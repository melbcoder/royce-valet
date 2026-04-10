import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from './lib/firebaseAdmin.js';
import { computeGuestAccessExpiry } from './lib/guestAccess.js';

const TEN_MINUTES_MS = 10 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getVehicleSnapshotData(vehicle) {
  return {
    tag: vehicle.tag || '',
    guestName: vehicle.guestName || '',
    roomNumber: vehicle.roomNumber || '',
    license: vehicle.license || '',
    make: vehicle.make || '',
    model: vehicle.model || '',
    color: vehicle.color || '',
    status: vehicle.status || 'parked',
    requested: Boolean(vehicle.requested),
    scheduledAt: vehicle.scheduledAt || null,
  };
}

async function resolveVehicleByToken(token) {
  const db = getAdminFirestore();
  const tokenHash = hashToken(token);
  const [activeSnapshot, historySnapshot, settingsSnap] = await Promise.all([
    db.collection('vehicles').where('guestAccessTokenHash', '==', tokenHash).limit(1).get(),
    db.collection('valetHistory').where('guestAccessTokenHash', '==', tokenHash).limit(1).get(),
    db.collection('settings').doc('app').get(),
  ]);

  const docSnap = !activeSnapshot.empty ? activeSnapshot.docs[0] : (!historySnapshot.empty ? historySnapshot.docs[0] : null);
  if (!docSnap) {
    return null;
  }

  const vehicle = docSnap.data() || {};
  const settings = settingsSnap.exists ? settingsSnap.data() || {} : {};
  const expiresAt = computeGuestAccessExpiry({
    departedAt: vehicle.departedAt,
    settings,
  });

  if (expiresAt !== null && Date.now() > expiresAt) {
    return { expired: true, ref: docSnap.ref, vehicle, expiresAt };
  }

  const storedExpiry = vehicle.guestAccessExpiresAt ?? null;
  if (storedExpiry !== expiresAt) {
    await docSnap.ref.update({ guestAccessExpiresAt: expiresAt });
  }

  return { ref: docSnap.ref, vehicle: { ...vehicle, guestAccessExpiresAt: expiresAt } };
}

async function addGuestAuditLog(db, vehicleTag, action, details = {}) {
  await db.collection('vehicleAudit').doc(`${vehicleTag}-${Date.now()}`).set({
    vehicleTag,
    action,
    details,
    timestamp: FieldValue.serverTimestamp(),
    user: {
      username: 'Guest',
      role: 'guest',
    },
  });
}

export default async function handler(req, res) {
  const token = req.method === 'GET'
    ? String(req.query?.t || '').trim()
    : String(req.body?.token || '').trim();

  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).json({ error: 'Invalid guest link' });
  }

  try {
    const db = getAdminFirestore();
    const resolved = await resolveVehicleByToken(token);
    if (!resolved) {
      return res.status(404).json({ error: 'Guest link not found or no longer active' });
    }

    if (resolved.expired) {
      await resolved.ref.update({
        guestAccessTokenHash: FieldValue.delete(),
        guestAccessExpiresAt: FieldValue.delete(),
        guestAccessIssuedAt: FieldValue.delete(),
      });
      return res.status(410).json({ error: 'Guest link expired' });
    }

    const { ref, vehicle } = resolved;
    const currentStatus = String(vehicle.status || '').toLowerCase();

    if (req.method === 'GET') {
      return res.status(200).json({ vehicle: getVehicleSnapshotData(vehicle) });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const action = String(req.body?.action || '').trim();

    if (action === 'request') {
      if (currentStatus === 'out') {
        return res.status(409).json({ error: 'Vehicle is currently out and cannot be requested' });
      }

      const prevStatus = currentStatus === 'requested' ? (vehicle.prevStatus || 'parked') : (vehicle.status || 'parked');
      await ref.update({
        status: 'requested',
        requested: true,
        requestedAt: Date.now(),
        scheduledAt: null,
        prevStatus,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await addGuestAuditLog(db, vehicle.tag, 'requested', {});
      const updated = await ref.get();
      return res.status(200).json({ vehicle: getVehicleSnapshotData(updated.data() || {}) });
    }

    if (action === 'cancel') {
      const targetStatus = currentStatus === 'requested' ? (vehicle.prevStatus || 'parked') : (vehicle.status || 'parked');
      await ref.update({
        requested: false,
        requestedAt: null,
        status: targetStatus,
        prevStatus: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await addGuestAuditLog(db, vehicle.tag, 'cancelled_request', {});
      const updated = await ref.get();
      return res.status(200).json({ vehicle: getVehicleSnapshotData(updated.data() || {}) });
    }

    if (action === 'schedule') {
      const requestedTime = String(req.body?.time || '').trim();
      const scheduledAt = Date.parse(requestedTime);
      if (!requestedTime || Number.isNaN(scheduledAt)) {
        return res.status(400).json({ error: 'Please choose a valid pickup time' });
      }
      if (scheduledAt - Date.now() < TEN_MINUTES_MS) {
        return res.status(400).json({ error: 'Please schedule at least 10 minutes in advance' });
      }
      if (currentStatus === 'out') {
        return res.status(409).json({ error: 'Vehicle is currently out and cannot be scheduled' });
      }

      await ref.update({
        scheduledAt: new Date(scheduledAt).toISOString(),
        requested: false,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await addGuestAuditLog(db, vehicle.tag, 'scheduled_request', { scheduledAt: new Date(scheduledAt).toISOString() });
      const updated = await ref.get();
      return res.status(200).json({ vehicle: getVehicleSnapshotData(updated.data() || {}) });
    }

    if (action === 'clear') {
      await ref.update({
        scheduledAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await addGuestAuditLog(db, vehicle.tag, 'cleared_schedule', {});
      const updated = await ref.get();
      return res.status(200).json({ vehicle: getVehicleSnapshotData(updated.data() || {}) });
    }

    return res.status(400).json({ error: 'Unsupported action' });
  } catch (error) {
    console.error('guest-vehicle error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}