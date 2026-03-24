import React, { useEffect, useMemo, useRef, useState } from 'react'
import { subscribeUsers, createUser, updateUser, deleteUser, subscribeSettings, updateSettings } from '../services/valetFirestore'
import { COMMON_TIMEZONES } from '../utils/timezoneUtils'

// Define available pages/permissions
const AVAILABLE_PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'valet', label: 'Valet', icon: '🚗' },
  { id: 'valet-history', label: 'Valet History', icon: '📋' },
  { id: 'luggage', label: 'Luggage', icon: '🧳' },
  { id: 'luggage-history', label: 'Luggage History', icon: '📋' },
  { id: 'amenities', label: 'Amenities', icon: '🎁' },
  { id: 'amenities-history', label: 'Amenities History', icon: '📋' },
  { id: 'maintenance', label: 'Maintenance', icon: '🔧' },
]

// Group permissions by section
const AVAILABLE_SECTIONS = [
  {
    id: 'valet-section',
    label: 'Valet',
    icon: '🚗',
    pages: [
      { id: 'valet', label: 'Valet' },
      { id: 'valet-history', label: 'Valet History' },
    ],
  },
  {
    id: 'luggage-section',
    label: 'Luggage',
    icon: '🧳',
    pages: [
      { id: 'luggage', label: 'Luggage' },
      { id: 'luggage-history', label: 'Luggage History' },
    ],
  },
  {
    id: 'amenities-section',
    label: 'Amenities',
    icon: '🎁',
    pages: [
      { id: 'amenities', label: 'Amenities' },
      { id: 'amenities-history', label: 'Amenities History' },
    ],
  },
  {
    id: 'maintenance-section',
    label: 'Maintenance',
    icon: '🔧',
    pages: [
      { id: 'maintenance', label: 'Maintenance' },
      { id: 'maintenance/jobs', label: 'Maintenance Jobs' },
      { id: 'maintenance/contractor-sign-in', label: 'Contractor Sign In' },
    ],
  },
]

// Fast lookup for page label in user table
const PAGE_LABEL_MAP = AVAILABLE_SECTIONS.flatMap(s => s.pages).reduce((acc, p) => {
  acc[p.id] = p.label
  return acc
}, {})

export default function Settings({open, onClose}){
  const [users, setUsers] = useState([])
  const [showAddUser, setShowAddUser] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [formData, setFormData] = useState({ username: '', password: '', role: 'user', phone: '', pages: [] })
  const [error, setError] = useState('')
  const [currentUser, setCurrentUser] = useState(null)
  const [changePasswordData, setChangePasswordData] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [settings, setSettings] = useState({ timezone: 'America/Los_Angeles' })
  const [timezoneSuccess, setTimezoneSuccess] = useState(false)
  const [timezoneError, setTimezoneError] = useState('')
  const [loading, setLoading] = useState(true)
  const [usersLoading, setUsersLoading] = useState(false)
  
  const isAdmin = currentUser?.role === 'admin'

  // Load current user from localStorage and Firebase Auth when modal opens
  useEffect(() => {
    if (!open) return
    
    const loadCurrentUser = async () => {
      setLoading(true)
      try {
        const { auth } = await import('../firebase')
        
        // Get user from localStorage
        const userStr = localStorage.getItem('currentUser')
        if (userStr) {
          try {
            const userData = JSON.parse(userStr)
            setCurrentUser(userData)
          } catch (err) {
            console.error('Failed to parse current user:', err)
          }
        }
        
        // Verify Firebase auth state
        if (!auth.currentUser) {
          console.warn('No Firebase user logged in')
        }
      } finally {
        setLoading(false)
      }
    }
    
    loadCurrentUser()
  }, [open])

  useEffect(() => {
    if (!open || !isAdmin) {
      setUsersLoading(false)
      return
    }
    setUsersLoading(true)
    const unsubscribe = subscribeUsers((updatedUsers) => {
      console.log('Users received:', updatedUsers) // Debug log
      setUsers(updatedUsers)
      setUsersLoading(false)
    })
    return () => unsubscribe()
  }, [open, isAdmin])

  // Subscribe to settings
  useEffect(() => {
    if (!open) return
    const unsubscribe = subscribeSettings(setSettings)
    return () => unsubscribe()
  }, [open])

  // Debug function to check user document
  useEffect(() => {
    if (!open || !currentUser) return
    
    const checkUserDocument = async () => {
      try {
        const { db } = await import('../firebase')
        const { doc, getDoc } = await import('firebase/firestore')
        
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid || currentUser.id))
        
        if (userDoc.exists()) {
          console.log('User document found:', {
            docId: userDoc.id,
            data: userDoc.data(),
            currentUserUid: currentUser.uid,
            currentUserId: currentUser.id
          })
        } else {
          console.error('User document not found for UID:', currentUser.uid || currentUser.id)
        }
      } catch (err) {
        console.error('Error checking user document:', err)
      }
    }
    
    checkUserDocument()
  }, [open, currentUser])

  const checkboxStyle = {
    width: 16,
    height: 16,
    minWidth: 16,
    flex: '0 0 16px',
    margin: 0,
    cursor: 'pointer'
  }

  const sectionCheckboxRefs = useRef({})

  const [expandedSections, setExpandedSections] = useState(() =>
    AVAILABLE_SECTIONS.reduce((acc, s) => ({ ...acc, [s.id]: false }), {})
  )

  // Keep section checkboxes in sync with partial selection state
  useEffect(() => {
    AVAILABLE_SECTIONS.forEach(section => {
      const el = sectionCheckboxRefs.current[section.id]
      if (!el) return

      const sectionPageIds = section.pages.map(p => p.id)
      const selectedCount = sectionPageIds.filter(id => formData.pages.includes(id)).length
      const isPartial = selectedCount > 0 && selectedCount < sectionPageIds.length

      el.indeterminate = isPartial
    })
  }, [formData.pages])

  const allPageIds = useMemo(
    () => AVAILABLE_SECTIONS.flatMap(section => section.pages.map(p => p.id)),
    []
  )

  if(!open) return null

  async function handleLogout() {
    try {
      const { auth } = await import('../firebase')
      const { signOut } = await import('firebase/auth')
      await signOut(auth)
      localStorage.clear()
      location.href = '/login'
    } catch (err) {
      console.error('Sign out error:', err)
      alert('Failed to logout. Please try again.')
    }
  }

  // Add function to generate random password
  function generateRandomPassword() {
    const length = 12
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const lowercase = 'abcdefghijklmnopqrstuvwxyz'
    const numbers = '0123456789'
    const special = '!@#$%^&*'
    const all = uppercase + lowercase + numbers + special
    
    let password = ''
    // Ensure at least one of each type
    password += uppercase[Math.floor(Math.random() * uppercase.length)]
    password += lowercase[Math.floor(Math.random() * lowercase.length)]
    password += numbers[Math.floor(Math.random() * numbers.length)]
    password += special[Math.floor(Math.random() * special.length)]
    
    // Fill the rest randomly
    for (let i = password.length; i < length; i++) {
      password += all[Math.floor(Math.random() * all.length)]
    }
    
    // Shuffle the password
    return password.split('').sort(() => Math.random() - 0.5).join('')
  }

  async function handleSubmitUser(e) {
    e.preventDefault()
    setError('')

    if (!formData.username) {
      setError('Username is required')
      return
    }

    // For new users, require at least one page access
    if (!editingUser && formData.pages.length === 0) {
      setError('User must have access to at least one page')
      return
    }

    // Validate phone number for new users
    if (!editingUser) {
      if (!formData.phone) {
        setError('Phone number is required for new users')
        return
      }
      
      const phoneRegex = /^\+?[1-9]\d{9,14}$/
      const cleanPhone = formData.phone.replace(/[\s\-\(\)]/g, '')
      if (!phoneRegex.test(cleanPhone)) {
        setError('Please enter a valid phone number (10+ digits)')
        return
      }
    }

    try {
      if (editingUser) {
        await updateUser(editingUser.id, {
          username: formData.username.toLowerCase().trim(),
          role: formData.role,
          pages: formData.pages
        })
      } else {
        const randomPassword = generateRandomPassword()
        
        await createUser({
          username: formData.username.toLowerCase().trim(),
          password: randomPassword,
          role: formData.role,
          phoneNumber: formData.phone,
          pages: formData.pages,
          mustChangePassword: true
        })
        
        try {
          const siteUrl = window.location.origin
          const message = `Welcome to Royce Valet!\n\nUsername: ${formData.username.toLowerCase().trim()}\nPassword: ${randomPassword}\n\nLogin at: ${siteUrl}\n\nYou will be required to change your password on first login.`
          
          const { sendSMS } = await import('../services/smsService')
          await sendSMS(formData.phone, message)
          
          alert(`User created successfully!\n\nCredentials have been sent to ${formData.phone}`)
        } catch (smsError) {
          console.error('Failed to send SMS:', smsError)
          alert(`User created successfully!\n\nWARNING: Could not send SMS. Please manually share credentials:\n\nUsername: ${formData.username.toLowerCase().trim()}\nPassword: ${randomPassword}\n\nUser must change password on first login.`)
        }
      }
      
      setFormData({ username: '', password: '', role: 'user', phone: '', pages: [] })
      setShowAddUser(false)
      setEditingUser(null)
    } catch (err) {
      console.error('Error saving user:', err)
      if (err.code === 'auth/email-already-in-use') {
        setError('Username already exists')
      } else {
        setError('Failed to save user')
      }
    }
  }

  function handleEditUser(user) {
    setEditingUser(user)
    setFormData({
      username: user.username,
      password: '', // Don't populate password for edit
      role: user.role,
      phone: '', // Don't populate phone for edit
      pages: user.pages || []
    })
    setShowAddUser(true)
  }

  function togglePageAccess(pageId) {
    setFormData(prev => ({
      ...prev,
      pages: prev.pages.includes(pageId)
        ? prev.pages.filter(p => p !== pageId)
        : [...prev.pages, pageId]
    }))
  }

  async function handleDeleteUser(userId) {
    const userToDelete = users.find(u => u.id === userId);
    const adminCount = users.filter(u => u.role === 'admin').length;
    
    // Prevent deleting yourself
    if (userId === currentUser?.id) {
      alert('You cannot delete your own account while logged in.');
      return;
    }
    
    // Prevent deleting the last admin
    if (userToDelete?.role === 'admin' && adminCount === 1) {
      alert('Cannot delete the last admin user. Please create another admin first.');
      return;
    }
    
    // Show special message for default admin
    let confirmMessage = 'Are you sure you want to delete this user?';
    if (userToDelete?.isDefaultAdmin) {
      confirmMessage = 'Are you sure you want to delete the default admin account?\n\nMake sure you have another admin account and remember your credentials!';
    }
    
    if (confirm(confirmMessage)) {
      try {
        await deleteUser(userId);
      } catch (err) {
        console.error('Error deleting user:', err);
        alert(err.message || 'Failed to delete user');
      }
    }
  }

  function cancelForm() {
    setFormData({ username: '', password: '', role: 'user', phone: '', pages: [] })
    setShowAddUser(false)
    setEditingUser(null)
    setError('')
  }

  async function handleTimezoneChange(timezone) {
    try {
      setTimezoneError('')
      
      // Debug: Check auth state
      const { auth } = await import('../firebase')
      console.log('Current auth user:', auth.currentUser?.uid)
      console.log('Attempting to update timezone to:', timezone)
      
      await updateSettings({ timezone })
      setTimezoneSuccess(true)
      setTimeout(() => setTimezoneSuccess(false), 3000)
    } catch (err) {
      console.error('Error updating timezone:', err)
      console.error('Error code:', err.code)
      console.error('Error message:', err.message)
      
      let errorMsg = 'Failed to update timezone. '
      if (err.code === 'permission-denied') {
        errorMsg += 'Permission denied. Please ensure:\n'
        errorMsg += '1. You are logged in as an admin\n'
        errorMsg += '2. Firestore rules are properly configured\n'
        errorMsg += '3. Your user document exists with the correct UID'
      } else if (err.message) {
        errorMsg += err.message
      }
      setTimezoneError(errorMsg)
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault()
    setPasswordError('')
    setPasswordSuccess(false)

    const { currentPassword, newPassword, confirmPassword } = changePasswordData

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('All fields are required')
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match')
      return
    }

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long')
      return
    }

    if (newPassword === 'admin123') {
      setPasswordError('Please choose a more secure password')
      return
    }

    // Check password strength
    const hasUpperCase = /[A-Z]/.test(newPassword)
    const hasLowerCase = /[a-z]/.test(newPassword)
    const hasNumber = /[0-9]/.test(newPassword)
    
    if (!hasUpperCase || !hasLowerCase || !hasNumber) {
      setPasswordError('Password must contain uppercase, lowercase, and numbers')
      return
    }

    try {
      const { auth } = await import('../firebase')
      const { EmailAuthProvider, reauthenticateWithCredential, updatePassword } = await import('firebase/auth')
      
      const user = auth.currentUser
      if (!user) {
        setPasswordError('Not authenticated. Please log in again.')
        return
      }

      // Re-authenticate before changing password
      const credential = EmailAuthProvider.credential(user.email, currentPassword)
      await reauthenticateWithCredential(user, credential)
      
      // Update password
      await updatePassword(user, newPassword)
      
      setChangePasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setPasswordSuccess(true)
      
      setTimeout(() => setPasswordSuccess(false), 3000)
    } catch (err) {
      console.error('Error changing password:', err)
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setPasswordError('Current password is incorrect')
      } else if (err.code === 'auth/weak-password') {
        setPasswordError('Password is too weak')
      } else {
        setPasswordError('Failed to change password: ' + (err.message || 'Unknown error'))
      }
    }
  }

  function toggleSectionExpanded(sectionId) {
    setExpandedSections(prev => ({ ...prev, [sectionId]: !prev[sectionId] }))
  }

  function toggleSectionAccess(section) {
    const sectionPageIds = section.pages.map(p => p.id)

    setFormData(prev => {
      const hasAll = sectionPageIds.every(id => prev.pages.includes(id))
      const nextPages = hasAll
        ? prev.pages.filter(id => !sectionPageIds.includes(id))
        : Array.from(new Set([...prev.pages, ...sectionPageIds]))

      return { ...prev, pages: nextPages }
    })
  }

  // Optional: quick select/deselect all pages
  function setAllPages(enabled) {
    setFormData(prev => ({ ...prev, pages: enabled ? allPageIds : [] }))
  }

  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,.35)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000}} onClick={onClose}>
      <div className="card pad" style={{width:'min(700px, 94vw)', maxHeight:'90vh', overflow:'auto'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 24}}>
          <h1 style={{marginBottom:0}}>Settings</h1>
          <button className="btn secondary" onClick={onClose}>Close</button>
        </div>

        {loading ? (
          <div style={{padding: 40, textAlign: 'center'}}>
            <p>Loading...</p>
          </div>
        ) : (
          <>
        {/* Current User Info */}
        {currentUser && (
          <div className="field" style={{marginBottom: 24, padding: 16, background: '#f5f5f5', borderRadius: 4}}>
            <div style={{marginBottom: 8}}>
              <strong>Logged in as:</strong> {currentUser.username}
            </div>
            <div style={{marginBottom: 12}}>
              <strong>Role:</strong> <span style={{
                padding: '2px 8px',
                borderRadius: 3,
                background: currentUser.role === 'admin' ? '#4CAF50' : '#2196F3',
                color: 'white',
                fontSize: 12,
                fontWeight: 500
              }}>{currentUser.role}</span>
            </div>
            <button className="btn secondary" onClick={handleLogout}>Logout</button>
          </div>
        )}

        {/* Change Password Section */}
        {currentUser && (
          <div style={{marginBottom: 24, padding: 16, border: '1px solid #ddd', borderRadius: 4}}>
            <h2 style={{marginTop: 0}}>Change Password</h2>
            <form onSubmit={handleChangePassword}>
              <div style={{marginBottom: 12}}>
                <input
                  type="password"
                  placeholder="Current Password"
                  value={changePasswordData.currentPassword}
                  onChange={(e) => setChangePasswordData({...changePasswordData, currentPassword: e.target.value})}
                  style={{width: '100%'}}
                />
              </div>
              <div style={{marginBottom: 12}}>
                <input
                  type="password"
                  placeholder="New Password"
                  value={changePasswordData.newPassword}
                  onChange={(e) => setChangePasswordData({...changePasswordData, newPassword: e.target.value})}
                  style={{width: '100%'}}
                />
              </div>
              <div style={{marginBottom: 12}}>
                <input
                  type="password"
                  placeholder="Confirm New Password"
                  value={changePasswordData.confirmPassword}
                  onChange={(e) => setChangePasswordData({...changePasswordData, confirmPassword: e.target.value})}
                  style={{width: '100%'}}
                />
                <small style={{color: '#666', fontSize: 12, display: 'block', marginTop: 4}}>
                  Must be 8+ characters with uppercase, lowercase, and numbers
                </small>
              </div>
              {passwordError && (
                <div style={{color: '#ff4444', fontSize: 12, marginBottom: 12}}>{passwordError}</div>
              )}
              {passwordSuccess && (
                <div style={{color: '#4CAF50', fontSize: 12, marginBottom: 12}}>Password changed successfully!</div>
              )}
              <button type="submit" className="btn primary">
                Change Password
              </button>
            </form>
          </div>
        )}

        {/* Timezone Settings (Admin Only) */}
        {isAdmin && (
          <div style={{marginBottom: 24, padding: 16, border: '1px solid #ddd', borderRadius: 4}}>
            <h2 style={{marginTop: 0}}>Time Zone</h2>
            <p style={{marginBottom: 12, fontSize: 14, color: '#666'}}>
              Set the time zone for determining when dates change. This affects luggage and amenities archiving.
            </p>
            <div style={{marginBottom: 12}}>
              <select
                value={settings.timezone}
                onChange={(e) => handleTimezoneChange(e.target.value)}
                style={{width: '100%', padding: 8, fontSize: 14}}
              >
                {COMMON_TIMEZONES.map(tz => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>
            {timezoneError && (
              <div style={{color: '#ff4444', fontSize: 12, marginTop: 8}}>{timezoneError}</div>
            )}
            {timezoneSuccess && (
              <div style={{color: '#4CAF50', fontSize: 12, marginTop: 8}}>Time zone updated successfully!</div>
            )}
          </div>
        )}

        {/* User Management (Admin Only) */}
        {isAdmin && (
          <div style={{marginBottom: 24}}>
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 16}}>
              <h2 style={{marginBottom:0}}>User Management</h2>
              {!showAddUser && (
                <button className="btn primary" onClick={() => setShowAddUser(true)}>Add User</button>
              )}
            </div>

            {/* Add/Edit User Form */}
            {showAddUser && (
              <div style={{marginBottom: 20, padding: 16, border: '1px solid #ddd', borderRadius: 4}}>
                <h3 style={{marginTop: 0}}>{editingUser ? 'Edit User' : 'Add New User'}</h3>
                <form onSubmit={handleSubmitUser}>
                  <div style={{marginBottom: 12}}>
                    <input
                      type="text"
                      placeholder="Username"
                      value={formData.username}
                      onChange={(e) => setFormData({...formData, username: e.target.value})}
                      style={{width: '100%'}}
                      autoFocus
                      disabled={!!editingUser}
                    />
                    {editingUser ? (
                      <small style={{color: '#666', fontSize: 12}}>Username cannot be changed</small>
                    ) : (
                      <small style={{color: '#666', fontSize: 12, display: 'block', marginTop: 4}}>
                        Email will be: {formData.username.toLowerCase().trim() || 'username'}@royce-valet.internal
                      </small>
                    )}
                  </div>
                  {!editingUser && (
                    <div style={{marginBottom: 12}}>
                      <input
                        type="tel"
                        placeholder="Phone Number (e.g., +12345678900)"
                        value={formData.phone}
                        onChange={(e) => setFormData({...formData, phone: e.target.value})}
                        style={{width: '100%'}}
                      />
                      <small style={{color: '#666', fontSize: 12, display: 'block', marginTop: 4}}>
                        A random password will be generated and sent via SMS
                      </small>
                    </div>
                  )}
                  {editingUser && (
                    <div style={{marginBottom: 12, padding: 8, background: '#fff3cd', borderRadius: 4, fontSize: 12}}>
                      Password changes must be done by the user through "Change Password"
                    </div>
                  )}
                  <div style={{marginBottom: 12}}>
                    <select
                      value={formData.role}
                      onChange={(e) => setFormData({...formData, role: e.target.value})}
                      style={{width: '100%', padding: 8}}
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>

                  {/* Page Access Permissions */}
                  <div
                    style={{
                      marginBottom: 12,
                      padding: 12,
                      background: '#f9f9f9',
                      borderRadius: 4,
                      border: '1px solid #eee',
                      textAlign: 'left'
                    }}
                  >
                    <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 8}}>
                      <label style={{fontWeight: 600, fontSize: 14, margin: 0}}>
                        Page Access Permissions:
                      </label>
                      <div style={{display: 'flex', gap: 8}}>
                        <button type="button" className="btn secondary" style={{padding:'4px 8px', fontSize: 12}} onClick={() => setAllPages(true)}>
                          Select All
                        </button>
                        <button type="button" className="btn secondary" style={{padding:'4px 8px', fontSize: 12}} onClick={() => setAllPages(false)}>
                          Clear All
                        </button>
                      </div>
                    </div>

                    <div style={{display: 'grid', gap: 8}}>
                      {AVAILABLE_SECTIONS.map(section => {
                        const sectionPageIds = section.pages.map(p => p.id)
                        const selectedCount = sectionPageIds.filter(id => formData.pages.includes(id)).length
                        const allSelected = selectedCount === sectionPageIds.length && sectionPageIds.length > 0

                        return (
                          <div key={section.id} style={{border: '1px solid #e5e5e5', borderRadius: 6, background: '#fff'}}>
                            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 10px'}}>
                              <label style={{display:'flex', alignItems:'center', cursor:'pointer', gap: 8, margin: 0}}>
                                <input
                                  type="checkbox"
                                  ref={(el) => { sectionCheckboxRefs.current[section.id] = el }}
                                  checked={allSelected}
                                  aria-checked={selectedCount > 0 && selectedCount < sectionPageIds.length ? 'mixed' : allSelected}
                                  onChange={() => toggleSectionAccess(section)}
                                  style={checkboxStyle}
                                />
                                <span style={{fontSize: 13, fontWeight: 600}}>
                                  {section.icon} {section.label}
                                </span>
                                <span style={{fontSize: 11, color: '#666'}}>
                                  ({selectedCount}/{sectionPageIds.length})
                                </span>
                              </label>

                              <button
                                type="button"
                                className="btn secondary"
                                style={{padding:'2px 8px', fontSize: 12}}
                                onClick={() => toggleSectionExpanded(section.id)}
                              >
                                {expandedSections[section.id] ? 'Hide' : 'Show'}
                              </button>
                            </div>

                            {expandedSections[section.id] && (
                              <div style={{ padding: '0 12px 12px 12px', display: 'grid', gap: 6 }}>
                                {section.pages.map(page => (
                                  <label
                                    key={page.id}
                                    style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: 8 }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={formData.pages.includes(page.id)}
                                      onChange={() => togglePageAccess(page.id)}
                                      style={checkboxStyle}
                                    />
                                    <span style={{fontSize: 13}}>{page.label}</span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    <small style={{color: '#666', fontSize: 11, display: 'block', marginTop: 8}}>
                      Select a section to grant all pages in that section, or expand for granular page-level access.
                    </small>
                  </div>

                  {error && (
                    <div style={{color: '#ff4444', fontSize: 12, marginBottom: 12}}>{error}</div>
                  )}
                  <div style={{display: 'flex', gap: 8}}>
                    <button type="submit" className="btn primary">
                      {editingUser ? 'Update User' : 'Create User'}
                    </button>
                    <button type="button" className="btn secondary" onClick={cancelForm}>
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* User List */}
            <div style={{border: '1px solid #ddd', borderRadius: 4, overflow: 'hidden'}}>
              {usersLoading ? (
                <div style={{padding: 20, textAlign: 'center', color: '#999'}}>
                  Loading users...
                </div>
              ) : users.length === 0 ? (
                <div style={{padding: 20, textAlign: 'center', color: '#999'}}>
                  No users yet. Add your first user above.
                </div>
              ) : (
                <table style={{width: '100%', borderCollapse: 'collapse'}}>
                  <thead>
                    <tr style={{background: '#f5f5f5'}}>
                      <th style={{padding: 12, textAlign: 'left', borderBottom: '1px solid #ddd'}}>Username</th>
                      <th style={{padding: 12, textAlign: 'left', borderBottom: '1px solid #ddd'}}>Role</th>
                      <th style={{padding: 12, textAlign: 'left', borderBottom: '1px solid #ddd'}}>Pages</th>
                      <th style={{padding: 12, textAlign: 'right', borderBottom: '1px solid #ddd'}}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(user => {
                      const isCurrentUser = user.id === currentUser?.id;
                      const isLastAdmin = user.role === 'admin' && users.filter(u => u.role === 'admin').length === 1;
                      const canDelete = !isCurrentUser && !isLastAdmin;
                      const userPages = user.pages || [];
                      
                      return (
                        <tr key={user.id} style={{borderBottom: '1px solid #eee'}}>
                          <td style={{padding: 12}}>
                            {user.username}
                            {user.isDefaultAdmin && (
                              <span style={{
                                marginLeft: 8,
                                padding: '2px 6px',
                                borderRadius: 3,
                                background: '#fff3cd',
                                color: '#856404',
                                fontSize: 11,
                                fontWeight: 500
                              }}>
                                DEFAULT
                              </span>
                            )}
                          </td>
                          <td style={{padding: 12}}>
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: 3,
                              background: user.role === 'admin' ? '#4CAF50' : '#2196F3',
                              color: 'white',
                              fontSize: 12,
                              fontWeight: 500
                            }}>
                              {user.role}
                            </span>
                          </td>
                          <td style={{padding: 12, fontSize: 12}}>
                            {userPages.length === 0 ? (
                              <span style={{color: '#999'}}>No access</span>
                            ) : (
                              <div style={{display: 'flex', flexWrap: 'wrap', gap: 4}}>
                                {userPages.map(pageId => {
                                  const pageLabel = PAGE_LABEL_MAP[pageId]
                                  return pageLabel ? (
                                    <span key={pageId} style={{
                                      padding: '2px 6px',
                                      borderRadius: 3,
                                      background: '#e3f2fd',
                                      color: '#1976d2',
                                      fontSize: 11
                                    }}>
                                      {pageLabel}
                                    </span>
                                  ) : null
                                })}
                              </div>
                            )}
                          </td>
                          <td style={{padding: 12, textAlign: 'right'}}>
                            <button 
                              className="btn secondary" 
                              onClick={() => handleEditUser(user)}
                              style={{marginRight: 8, fontSize: 12, padding: '4px 12px'}}
                              disabled={isCurrentUser}
                            >
                              Edit
                            </button>
                            <button 
                              className="btn secondary" 
                              onClick={() => handleDeleteUser(user.id)}
                              style={{
                                fontSize: 12, 
                                padding: '4px 12px', 
                                color: canDelete ? '#ff4444' : '#999',
                                cursor: canDelete ? 'pointer' : 'not-allowed'
                              }}
                              disabled={!canDelete}
                              title={
                                isCurrentUser ? 'Cannot delete your own account' :
                                isLastAdmin ? 'Cannot delete the last admin' :
                                'Delete user'
                              }
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
          </>
        )}
      </div>
    </div>
  )
}