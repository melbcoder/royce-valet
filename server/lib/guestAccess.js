const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_GUEST_LINK_RETENTION_DAYS = 2;

function normalizeRetentionDays(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 30) {
    return DEFAULT_GUEST_LINK_RETENTION_DAYS;
  }
  return parsed;
}

function toMs(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  // Firestore Timestamp-like object
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return value.seconds * 1000;
  }

  return null;
}

export function getGuestLinkRetentionDays(settings = {}) {
  return normalizeRetentionDays(settings?.guestLinkRetentionDays);
}

export function computeGuestAccessExpiry({ departedAt, settings = {} }) {
  const retentionDays = getGuestLinkRetentionDays(settings);
  const departedAtMs = toMs(departedAt);

  // No forced expiry before the vehicle is marked departed.
  if (!departedAtMs) {
    return null;
  }

  return departedAtMs + retentionDays * DAY_MS;
}
