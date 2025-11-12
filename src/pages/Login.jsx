import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Check password (you can change this password)
    if (password === 'royce2024') {
      // Store authentication in sessionStorage
      sessionStorage.setItem('staffAuthenticated', 'true');
      navigate('/staff');
    } else {
      setError(true);
      setPassword('');
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
              type="password"
              placeholder="Enter staff password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(false);
              }}
              style={{ 
                borderColor: error ? '#ff4444' : undefined,
                width: '100%'
              }}
              autoFocus
            />
            {error && (
              <div style={{ color: '#ff4444', fontSize: '12px', marginTop: '4px' }}>
                Incorrect password. Please try again.
              </div>
            )}
          </div>

          <button 
            type="submit" 
            className="btn primary" 
            style={{ width: '100%' }}
          >
            Login
          </button>
        </form>
      </section>
    </div>
  );
}