import crypto from 'crypto';
import { getAdminAuth, getAdminFirestore } from './lib/firebaseAdmin.js';

const DEFAULT_GUEST_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function computeExpiry(departureDate) {
  if (typeof departureDate !== 'string' || !departureDate.trim()) {
    return Date.now() + DEFAULT_GUEST_LINK_TTL_MS;
  }

  const parsed = Date.parse(`${departureDate}T23:59:59Z`);
  if (Number.isNaN(parsed)) {
    return Date.now() + DEFAULT_GUEST_LINK_TTL_MS;
  }

  return Math.max(Date.now() + 24 * 60 * 60 * 1000, parsed + 48 * 60 * 60 * 1000);
}

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
    if (String(vehicle.status || '').toLowerCase() === 'departed') {
      return res.status(409).json({ error: 'Guest access is not available for departed vehicles' });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = computeExpiry(vehicle.departureDate);

    await vehicleRef.update({
      guestAccessTokenHash: tokenHash,
      guestAccessExpiresAt: expiresAt,
      guestAccessIssuedAt: Date.now(),
    });

    return res.status(200).json({ token: rawToken, expiresAt });
  } catch (error) {
    console.error('guest-access-token error:', error);
    if (error.code === 'auth/id-token-expired' || error.code === 'auth/argument-error') {
      return res.status(401).json({ error: 'Session expired, please refresh the page' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}