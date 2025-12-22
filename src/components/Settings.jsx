import React, { useEffect, useState } from 'react'
import { subscribeUsers, createUser, updateUser, deleteUser } from '../services/valetFirestore'

export default function Settings({open, onClose}){
  const [users, setUsers] = useState([])
  const [showAddUser, setShowAddUser] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [formData, setFormData] = useState({ username: '', password: '', role: 'user' })
  const [error, setError] = useState('')
  const [currentUser, setCurrentUser] = useState(null)
  const [changePasswordData, setChangePasswordData] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  
  const isAdmin = currentUser?.role === 'admin'

  // Load current user from sessionStorage when modal opens
  useEffect(() => {
    if (!open) return
    const userStr = sessionStorage.getItem('currentUser')
    if (userStr) {
      try {
        setCurrentUser(JSON.parse(userStr))
      } catch (err) {
        console.error('Failed to parse current user:', err)
      }
    }
  }, [open])

  useEffect(() => {
    if (!open || !isAdmin) return
    const unsubscribe = subscribeUsers(setUsers)
    return () => unsubscribe()
  }, [open, isAdmin])

  if(!open) return null

  function clearData(){
    if(confirm('Clear all demo data? This will erase local vehicles and history.')){
      localStorage.removeItem('royce-valet-demo-v11')
      localStorage.removeItem('royce-valet-history')
      alert('Demo data cleared. Reloading…'); location.reload()
    }
  }

  function handleLogout() {
    sessionStorage.clear()
    location.href = '/login'
  }

  async function handleSubmitUser(e) {
    e.preventDefault()
    setError('')

    if (!formData.username || !formData.password) {
      setError('Username and password are required')
      return
    }

    try {
      if (editingUser) {
        await updateUser(editingUser.id, {
          username: formData.username,
          password: formData.password,
          role: formData.role
        })
      } else {
        await createUser(formData)
      }
      
      setFormData({ username: '', password: '', role: 'user' })
      setShowAddUser(false)
      setEditingUser(null)
    } catch (err) {
      console.error('Error saving user:', err)
      setError('Failed to save user')
    }
  }

  function handleEditUser(user) {
    setEditingUser(user)
    setFormData({
      username: user.username,
      password: user.password,
      role: user.role
    })
    setShowAddUser(true)
  }

  async function handleDeleteUser(userId) {
    if (confirm('Are you sure you want to delete this user?')) {
      try {
        await deleteUser(userId)
      } catch (err) {
        console.error('Error deleting user:', err)
        alert('Failed to delete user')
      }
    }
  }

  function cancelForm() {
    setFormData({ username: '', password: '', role: 'user' })
    setShowAddUser(false)
    setEditingUser(null)
    setError('')
  }

  async function handleChangePassword(e) {
    e.preventDefault()
    setPasswordError('')
    setPasswordSuccess(false)

    if (!changePasswordData.currentPassword || !changePasswordData.newPassword || !changePasswordData.confirmPassword) {
      setPasswordError('All fields are required')
      return
    }

    if (changePasswordData.currentPassword !== currentUser.password) {
      setPasswordError('Current password is incorrect')
      return
    }

    if (changePasswordData.newPassword !== changePasswordData.confirmPassword) {
      setPasswordError('New passwords do not match')
      return
    }

    if (changePasswordData.newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters')
      return
    }

    try {
      await updateUser(currentUser.id, { password: changePasswordData.newPassword })
      
      // Update current user in sessionStorage
      const updatedUser = { ...currentUser, password: changePasswordData.newPassword }
      sessionStorage.setItem('currentUser', JSON.stringify(updatedUser))
      setCurrentUser(updatedUser)
      
      setChangePasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setPasswordSuccess(true)
      
      setTimeout(() => setPasswordSuccess(false), 3000)
    } catch (err) {
      console.error('Error changing password:', err)
      setPasswordError('Failed to change password')
    }
  }

  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,.35)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000}} onClick={onClose}>
      <div className="card pad" style={{width:'min(700px, 94vw)', maxHeight:'90vh', overflow:'auto'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 24}}>
          <h1 style={{marginBottom:0}}>Settings</h1>
          <button className="btn secondary" onClick={onClose}>Close</button>
        </div>

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
                    />
                  </div>
                  <div style={{marginBottom: 12}}>
                    <input
                      type="text"
                      placeholder="Password"
                      value={formData.password}
                      onChange={(e) => setFormData({...formData, password: e.target.value})}
                      style={{width: '100%'}}
                    />
                  </div>
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
              {users.length === 0 ? (
                <div style={{padding: 20, textAlign: 'center', color: '#999'}}>
                  No users yet. Add your first user above.
                </div>
              ) : (
                <table style={{width: '100%', borderCollapse: 'collapse'}}>
                  <thead>
                    <tr style={{background: '#f5f5f5'}}>
                      <th style={{padding: 12, textAlign: 'left', borderBottom: '1px solid #ddd'}}>Username</th>
                      <th style={{padding: 12, textAlign: 'left', borderBottom: '1px solid #ddd'}}>Role</th>
                      <th style={{padding: 12, textAlign: 'right', borderBottom: '1px solid #ddd'}}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(user => (
                      <tr key={user.id} style={{borderBottom: '1px solid #eee'}}>
                        <td style={{padding: 12}}>{user.username}</td>
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
                        <td style={{padding: 12, textAlign: 'right'}}>
                          <button 
                            className="btn secondary" 
                            onClick={() => handleEditUser(user)}
                            style={{marginRight: 8, fontSize: 12, padding: '4px 12px'}}
                          >
                            Edit
                          </button>
                          <button 
                            className="btn secondary" 
                            onClick={() => handleDeleteUser(user.id)}
                            style={{fontSize: 12, padding: '4px 12px', color: '#ff4444'}}
                            disabled={user.id === currentUser?.id}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Demo Data Section */}
        <div className="field">
          <label>Demo data</label>
          <button className="btn secondary" onClick={clearData}>Clear demo data</button>
        </div>
      </div>
    </div>
  )
}