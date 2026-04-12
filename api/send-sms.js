import { getAdminAuth, getAdminFirestore } from '../server/lib/firebaseAdmin.js';

const RATE_WINDOW_MS = 60 * 1000;
const MAX_PER_UID_PER_WINDOW = 10;
const MAX_PER_IP_PER_WINDOW = 20;
const MAX_PER_DESTINATION_PER_WINDOW = 5;

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

function hashKey(value) {
  return Buffer.from(String(value || '')).toString('base64url');
}

function windowBucket() {
  return Math.floor(Date.now() / RATE_WINDOW_MS);
}

async function bumpRateCounter(db, scope, id, maxAllowed) {
  const bucket = windowBucket();
  const key = `${scope}:${hashKey(id)}:${bucket}`;
  const ref = db.collection('smsRateLimits').doc(key);
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() || {}) : {};
    const count = Number(data.count || 0);
    if (count >= maxAllowed) {
      throw Object.assign(new Error('SMS rate limit exceeded'), { code: 'RATE_LIMITED' });
    }

    tx.set(ref, {
      scope,
      idHash: hashKey(id),
      count: count + 1,
      createdAt: Number(data.createdAt || now),
      updatedAt: now,
      expiresAt: now + (5 * RATE_WINDOW_MS),
    }, { merge: true });
  });
}

async function enforceRateLimits(db, uid, ip, to) {
  await bumpRateCounter(db, 'uid', uid, MAX_PER_UID_PER_WINDOW);
  await bumpRateCounter(db, 'ip', ip, MAX_PER_IP_PER_WINDOW);
  await bumpRateCounter(db, 'to', to, MAX_PER_DESTINATION_PER_WINDOW);
}

// Vercel Serverless Function for sending SMS via Twilio
export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  const idToken = authHeader.slice(7);

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userDoc = await getAdminFirestore().collection('users').doc(decoded.uid).get();
  if (!userDoc.exists) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const userData = userDoc.data() || {};
  const pages = Array.isArray(userData.pages) ? userData.pages : [];
  const hasSmsAccess = userData.role === 'admin' || pages.some((p) => ['valet', 'luggage', 'amenities'].includes(p));
  if (!hasSmsAccess) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const to = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
  const rawMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  // Strip null bytes and non-printable control characters; preserve \n for multi-line SMS
  const message = rawMessage.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  if (!to || !message) {
    return res.status(400).json({ error: 'Missing required fields: to, message' });
  }

  if (!/^\+[1-9]\d{1,14}$/.test(to)) {
    return res.status(400).json({ error: 'Invalid phone number format' });
  }

  const db = getAdminFirestore();
  const clientIp = getClientIp(req);

  try {
    await enforceRateLimits(db, decoded.uid, clientIp, to);
  } catch (rateErr) {
    if (rateErr?.code === 'RATE_LIMITED') {
      return res.status(429).json({ error: 'Too many SMS requests. Please try again shortly.' });
    }
    throw rateErr;
  }

  if (message.length > 1600) {
    return res.status(400).json({ error: 'Message is too long' });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const usNumber = process.env.TWILIO_US_PHONE_NUMBER;
  const auNumber = process.env.TWILIO_AU_PHONE_NUMBER;

  if (!accountSid || !authToken || !auNumber) {
    console.error('Missing Twilio credentials');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Determine which number to send from based on destination country
  // US numbers start with +1, use US number for those
  const isUSNumber = to.startsWith('+1');
  const fromNumber = isUSNumber ? (usNumber || auNumber) : auNumber;

  console.log(`Sending to ${to.substring(0, 5)}... from ${fromNumber.substring(0, 5)}... (${isUSNumber ? 'US' : 'International'})`);

  try {
    // Create the authorization header
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    // Call Twilio API
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: to,
          From: fromNumber,
          Body: message,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Twilio API error:', data);
      return res.status(response.status).json({ error: 'Failed to send SMS' });
    }

    // Twilio can return 200 with error info embedded
    if (data.error_code || data.error_message || data.status === 'failed' || data.status === 'undelivered') {
      console.error('Twilio message failure:', data);
      return res.status(502).json({ error: 'Failed to send SMS' });
    }

    return res.status(200).json({
      success: true,
      messageSid: data.sid,
      status: data.status
    });
  } catch (error) {
    console.error('Error sending SMS:', error);
    return res.status(500).json({ error: 'Failed to send SMS' });
  }
}
