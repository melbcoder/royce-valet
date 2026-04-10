import crypto from 'crypto';
import { getAdminAuth, getAdminFirestore } from '../server/lib/firebaseAdmin.js';

const TOKEN_TTL_MS = 60 * 1000; // 60 seconds

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  const idToken = authHeader.slice(7);

  try {
    const adminAuth = getAdminAuth();
    const adminDb = getAdminFirestore();

    // Verify the caller is authenticated with Firebase
    const decoded = await adminAuth.verifyIdToken(idToken);

    // Fetch their Firestore user profile
    const userDoc = await adminDb.collection('users').doc(decoded.uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userData = userDoc.data();

    // Generate a cryptographically secure 32-byte random token (64 hex chars)
    const rawToken = crypto.randomBytes(32).toString('hex');

    // Store only the SHA-256 hash as the document ID — the raw token never persists server-side
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await adminDb.collection('loginTokens').doc(tokenHash).set({
      uid: decoded.uid,
      username: userData.username || '',
      role: userData.role || 'staff',
      mustChangePassword: userData.mustChangePassword || false,
      createdAt: Date.now(),
      expiresAt: Date.now() + TOKEN_TTL_MS,
      used: false,
    });

    return res.status(200).json({ token: rawToken });
  } catch (err) {
    console.error('generate-login-token error:', err.code || err.message);
    if (err.code === 'auth/id-token-expired' || err.code === 'auth/argument-error') {
      return res.status(401).json({ error: 'Session expired, please refresh the page' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}
