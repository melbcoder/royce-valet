import React, { useEffect, useMemo, useRef, useState } from 'react'
import { subscribeUsers, createUser, updateUser, deleteUser, subscribeSettings, updateSettings } from '../services/valetFirestore'
import { COMMON_TIMEZONES } from '../utils/timezoneUtils'
import { formatPhoneNumber } from '../utils/phoneFormatter'
import { countryCodes } from '../utils/countryCodes'
import CountryCodeSelect from './CountryCodeSelect'
import Modal from './Modal'

const DEFAULT_SMS_WELCOME_TEMPLATE = "Welcome to The Royce Hotel. Your valet tag is #[VALET_TAG] - we'll take care of the rest.\n\nWhen you're ready for your vehicle, request it here: [VALET_LINK]"
const DEFAULT_SMS_VEHICLE_READY_TEMPLATE = 'Your vehicle (#[VALET_TAG]) is ready at the driveway. Thank you for choosing The Royce Hotel!'
const DEFAULT_SMS_ROOM_READY_TEMPLATE = 'Greetings from The Royce! We are pleased to inform you that your room is ready. Please stop by the front desk to collect your keys.'
const DEFAULT_SMS_DEPARTURE_TEMPLATE = 'Your bags are in very good company.\nTag numbers: [DEP_TAGS].\nGo explore, indulge, wander - we\'ll mind the details.'

const getPrimaryCode = (codeStr) => String(codeStr || '').split(',')[0]?.trim() || ''

const resolveCountryCode = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return ''

  const match = raw.match(/\+\d[\d-]*/)
  if (match) {
    const digits = match[0].replace(/\D/g, '')
    return digits ? `+${digits}` : ''
  }

  const iso = raw.replace(/[^a-z]/gi, '').toUpperCase()
  const isoMatch = countryCodes.find((c) => c.iso.toUpperCase() === iso)
  if (isoMatch) return getPrimaryCode(isoMatch.code)

  const nameMatch = countryCodes.find((c) => c.name.toLowerCase() === raw.toLowerCase())
  if (nameMatch) return getPrimaryCode(nameMatch.code)

  return ''
}

const splitPhoneForForm = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return { countryCode: '', phone: '' }

  const normalized = raw.startsWith('+') ? raw : `+${raw.replace(/\D/g, '')}`
  const allCodes = countryCodes
    .flatMap((c) => String(c.code || '').split(',').map((code) => code.trim()).filter(Boolean))
    .sort((a, b) => b.length - a.length)

  const match = allCodes.find((code) => normalized.startsWith(code))
  if (!match) return { countryCode: '', phone: raw }

  return {
    countryCode: match,
    phone: normalized.slice(match.length),
  }
}

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
  { id: 'accounts-payable', label: 'Accounts Payable', icon: '💰' },
  { id: 'accounts-payable/travel-agents', label: 'Travel Agents', icon: '💰' },
  { id: 'accounts-payable/suppliers', label: 'Suppliers', icon: '💰' },
  { id: 'reports', label: 'Reports', icon: '📈' },
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
  {
    id: 'accounts-payable-section',
    label: 'Accounts Payable',
    icon: '💰',
    pages: [
      { id: 'accounts-payable', label: 'Accounts Payable' },
      { id: 'accounts-payable/travel-agents', label: 'Travel Agents' },
      { id: 'accounts-payable/suppliers', label: 'Suppliers' },
    ],
  },
  {
    id: 'reports-section',
    label: 'Reports',
    icon: '📈',
    pages: [
      { id: 'reports', label: 'Reports' },
    ],
  },
]

// Fast lookup for page label in user table
const PAGE_LABEL_MAP = AVAILABLE_SECTIONS.flatMap(s => s.pages).reduce((acc, p) => {
  acc[p.id] = p.label
  return acc
}, {})

export default function Settings({open = false, onClose, asPage = false}){
  const [users, setUsers] = useState([])
  const [showAddUser, setShowAddUser] = useState(false)
  const [showUsersTable, setShowUsersTable] = useState(false)
  const [userSearchQuery, setUserSearchQuery] = useState('')
  const [userRoleFilter, setUserRoleFilter] = useState('all')
  const [editingUser, setEditingUser] = useState(null)
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false)
  const [formData, setFormData] = useState({ username: '', password: '', role: 'user', countryCode: '', phone: '', pages: [] })
  const [error, setError] = useState('')
  const [currentUser, setCurrentUser] = useState(null)
  const [changePasswordData, setChangePasswordData] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [settings, setSettings] = useState({
    timezone: 'America/Los_Angeles',
    contractorPhotoRetentionDays: 7,
    vehiclePhotoRetentionDays: 7,
    pdfRetentionDays: 90,
    guestLinkRetentionDays: 2,
    smsWelcomeTemplate: DEFAULT_SMS_WELCOME_TEMPLATE,
    smsWelcomeEnabled: true,
    smsVehicleReadyTemplate: DEFAULT_SMS_VEHICLE_READY_TEMPLATE,
    smsVehicleReadyEnabled: true,
    smsRoomReadyTemplate: DEFAULT_SMS_ROOM_READY_TEMPLATE,
    smsRoomReadyEnabled: true,
    smsDepartureTemplate: DEFAULT_SMS_DEPARTURE_TEMPLATE,
    smsDepartureEnabled: true,
  })
  const [timezoneSuccess, setTimezoneSuccess] = useState(false)
  const [timezoneError, setTimezoneError] = useState('')
  const [retentionDaysInput, setRetentionDaysInput] = useState('7')
  const [retentionSuccess, setRetentionSuccess] = useState(false)
  const [retentionError, setRetentionError] = useState('')
  const [vehicleRetentionDaysInput, setVehicleRetentionDaysInput] = useState('7')
  const [vehicleRetentionSuccess, setVehicleRetentionSuccess] = useState(false)
  const [vehicleRetentionError, setVehicleRetentionError] = useState('')
  const [pdfRetentionDaysInput, setPdfRetentionDaysInput] = useState('90')
  const [pdfRetentionSuccess, setPdfRetentionSuccess] = useState(false)
  const [pdfRetentionError, setPdfRetentionError] = useState('')
  const [guestLinkRetentionDaysInput, setGuestLinkRetentionDaysInput] = useState('2')
  const [guestLinkRetentionSuccess, setGuestLinkRetentionSuccess] = useState(false)
  const [guestLinkRetentionError, setGuestLinkRetentionError] = useState('')
  const [smsWelcomeTemplateInput, setSmsWelcomeTemplateInput] = useState(DEFAULT_SMS_WELCOME_TEMPLATE)
  const [smsWelcomeEnabledInput, setSmsWelcomeEnabledInput] = useState(true)
  const [smsVehicleReadyTemplateInput, setSmsVehicleReadyTemplateInput] = useState(DEFAULT_SMS_VEHICLE_READY_TEMPLATE)
  const [smsVehicleReadyEnabledInput, setSmsVehicleReadyEnabledInput] = useState(true)
  const [smsRoomReadyTemplateInput, setSmsRoomReadyTemplateInput] = useState(DEFAULT_SMS_ROOM_READY_TEMPLATE)
  const [smsRoomReadyEnabledInput, setSmsRoomReadyEnabledInput] = useState(true)
  const [smsDepartureTemplateInput, setSmsDepartureTemplateInput] = useState(DEFAULT_SMS_DEPARTURE_TEMPLATE)
  const [smsDepartureEnabledInput, setSmsDepartureEnabledInput] = useState(true)
  const [smsTemplateSuccess, setSmsTemplateSuccess] = useState(false)
  const [smsTemplateError, setSmsTemplateError] = useState('')
  const [loading, setLoading] = useState(true)
  const [usersLoading, setUsersLoading] = useState(false)
  
  const isAdmin = currentUser?.role === 'admin'
  const isEditingSelf = editingUser && editingUser.id === currentUser?.id
  const isVisible = asPage || open

  // Load current user from localStorage and Firebase Auth when modal opens
  useEffect(() => {
    if (!isVisible) return
    
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
  }, [isVisible])

  useEffect(() => {
    if (!isVisible || !isAdmin) {
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
  }, [isVisible, isAdmin])

  // Subscribe to settings
  useEffect(() => {
    if (!isVisible) return
    const unsubscribe = subscribeSettings(setSettings)
    return () => unsubscribe()
  }, [isVisible])

  useEffect(() => {
    setRetentionDaysInput(String(settings.contractorPhotoRetentionDays || 7))
  }, [settings.contractorPhotoRetentionDays])

  useEffect(() => {
    setVehicleRetentionDaysInput(String(settings.vehiclePhotoRetentionDays || 7))
  }, [settings.vehiclePhotoRetentionDays])

  useEffect(() => {
    setPdfRetentionDaysInput(String(settings.pdfRetentionDays || 90))
  }, [settings.pdfRetentionDays])

  useEffect(() => {
    setGuestLinkRetentionDaysInput(String(settings.guestLinkRetentionDays || 2))
  }, [settings.guestLinkRetentionDays])

  useEffect(() => {
    setSmsWelcomeTemplateInput(settings.smsWelcomeTemplate || DEFAULT_SMS_WELCOME_TEMPLATE)
  }, [settings.smsWelcomeTemplate])

  useEffect(() => {
    setSmsWelcomeEnabledInput(settings.smsWelcomeEnabled !== false)
  }, [settings.smsWelcomeEnabled])

  useEffect(() => {
    setSmsVehicleReadyTemplateInput(settings.smsVehicleReadyTemplate || DEFAULT_SMS_VEHICLE_READY_TEMPLATE)
  }, [settings.smsVehicleReadyTemplate])

  useEffect(() => {
    setSmsVehicleReadyEnabledInput(settings.smsVehicleReadyEnabled !== false)
  }, [settings.smsVehicleReadyEnabled])

  useEffect(() => {
    setSmsRoomReadyTemplateInput(settings.smsRoomReadyTemplate || DEFAULT_SMS_ROOM_READY_TEMPLATE)
  }, [settings.smsRoomReadyTemplate])

  useEffect(() => {
    setSmsRoomReadyEnabledInput(settings.smsRoomReadyEnabled !== false)
  }, [settings.smsRoomReadyEnabled])

  useEffect(() => {
    setSmsDepartureTemplateInput(settings.smsDepartureTemplate || DEFAULT_SMS_DEPARTURE_TEMPLATE)
  }, [settings.smsDepartureTemplate])

  useEffect(() => {
    setSmsDepartureEnabledInput(settings.smsDepartureEnabled !== false)
  }, [settings.smsDepartureEnabled])

  // Debug function to check user document
  useEffect(() => {
    if (!isVisible || !currentUser) return
    
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
  }, [isVisible, currentUser])

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
  const validPageIdSet = useMemo(() => new Set(allPageIds), [allPageIds])

  const filteredUsers = useMemo(() => {
    const query = userSearchQuery.trim().toLowerCase()

    return users.filter((user) => {
      if (userRoleFilter !== 'all' && user.role !== userRoleFilter) return false

      if (!query) return true

      const pageText = (user.pages || [])
        .map((pageId) => PAGE_LABEL_MAP[pageId] || pageId)
        .join(' ')
        .toLowerCase()

      return (
        String(user.username || '').toLowerCase().includes(query) ||
        String(user.role || '').toLowerCase().includes(query) ||
        pageText.includes(query)
      )
    })
  }, [users, userSearchQuery, userRoleFilter])

  if(!isVisible) return null

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

    if (!formData.phone) {
      setError('Phone number is required')
      return
    }

    if (formData.countryCode && !resolveCountryCode(formData.countryCode)) {
      setError('Please enter a valid country code')
      return
    }

    const parsedCode = resolveCountryCode(formData.countryCode)
    const effectiveCode = parsedCode || '+61'
    const phoneDigits = String(formData.phone).replace(/\D/g, '').replace(/^0+/, '')
    if (phoneDigits.length === 0) {
      setError('Please enter a valid phone number (10+ digits)')
      return
    }

    const formattedPhone = formatPhoneNumber(`${effectiveCode}${phoneDigits}`)

    try {
      if (editingUser) {
        const updates = {
          username: formData.username.toLowerCase().trim(),
          phoneNumber: formattedPhone,
        }

        // Prevent admins from accidentally removing their own role/access.
        if (!isEditingSelf) {
          updates.role = formData.role
          updates.pages = formData.pages.filter((id) => validPageIdSet.has(id))
        }

        await updateUser(editingUser.id, updates)
      } else {
        const randomPassword = generateRandomPassword()
        
        await createUser({
          username: formData.username.toLowerCase().trim(),
          password: randomPassword,
          role: formData.role,
          phoneNumber: formattedPhone,
          pages: formData.pages.filter((id) => validPageIdSet.has(id)),
          mustChangePassword: true
        })
        
        try {
          const siteUrl = window.location.origin
          const message = `Welcome to Royce Valet!\n\nUsername: ${formData.username.toLowerCase().trim()}\nPassword: ${randomPassword}\n\nLogin at: ${siteUrl}\n\nYou will be required to change your password on first login.`
          
          const { sendSMS } = await import('../services/smsService')
          await sendSMS(formattedPhone, message)
          
          alert(`User created successfully!\n\nCredentials have been sent to ${formattedPhone}`)
        } catch (smsError) {
          console.error('Failed to send SMS:', smsError)
          alert(`User created successfully!\n\nWARNING: Could not send SMS. Please manually share credentials:\n\nUsername: ${formData.username.toLowerCase().trim()}\nPassword: ${randomPassword}\n\nUser must change password on first login.`)
        }
      }
      
      setFormData({ username: '', password: '', role: 'user', countryCode: '', phone: '', pages: [] })
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
    const splitPhone = splitPhoneForForm(user.phoneNumber || user.phone || '')
    setEditingUser(user)
    setFormData({
      username: user.username,
      password: '', // Don't populate password for edit
      role: user.role,
      countryCode: splitPhone.countryCode,
      phone: splitPhone.phone,
      pages: (user.pages || []).filter((id) => validPageIdSet.has(id))
    })
    setError('')
    setShowAddUser(true)
  }

  function handleOpenAddUserModal() {
    setEditingUser(null)
    setError('')
    setFormData({ username: '', password: '', role: 'user', countryCode: '', phone: '', pages: [] })
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
    setFormData({ username: '', password: '', role: 'user', countryCode: '', phone: '', pages: [] })
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

  async function handleSavePhotoRetentionDays() {
    try {
      setRetentionError('')
      setRetentionSuccess(false)

      const parsed = Number(retentionDaysInput)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
        setRetentionError('Please enter a whole number between 1 and 365 days.')
        return
      }

      await updateSettings({ contractorPhotoRetentionDays: parsed })
      setRetentionSuccess(true)
      setTimeout(() => setRetentionSuccess(false), 3000)
    } catch (err) {
      console.error('Error updating photo retention days:', err)
      setRetentionError('Failed to update photo retention days.')
    }
  }

  async function handleSaveVehiclePhotoRetentionDays() {
    try {
      setVehicleRetentionError('')
      setVehicleRetentionSuccess(false)

      const parsed = Number(vehicleRetentionDaysInput)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
        setVehicleRetentionError('Please enter a whole number between 1 and 365 days.')
        return
      }

      await updateSettings({ vehiclePhotoRetentionDays: parsed })
      setVehicleRetentionSuccess(true)
      setTimeout(() => setVehicleRetentionSuccess(false), 3000)
    } catch (err) {
      console.error('Error updating vehicle photo retention days:', err)
      setVehicleRetentionError('Failed to update vehicle photo retention days.')
    }
  }

  async function handleSavePdfRetentionDays() {
    try {
      setPdfRetentionError('')
      setPdfRetentionSuccess(false)

      const parsed = Number(pdfRetentionDaysInput)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) {
        setPdfRetentionError('Please enter a whole number between 1 and 3650 days.')
        return
      }

      await updateSettings({ pdfRetentionDays: parsed })
      setPdfRetentionSuccess(true)
      setTimeout(() => setPdfRetentionSuccess(false), 3000)
    } catch (err) {
      console.error('Error updating PDF retention days:', err)
      setPdfRetentionError('Failed to update PDF retention days.')
    }
  }

  async function handleSaveGuestLinkRetentionDays() {
    try {
      setGuestLinkRetentionError('')
      setGuestLinkRetentionSuccess(false)

      const parsed = Number(guestLinkRetentionDaysInput)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 30) {
        setGuestLinkRetentionError('Please enter a whole number between 1 and 30 days.')
        return
      }

      await updateSettings({ guestLinkRetentionDays: parsed })
      setGuestLinkRetentionSuccess(true)
      setTimeout(() => setGuestLinkRetentionSuccess(false), 3000)
    } catch (err) {
      console.error('Error updating guest link retention days:', err)
      setGuestLinkRetentionError('Failed to update guest link retention days.')
    }
  }

  async function handleSaveSmsTemplates() {
    try {
      setSmsTemplateError('')
      setSmsTemplateSuccess(false)

      const confirmed = window.confirm(
        'Saving these templates will change the SMS messages guests receive. Do you want to continue?'
      )
      if (!confirmed) return

      const welcome = String(smsWelcomeTemplateInput || '').trim()
      const vehicleReady = String(smsVehicleReadyTemplateInput || '').trim()
      const roomReady = String(smsRoomReadyTemplateInput || '').trim()
      const departure = String(smsDepartureTemplateInput || '').trim()

      if (!welcome || !vehicleReady || !roomReady || !departure) {
        setSmsTemplateError('All SMS templates are required.')
        return
      }

      if (welcome.length > 1600 || vehicleReady.length > 1600 || roomReady.length > 1600 || departure.length > 1600) {
        setSmsTemplateError('Each template must be 1600 characters or fewer.')
        return
      }

      await updateSettings({
        smsWelcomeTemplate: welcome,
        smsWelcomeEnabled: smsWelcomeEnabledInput,
        smsVehicleReadyTemplate: vehicleReady,
        smsVehicleReadyEnabled: smsVehicleReadyEnabledInput,
        smsRoomReadyTemplate: roomReady,
        smsRoomReadyEnabled: smsRoomReadyEnabledInput,
        smsDepartureTemplate: departure,
        smsDepartureEnabled: smsDepartureEnabledInput,
      })
      setSmsTemplateSuccess(true)
      setTimeout(() => setSmsTemplateSuccess(false), 3000)
    } catch (err) {
      console.error('Error updating SMS templates:', err)
      setSmsTemplateError('Failed to update SMS templates.')
    }
  }

  function handleResetSmsTemplatesToSaved() {
    setSmsTemplateError('')
    setSmsTemplateSuccess(false)
    setSmsWelcomeTemplateInput(settings.smsWelcomeTemplate || DEFAULT_SMS_WELCOME_TEMPLATE)
    setSmsWelcomeEnabledInput(settings.smsWelcomeEnabled !== false)
    setSmsVehicleReadyTemplateInput(settings.smsVehicleReadyTemplate || DEFAULT_SMS_VEHICLE_READY_TEMPLATE)
    setSmsVehicleReadyEnabledInput(settings.smsVehicleReadyEnabled !== false)
    setSmsRoomReadyTemplateInput(settings.smsRoomReadyTemplate || DEFAULT_SMS_ROOM_READY_TEMPLATE)
    setSmsRoomReadyEnabledInput(settings.smsRoomReadyEnabled !== false)
    setSmsDepartureTemplateInput(settings.smsDepartureTemplate || DEFAULT_SMS_DEPARTURE_TEMPLATE)
    setSmsDepartureEnabledInput(settings.smsDepartureEnabled !== false)
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
    <div
      style={asPage
        ? { maxWidth: '980px', margin: '0 auto' }
        : {position:'fixed', inset:0, background:'rgba(0,0,0,.35)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000}
      }
      onClick={!asPage ? onClose : undefined}
    >
      <div
        className="card pad"
        style={asPage ? { width: '100%' } : {width:'min(700px, 94vw)', maxHeight:'90vh', overflow:'auto'}}
        onClick={!asPage ? (e=>e.stopPropagation()) : undefined}
      >
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 24}}>
          <h1 style={{marginBottom:0}}>Settings</h1>
          <button className="btn secondary" onClick={() => onClose && onClose()}>
            {asPage ? 'Back' : 'Close'}
          </button>
        </div>

        {loading ? (
          <div style={{padding: 40, textAlign: 'center'}}>
            <p>Loading...</p>
          </div>
        ) : (
          <>
        {(() => {
          const sectionStyle = { marginBottom: 24, border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', background: '#fff' }
          const sectionHeaderStyle = { padding: '12px 16px', borderBottom: '1px solid #ddd', background: '#f5f7fb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }
          const sectionBodyStyle = { padding: 16 }

          return (
            <>
        {/* Current User Info */}
        {currentUser && (
          <section style={sectionStyle}>
            <div style={sectionHeaderStyle}>
              <h2 style={{margin: 0, fontSize: 20}}>Profile</h2>
              <button className="btn secondary" onClick={() => setIsProfileModalOpen(true)}>
                Edit Profile
              </button>
            </div>
            <div style={sectionBodyStyle}>
              <div style={{marginBottom: 8}}>
                <strong>Logged in as:</strong> {currentUser.username}
              </div>
              <div>
                <strong>Role:</strong> <span style={{
                padding: '2px 8px',
                borderRadius: 3,
                background: currentUser.role === 'admin' ? '#4CAF50' : '#2196F3',
                color: 'white',
                fontSize: 12,
                fontWeight: 500
              }}>{currentUser.role}</span>
              </div>
            </div>
          </section>
        )}

        {/* Timezone Settings (Admin Only) */}
        {isAdmin && (
          <section style={sectionStyle}>
            <div style={sectionHeaderStyle}>
              <h2 style={{margin: 0, fontSize: 20}}>Operations Settings</h2>
            </div>
            <div style={sectionBodyStyle}>
              <h3 style={{margin: '0 0 8px 0', fontSize: 16}}>Time Zone</h3>
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

              <div style={{marginTop: 16, paddingTop: 12, borderTop: '1px solid #eee'}}>
              <h3 style={{margin: '0 0 8px 0', fontSize: 16}}>Contractor Photo Retention</h3>
              <p style={{marginBottom: 10, fontSize: 14, color: '#666'}}>
                Choose how many days contractor photos stay in history after sign-out.
              </p>
              <div className="row" style={{gap: 8, alignItems: 'center'}}>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={retentionDaysInput}
                  onChange={(e) => setRetentionDaysInput(e.target.value)}
                  style={{width: 120}}
                />
                <span style={{fontSize: 13, color: '#666'}}>days</span>
                <button type="button" className="btn secondary" onClick={handleSavePhotoRetentionDays}>
                  Save
                </button>
              </div>
              {retentionError && (
                <div style={{color: '#ff4444', fontSize: 12, marginTop: 8}}>{retentionError}</div>
              )}
              {retentionSuccess && (
                <div style={{color: '#4CAF50', fontSize: 12, marginTop: 8}}>Photo retention updated successfully!</div>
              )}
            </div>

            <div style={{marginTop: 16, paddingTop: 12, borderTop: '1px solid #eee'}}>
              <h3 style={{margin: '0 0 8px 0', fontSize: 16}}>Vehicle Photo Retention</h3>
              <p style={{marginBottom: 10, fontSize: 14, color: '#666'}}>
                Choose how many days vehicle photos stay available in valet history.
              </p>
              <div className="row" style={{gap: 8, alignItems: 'center'}}>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={vehicleRetentionDaysInput}
                  onChange={(e) => setVehicleRetentionDaysInput(e.target.value)}
                  style={{width: 120}}
                />
                <span style={{fontSize: 13, color: '#666'}}>days</span>
                <button type="button" className="btn secondary" onClick={handleSaveVehiclePhotoRetentionDays}>
                  Save
                </button>
              </div>
              {vehicleRetentionError && (
                <div style={{color: '#ff4444', fontSize: 12, marginTop: 8}}>{vehicleRetentionError}</div>
              )}
              {vehicleRetentionSuccess && (
                <div style={{color: '#4CAF50', fontSize: 12, marginTop: 8}}>Vehicle photo retention updated successfully!</div>
              )}
            </div>

            <div style={{marginTop: 16, paddingTop: 12, borderTop: '1px solid #eee'}}>
              <h3 style={{margin: '0 0 8px 0', fontSize: 16}}>AP Invoice PDF Retention</h3>
              <p style={{marginBottom: 10, fontSize: 14, color: '#666'}}>
                Choose how many days AP invoice PDFs remain accessible after receipt.
              </p>
              <div className="row" style={{gap: 8, alignItems: 'center'}}>
                <input
                  type="number"
                  min="1"
                  max="3650"
                  value={pdfRetentionDaysInput}
                  onChange={(e) => setPdfRetentionDaysInput(e.target.value)}
                  style={{width: 120}}
                />
                <span style={{fontSize: 13, color: '#666'}}>days</span>
                <button type="button" className="btn secondary" onClick={handleSavePdfRetentionDays}>
                  Save
                </button>
              </div>
              {pdfRetentionError && (
                <div style={{color: '#ff4444', fontSize: 12, marginTop: 8}}>{pdfRetentionError}</div>
              )}
              {pdfRetentionSuccess && (
                <div style={{color: '#4CAF50', fontSize: 12, marginTop: 8}}>PDF retention updated successfully!</div>
              )}
            </div>

            <div style={{marginTop: 16, paddingTop: 12, borderTop: '1px solid #eee'}}>
              <h3 style={{margin: '0 0 8px 0', fontSize: 16}}>Guest Link Retention</h3>
              <p style={{marginBottom: 10, fontSize: 14, color: '#666'}}>
                Choose how many days guest valet links stay active after a vehicle is marked as departed.
              </p>
              <div className="row" style={{gap: 8, alignItems: 'center'}}>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={guestLinkRetentionDaysInput}
                  onChange={(e) => setGuestLinkRetentionDaysInput(e.target.value)}
                  style={{width: 120}}
                />
                <span style={{fontSize: 13, color: '#666'}}>days</span>
                <button type="button" className="btn secondary" onClick={handleSaveGuestLinkRetentionDays}>
                  Save
                </button>
              </div>
              {guestLinkRetentionError && (
                <div style={{color: '#ff4444', fontSize: 12, marginTop: 8}}>{guestLinkRetentionError}</div>
              )}
              {guestLinkRetentionSuccess && (
                <div style={{color: '#4CAF50', fontSize: 12, marginTop: 8}}>Guest link retention updated successfully!</div>
              )}
            </div>

            <div style={{marginTop: 16, paddingTop: 12, borderTop: '1px solid #eee'}}>
              <h3 style={{margin: '0 0 8px 0', fontSize: 16}}>Guest SMS Templates</h3>
              <p style={{marginBottom: 10, fontSize: 14, color: '#666'}}>
                Configure guest-facing SMS content. Variables are replaced automatically when sent.
              </p>
              <p style={{marginBottom: 10, fontSize: 13, color: '#b45309'}}>
                Warning: Saving these templates immediately changes the messages guests receive.
              </p>
              <p style={{marginBottom: 10, fontSize: 13, color: '#4b5563'}}>
                Available variables: <strong>[VALET_TAG]</strong>, <strong>[VALET_LINK]</strong>, <strong>[ROOM_NUMBER]</strong>, <strong>[DEP_TAGS]</strong>, <strong>[ARR_TAGS]</strong>
              </p>

              <div style={{display: 'grid', gap: 10}}>
                <div>
                  <label style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, marginBottom: 4, color: '#333'}}>
                    <span>Valet Welcome SMS</span>
                    <span style={{display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#444'}}>
                      <input
                        type="checkbox"
                        checked={smsWelcomeEnabledInput}
                        onChange={(e) => setSmsWelcomeEnabledInput(e.target.checked)}
                      />
                      Enabled
                    </span>
                  </label>
                  <textarea
                    value={smsWelcomeTemplateInput}
                    onChange={(e) => setSmsWelcomeTemplateInput(e.target.value)}
                    rows={4}
                    style={{width: '100%', fontFamily: 'inherit', fontSize: 14}}
                  />
                </div>

                <div>
                  <label style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, marginBottom: 4, color: '#333'}}>
                    <span>Vehicle Ready SMS</span>
                    <span style={{display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#444'}}>
                      <input
                        type="checkbox"
                        checked={smsVehicleReadyEnabledInput}
                        onChange={(e) => setSmsVehicleReadyEnabledInput(e.target.checked)}
                      />
                      Enabled
                    </span>
                  </label>
                  <textarea
                    value={smsVehicleReadyTemplateInput}
                    onChange={(e) => setSmsVehicleReadyTemplateInput(e.target.value)}
                    rows={3}
                    style={{width: '100%', fontFamily: 'inherit', fontSize: 14}}
                  />
                </div>

                <div>
                  <label style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, marginBottom: 4, color: '#333'}}>
                    <span>Room Ready SMS</span>
                    <span style={{display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#444'}}>
                      <input
                        type="checkbox"
                        checked={smsRoomReadyEnabledInput}
                        onChange={(e) => setSmsRoomReadyEnabledInput(e.target.checked)}
                      />
                      Enabled
                    </span>
                  </label>
                  <textarea
                    value={smsRoomReadyTemplateInput}
                    onChange={(e) => setSmsRoomReadyTemplateInput(e.target.value)}
                    rows={3}
                    style={{width: '100%', fontFamily: 'inherit', fontSize: 14}}
                  />
                </div>

                <div>
                  <label style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, marginBottom: 4, color: '#333'}}>
                    <span>Departure Luggage SMS</span>
                    <span style={{display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#444'}}>
                      <input
                        type="checkbox"
                        checked={smsDepartureEnabledInput}
                        onChange={(e) => setSmsDepartureEnabledInput(e.target.checked)}
                      />
                      Enabled
                    </span>
                  </label>
                  <textarea
                    value={smsDepartureTemplateInput}
                    onChange={(e) => setSmsDepartureTemplateInput(e.target.value)}
                    rows={3}
                    style={{width: '100%', fontFamily: 'inherit', fontSize: 14}}
                  />
                </div>

                <div className="row" style={{gap: 8, alignItems: 'center'}}>
                  <button type="button" className="btn secondary" onClick={handleSaveSmsTemplates}>
                    Save Templates
                  </button>
                  <button type="button" className="btn secondary" onClick={handleResetSmsTemplatesToSaved}>
                    Revert to Saved
                  </button>
                </div>

                {smsTemplateError && (
                  <div style={{color: '#ff4444', fontSize: 12}}>{smsTemplateError}</div>
                )}
                {smsTemplateSuccess && (
                  <div style={{color: '#4CAF50', fontSize: 12}}>SMS templates updated successfully!</div>
                )}
              </div>
            </div>
            </div>
          </section>
        )}

        {/* User Management (Admin Only) */}
        {isAdmin && (
          <section style={sectionStyle}>
            <div style={sectionHeaderStyle}>
              <h2 style={{margin: 0, fontSize: 20}}>User Management</h2>
              <div style={{display:'flex', gap: 8}}>
                {!showAddUser && (
                  <button className="btn primary" onClick={handleOpenAddUserModal}>Add User</button>
                )}
                <button className="btn secondary" onClick={() => setShowUsersTable((prev) => !prev)}>
                  {showUsersTable ? 'Hide Users' : 'Show Users'}
                </button>
              </div>
            </div>

            <div style={sectionBodyStyle}>
            {/* User List */}
            {showUsersTable && (
            <>
            <div style={{display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12}}>
              <input
                type="text"
                placeholder="Search by username, role, or page"
                value={userSearchQuery}
                onChange={(e) => setUserSearchQuery(e.target.value)}
                style={{flex: '1 1 260px', minWidth: 220}}
              />
              <select
                value={userRoleFilter}
                onChange={(e) => setUserRoleFilter(e.target.value)}
                style={{width: 150, padding: 8}}
              >
                <option value="all">All Roles</option>
                <option value="admin">Admin</option>
                <option value="user">User</option>
              </select>
              <div style={{fontSize: 12, color: '#666'}}>
                Showing {filteredUsers.length} of {users.length} users
              </div>
            </div>

            <div style={{border: '1px solid #ddd', borderRadius: 4, overflow: 'hidden'}}>
              {usersLoading ? (
                <div style={{padding: 20, textAlign: 'center', color: '#999'}}>
                  Loading users...
                </div>
              ) : users.length === 0 ? (
                <div style={{padding: 20, textAlign: 'center', color: '#999'}}>
                  No users yet. Add your first user above.
                </div>
              ) : filteredUsers.length === 0 ? (
                <div style={{padding: 20, textAlign: 'center', color: '#999'}}>
                  No users match the current filters.
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
                    {filteredUsers.map(user => {
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
                              title={isCurrentUser ? 'Edit your profile' : 'Edit user'}
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
            </>
            )}
            </div>
          </section>
        )}
            </>
          )
        })()}

        <Modal
          open={!!currentUser && isProfileModalOpen}
          title="Edit Profile"
          onClose={() => {
            setIsProfileModalOpen(false)
            setPasswordError('')
            setPasswordSuccess(false)
          }}
        >
          <div style={{marginBottom: 12, fontSize: 14, color: '#555'}}>
            Signed in as <strong>{currentUser?.username}</strong>
          </div>
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
            <div style={{display: 'flex', gap: 8}}>
              <button type="submit" className="btn primary">
                Change Password
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setIsProfileModalOpen(false)
                  setPasswordError('')
                  setPasswordSuccess(false)
                }}
              >
                Close
              </button>
            </div>
          </form>
        </Modal>

        <Modal
          open={showAddUser}
          title={editingUser ? 'Edit User' : 'Add New User'}
          onClose={cancelForm}
        >
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
            <div style={{marginBottom: 12}}>
              <div className="row" style={{ gap: 8 }}>
                <div style={{ minWidth: 170, flex: '0 0 170px' }}>
                  <CountryCodeSelect
                    value={formData.countryCode}
                    onChange={(value) => setFormData({ ...formData, countryCode: value })}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <input
                    type="tel"
                    placeholder="Phone Number"
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    style={{width: '100%'}}
                  />
                </div>
              </div>
              <small style={{color: '#666', fontSize: 12, display: 'block', marginTop: 4}}>
                {editingUser
                  ? 'Used for password reset OTP delivery. If country code is empty, Australia (+61) is used.'
                  : 'A random password will be generated and sent via SMS. If country code is empty, Australia (+61) is used.'}
              </small>
            </div>
            {editingUser && (
              <div style={{marginBottom: 12, padding: 8, background: '#fff3cd', borderRadius: 4, fontSize: 12}}>
                Password changes must be done by the user through "Change Password"
              </div>
            )}
            <div style={{marginBottom: 12}}>
              <select
                value={formData.role}
                onChange={(e) => setFormData({...formData, role: e.target.value})}
                disabled={isEditingSelf}
                style={{width: '100%', padding: 8}}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              {isEditingSelf && (
                <small style={{color: '#666', fontSize: 12, display: 'block', marginTop: 4}}>
                  You cannot change your own role.
                </small>
              )}
            </div>

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
                            onChange={() => !isEditingSelf && toggleSectionAccess(section)}
                            disabled={isEditingSelf}
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
                                onChange={() => !isEditingSelf && togglePageAccess(page.id)}
                                disabled={isEditingSelf}
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
              {isEditingSelf && (
                <small style={{color: '#666', fontSize: 11, display: 'block', marginTop: 4}}>
                  Your own page permissions cannot be changed from this screen.
                </small>
              )}
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
        </Modal>
          </>
        )}
      </div>
    </div>
  )
}