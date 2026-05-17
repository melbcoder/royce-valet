const SESSION_USER_KEY = 'currentUser';

function sanitizeSessionUser(user) {
  if (!user || typeof user !== 'object') return null;

  const id = String(user.id || user.uid || '').trim();
  if (!id) return null;

  return {
    id,
    username: String(user.username || '').trim().slice(0, 80),
    role: String(user.role || 'user').trim().slice(0, 30),
    mustChangePassword: Boolean(user.mustChangePassword),
  };
}

export function saveSessionUser(user) {
  const sanitized = sanitizeSessionUser(user);
  if (!sanitized) {
    clearSessionUser();
    return null;
  }

  sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(sanitized));
  localStorage.removeItem(SESSION_USER_KEY);
  return sanitized;
}

export function getSessionUser() {
  try {
    const rawSessionUser = sessionStorage.getItem(SESSION_USER_KEY);
    if (rawSessionUser) {
      const parsed = sanitizeSessionUser(JSON.parse(rawSessionUser));
      if (!parsed) {
        clearSessionUser();
        return null;
      }
      return parsed;
    }

    // Migrate old localStorage session to sessionStorage.
    const rawLegacyUser = localStorage.getItem(SESSION_USER_KEY);
    if (!rawLegacyUser) return null;

    const migrated = sanitizeSessionUser(JSON.parse(rawLegacyUser));
    localStorage.removeItem(SESSION_USER_KEY);
    if (!migrated) return null;

    sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    clearSessionUser();
    return null;
  }
}

export function updateSessionUser(patch = {}) {
  const current = getSessionUser();
  if (!current) return null;
  return saveSessionUser({ ...current, ...patch });
}

export function clearSessionUser() {
  sessionStorage.removeItem(SESSION_USER_KEY);
  localStorage.removeItem(SESSION_USER_KEY);
}
