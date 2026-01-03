import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authenticateUser } from '../services/valetFirestore';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    console.log('Attempting login with username:', username);

    try {
      // Use the authenticateUser function which handles username -> email conversion
      const userData = await authenticateUser(username, password);

      console.log('Login successful, userData:', userData);
      console.log('mustChangePassword value:', userData.mustChangePassword);
      console.log('Type of mustChangePassword:', typeof userData.mustChangePassword);

      // Store in localStorage
      localStorage.setItem('currentUser', JSON.stringify(userData));

      // Check if user must change password
      if (userData.mustChangePassword === true) {
        console.log('User must change password, redirecting to /force-change-password');
        // Try using window.location instead of navigate for a hard redirect
        window.location.href = '/force-change-password';
        return;
      }

      console.log('Navigating to home page');
      navigate('/');
    } catch (err) {
      console.error('Login error:', err);
      console.error('Error code:', err.code);
      console.error('Error message:', err.message);
      
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
        setError('Invalid username or password');
      } else if (err.code === 'auth/too-many-requests') {
        setError('Too many failed attempts. Please try again later.');
      } else {
        setError(err.message || 'Login failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <h2>Login</h2>
      <form onSubmit={handleLogin}>
        <div className="form-group">
          <label htmlFor="username">Username:</label>
          <input
            type="text"
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            disabled={loading}
            autoFocus
          />
        </div>
        <div className="form-group">
          <label htmlFor="password">Password:</label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        {error && <p className="error-message">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </div>
  );
};

export default Login;