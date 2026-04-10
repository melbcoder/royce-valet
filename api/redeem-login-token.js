import crypto from 'crypto';
import { getAdminAuth, getAdminFirestore } from '../server/lib/firebaseAdmin.js';

// Expected token format: 64 lowercase hex characters
const TOKEN_REGEX = /^[a-f0-9]{64}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.body || {};

  // Validate token format before touching Firestore
  if (!token || typeof token !== 'string' || !TOKEN_REGEX.test(token)) {
    return res.status(400).json({ error: 'Invalid token' });
  }

  try {
    const adminAuth = getAdminAuth();
    const adminDb = getAdminFirestore();

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const docRef = adminDb.collection('loginTokens').doc(tokenHash);

    let tokenData;

    // Use a transaction to guarantee single-use atomicity
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);

      if (!snap.exists) {
        throw Object.assign(new Error('Token not found'), { code: 'NOT_FOUND' });
      }

      const data = snap.data();

      if (data.used) {
        throw Object.assign(new Error('Token already used'), { code: 'USED' });
      }
      if (Date.now() > data.expiresAt) {
        throw Object.assign(new Error('Token expired'), { code: 'EXPIRED' });
      }

      // Mark as used atomically before issuing custom token
      tx.update(docRef, { used: true, usedAt: Date.now() });
      tokenData = data;
    });

    // Issue a Firebase Custom Token with the user's non-sensitive claims embedded
    const customToken = await adminAuth.createCustomToken(tokenData.uid, {
      username: tokenData.username,
      role: tokenData.role,
      mustChangePassword: tokenData.mustChangePassword,
    });

    // Schedule cleanup of the now-used doc (best-effort, non-blocking)
    docRef.delete().catch(() => {});

    return res.status(200).json({ customToken });
  } catch (err) {
    const knownCode = err.code;
    if (knownCode === 'NOT_FOUND' || knownCode === 'USED' || knownCode === 'EXPIRED') {
      return res.status(401).json({ error: 'QR code is invalid or has expired' });
    }
    console.error('redeem-login-token error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
