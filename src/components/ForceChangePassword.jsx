import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function ForceChangePassword() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    const userStr = localStorage.getItem('currentUser')
    if (!userStr) {
      navigate('/login')
      return
    }
    
    const userData = JSON.parse(userStr)
    setCurrentUser(userData)
    
    // If user doesn't need to change password, redirect to home
    if (!userData.mustChangePassword) {
      navigate('/')
    }
  }, [navigate])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    // Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('All fields are required')
      setLoading(false)
      return
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match')
      setLoading(false)
      return
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long')
      setLoading(false)
      return
    }

    if (newPassword === currentPassword) {
      setError('New password must be different from current password')
      setLoading(false)
      return
    }

    // Check password strength
    const hasUpperCase = /[A-Z]/.test(newPassword)
    const hasLowerCase = /[a-z]/.test(newPassword)
    const hasNumber = /[0-9]/.test(newPassword)
    
    if (!hasUpperCase || !hasLowerCase || !hasNumber) {
      setError('Password must contain uppercase, lowercase, and numbers')
      setLoading(false)
      return
    }

    try {
      const { auth } = await import('../firebase')
      const { EmailAuthProvider, reauthenticateWithCredential, updatePassword } = await import('firebase/auth')
      const { db } = await import('../firebase')
      const { doc, updateDoc } = await import('firebase/firestore')
      
      const user = auth.currentUser
      if (!user) {
        setError('Not authenticated. Please log in again.')
        setLoading(false)
        return
      }

      // Re-authenticate with current (temporary) password
      const credential = EmailAuthProvider.credential(user.email, currentPassword)
      await reauthenticateWithCredential(user, credential)
      
      // Update password
      await updatePassword(user, newPassword)
      
      // Clear the mustChangePassword flag in Firestore
      await updateDoc(doc(db, 'users', user.uid), {
        mustChangePassword: false
      })
      
      // Update localStorage
      const updatedUser = { ...currentUser, mustChangePassword: false }
      localStorage.setItem('currentUser', JSON.stringify(updatedUser))
      
      // Redirect to home
      navigate('/')
    } catch (err) {
      console.error('Error changing password:', err)
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('Current password is incorrect')
      } else if (err.code === 'auth/weak-password') {
        setError('Password is too weak')
      } else {
        setError('Failed to change password: ' + (err.message || 'Unknown error'))
      }
      setLoading(false)
    }
  }

  async function handleLogout() {
    try {
      const { auth } = await import('../firebase')
      const { signOut } = await import('firebase/auth')
      await signOut(auth)
      localStorage.clear()
      navigate('/login')
    } catch (err) {
      console.error('Sign out error:', err)
    }
  }

  if (!currentUser) {
    return <div style={{padding: 20}}>Loading...</div>
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f5f5f5',
      padding: 20
    }}>
      <div className="card pad" style={{width: 'min(450px, 100%)', maxWidth: 450}}>
        <div style={{marginBottom: 24}}>
          <h1 style={{marginBottom: 8}}>Change Password Required</h1>
          <p style={{color: '#666', fontSize: 14, marginBottom: 16}}>
            For security reasons, you must change your password before continuing.
          </p>
          <div style={{
            padding: 12,
            background: '#fff3cd',
            borderRadius: 4,
            fontSize: 13,
            color: '#856404',
            marginBottom: 16
          }}>
            <strong>Note:</strong> You cannot access the application until you change your password.
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field" style={{marginBottom: 16}}>
            <label>Current Password (Temporary)</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter temporary password from SMS"
              autoFocus
              disabled={loading}
            />
          </div>

          <div className="field" style={{marginBottom: 16}}>
            <label>New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              disabled={loading}
            />
            <small style={{color: '#666', fontSize: 12, display: 'block', marginTop: 4}}>
              Must be 8+ characters with uppercase, lowercase, and numbers
            </small>
          </div>

          <div className="field" style={{marginBottom: 16}}>
            <label>Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              disabled={loading}
            />
          </div>

          {error && (
            <div style={{
              color: '#ff4444',
              fontSize: 13,
              marginBottom: 16,
              padding: 12,
              background: '#ffebee',
              borderRadius: 4
            }}>
              {error}
            </div>
          )}

          <div style={{display: 'flex', gap: 8}}>
            <button
              type="submit"
              className="btn primary"
              disabled={loading}
              style={{flex: 1}}
            >
              {loading ? 'Changing Password...' : 'Change Password'}
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={handleLogout}
              disabled={loading}
            >
              Logout
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
