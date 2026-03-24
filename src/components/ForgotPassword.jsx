import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Toast from './Toast'

export default function ForgotPassword() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1) // 1: request, 2: verify OTP, 3: reset password
  const [username, setUsername] = useState('')
  const [otp, setOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetDocId, setResetDocId] = useState('')
  const [email, setEmail] = useState('')
  const [userId, setUserId] = useState('')
  const [toast, setToast] = useState(null)

  const showToast = (message, type = 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  // Step 1: Request OTP
  const handleRequestOtp = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (!username) {
      setError('Please enter your username')
      setLoading(false)
      return
    }

    try {
      const response = await fetch('/api/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to request OTP')
        setLoading(false)
        return
      }

      setResetDocId(data.resetDocId)
      setOtp('')
      setStep(2)
      showToast('OTP sent to your registered phone number', 'success')
    } catch (err) {
      console.error('Error requesting OTP:', err)
      setError('Failed to request OTP. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Step 2: Verify OTP
  const handleVerifyOtp = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (!otp || otp.length !== 6) {
      setError('Please enter a valid 6-digit OTP')
      setLoading(false)
      return
    }

    try {
      const response = await fetch('/api/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetDocId, otp })
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Invalid OTP')
        setLoading(false)
        return
      }

      setUserId(data.uid)
      setNewPassword('')
      setConfirmPassword('')
      setStep(3)
      showToast('OTP verified. Please set your new password.', 'success')
    } catch (err) {
      console.error('Error verifying OTP:', err)
      setError('Failed to verify OTP. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Step 3: Reset Password
  const handleResetPassword = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    // Validation
    if (!newPassword || !confirmPassword) {
      setError('Please fill in all password fields')
      setLoading(false)
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long')
      setLoading(false)
      return
    }

    const hasUpperCase = /[A-Z]/.test(newPassword)
    const hasLowerCase = /[a-z]/.test(newPassword)
    const hasNumber = /[0-9]/.test(newPassword)

    if (!hasUpperCase || !hasLowerCase || !hasNumber) {
      setError('Password must contain uppercase, lowercase, and numbers')
      setLoading(false)
      return
    }

    try {
      const response = await fetch('/api/reset-password-with-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetDocId, newPassword })
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to reset password')
        setLoading(false)
        return
      }

      showToast('Password reset successfully! Redirecting to login...', 'success')
      
      // Clear any stored session data
      localStorage.removeItem('currentUser')
      
      // Redirect to login after 2 seconds
      setTimeout(() => {
        navigate('/login')
      }, 2000)
    } catch (err) {
      console.error('Error resetting password:', err)
      setError('Failed to reset password. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleBackToLogin = () => {
    navigate('/login')
  }

  const handleBackToStep1 = () => {
    setStep(1)
    setUsername('')
    setResetDocId('')
    setError('')
  }

  const handleBackToStep2 = () => {
    setStep(2)
    setError('')
  }

  return (
    <div className="login-container">
      {toast && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          padding: '12px 20px',
          backgroundColor: toast.type === 'success' ? '#4caf50' : '#f44336',
          color: 'white',
          borderRadius: '4px',
          zIndex: 1000
        }}>
          {toast.message}
        </div>
      )}

      {step === 1 && (
        <>
          <h2>Reset Password</h2>
          <p style={{ marginBottom: '20px', color: '#666' }}>
            Enter your username and we'll send you an OTP via SMS
          </p>
          <form onSubmit={handleRequestOtp}>
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

            {error && <div style={{ color: '#f44336', marginBottom: '16px' }}>{error}</div>}

            <button type="submit" disabled={loading} style={{ marginBottom: '12px' }}>
              {loading ? 'Sending OTP...' : 'Send OTP'}
            </button>
            <button
              type="button"
              onClick={handleBackToLogin}
              style={{
                background: '#f0f0f0',
                color: '#333',
                marginLeft: '12px'
              }}
              disabled={loading}
            >
              Back to Login
            </button>
          </form>
        </>
      )}

      {step === 2 && (
        <>
          <h2>Verify OTP</h2>
          <p style={{ marginBottom: '20px', color: '#666' }}>
            Enter the 6-digit code sent to your phone
          </p>
          <form onSubmit={handleVerifyOtp}>
            <div className="form-group">
              <label htmlFor="otp">OTP Code:</label>
              <input
                type="text"
                id="otp"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength="6"
                required
                disabled={loading}
                autoFocus
                inputMode="numeric"
              />
            </div>

            <div style={{ fontSize: '0.9em', color: '#999', marginBottom: '16px' }}>
              Code expires in 10 minutes
            </div>

            {error && <div style={{ color: '#f44336', marginBottom: '16px' }}>{error}</div>}

            <button type="submit" disabled={loading} style={{ marginBottom: '12px' }}>
              {loading ? 'Verifying...' : 'Verify OTP'}
            </button>
            <button
              type="button"
              onClick={handleBackToStep1}
              style={{
                background: '#f0f0f0',
                color: '#333',
                marginLeft: '12px'
              }}
              disabled={loading}
            >
              Back
            </button>
          </form>
        </>
      )}

      {step === 3 && (
        <>
          <h2>Set New Password</h2>
          <p style={{ marginBottom: '20px', color: '#666' }}>
            Create a strong password for your account
          </p>
          <form onSubmit={handleResetPassword}>
            <div className="form-group">
              <label htmlFor="newPassword">New Password:</label>
              <input
                type="password"
                id="newPassword"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                disabled={loading}
                autoFocus
              />
              <small style={{ color: '#999', marginTop: '4px', display: 'block' }}>
                Must be at least 8 characters with uppercase, lowercase, and numbers
              </small>
            </div>

            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password:</label>
              <input
                type="password"
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            {error && <div style={{ color: '#f44336', marginBottom: '16px' }}>{error}</div>}

            <button type="submit" disabled={loading} style={{ marginBottom: '12px' }}>
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>
            <button
              type="button"
              onClick={handleBackToStep2}
              style={{
                background: '#f0f0f0',
                color: '#333',
                marginLeft: '12px'
              }}
              disabled={loading}
            >
              Back
            </button>
          </form>
        </>
      )}
    </div>
  )
}
