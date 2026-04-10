const SESSION_EXPIRY_KEY = 'sessionExpiry';
const DEFAULT_SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours

const getExpiry = () => {
  const raw = localStorage.getItem(SESSION_EXPIRY_KEY);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

const setExpiry = (msFromNow = DEFAULT_SESSION_MS) => {
  const expiry = Date.now() + msFromNow;
  localStorage.setItem(SESSION_EXPIRY_KEY, String(expiry));
  return expiry;
};

export const sessionManager = {
  startSession(msFromNow) {
    return setExpiry(msFromNow);
  },

  isSessionValid() {
    const expiry = getExpiry();
    if (!expiry) return true; // allow first-time session creation
    return Date.now() < expiry;
  },

  endSession() {
    localStorage.removeItem(SESSION_EXPIRY_KEY);
    localStorage.removeItem('currentUser');
    if (typeof window !== 'undefined') {
      const path = window.location.pathname || '';
      const isPublicPath = path === '/login'
        || path.startsWith('/guest/')
        || path.startsWith('/forgot-password')
        || path.startsWith('/qr-login');

      if (!isPublicPath) {
        window.location.assign('/login');
      }
    }
  }
};
