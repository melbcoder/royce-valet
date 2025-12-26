// SMS Service - Frontend interface for sending SMS via Twilio

// ⚠️ SECURITY WARNING: Client-side rate limiting can be bypassed
// Implement server-side rate limiting in your /api/send-sms endpoint
// Example using express-rate-limit:
// const rateLimit = require('express-rate-limit');
// const smsLimiter = rateLimit({
//   windowMs: 60 * 1000, // 1 minute
//   max: 5, // 5 requests per minute per IP
//   message: 'Too many SMS requests, please try again later'
// });

// Rate limiting storage (client-side defense-in-depth)
const smsRateLimit = new Map();
const MAX_SMS_PER_MINUTE = 5;
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

// Enhanced input validation
const validatePhoneNumber = (phone) => {
  // E.164 format: +[country code][subscriber number]
  const phoneRegex = /^\+[1-9]\d{1,14}$/;
  // Also check for common invalid patterns
  if (!phoneRegex.test(phone)) return false;
  // Prevent excessively long numbers
  if (phone.length > 16) return false;
  return true;
};

const validateTag = (tag) => {
  // Alphanumeric only, 1-20 characters
  if (typeof tag !== 'string' && typeof tag !== 'number') return false;
  const tagStr = String(tag);
  if (tagStr.length > 20 || tagStr.length < 1) return false;
  return /^[a-zA-Z0-9]+$/.test(tagStr);
};

const sanitizeMessage = (message) => {
  // Remove potentially dangerous characters
  const sanitized = String(message)
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/onerror=/gi, '')
    .replace(/onload=/gi, '')
    .slice(0, 1600);
  return sanitized;
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
  if (!appUrl.match(/^https:\/\//i) && !appUrl.match(/^http:\/\/localhost/i)) {
    throw new Error('Invalid app URL configuration');
  }
  
  // Ensure tag is properly encoded
  const encodedTag = encodeURIComponent(String(tag));
  const guestLink = `${appUrl}/guest/${encodedTag}`;
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
    
    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(data.error || 'Failed to send SMS');
    }
    
    const data = await response.json();

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

