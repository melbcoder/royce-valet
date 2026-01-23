// Vercel Serverless Function for sending SMS via Twilio
export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({ error: 'Missing required fields: to, message' });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const usNumber = process.env.TWILIO_US_PHONE_NUMBER;
  const auNumber = process.env.TWILIO_AU_PHONE_NUMBER;

  if (!accountSid || !authToken || !usNumber || !auNumber) {
    console.error('Missing Twilio credentials');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Determine which number to send from based on destination country
  // US numbers start with +1, use US number for those
  const isUSNumber = to.startsWith('+1');
  const fromNumber = isUSNumber ? usNumber : auNumber;

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
      return res.status(response.status).json({ 
        error: 'Failed to send SMS', 
        details: data 
      });
    }

    return res.status(200).json({ 
      success: true, 
      messageSid: data.sid 
    });
  } catch (error) {
    console.error('Error sending SMS:', error);
    return res.status(500).json({ 
      error: 'Failed to send SMS', 
      details: error.message 
    });
  }
}
