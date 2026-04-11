// Vercel Serverless Function for requesting password reset via SMS OTP
import crypto from 'crypto';
import { getAdminAuth, getAdminFirestore } from '../server/lib/firebaseAdmin.js';

function maskPhoneLast3(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 3) return 'xxx';
  return `xxx${digits.slice(-3)}`;
}

function getOtpSecret() {
  return process.env.PASSWORD_RESET_OTP_SECRET
    || process.env.FIREBASE_PRIVATE_KEY
    || process.env.TWILIO_AUTH_TOKEN
    || '';
}

function hashOtp(resetDocId, otp) {
  const secret = getOtpSecret();
  if (!secret) {
    throw new Error('Missing PASSWORD_RESET_OTP_SECRET (or fallback secret) for OTP hashing');
  }
  return crypto.createHmac('sha256', secret).update(`${resetDocId}:${otp}`).digest('hex');
}

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username } = req.body;

  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Username is required' });
  }

  try {
    const db = getAdminFirestore();
    const adminAuth = getAdminAuth();

    // Sanitize username
    const cleanUsername = String(username).toLowerCase().trim().slice(0, 50);
    const email = `${cleanUsername}@royce-valet.internal`;

    // Verify user exists in Firebase Auth
    let user;
    try {
      user = await adminAuth.getUserByEmail(email);
    } catch (error) {
      return res.status(404).json({
        error: 'No account found for that username.'
      });
    }

    // Get user data from Firestore
    const userDoc = await db.collection('users').doc(user.uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        error: 'No account profile found. Please contact an admin.'
      });
    }

    const userData = userDoc.data();
    const phoneNumber = userData.phoneNumber || userData.phone || userData.mobile || '';
    const cleanPhone = String(phoneNumber).replace(/[\s\-\(\)]/g, '');

    if (!cleanPhone) {
      console.info('Password reset skipped: no phone on user profile', { uid: user.uid });
      return res.status(400).json({
        error: 'No phone number is saved for this account. Please contact an admin.'
      });
    }

    // One-time backfill so all users end up with a canonical phoneNumber field.
    if (!userData.phoneNumber || userData.phoneNumber !== cleanPhone) {
      await db.collection('users').doc(user.uid).set({
        phoneNumber: cleanPhone
      }, { merge: true });
    }

    // Check rate limiting - max 3 OTPs per hour per user.
    // Use a single-field query to avoid composite-index runtime failures.
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    const userOtpDocs = await db.collection('passwordResets')
      .where('uid', '==', user.uid)
      .get();

    const recentCount = userOtpDocs.docs.filter((d) => {
      const data = d.data() || {};
      return !data.deleted && Number(data.createdAt || 0) > oneHourAgo;
    }).length;

    if (recentCount >= 3) {
      return res.status(429).json({ 
        error: 'Too many reset requests. Please try again later.' 
      });
    }

    // Generate 6-digit OTP using cryptographically secure randomness
    const otp = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
    const expiresAt = Date.now() + (10 * 60 * 1000); // 10 minutes

    // Store OTP in Firestore
    const resetDocId = `${user.uid}-${Date.now()}`;
    const otpHash = hashOtp(resetDocId, otp);
    await db.collection('passwordResets').doc(resetDocId).set({
      uid: user.uid,
      username: cleanUsername,
      phoneNumber: phoneNumber,
      otpHash,
      verified: false,
      attempts: 0,
      createdAt: Date.now(),
      expiresAt: expiresAt,
      deleted: false
    });

    // Send OTP via SMS
    const message = `Your Royce Valet password reset code is: ${otp}\n\nThis code expires in 10 minutes.\n\nDo not share this code with anyone.`;
    
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const auNumber = process.env.TWILIO_AU_PHONE_NUMBER;

    if (!accountSid || !authToken || !auNumber) {
      console.error('Missing Twilio credentials');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const isUSNumber = cleanPhone.startsWith('+1');
    const usNumber = process.env.TWILIO_US_PHONE_NUMBER;
    const fromNumber = isUSNumber ? (usNumber || auNumber) : auNumber;

    try {
      const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

      const smsResponse = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: cleanPhone,
            From: fromNumber,
            Body: message,
          }),
        }
      );

      if (!smsResponse.ok) {
        console.error('SMS send failed:', await smsResponse.text());
        return res.status(500).json({ error: 'Failed to send OTP' });
      }

      // Log the password reset request (audit trail)
      const { FieldValue } = await import('firebase-admin/firestore');
      await db.collection('auditLogs').add({
        action: 'PASSWORD_RESET_REQUESTED',
        timestamp: FieldValue.serverTimestamp(),
        username: cleanUsername,
        uid: user.uid,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress
      });

      return res.status(200).json({ 
        message: 'OTP sent to registered phone number',
        resetDocId: resetDocId,
        maskedPhone: maskPhoneLast3(cleanPhone)
      });

    } catch (smsError) {
      console.error('Error sending SMS:', smsError);
      return res.status(500).json({ error: 'Failed to send OTP' });
    }

  } catch (error) {
    console.error('Error in password reset request:', error);
    return res.status(500).json({ error: error?.message || 'Internal server error' });
  }
}
