import crypto from 'crypto';
import { getAdminAuth, getAdminFirestore } from '../server/lib/firebaseAdmin.js';
import { computeGuestAccessExpiry, getGuestLinkRetentionDays } from '../server/lib/guestAccess.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  const tag = typeof req.body?.tag === 'string' ? req.body.tag.trim() : '';
  if (!/^[a-zA-Z0-9]{1,20}$/.test(tag)) {
    return res.status(400).json({ error: 'Missing or invalid vehicle tag' });
  }

  try {
    const adminAuth = getAdminAuth();
    const adminDb = getAdminFirestore();
    const decoded = await adminAuth.verifyIdToken(authHeader.slice(7));

    const userDoc = await adminDb.collection('users').doc(decoded.uid).get();
    if (!userDoc.exists) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const userData = userDoc.data() || {};
    const pages = Array.isArray(userData.pages) ? userData.pages : [];
    const hasAccess = userData.role === 'admin' || pages.includes('valet');
    if (!hasAccess) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const vehicleRef = adminDb.collection('vehicles').doc(tag);
    const vehicleSnap = await vehicleRef.get();
    if (!vehicleSnap.exists) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    const vehicle = vehicleSnap.data() || {};
    const settingsSnap = await adminDb.collection('settings').doc('app').get();
    const settings = settingsSnap.exists ? settingsSnap.data() || {} : {};

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const issuedAt = Date.now();
    const expiresAt = computeGuestAccessExpiry({
      departedAt: vehicle.departedAt,
      settings,
    });

    await vehicleRef.update({
      guestAccessTokenHash: tokenHash,
      guestAccessExpiresAt: expiresAt,
      guestAccessIssuedAt: issuedAt,
    });

    return res.status(200).json({ token: rawToken, expiresAt, retentionDays: getGuestLinkRetentionDays(settings) });
  } catch (error) {
    console.error('guest-access-token error:', error);
    if (error.code === 'auth/id-token-expired' || error.code === 'auth/argument-error') {
      return res.status(401).json({ error: 'Session expired, please refresh the page' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}