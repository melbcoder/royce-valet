import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authenticateUser, checkUsersExist, initializeDefaultAdmin } from '../services/valetFirestore';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isFirstSetup, setIsFirstSetup] = useState(false);
  const navigate = useNavigate();

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
    
    try {
      // If no users exist and default credentials are used, create default admin
      if (isFirstSetup && username === 'admin' && password === 'admin123') {
        await initializeDefaultAdmin();
        const user = await authenticateUser(username, password);
        if (user) {
          sessionStorage.setItem('staffAuthenticated', 'true');
          sessionStorage.setItem('currentUser', JSON.stringify(user));
          navigate('/valet');
          return;
        }
      }

      const user = await authenticateUser(username, password);
      
      if (user) {
        // Store authentication and user info in sessionStorage
        sessionStorage.setItem('staffAuthenticated', 'true');
        sessionStorage.setItem('currentUser', JSON.stringify(user));
        navigate('/valet');
      } else {
        setError('Invalid username or password');
        setPassword('');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('An error occurred during login');
    } finally {
      setLoading(false);
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
        
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError('');
              }}
              style={{ width: '100%', marginBottom: 12 }}
              autoFocus
              disabled={loading}
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
              disabled={loading}
            />
            {error && (
              <div style={{ color: '#ff4444', fontSize: '12px', marginTop: '4px' }}>
                {error}
              </div>
            )}
          </div>

          <button 
            type="submit" 
            className="btn primary" 
            style={{ width: '100%' }}
            disabled={loading || !username || !password}
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </section>
    </div>
  );
}