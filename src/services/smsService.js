// SMS Service - Frontend interface for sending SMS via Twilio
import { auth, db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';

const DEFAULT_SMS_TEMPLATES = {
  welcome: "Welcome to The Royce Hotel. Your valet tag is #[VALET_TAG] - we'll take care of the rest.\n\nWhen you're ready for your vehicle, request it here: [VALET_LINK]",
  vehicleReady: 'Your vehicle (#[VALET_TAG]) is ready at the driveway. Thank you for choosing The Royce Hotel!',
  roomReady: 'Greetings from The Royce! We are pleased to inform you that your room is ready. Please stop by the front desk to collect your keys.',
  departure: 'Your bags are in very good company.\nTag numbers: [DEP_TAGS].\nGo explore, indulge, wander - we\'ll mind the details.',
};

const SETTINGS_CACHE_TTL_MS = 60 * 1000;
let smsTemplateCache = {
  expiresAt: 0,
  templates: DEFAULT_SMS_TEMPLATES,
};

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

const applySmsTemplate = (template, variables = {}) => {
  const source = String(template || '');
  return source.replace(/\[([A-Z_]+)\]/gi, (full, variableName) => {
    const key = String(variableName || '').toUpperCase();
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      return String(variables[key] ?? '');
    }
    return full;
  });
};

const getSmsTemplates = async () => {
  const now = Date.now();
  if (smsTemplateCache.expiresAt > now) {
    return smsTemplateCache.templates;
  }

  try {
    const settingsSnap = await getDoc(doc(db, 'settings', 'app'));
    const data = settingsSnap.exists() ? (settingsSnap.data() || {}) : {};
    const templates = {
      welcome: typeof data.smsWelcomeTemplate === 'string' && data.smsWelcomeTemplate.trim()
        ? data.smsWelcomeTemplate
        : DEFAULT_SMS_TEMPLATES.welcome,
      vehicleReady: typeof data.smsVehicleReadyTemplate === 'string' && data.smsVehicleReadyTemplate.trim()
        ? data.smsVehicleReadyTemplate
        : DEFAULT_SMS_TEMPLATES.vehicleReady,
      roomReady: typeof data.smsRoomReadyTemplate === 'string' && data.smsRoomReadyTemplate.trim()
        ? data.smsRoomReadyTemplate
        : DEFAULT_SMS_TEMPLATES.roomReady,
      departure: typeof data.smsDepartureTemplate === 'string' && data.smsDepartureTemplate.trim()
        ? data.smsDepartureTemplate
        : DEFAULT_SMS_TEMPLATES.departure,
    };

    smsTemplateCache = {
      expiresAt: now + SETTINGS_CACHE_TTL_MS,
      templates,
    };

    return templates;
  } catch (error) {
    console.warn('Failed to load SMS templates from settings, using defaults:', error);
    smsTemplateCache = {
      expiresAt: now + 10 * 1000,
      templates: DEFAULT_SMS_TEMPLATES,
    };
    return DEFAULT_SMS_TEMPLATES;
  }
};

const getAuthHeaders = async () => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('You must be signed in to send SMS');
  }

  const idToken = await currentUser.getIdToken();
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${idToken}`,
  };
};

const getGuestAccessLink = async (tag) => {
  const headers = await getAuthHeaders();
  const response = await fetch('/api/guest-access-token', {
    method: 'POST',
    headers,
    body: JSON.stringify({ tag: String(tag).trim() }),
  });

  const data = await response.json();
  if (!response.ok || !data?.token) {
    throw new Error(data?.error || 'Failed to create guest link');
  }

  return data.token;
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

  const configuredUrl = import.meta.env.VITE_APP_URL || window.location.origin;
  let appOrigin = window.location.origin;
  try {
    appOrigin = new URL(configuredUrl).origin;
  } catch {
    appOrigin = window.location.origin;
  }
  
  // Validate app URL
  if (!appOrigin.match(/^https:\/\//i) && !appOrigin.match(/^http:\/\/localhost/i)) {
    throw new Error('Invalid app URL configuration');
  }
  
  const guestToken = await getGuestAccessLink(tag);
  const guestLink = `${appOrigin}/guest/${encodeURIComponent(guestToken)}`;
  const templates = await getSmsTemplates();
  const message = sanitizeMessage(applySmsTemplate(templates.welcome, {
    VALET_TAG: tag,
    ARR_TAGS: tag,
    VALET_LINK: guestLink,
  }));

  console.log('Attempting to send SMS to:', phone.replace(/\d(?=\d{4})/g, '*'));
  
  try {
    const headers = await getAuthHeaders();
    const response = await fetch('/api/send-sms', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        to: phone,
        message: message,
        // from: from,
      }),
    });

    console.log('Response status:', response.status);

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to send SMS');
    }

    return { success: true, messageSid: data.messageSid, status: data.status };
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
  const templates = await getSmsTemplates();
  const message = sanitizeMessage(applySmsTemplate(templates.vehicleReady, {
    VALET_TAG: tag,
  }));

  try {
    const headers = await getAuthHeaders();
    const response = await fetch('/api/send-sms', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        to: phone,
        message: message,
        // from: 'The Royce',
      }),
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to send SMS');
    }

    return { success: true, messageSid: data.messageSid, status: data.status };
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
  const templates = await getSmsTemplates();
  const message = sanitizeMessage(applySmsTemplate(templates.roomReady, {
    ROOM_NUMBER: roomNumber,
  }));

  try {
    const headers = await getAuthHeaders();
    const response = await fetch('/api/send-sms', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        to: phone,
        message: message,
        // from: 'The Royce',
      }),
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to send SMS');
    }

    return { success: true, messageSid: data.messageSid, status: data.status };
  } catch (error) {
    console.error('Error sending SMS:', error);
    throw error;
  }
}

export async function sendDepartureSMS(phone, tagList) {
  if (!validatePhoneNumber(phone)) {
    throw new Error('Invalid phone number format');
  }

  const cleanTagList = String(tagList || '').trim();
  if (!cleanTagList) {
    throw new Error('Tag list is required');
  }

  checkRateLimit(phone);
  const templates = await getSmsTemplates();
  const message = sanitizeMessage(applySmsTemplate(templates.departure, {
    DEP_TAGS: cleanTagList,
  }));

  try {
    const headers = await getAuthHeaders();
    const response = await fetch('/api/send-sms', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        to: phone,
        message,
      }),
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to send SMS');
    }

    return { success: true, messageSid: data.messageSid, status: data.status };
  } catch (error) {
    console.error('Error sending departure SMS:', error);
    throw error;
  }
}

/**
 * Send SMS using your SMS provider
 * @param {string} phone - Phone number in E.164 format (e.g., +12345678900)
 * @param {string} message - Message to send
 */
export async function sendSMS(phone, message) {
  // Validate inputs
  if (!validatePhoneNumber(phone)) {
    throw new Error('Invalid phone number format');
  }
  
  checkRateLimit(phone);
  
  const sanitized = sanitizeMessage(message);
  
  // Option 1: Using Firebase Functions (recommended for security)
  // Call a Cloud Function that handles SMS sending
  try {
    const headers = await getAuthHeaders();
    const response = await fetch('/api/send-sms', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        to: phone,
        message: sanitized,
        // from: 'The Royce'
      }),
    })

    const text = await response.text()
    const data = text ? JSON.parse(text) : {}

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to send SMS')
    }

    return data
  } catch (error) {
    console.error('SMS sending error:', error)
    throw error
  }
}

// Option 2: Direct Twilio integration (not recommended - exposes API keys)
// You would need: npm install twilio
// And set up environment variables for TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER

