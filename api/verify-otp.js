// Vercel Serverless Function for verifying OTP
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

  try {
    const admin = require('firebase-admin');
    const { initializeFirebaseAdmin } = require('./lib/firebaseAdmin');
    
    if (!admin.apps.length) {
      initializeFirebaseAdmin();
    }

    const db = admin.firestore();

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

    // Verify OTP
    if (resetData.otp !== otp) {
      // Increment attempts
      await db.collection('passwordResets').doc(resetDocId).update({
        attempts: admin.firestore.FieldValue.increment(1)
      });

      // Log failed attempt
      await db.collection('auditLogs').add({
        action: 'PASSWORD_RESET_OTP_FAILED',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        uid: resetData.uid,
        username: resetData.username,
        reason: 'Invalid OTP'
      });

      return res.status(401).json({ error: 'Invalid OTP' });
    }

    // OTP is correct - mark as verified
    await db.collection('passwordResets').doc(resetDocId).update({
      verified: true,
      verifiedAt: Date.now()
    });

    // Log successful verification
    await db.collection('auditLogs').add({
      action: 'PASSWORD_RESET_OTP_VERIFIED',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      uid: resetData.uid,
      username: resetData.username
    });

    return res.status(200).json({ 
      message: 'OTP verified successfully',
      uid: resetData.uid
    });

  } catch (error) {
    console.error('Error in OTP verification:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
