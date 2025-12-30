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
  const [debugInfo, setDebugInfo] = useState('');
  const [debugOutput, setDebugOutput] = useState('');
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
    setDebugInfo('');
    setLoading(true);
    
    const startTime = Date.now();
    const minResponseTime = 500;
    
    if (isLockedOut) {
      setError('Account temporarily locked due to too many failed attempts. Please try again later.');
      setLoading(false);
      return;
    }

    const cleanUsername = sanitizeInput(username);
    const cleanPassword = password;
    
    if (!cleanUsername || cleanUsername.length < 2 || cleanUsername.length > 50) {
      setError('Please enter a valid username (2-50 characters).');
      setLoading(false);
      return;
    }
    
    if (!cleanPassword || cleanPassword.length < 6 || cleanPassword.length > 100) {
      setError('Password must be 6-100 characters long.');
      setLoading(false);
      return;
    }
    
    if (/[<>'"]/g.test(cleanUsername)) {
      setError('Invalid characters in username.');
      setLoading(false);
      return;
    }
    
    try {
      setDebugInfo('Checking if users exist...');
      
      // If no users exist and default credentials are used, create default admin
      if (isFirstSetup && cleanUsername === 'admin' && cleanPassword === 'admin123') {
        setDebugInfo('Creating default admin account...');
        console.log('Creating default admin account...');
        
        try {
          await initializeDefaultAdmin();
          setDebugInfo('Default admin created. Waiting for Firestore sync...');
          console.log('Default admin created successfully');
          
          // Longer delay to ensure Firestore write completes
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          setDebugInfo('Attempting authentication...');
        } catch (createError) {
          console.error('Error creating default admin:', createError);
          
          // If user already exists, continue with authentication
          if (createError.code !== 'auth/email-already-in-use') {
            setError('Failed to create default admin: ' + createError.message);
            setLoading(false);
            return;
          }
          console.log('Default admin already exists, proceeding to authenticate');
        }
      }

      setDebugInfo('Authenticating user...');
      console.log('Attempting to authenticate user:', cleanUsername);
      
      const user = await authenticateUser(cleanUsername, cleanPassword);
      console.log('Authentication result:', user);
      
      if (user) {
        setDebugInfo('Authentication successful!');
        console.log('Login successful:', user.username);
        
        localStorage.removeItem('loginAttempts');
        localStorage.removeItem('lastLoginAttempt');
        
        // Store user info in localStorage for non-sensitive data
        localStorage.setItem('currentUser', JSON.stringify({
          id: user.id,
          uid: user.uid,
          username: user.username,
          role: user.role
        }));
        
        // Check if this is default admin with default password
        if (user.isDefaultAdmin && cleanUsername === 'admin' && cleanPassword === 'admin123') {
          setError('');
          alert('⚠️ SECURITY WARNING: You are using the default admin credentials. Please change your password immediately for security.');
        }
        
        const elapsed = Date.now() - startTime;
        if (elapsed < minResponseTime) {
          await new Promise(resolve => setTimeout(resolve, minResponseTime - elapsed));
        }
        
        navigate('/dashboard');
      } else {
        await new Promise(resolve => setTimeout(resolve, Math.max(0, minResponseTime - (Date.now() - startTime))));
        handleFailedLogin();
        setError('Invalid credentials. Please try again.');
        setDebugInfo('');
        setPassword('');
      }
    } catch (err) {
      console.error('Login error:', err);
      console.error('Error code:', err.code);
      console.error('Error message:', err.message);
      
      await new Promise(resolve => setTimeout(resolve, Math.max(0, minResponseTime - (Date.now() - startTime))));
      
      handleFailedLogin();
      
      // More detailed error messages
      let errorMessage = 'Login error. ';
      
      if (err.code === 'auth/invalid-credential' || 
          err.code === 'auth/user-not-found' || 
          err.code === 'auth/wrong-password') {
        errorMessage = 'Invalid credentials. Please try again.';
      } else if (err.code === 'auth/too-many-requests') {
        errorMessage = 'Too many failed attempts. Please try again later.';
      } else if (err.code === 'auth/network-request-failed') {
        errorMessage = 'Network error. Please check your connection.';
      } else if (err.message) {
        errorMessage += err.message;
      }
      
      setError(errorMessage);
      setDebugInfo('Error: ' + err.code);
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

  const runDiagnostics = async () => {
    setDebugOutput('Running diagnostics...\n');
    
    try {
      const { auth } = await import('../firebase');
      const { db } = await import('../firebase');
      const { collection, getDocs } = await import('firebase/firestore');
      
      let output = 'Running diagnostics...\n\n';
      
      // Check auth state
      output += '1. Firebase Auth State:\n';
      if (auth.currentUser) {
        output += `   ✅ Logged in as: ${auth.currentUser.email}\n`;
        output += `   UID: ${auth.currentUser.uid}\n\n`;
      } else {
        output += '   ❌ No user logged in\n\n';
      }
      
      // Check users in Firestore
      output += '2. Firestore Users Collection:\n';
      const usersSnapshot = await getDocs(collection(db, 'users'));
      output += `   Total users: ${usersSnapshot.size}\n\n`;
      
      if (usersSnapshot.size > 0) {
        output += '   User documents:\n';
        usersSnapshot.forEach(doc => {
          const data = doc.data();
          output += `   - Document ID: ${doc.id}\n`;
          output += `     Username: ${data.username}\n`;
          output += `     Role: ${data.role}\n`;
          output += `     UID field: ${data.uid}\n`;
          output += `     Match: ${doc.id === data.uid ? '✅ YES' : '❌ NO'}\n\n`;
        });
      } else {
        output += '   ❌ No users found in Firestore\n\n';
      }
      
      // Check Firestore rules
      output += '3. Next Steps:\n';
      output += '   - Go to Firebase Console → Firestore → Rules\n';
      output += '   - Make sure you published the latest rules\n';
      output += '   - Document ID must match the UID field\n';
      
      setDebugOutput(output);
      
    } catch (error) {
      setDebugOutput(`Error running diagnostics: ${error.message}\n${error.stack}`);
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      minHeight: 'calc(100vh - 200px)',
      padding: '20px'
    }}>
      <section className="card pad" style={{ maxWidth: '600px', width: '100%' }}>
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
            <small style={{ color: '#666' }}>
              This default account will be created automatically when you log in.<br />
              Please create a second admin account afterward!
            </small>
          </div>
        )}

        {/* Debug info */}
        {debugInfo && (
          <div style={{ 
            background: '#f0f0f0', 
            padding: '8px', 
            borderRadius: '4px', 
            marginBottom: '12px',
            fontSize: '12px',
            color: '#666'
          }}>
            {debugInfo}
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