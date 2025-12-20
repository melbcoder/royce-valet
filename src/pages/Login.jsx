import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authenticateUser } from '../services/valetFirestore';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      const user = await authenticateUser(username, password);
      
      if (user) {
        // Store authentication and user info in sessionStorage
        sessionStorage.setItem('staffAuthenticated', 'true');
        sessionStorage.setItem('currentUser', JSON.stringify(user));
        navigate('/staff');
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