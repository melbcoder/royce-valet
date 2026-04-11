// Vercel Serverless Function for verifying OTP
import crypto from 'crypto';
import { getAdminAuth, getAdminFirestore } from '../server/lib/firebaseAdmin.js';

function getOtpSecret() {
  return process.env.PASSWORD_RESET_OTP_SECRET || '';
}

function hashOtp(resetDocId, otp) {
  const secret = getOtpSecret();
  if (!secret) {
    throw new Error('Missing PASSWORD_RESET_OTP_SECRET for OTP hashing');
  }
  return crypto.createHmac('sha256', secret).update(`${resetDocId}:${otp}`).digest('hex');
}

function safeEqualHex(expectedHex, actualHex) {
  if (!expectedHex || !actualHex || expectedHex.length !== actualHex.length) {
    return false;
  }
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualHex, 'hex');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { resetDocId, otp } = req.body;

  if (!resetDocId || !otp) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (typeof otp !== 'string' || otp.length !== 6 || !/^\d+$/.test(otp)) {
    return res.status(400).json({ error: 'Invalid OTP format' });
  }

  if (typeof resetDocId !== 'string' || resetDocId.length > 200) {
    return res.status(400).json({ error: 'Invalid reset request' });
  }

  try {
    const db = getAdminFirestore();

    // Get the password reset document
    const resetDoc = await db.collection('passwordResets').doc(resetDocId).get();

    if (!resetDoc.exists) {
      return res.status(400).json({ error: 'Invalid or expired reset request' });
    }

    const resetData = resetDoc.data();

    // Check if already verified
    if (resetData.verified) {
      return res.status(400).json({ error: 'OTP already used' });
    }

    // Check if deleted/expired
    if (resetData.deleted || resetData.expiresAt < Date.now()) {
      // Mark as deleted for cleanup
      await db.collection('passwordResets').doc(resetDocId).update({
        deleted: true
      });
      return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    }

    // Check attempt count (max 5 attempts)
    if (resetData.attempts >= 5) {
      await db.collection('passwordResets').doc(resetDocId).update({
        deleted: true
      });
      return res.status(429).json({ error: 'Too many attempts. Please request a new OTP.' });
    }

    // Verify OTP hash in constant time
    const expectedOtpHash = String(resetData.otpHash || '');
    const suppliedOtpHash = hashOtp(resetDocId, otp);
    if (!safeEqualHex(expectedOtpHash, suppliedOtpHash)) {
      // Increment attempts
      const { FieldValue } = await import('firebase-admin/firestore');
      await db.collection('passwordResets').doc(resetDocId).update({
        attempts: FieldValue.increment(1)
      });

      // Log failed attempt
      await db.collection('auditLogs').add({
        action: 'PASSWORD_RESET_OTP_FAILED',
        timestamp: FieldValue.serverTimestamp(),
        uid: resetData.uid,
        username: resetData.username,
        reason: 'Invalid OTP'
      });

      return res.status(401).json({ error: 'Invalid OTP' });
    }

    // OTP is correct - mark as verified and issue one-time reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const resetTokenExpiresAt = Date.now() + (30 * 60 * 1000);
    await db.collection('passwordResets').doc(resetDocId).update({
      verified: true,
      verifiedAt: Date.now(),
      resetTokenHash,
      resetTokenExpiresAt,
    });

    // Log successful verification
    const { FieldValue } = await import('firebase-admin/firestore');
    await db.collection('auditLogs').add({
      action: 'PASSWORD_RESET_OTP_VERIFIED',
      timestamp: FieldValue.serverTimestamp(),
      uid: resetData.uid,
      username: resetData.username
    });

    return res.status(200).json({ 
      message: 'OTP verified successfully',
      resetToken,
    });

  } catch (error) {
    console.error('Error in OTP verification:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
