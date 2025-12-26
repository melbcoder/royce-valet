// SMS Service - Frontend interface for sending SMS via Twilio

// Rate limiting storage
const smsRateLimit = new Map();
const MAX_SMS_PER_MINUTE = 5;
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

// Input validation
const validatePhoneNumber = (phone) => {
  // Basic international phone number validation
  const phoneRegex = /^\+[1-9]\d{1,14}$/;
  return phoneRegex.test(phone);
};

const validateTag = (tag) => {
  return /^[a-zA-Z0-9]{1,20}$/.test(String(tag));
};

const sanitizeMessage = (message) => {
  // Remove potentially dangerous characters but preserve spaces and punctuation
  return String(message).replace(/[<>]/g, '').slice(0, 1600); // SMS limit
};

const checkRateLimit = (phone) => {
  const now = Date.now();
  const key = phone;
  
  if (!smsRateLimit.has(key)) {
    smsRateLimit.set(key, []);
  }
  
  const attempts = smsRateLimit.get(key);
  // Remove old attempts outside the window
  const recentAttempts = attempts.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
  
  if (recentAttempts.length >= MAX_SMS_PER_MINUTE) {
    throw new Error('Rate limit exceeded. Please try again later.');
  }
  
  recentAttempts.push(now);
  smsRateLimit.set(key, recentAttempts);
};

export async function sendWelcomeSMS(phone, tag) {
  // Input validation
  if (!validatePhoneNumber(phone)) {
    throw new Error('Invalid phone number format');
  }
  
  if (!validateTag(tag)) {
    throw new Error('Invalid tag format');
  }

  // Rate limiting
  checkRateLimit(phone);

  const appUrl = import.meta.env.VITE_APP_URL || window.location.origin;
  
  // Validate app URL
  if (!appUrl.startsWith('https://') && !appUrl.startsWith('http://localhost')) {
    throw new Error('Invalid app URL configuration');
  }
  
  const guestLink = `${appUrl}/guest/${encodeURIComponent(tag)}`;
  const from = 'The Royce';

  const message = sanitizeMessage(`Welcome to The Royce Hotel. Your valet tag is #${tag} — we'll take care of the rest.\n\nWhen you're ready for your vehicle, request it here: ${guestLink}`);

  console.log('Attempting to send SMS to:', phone.replace(/\d(?=\d{4})/g, '*'));
  
  try {
    const response = await fetch('/api/send-sms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: phone,
        message: message,
        from: from,
      }),
    });

    console.log('Response status:', response.status);
    
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to send SMS');
    }

    return { success: true, messageSid: data.messageSid };
  } catch (error) {
    console.error('Error sending SMS:', error);
    throw error;
  }
}

export async function sendVehicleReadySMS(phone, tag) {
  if (!validatePhoneNumber(phone)) {
    throw new Error('Invalid phone number format');
  }
  
  if (!validateTag(tag)) {
    throw new Error('Invalid tag format');
  }

  checkRateLimit(phone);

  const message = sanitizeMessage(`Your vehicle (#${tag}) is ready at the driveway. Thank you for choosing The Royce Hotel!`);

  try {
    const response = await fetch('/api/send-sms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: phone,
        message: message,
        from: 'The Royce',
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to send SMS');
    }

    return { success: true, messageSid: data.messageSid };
  } catch (error) {
    console.error('Error sending SMS:', error);
    throw error;
  }
}

export async function sendRoomReadySMS(phone, roomNumber) {
  if (!validatePhoneNumber(phone)) {
    throw new Error('Invalid phone number format');
  }

  checkRateLimit(phone);

  const message = sanitizeMessage(`Greetings from The Royce! We are pleased to inform you that your room is ready. Please stop by the front desk to collect your keys.`);

  try {
    const response = await fetch('/api/send-sms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: phone,
        message: message,
        from: 'The Royce',
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to send SMS');
    }

    return { success: true, messageSid: data.messageSid };
  } catch (error) {
    console.error('Error sending SMS:', error);
    throw error;
  }
}

