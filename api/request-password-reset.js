// Vercel Serverless Function for requesting password reset via SMS OTP
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
    // Import Firebase Admin SDK using dynamic import
    const admin = (await import('firebase-admin')).default || (await import('firebase-admin'));
    const { initializeFirebaseAdmin } = await import('./lib/firebaseAdmin.js');
    
    // Initialize Firebase Admin if not already done
    if (!admin.apps.length) {
      initializeFirebaseAdmin();
    }

    const db = admin.firestore();
    const adminAuth = admin.auth();

    // Sanitize username
    const cleanUsername = String(username).toLowerCase().trim().slice(0, 50);
    const email = `${cleanUsername}@royce-valet.internal`;

    // Verify user exists in Firebase Auth
    let user;
    try {
      user = await adminAuth.getUserByEmail(email);
    } catch (error) {
      // User doesn't exist - return generic message for security
      return res.status(200).json({ 
        message: 'If an account exists with this username, an OTP will be sent to the registered phone number.' 
      });
    }

    // Get user data from Firestore
    const userDoc = await db.collection('users').doc(user.uid).get();
    
    if (!userDoc.exists()) {
      return res.status(200).json({ 
        message: 'If an account exists with this username, an OTP will be sent to the registered phone number.' 
      });
    }

    const userData = userDoc.data();
    const phoneNumber = userData.phoneNumber;

    if (!phoneNumber) {
      return res.status(200).json({ 
        message: 'If an account exists with this username, an OTP will be sent to the registered phone number.' 
      });
    }

    // Check rate limiting - max 3 OTPs per hour per user
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    const recentOTPs = await db.collection('passwordResets')
      .where('uid', '==', user.uid)
      .where('createdAt', '>', oneHourAgo)
      .where('deleted', '==', false)
      .get();

    if (recentOTPs.size >= 3) {
      return res.status(429).json({ 
        error: 'Too many reset requests. Please try again later.' 
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + (10 * 60 * 1000); // 10 minutes

    // Store OTP in Firestore
    const resetDocId = `${user.uid}-${Date.now()}`;
    await db.collection('passwordResets').doc(resetDocId).set({
      uid: user.uid,
      username: cleanUsername,
      phoneNumber: phoneNumber,
      otp: otp,
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

    const isUSNumber = phoneNumber.startsWith('+1');
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
            To: phoneNumber,
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
      await db.collection('auditLogs').add({
        action: 'PASSWORD_RESET_REQUESTED',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        username: cleanUsername,
        uid: user.uid,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress
      });

      return res.status(200).json({ 
        message: 'OTP sent to registered phone number',
        resetDocId: resetDocId
      });

    } catch (smsError) {
      console.error('Error sending SMS:', smsError);
      return res.status(500).json({ error: 'Failed to send OTP' });
    }

  } catch (error) {
    console.error('Error in password reset request:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
