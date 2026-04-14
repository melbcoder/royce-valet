import { getAdminAuth, getAdminFirestore } from '../server/lib/firebaseAdmin.js';

const VALID_ROLES = new Set(['admin', 'user']);
const VALID_PAGE_IDS = new Set([
  'dashboard',
  'valet',
  'valet-history',
  'luggage',
  'luggage-history',
  'amenities',
  'amenities-history',
  'maintenance',
  'maintenance/jobs',
  'maintenance/contractor-sign-in',
  'accounts-payable',
  'accounts-payable/travel-agents',
  'accounts-payable/suppliers',
]);

function sanitizeUsername(value) {
  return String(value || '').toLowerCase().trim().slice(0, 50);
}

function sanitizePhone(value) {
  return String(value || '').replace(/[\s\-()]/g, '').slice(0, 25);
}

function sanitizePages(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((p) => String(p || '').trim()).filter((p) => VALID_PAGE_IDS.has(p)))];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  const idToken = authHeader.slice(7);

  const cleanUsername = sanitizeUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const role = String(req.body?.role || 'user').trim();
  const phoneNumber = sanitizePhone(req.body?.phoneNumber);
  const pages = sanitizePages(req.body?.pages);
  const mustChangePassword = req.body?.mustChangePassword !== false;

  if (!cleanUsername || cleanUsername.length < 2) {
    return res.status(400).json({ error: 'Invalid username' });
  }

  if (password.length < 8 || password.length > 100) {
    return res.status(400).json({ error: 'Invalid password length' });
  }

  if (!VALID_ROLES.has(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const email = `${cleanUsername}@royce-valet.internal`;

  let createdUid = null;

  try {
    const adminAuth = getAdminAuth();
    const adminDb = getAdminFirestore();
    const decoded = await adminAuth.verifyIdToken(idToken);

    const callerDoc = await adminDb.collection('users').doc(decoded.uid).get();
    const callerData = callerDoc.exists ? (callerDoc.data() || {}) : {};
    if (callerData.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const userRecord = await adminAuth.createUser({
      email,
      password,
      displayName: cleanUsername,
    });
    createdUid = userRecord.uid;

    await adminDb.collection('users').doc(createdUid).set({
      uid: createdUid,
      username: cleanUsername,
      email,
      role,
      phoneNumber,
      pages,
      mustChangePassword: Boolean(mustChangePassword),
      createdAt: Date.now(),
      createdBy: decoded.uid,
    });

    return res.status(201).json({
      uid: createdUid,
      username: cleanUsername,
      role,
    });
  } catch (err) {
    if (createdUid) {
      try {
        await getAdminAuth().deleteUser(createdUid);
      } catch {
        // Best effort cleanup
      }
    }

    if (err?.code === 'auth/email-already-exists') {
      return res.status(409).json({ error: 'Username already exists', code: 'auth/email-already-in-use' });
    }
    if (err?.code === 'auth/id-token-expired' || err?.code === 'auth/argument-error') {
      return res.status(401).json({ error: 'Session expired, please refresh the page' });
    }

    console.error('create-user error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
