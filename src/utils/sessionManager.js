const SESSION_TIMEOUT = 120 * 60 * 1000; // 120 minutes (absolute timeout)
const INACTIVITY_TIMEOUT = 60 * 60 * 1000; // 60 minutes (inactivity timeout)
const ACTIVITY_CHECK_INTERVAL = 60 * 1000; // Check every minute

class SessionManager {
  constructor() {
    this.lastActivityTime = Date.now();
    this.sessionStartTime = Date.now();
    this.activityCheckInterval = null;
    this.isActive = false;
  }

  // Initialize session tracking
  startSession() {
    this.lastActivityTime = Date.now();
    this.sessionStartTime = Date.now();
    this.isActive = true;
    
    // Store session start time
    localStorage.setItem('sessionStartTime', this.sessionStartTime.toString());
    localStorage.setItem('lastActivityTime', this.lastActivityTime.toString());
    
    // Start activity monitoring
    this.startActivityMonitoring();
    this.startPeriodicCheck();
  }

  // Update last activity time
  updateActivity() {
    if (!this.isActive) return;
    
    this.lastActivityTime = Date.now();
    localStorage.setItem('lastActivityTime', this.lastActivityTime.toString());
  }

  // Check if session is still valid
  isSessionValid() {
    const now = Date.now();
    const sessionStart = parseInt(localStorage.getItem('sessionStartTime') || '0');
    const lastActivity = parseInt(localStorage.getItem('lastActivityTime') || '0');
    
    if (!sessionStart || !lastActivity) {
      return false;
    }
    
    // Check if 120 minutes have passed since session start (absolute timeout)
    const totalSessionTime = now - sessionStart;
    if (totalSessionTime > SESSION_TIMEOUT) {
      return false;
    }
    
    // Check if 60 minutes have passed since last activity (inactivity timeout)
    const timeSinceActivity = now - lastActivity;
    if (timeSinceActivity > INACTIVITY_TIMEOUT) {
      return false;
    }
    
    return true;
  }

  // Start monitoring user activity
  startActivityMonitoring() {
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    
    const updateActivity = () => this.updateActivity();
    
    events.forEach(event => {
      document.addEventListener(event, updateActivity, { passive: true });
    });
  }

  // Periodically check session validity
  startPeriodicCheck() {
    if (this.activityCheckInterval) {
      clearInterval(this.activityCheckInterval);
    }
    
    this.activityCheckInterval = setInterval(() => {
      if (!this.isSessionValid()) {
        this.endSession();
      }
    }, ACTIVITY_CHECK_INTERVAL);
  }

  // End session and redirect to login
  endSession() {
    this.isActive = false;
    
    if (this.activityCheckInterval) {
      clearInterval(this.activityCheckInterval);
      this.activityCheckInterval = null;
    }
    
    // Clear all session data
    localStorage.removeItem('currentUser');
    localStorage.removeItem('sessionStartTime');
    localStorage.removeItem('lastActivityTime');
    
    // Redirect to login with timeout message
    window.location.href = '/login?reason=timeout';
  }

  // Get remaining session time in minutes
  getRemainingTime() {
    const now = Date.now();
    const sessionStart = parseInt(localStorage.getItem('sessionStartTime') || '0');
    const lastActivity = parseInt(localStorage.getItem('lastActivityTime') || '0');
    
    if (!sessionStart || !lastActivity) {
      return 0;
    }
    
    // Calculate time until absolute timeout (120 minutes)
    const timeUntilAbsoluteTimeout = SESSION_TIMEOUT - (now - sessionStart);
    
    // Calculate time until inactivity timeout (60 minutes)
    const timeUntilInactivityTimeout = INACTIVITY_TIMEOUT - (now - lastActivity);
    
    // Return the smaller of the two (whichever expires first)
    const remainingTime = Math.min(timeUntilAbsoluteTimeout, timeUntilInactivityTimeout);
    
    return Math.max(0, Math.floor(remainingTime / 60000)); // Convert to minutes
  }
}

export const sessionManager = new SessionManager();
