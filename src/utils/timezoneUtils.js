/**
 * Timezone utility functions for consistent date handling across the app
 */

/**
 * Get the current date in YYYY-MM-DD format for a specific timezone
 * @param {string} timezone - IANA timezone identifier (e.g., "America/Los_Angeles")
 * @returns {string} Date in YYYY-MM-DD format
 */
export function getTodayInTimezone(timezone) {
  try {
    const now = new Date();
    
    // Use Intl.DateTimeFormat to get date in the specified timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    
    const parts = formatter.formatToParts(now);
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    
    return `${year}-${month}-${day}`;
  } catch (error) {
    console.error('Error getting date in timezone:', timezone, error);
    // Fallback to system timezone
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
}

/**
 * Get tomorrow's date in YYYY-MM-DD format for a specific timezone
 * @param {string} timezone - IANA timezone identifier
 * @returns {string} Tomorrow's date in YYYY-MM-DD format
 */
export function getTomorrowInTimezone(timezone) {
  try {
    // Add 24 hours to current time
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    
    const parts = formatter.formatToParts(tomorrow);
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    
    return `${year}-${month}-${day}`;
  } catch (error) {
    console.error('Error getting tomorrow in timezone:', timezone, error);
    // Fallback to system timezone
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  }
}

/**
 * Common US timezones for the dropdown
 */
export const COMMON_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Phoenix', label: 'Arizona (MST - No DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)' },
];
