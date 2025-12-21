/**
 * Format phone number to international format for SMS
 * Converts various Australian phone formats to +61XXXXXXXXX
 * 
 * Examples:
 * 0400000000 -> +61400000000
 * 0400 000 000 -> +61400000000
 * 400000000 -> +61400000000
 * +61400000000 -> +61400000000
 * 61400000000 -> +61400000000
 */
export function formatPhoneNumber(phone) {
  if (!phone) return '';
  
  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, '');
  
  // If already has +61, return as is
  if (cleaned.startsWith('+61')) {
    return cleaned;
  }
  
  // If starts with 61 (but no +), add the +
  if (cleaned.startsWith('61')) {
    return '+' + cleaned;
  }
  
  // If starts with 0, replace with +61
  if (cleaned.startsWith('0')) {
    return '+61' + cleaned.substring(1);
  }
  
  // Otherwise assume it's a local number and add +61
  return '+61' + cleaned;
}
