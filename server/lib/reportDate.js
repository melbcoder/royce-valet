const DEFAULT_REPORT_TIMEZONE = 'Australia/Melbourne';

function normalizeReportTimezone(timezone) {
  return typeof timezone === 'string' && timezone.trim()
    ? timezone.trim()
    : DEFAULT_REPORT_TIMEZONE;
}

function formatDateInTimezone(date, timezone) {
  const effectiveTimezone = normalizeReportTimezone(timezone);

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: effectiveTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;

    if (year && month && day) return `${year}-${month}-${day}`;
  } catch (error) {
    console.error('Error formatting report date in timezone:', effectiveTimezone, error);
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getTodayIsoForTimezone(timezone) {
  return formatDateInTimezone(new Date(), timezone);
}

export function getPreviousDateIsoForTimezone(timezone) {
  const todayIso = getTodayIsoForTimezone(timezone);
  const [year, month, day] = todayIso.split('-').map(Number);
  const previousDate = new Date(Date.UTC(year, month - 1, day));
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);

  return `${previousDate.getUTCFullYear()}-${String(previousDate.getUTCMonth() + 1).padStart(2, '0')}-${String(previousDate.getUTCDate()).padStart(2, '0')}`;
}

export function getDefaultReportTimezone() {
  return DEFAULT_REPORT_TIMEZONE;
}