import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authenticateUser, checkUsersExist, initializeDefaultAdmin } from '../services/valetFirestore';

// Security utilities
const sanitizeInput = (input) => {
  if (!input) return '';
  return String(input).trim().replace(/[<>]/g, '');
};

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isFirstSetup, setIsFirstSetup] = useState(false);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [isLockedOut, setIsLockedOut] = useState(false);
  const [lockoutEndTime, setLockoutEndTime] = useState(null);
  const navigate = useNavigate();

  // Check lockout status
  useEffect(() => {
    const checkLockout = () => {
      const attempts = parseInt(localStorage.getItem('loginAttempts') || '0');
      const lastAttempt = parseInt(localStorage.getItem('lastLoginAttempt') || '0');
      
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        const timeSinceLastAttempt = Date.now() - lastAttempt;
        if (timeSinceLastAttempt < LOCKOUT_DURATION) {
          setIsLockedOut(true);
          setLockoutEndTime(lastAttempt + LOCKOUT_DURATION);
          return;
        } else {
          // Reset attempts after lockout period
          localStorage.removeItem('loginAttempts');
          localStorage.removeItem('lastLoginAttempt');
        }
      }
      
      setLoginAttempts(attempts);
    };
    
    checkLockout();
    const interval = setInterval(checkLockout, 1000);
    return () => clearInterval(interval);
  }, []);

  // Check if this is first-time setup
  useEffect(() => {
    async function checkSetup() {
      const usersExist = await checkUsersExist();
      setIsFirstSetup(!usersExist);
    }
    checkSetup();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    if (isLockedOut) {
      setError('Account temporarily locked due to too many failed attempts. Please try again later.');
      setLoading(false);
      return;
    }

    // Input validation
    const cleanUsername = sanitizeInput(username);
    const cleanPassword = password; // Don't sanitize password, just validate length
    
    if (!cleanUsername || cleanUsername.length < 2) {
      setError('Please enter a valid username (minimum 2 characters).');
      setLoading(false);
      return;
    }
    
    if (!cleanPassword || cleanPassword.length < 6) {
      setError('Password must be at least 6 characters long.');
      setLoading(false);
      return;
    }
    
    try {
      // If no users exist and default credentials are used, create default admin
      if (isFirstSetup && cleanUsername === 'admin' && cleanPassword === 'admin123') {
        await initializeDefaultAdmin();
        const user = await authenticateUser(cleanUsername, cleanPassword);
        if (user) {
          // Clear failed attempts on successful login
          localStorage.removeItem('loginAttempts');
          localStorage.removeItem('lastLoginAttempt');
          
          sessionStorage.setItem('staffAuthenticated', 'true');
          sessionStorage.setItem('currentUser', JSON.stringify(user));
          navigate('/valet');
          return;
        }
      }

      console.log('Attempting to authenticate user:', cleanUsername);
      const user = await authenticateUser(cleanUsername, cleanPassword);
      console.log('Authentication result:', user ? 'Success' : 'Failed');
      
      if (user) {
        // Clear failed attempts on successful login
        localStorage.removeItem('loginAttempts');
        localStorage.removeItem('lastLoginAttempt');
        
        // Store authentication and user info in sessionStorage
        sessionStorage.setItem('staffAuthenticated', 'true');
        sessionStorage.setItem('currentUser', JSON.stringify(user));
        navigate('/valet');
      } else {
        handleFailedLogin();
        setError('Invalid username or password. Please check your credentials and try again.');
        setPassword('');
      }
    } catch (err) {
      console.error('Login error:', err);
      handleFailedLogin();
      
      // Show more specific error messages based on Firebase error codes
      if (err.code === 'auth/invalid-credential') {
        setError('Invalid username or password. Please check your credentials and try again.');
      } else if (err.code === 'auth/user-not-found') {
        setError('User not found. Please check your username.');
      } else if (err.code === 'auth/wrong-password') {
        setError('Incorrect password. Please try again.');
      } else if (err.code === 'auth/too-many-requests') {
        setError('Too many failed login attempts. Please try again later.');
      } else if (err.code === 'auth/network-request-failed') {
        setError('Network error. Please check your connection and try again.');
      } else {
        setError(`Login error: ${err.message || 'Unknown error'}`);
      }
      
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  const handleFailedLogin = () => {
    const attempts = loginAttempts + 1;
    setLoginAttempts(attempts);
    
    localStorage.setItem('loginAttempts', attempts.toString());
    localStorage.setItem('lastLoginAttempt', Date.now().toString());
    
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      setIsLockedOut(true);
      setLockoutEndTime(Date.now() + LOCKOUT_DURATION);
    }
  };

  const getRemainingLockoutTime = () => {
    if (!lockoutEndTime) return 0;
    return Math.max(0, Math.ceil((lockoutEndTime - Date.now()) / 1000));
  };

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      minHeight: 'calc(100vh - 200px)',
      padding: '20px'
    }}>
      <section className="card pad" style={{ maxWidth: '400px', width: '100%' }}>
        <h1 style={{ textAlign: 'center', marginBottom: 24 }}>Staff Login</h1>
        
        {isFirstSetup && (
          <div style={{ 
            background: '#e3f2fd', 
            padding: '12px', 
            borderRadius: '4px', 
            marginBottom: '16px',
            fontSize: '14px',
            border: '1px solid #2196F3'
          }}>
            <strong>First-time setup:</strong><br />
            Username: <code>admin</code><br />
            Password: <code>admin123</code><br />
            <small style={{ color: '#666' }}>Please change this password after logging in!</small>
          </div>
        )}

        {isLockedOut && (
          <div style={{ 
            background: '#ffebee', 
            padding: '12px', 
            borderRadius: '4px', 
            marginBottom: '16px',
            fontSize: '14px',
            border: '1px solid #f44336',
            color: '#d32f2f'
          }}>
            <strong>Account Locked</strong><br />
            Too many failed attempts. Try again in {getRemainingLockoutTime()} seconds.
          </div>
        )}
        
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => {
                setUsername(sanitizeInput(e.target.value));
                setError('');
              }}
              style={{ width: '100%', marginBottom: 12 }}
              autoFocus
              disabled={loading || isLockedOut}
              maxLength={50}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              style={{ 
                borderColor: error ? '#ff4444' : undefined,
                width: '100%'
              }}
              disabled={loading || isLockedOut}
              maxLength={100}
            />
            {error && (
              <div style={{ color: '#ff4444', fontSize: '12px', marginTop: '4px' }}>
                {error}
              </div>
            )}
            {loginAttempts > 0 && !isLockedOut && (
              <div style={{ color: '#ff9800', fontSize: '12px', marginTop: '4px' }}>
                {MAX_LOGIN_ATTEMPTS - loginAttempts} attempts remaining
              </div>
            )}
          </div>

          <button 
            type="submit" 
            className="btn primary" 
            style={{ width: '100%' }}
            disabled={loading || !username || !password || isLockedOut}
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </section>
    </div>
  );
}