import React, { useState, useEffect } from 'react';
import { auth } from '../firebase';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { showToast } from '../components/Toast';

export default function UserManagement() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    setUser(auth.currentUser);
  }, []);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    
    if (!currentPassword || !newPassword || !confirmPassword) {
      showToast('Please fill in all fields.');
      return;
    }

    if (newPassword !== confirmPassword) {
      showToast('New passwords do not match.');
      return;
    }

    if (newPassword.length < 8) {
      showToast('New password must be at least 8 characters long.');
      return;
    }

    if (newPassword === 'admin123') {
      showToast('Please choose a more secure password.');
      return;
    }

    // Check password strength
    const hasUpperCase = /[A-Z]/.test(newPassword);
    const hasLowerCase = /[a-z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    
    if (!hasUpperCase || !hasLowerCase || !hasNumber) {
      showToast('Password must contain uppercase, lowercase, and numbers.');
      return;
    }

    setLoading(true);

    try {
      // Re-authenticate user before changing password
      const credential = EmailAuthProvider.credential(
        user.email,
        currentPassword
      );
      
      await reauthenticateWithCredential(user, credential);
      
      // Update password
      await updatePassword(user, newPassword);
      
      showToast('Password changed successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      console.error('Password change error:', error);
      
      if (error.code === 'auth/wrong-password') {
        showToast('Current password is incorrect.');
      } else if (error.code === 'auth/weak-password') {
        showToast('Password is too weak. Please choose a stronger password.');
      } else {
        showToast('Failed to change password: ' + error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto' }}>
      <section className="card pad">
        <h1>Account Management</h1>
        
        <div style={{ marginBottom: '24px', padding: '16px', background: '#f0f0f0', borderRadius: '8px' }}>
          <h3 style={{ marginTop: 0 }}>Current User</h3>
          <p><strong>Email:</strong> {user?.email || 'Loading...'}</p>
        </div>

        <h2>Change Password</h2>
        <form onSubmit={handleChangePassword}>
          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="currentPassword" style={{ display: 'block', marginBottom: '4px' }}>
              Current Password
            </label>
            <input
              type="password"
              id="currentPassword"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={loading}
              style={{ width: '100%', padding: '8px', fontSize: '14px' }}
              autoComplete="current-password"
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="newPassword" style={{ display: 'block', marginBottom: '4px' }}>
              New Password
            </label>
            <input
              type="password"
              id="newPassword"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={loading}
              style={{ width: '100%', padding: '8px', fontSize: '14px' }}
              autoComplete="new-password"
            />
            <small style={{ color: '#666', fontSize: '12px' }}>
              Must be at least 8 characters with uppercase, lowercase, and numbers
            </small>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="confirmPassword" style={{ display: 'block', marginBottom: '4px' }}>
              Confirm New Password
            </label>
            <input
              type="password"
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              style={{ width: '100%', padding: '8px', fontSize: '14px' }}
              autoComplete="new-password"
            />
          </div>

          <button 
            type="submit" 
            className="btn primary"
            disabled={loading}
            style={{ width: '100%' }}
          >
            {loading ? 'Changing Password...' : 'Change Password'}
          </button>
        </form>

        <div style={{ marginTop: '24px', padding: '16px', background: '#fff3cd', borderRadius: '8px', border: '1px solid #ffc107' }}>
          <strong>⚠️ Security Tip:</strong>
          <ul style={{ marginTop: '8px', marginBottom: 0, paddingLeft: '20px' }}>
            <li>Never share your password with anyone</li>
            <li>Use a unique password for this system</li>
            <li>Change default passwords immediately</li>
            <li>Consider using a password manager</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
