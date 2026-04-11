// Vercel Serverless Function for resetting password with verified OTP
import crypto from 'crypto';
import { getAdminAuth, getAdminFirestore } from '../server/lib/firebaseAdmin.js';

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

  const { resetDocId, newPassword, resetToken } = req.body;

  if (!resetDocId || !newPassword || !resetToken) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (typeof resetToken !== 'string' || !/^[a-f0-9]{64}$/.test(resetToken)) {
    return res.status(400).json({ error: 'Invalid reset token' });
  }

  // Validate password strength
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const hasUpperCase = /[A-Z]/.test(newPassword);
  const hasLowerCase = /[a-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);

  if (!hasUpperCase || !hasLowerCase || !hasNumber) {
    return res.status(400).json({ 
      error: 'Password must contain uppercase, lowercase, and numbers' 
    });
  }

  try {
    const db = getAdminFirestore();
    const adminAuth = getAdminAuth();

    // Get the password reset document
    const resetDoc = await db.collection('passwordResets').doc(resetDocId).get();

    if (!resetDoc.exists) {
      return res.status(400).json({ error: 'Invalid reset request' });
    }

    const resetData = resetDoc.data();

    // Check if verified
    if (!resetData.verified) {
      return res.status(400).json({ error: 'OTP not verified' });
    }

    // Check if deleted/expired
    if (resetData.deleted) {
      return res.status(400).json({ error: 'Reset request expired' });
    }

    // Check if verification token is still valid (30 minutes to reset after OTP verification)
    const thirtyMinutesInMs = 30 * 60 * 1000;
    if (resetData.verifiedAt && (Date.now() - resetData.verifiedAt) > thirtyMinutesInMs) {
      await db.collection('passwordResets').doc(resetDocId).update({
        deleted: true
      });
      return res.status(400).json({ error: 'Reset window expired. Please request a new OTP.' });
    }

    const suppliedResetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expectedResetTokenHash = String(resetData.resetTokenHash || '');
    const tokenIsValid = safeEqualHex(expectedResetTokenHash, suppliedResetTokenHash);
    const tokenNotExpired = Number.isFinite(resetData.resetTokenExpiresAt)
      ? Date.now() <= resetData.resetTokenExpiresAt
      : false;

    if (!tokenIsValid || !tokenNotExpired) {
      return res.status(401).json({ error: 'Reset token is invalid or expired' });
    }

    const uid = resetData.uid;

    // Update password in Firebase Auth
    try {
      await adminAuth.updateUser(uid, {
        password: newPassword
      });
    } catch (authError) {
      console.error('Error updating password:', authError);
      return res.status(500).json({ error: 'Failed to update password' });
    }

    // Mark reset as completed
    await db.collection('passwordResets').doc(resetDocId).update({
      deleted: true,
      completedAt: Date.now(),
      resetTokenHash: null,
      resetTokenExpiresAt: null,
    });

    // Log successful password reset
    const { FieldValue } = await import('firebase-admin/firestore');
    await db.collection('auditLogs').add({
      action: 'PASSWORD_RESET_COMPLETED',
      timestamp: FieldValue.serverTimestamp(),
      uid: uid,
      username: resetData.username,
      method: 'SMS_OTP'
    });

    // Optional: Invalidate all existing sessions by updating lastPasswordChange
    await db.collection('users').doc(uid).update({
      lastPasswordChange: Date.now()
    });

    return res.status(200).json({ 
      message: 'Password reset successfully. Please log in with your new password.',
      success: true
    });

  } catch (error) {
    console.error('Error in password reset:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
