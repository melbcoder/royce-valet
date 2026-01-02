import { initializeApp } from "firebase/app";
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  getDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
  getDocs,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { getTodayInTimezone } from "../utils/timezoneUtils";

import { db, auth } from "../firebase";

// Get storage from the existing Firebase app (imported from firebase.js)
export const storage = getStorage();

// Firestore collections
const vehiclesRef = collection(db, "vehicles");
const historyRef = collection(db, "history");
const vehicleAuditRef = collection(db, "vehicleAudit");
const usersRef = collection(db, "users");
const luggageRef = collection(db, "luggage");
const luggageHistoryRef = collection(db, "luggageHistory");
const luggageAuditRef = collection(db, "luggageAudit");
const amenitiesRef = collection(db, "amenities");
const amenitiesHistoryRef = collection(db, "amenitiesHistory");
const amenitiesAuditRef = collection(db, "amenitiesAudit");
const settingsRef = collection(db, "settings");

// ===== SETTINGS MANAGEMENT =====

// Get app settings
export async function getSettings() {
  try {
    const settingsDoc = await getDoc(doc(settingsRef, "app"));
    if (settingsDoc.exists()) {
      return settingsDoc.data();
    }
    // Return defaults if no settings exist
    return {
      timezone: "Australia/Melbourne", // Default to Melbourne, Australia
    };
  } catch (error) {
    console.error("Error getting settings:", error);
    return { timezone: "Australia/Melbourne" };
  }
}

// Update app settings
export async function updateSettings(updates) {
  await setDoc(doc(settingsRef, "app"), {
    ...updates,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// Subscribe to settings
export function subscribeSettings(callback) {
  return onSnapshot(doc(settingsRef, "app"), (snap) => {
    if (snap.exists()) {
      callback(snap.data());
    } else {
      callback({ timezone: "Australia/Melbourne" });
    }
  });
}

// Security utility functions
const sanitizeString = (str, maxLength = 500) => {
  if (!str) return '';
  return String(str).trim().slice(0, maxLength).replace(/[<>]/g, '');
};

const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
};

const validateTag = (tag) => {
  return /^[a-zA-Z0-9]{1,20}$/.test(String(tag));
};

// Helper function to get current user from session
const getCurrentUser = () => {
  try {
    const userStr = localStorage.getItem('currentUser');
    if (userStr) {
      return JSON.parse(userStr);
    }
  } catch (error) {
    console.error('Error getting current user:', error);
  }
  return null;
};

// Helper function to add audit log entry for luggage
const addAuditLog = async (luggageId, action, details = {}) => {
  try {
    const currentUser = getCurrentUser();
    const auditEntry = {
      luggageId,
      action,
      details,
      timestamp: serverTimestamp(),
      user: currentUser ? {
        id: currentUser.id,
        username: currentUser.username,
        role: currentUser.role
      } : { username: 'System' }
    };
    
    await setDoc(doc(luggageAuditRef, `${luggageId}-${Date.now()}`), auditEntry);
  } catch (error) {
    console.error('Error adding audit log:', error);
  }
};

// Helper function to add vehicle audit log
const addVehicleAuditLog = async (vehicleTag, action, details = {}) => {
  try {
    const currentUser = getCurrentUser();
    const auditEntry = {
      vehicleTag,
      action,
      details,
      timestamp: serverTimestamp(),
      user: currentUser ? {
        id: currentUser.id,
        username: currentUser.username,
        role: currentUser.role
      } : { username: 'System' }
    };
    
    await setDoc(doc(vehicleAuditRef, `${vehicleTag}-${Date.now()}`), auditEntry);
  } catch (error) {
    console.error('Error adding vehicle audit log:', error);
  }
};

// Helper function to add amenity audit log
const addAmenityAuditLog = async (amenityId, action, details = {}) => {
  try {
    const currentUser = getCurrentUser();
    const auditEntry = {
      amenityId,
      action,
      details,
      timestamp: serverTimestamp(),
      user: currentUser ? {
        id: currentUser.id,
        username: currentUser.username,
        role: currentUser.role
      } : { username: 'System' }
    };
    
    await setDoc(doc(amenitiesAuditRef, `${amenityId}-${Date.now()}`), auditEntry);
  } catch (error) {
    console.error('Error adding amenity audit log:', error);
  }
};

// Create / check-in vehicle
export async function createVehicle(data) {
  // Validate and sanitize inputs
  if (!validateTag(data.tag)) {
    throw new Error('Invalid tag format');
  }
  
  const v = {
    tag: sanitizeString(data.tag, 20),
    guestName: sanitizeString(data.guestName, 200),
    roomNumber: sanitizeString(data.roomNumber, 50),
    phone: sanitizeString(data.phone, 20),
    status: "received",

    license: "",
    make: "",
    color: "",
    bay: "",
    departureDate: data.departureDate ? sanitizeString(data.departureDate, 10) : '',

    scheduledAt: null,
    requested: false,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const tag = sanitizeString(data.tag, 20);
  await setDoc(doc(vehiclesRef, tag), v);
  
  // Add audit log
  await addVehicleAuditLog(tag, 'created', {
    guestName: v.guestName,
    roomNumber: v.roomNumber,
    departureDate: v.departureDate
  });
}

// Staff: update vehicle
export async function updateVehicle(tag, updates) {
  await updateDoc(doc(vehiclesRef, tag), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
  
  // Add audit log for significant updates
  const auditableUpdates = Object.keys(updates)
    .filter(key => !key.includes('At') && key !== 'updatedAt' && key !== 'requested')
    .reduce((obj, key) => {
      obj[key] = updates[key];
      return obj;
    }, {});
  
  if (Object.keys(auditableUpdates).length > 0) {
    await addVehicleAuditLog(tag, 'updated', auditableUpdates);
  }
}

// Guest: request pickup
export async function requestVehicle(tag) {
  await updateDoc(doc(vehiclesRef, tag), {
    status: "requested",
    requested: true,
    scheduledAt: null,
    updatedAt: serverTimestamp(),
  });
  await addVehicleAuditLog(tag, 'requested', {});
}

// Guest: cancel request
export async function cancelRequest(tag) {
  const docRef = doc(vehiclesRef, tag);
  const docSnap = await getDoc(docRef);
  
  if (!docSnap.exists()) {
    throw new Error('Vehicle not found');
  }
  
  const vehicle = docSnap.data();
  
  // If status is 'requested', revert to prevStatus (or 'parked' as fallback)
  // Otherwise, keep current status
  let targetStatus = vehicle.status;
  if (vehicle.status === 'requested') {
    targetStatus = vehicle.prevStatus || 'parked';
  }
  
  await updateDoc(docRef, {
    requested: false,
    requestedAt: null,
    status: targetStatus,
    prevStatus: null,
    updatedAt: serverTimestamp(),
  });
}

// Staff: vehicle ready at driveway
export async function markReady(tag) {
  await updateDoc(doc(vehiclesRef, tag), {
    status: "ready",
    updatedAt: serverTimestamp(),
  });
  await addVehicleAuditLog(tag, 'marked_ready', {});
}

// Staff: vehicle handed to guest
export async function markOut(tag) {
  await updateDoc(doc(vehiclesRef, tag), {
    status: "out",
    requested: false,
    updatedAt: serverTimestamp(),
  });
  await addVehicleAuditLog(tag, 'handed_over', {});
}

// Staff: re-park returned vehicle
export async function parkAgain(tag, bay, license, make, color) {
  await updateDoc(doc(vehiclesRef, tag), {
    status: "parked",
    bay: bay ?? "",
    license: license ?? "",
    make: make ?? "",
    color: color ?? "",
    updatedAt: serverTimestamp(),
  });
  
  await addVehicleAuditLog(tag, 'parked', {
    bay: bay ?? "",
    license: license ?? "",
    make: make ?? "",
    color: color ?? ""
  });
}

// Guest: schedule pickup time
export async function scheduleRequest(tag, time) {
  await updateVehicle(tag, { scheduledAt: time, requested: false });
}

// Staff: cancel scheduled pickup
export async function clearSchedule(tag) {
  await updateVehicle(tag, { scheduledAt: null });
}

// Staff: archive on departure
export async function archiveVehicle(tag, vehicle) {
  await setDoc(doc(historyRef, `${tag}-${Date.now()}`), {
    ...vehicle,
    archivedAt: serverTimestamp(),
  });

  await deleteDoc(doc(vehiclesRef, tag));
}

// ✅ Reinstate vehicle from today's history
export async function reinstateVehicle(histId, veh) {
  // Restore to active vehicles
  await setDoc(doc(vehiclesRef, veh.tag), {
    ...veh,
    status: "parked",
    requested: false,
    scheduledAt: null,
    updatedAt: serverTimestamp(),
  });

  // Remove from history
  await deleteDoc(doc(historyRef, histId));
}

// Delete vehicle from database
export async function deleteVehicle(tag) {
  await deleteDoc(doc(vehiclesRef, tag));
}

// Subscribe: staff active view
export function subscribeActiveVehicles(callback) {
  return onSnapshot(vehiclesRef, (snapshot) => {
    const list = snapshot.docs.map((d) => d.data());
    callback(list);
  });
}

// Subscribe: guest page
export function subscribeVehicleByTag(tag, callback) {
  return onSnapshot(doc(db, "vehicles", tag), (snap) => {
    callback(snap.exists() ? snap.data() : null);
  });
}

// ✅ Subscribe to history vehicles
export function subscribeHistory(callback) {
  return onSnapshot(historyRef, (snapshot) => {
    const list = snapshot.docs.map((d) => ({
      ...d.data(),
      _id: d.id, // store document ID for reinstating
    }));
    callback(list);
  });
}

// Get audit logs for a specific vehicle
export async function getVehicleAuditLog(vehicleTag) {
  try {
    const q = query(vehicleAuditRef, where("vehicleTag", "==", vehicleTag));
    const snapshot = await getDocs(q);
    const logs = snapshot.docs.map((d) => ({
      ...d.data(),
      id: d.id,
    }));
    // Sort by timestamp (oldest first for chronological order)
    return logs.sort((a, b) => {
      const timeA = a.timestamp?.seconds || 0;
      const timeB = b.timestamp?.seconds || 0;
      return timeA - timeB;
    });
  } catch (error) {
    console.error("Error fetching vehicle audit logs:", error);
    return [];
  }
}

// ===== USER MANAGEMENT =====

// Check if any users exist
export async function checkUsersExist() {
  const snapshot = await getDocs(usersRef);
  return !snapshot.empty;
}

// Initialize default admin user
export async function initializeDefaultAdmin() {
  const { createUserWithEmailAndPassword } = await import('firebase/auth');
  const { auth } = await import('../firebase');
  
  try {
    const email = "admin@royce-valet.internal";
    const password = "admin123"; // Changed to match your requirement
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    
    // Use Firebase Auth UID as document ID for easy rule matching
    await setDoc(doc(usersRef, userCredential.user.uid), {
      uid: userCredential.user.uid,
      username: "admin",
      role: "admin",
      isDefaultAdmin: true, // Mark as default admin
      createdAt: serverTimestamp(),
    });
    return userCredential.user.uid;
  } catch (error) {
    // If user already exists, that's okay
    if (error.code === 'auth/email-already-in-use') {
      console.log('Default admin already exists');
      return null;
    }
    console.error('Error creating default admin:', error);
    throw error;
  }
}

// Authenticate user with Firebase Auth
export async function authenticateUser(username, password) {
  const { signInWithEmailAndPassword } = await import('firebase/auth');
  const { auth } = await import('../firebase');
  
  // Input validation
  if (!username || typeof username !== 'string' || username.length > 50) {
    throw new Error('Invalid username');
  }
  
  if (!password || typeof password !== 'string' || password.length > 100) {
    throw new Error('Invalid password');
  }
  
  try {
    const cleanUsername = sanitizeString(username.toLowerCase().trim(), 50);
    const email = `${cleanUsername}@royce-valet.internal`;
    
    console.log('Attempting Firebase Auth with email:', email);
    
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;
    console.log('Firebase Auth successful for UID:', uid);
    
    // Get user data using UID as document ID
    const userDoc = await getDoc(doc(usersRef, uid));
    
    if (!userDoc.exists()) {
      console.error('User authenticated in Firebase Auth but not found in Firestore');
      console.error('Expected document at path: users/' + uid);
      
      // Try to find user by querying
      console.log('Attempting to find user by UID in query...');
      const q = query(usersRef, where("uid", "==", uid));
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
        const foundDoc = snapshot.docs[0];
        console.log('Found user in Firestore with different document ID:', foundDoc.id);
        
        // Migrate to correct document structure
        const userData = foundDoc.data();
        await setDoc(doc(usersRef, uid), userData);
        await deleteDoc(doc(usersRef, foundDoc.id));
        console.log('Migrated user document to correct ID');
        
        return {
          id: uid,
          uid: uid,
          username: userData.username,
          role: userData.role,
          mustChangePassword: userData.mustChangePassword || false,
          createdAt: userData.createdAt,
        };
      }
      
      throw new Error('User profile not found in Firestore after authentication');
    }
    
    const userData = userDoc.data();
    console.log('User data retrieved successfully:', userData);
    
    return {
      id: uid,
      uid: uid,
      username: userData.username,
      role: userData.role,
      mustChangePassword: userData.mustChangePassword || false,
      createdAt: userData.createdAt,
    };
  } catch (error) {
    console.error('Authentication error:', error);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    throw error;
  }
}

// Create new user with Firebase Auth
export async function createUser({ username, password, role, mustChangePassword = false }) {
  const cleanUsername = username.toLowerCase().trim()
  const email = `${cleanUsername}@royce-valet.internal` // Changed from .local to .internal
  
  let userCredential = null
  
  try {
    // Create Firebase Auth user
    userCredential = await createUserWithEmailAndPassword(auth, email, password)
    
    // Create user document in Firestore using UID as document ID
    await setDoc(doc(db, 'users', userCredential.user.uid), {
      uid: userCredential.user.uid,
      username: cleanUsername,
      email,
      role,
      mustChangePassword,
      createdAt: serverTimestamp()
    })
    
    console.log('User created successfully:', userCredential.user.uid)
    
  } catch (err) {
    console.error('Error in createUser:', err)
    console.error('Error code:', err.code)
    console.error('Error message:', err.message)
    
    // If Firestore write failed but Auth user was created, try to clean up
    if (userCredential?.user) {
      console.warn('Auth user created but Firestore write failed. Attempting cleanup...')
      try {
        await userCredential.user.delete()
        console.log('Cleaned up orphaned auth user')
      } catch (cleanupErr) {
        console.error('Failed to cleanup auth user:', cleanupErr)
      }
    }
    
    throw err
  }
}

// Update user
export async function updateUser(userId, updates) {
  const { updatePassword } = await import('firebase/auth');
  const { auth } = await import('../firebase');
  
  // If password is being updated, update Firebase Auth
  if (updates.password) {
    try {
      const currentUser = auth.currentUser;
      if (currentUser) {
        await updatePassword(currentUser, updates.password);
      }
    } catch (error) {
      console.error('Error updating password:', error);
      throw error;
    }
    // Don't store password in Firestore
    delete updates.password;
  }
  
  if (updates.username) {
    updates.username = updates.username.toLowerCase();
  }
  
  // Only update Firestore if there are remaining fields
  if (Object.keys(updates).length > 0) {
    await updateDoc(doc(usersRef, userId), updates);
  }
}

// Delete user (Firestore only - Firebase Auth deletion requires current user context)
export async function deleteUser(userId) {
  // Check if this is the last admin
  const snapshot = await getDocs(usersRef);
  const users = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  const admins = users.filter(u => u.role === 'admin');
  const userToDelete = users.find(u => u.id === userId);
  
  // Prevent deleting the last admin
  if (admins.length === 1 && userToDelete?.role === 'admin') {
    throw new Error('Cannot delete the last admin user. Create another admin first.');
  }
  
  // Note: Firebase Auth user deletion should be handled separately
  // and requires the user to be signed in or admin SDK on backend
  await deleteDoc(doc(usersRef, userId));
}

// Subscribe to all users (admin only)
export function subscribeUsers(callback) {
  return onSnapshot(usersRef, (snapshot) => {
    const list = snapshot.docs.map((d) => ({
      ...d.data(),
      id: d.id,
    }));
    callback(list);
  });
}

// ===== LUGGAGE MANAGEMENT =====

// Create luggage item
export async function createLuggage(data) {
  // Get the configured timezone and calculate today's date
  const settings = await getSettings();
  const timezone = settings.timezone || 'Australia/Melbourne';
  const todayDate = getTodayInTimezone(timezone);
  
  const item = {
    tags: data.tags || [], // Array of tag numbers
    guestName: data.guestName,
    roomNumber: data.roomNumber,
    roomStatus: data.roomStatus || "",
    phone: data.phone,
    numberOfBags: data.numberOfBags || 0,
    status: "stored", // stored, delivered
    notes: data.notes || "",
    createdDate: todayDate, // YYYY-MM-DD format for easy comparison
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // Use guest name + timestamp as document ID since we may have multiple tags
  const docId = `${data.guestName.replace(/\s+/g, '-')}-${Date.now()}`;
  await setDoc(doc(luggageRef, docId), item);
  
  // Add audit log
  await addAuditLog(docId, 'created', {
    tags: item.tags,
    guestName: item.guestName,
    roomNumber: item.roomNumber,
    numberOfBags: item.numberOfBags
  });
  
  return docId;
}

// Update luggage item
export async function updateLuggage(id, updates) {
  await updateDoc(doc(luggageRef, id), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
  
  // Add audit log for updates (excluding timestamp fields)
  const auditableUpdates = Object.keys(updates)
    .filter(key => !key.includes('At') && key !== 'updatedAt')
    .reduce((obj, key) => {
      obj[key] = updates[key];
      return obj;
    }, {});
  
  if (Object.keys(auditableUpdates).length > 0) {
    await addAuditLog(id, 'updated', auditableUpdates);
  }
}

// Mark luggage as delivered to room
export async function markLuggageDelivered(id) {
  await updateDoc(doc(luggageRef, id), {
    status: "delivered",
    deliveredAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  
  // Add specific audit log for delivery
  await addAuditLog(id, 'delivered', {});
}

// Archive luggage item
export async function archiveLuggage(id, item) {
  await setDoc(doc(luggageHistoryRef, `${id}-${Date.now()}`), {
    ...item,
    archivedAt: serverTimestamp(),
  });

  await deleteDoc(doc(luggageRef, id));
}

// Delete luggage item
export async function deleteLuggage(id) {
  await deleteDoc(doc(luggageRef, id));
}

// Subscribe to active luggage
export function subscribeActiveLuggage(callback) {
  return onSnapshot(luggageRef, (snapshot) => {
    const list = snapshot.docs.map((d) => ({ ...d.data(), id: d.id }));
    callback(list);
  });
}

// Subscribe to luggage history
export function subscribeLuggageHistory(callback) {
  return onSnapshot(luggageHistoryRef, (snapshot) => {
    const list = snapshot.docs.map((d) => ({
      ...d.data(),
      _id: d.id,
    }));
    callback(list);
  });
}

// Get audit logs for a specific luggage item
export async function getLuggageAuditLog(luggageId) {
  try {
    const q = query(luggageAuditRef, where("luggageId", "==", luggageId));
    const snapshot = await getDocs(q);
    const logs = snapshot.docs.map((d) => ({
      ...d.data(),
      id: d.id,
    }));
    // Sort by timestamp (most recent first)
    return logs.sort((a, b) => {
      const timeA = a.timestamp?.seconds || 0;
      const timeB = b.timestamp?.seconds || 0;
      return timeA - timeB; // Oldest first for chronological order
    });
  } catch (error) {
    console.error("Error fetching audit logs:", error);
    return [];
  }
}

// ===== AMENITIES MANAGEMENT =====

// Create amenity item
export async function createAmenity(data) {
  // Get today's date in the configured timezone if no deliveryDate provided
  let deliveryDate = data.deliveryDate;
  if (!deliveryDate) {
    const settings = await getSettings();
    const timezone = settings.timezone || 'Australia/Melbourne';
    deliveryDate = getTodayInTimezone(timezone);
  }
  
  const item = {
    description: data.description,
    guestName: data.guestName,
    roomNumber: data.roomNumber,
    roomStatus: data.roomStatus || "",
    deliveryDate: deliveryDate, // YYYY-MM-DD format
    status: "outstanding", // outstanding, delivered
    notes: data.notes || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // Use guest name + timestamp as document ID
  const docId = `${data.guestName.replace(/\s+/g, '-')}-${Date.now()}`;
  await setDoc(doc(amenitiesRef, docId), item);
  
  // Add audit log
  await addAmenityAuditLog(docId, 'created', {
    description: item.description,
    guestName: item.guestName,
    roomNumber: item.roomNumber,
    deliveryDate: item.deliveryDate
  });
  
  return docId;
}

// Update amenity item
export async function updateAmenity(id, updates) {
  await updateDoc(doc(amenitiesRef, id), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
  
  // Add audit log for updates (excluding timestamp fields)
  const auditableUpdates = Object.keys(updates)
    .filter(key => !key.includes('At') && key !== 'updatedAt')
    .reduce((obj, key) => {
      obj[key] = updates[key];
      return obj;
    }, {});
  
  if (Object.keys(auditableUpdates).length > 0) {
    await addAmenityAuditLog(id, 'updated', auditableUpdates);
  }
}

// Mark amenity as delivered to room
export async function markAmenityDelivered(id) {
  await updateDoc(doc(amenitiesRef, id), {
    status: "delivered",
    deliveredAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  
  // Add specific audit log for delivery
  await addAmenityAuditLog(id, 'delivered', {});
}

// Archive amenity item
export async function archiveAmenity(id, item) {
  await setDoc(doc(amenitiesHistoryRef, `${id}-${Date.now()}`), {
    ...item,
    archivedAt: serverTimestamp(),
  });

  await deleteDoc(doc(amenitiesRef, id));
}

// Delete amenity item
export async function deleteAmenity(id) {
  await deleteDoc(doc(amenitiesRef, id));
}

// Subscribe to active amenities
export function subscribeActiveAmenities(callback) {
  return onSnapshot(amenitiesRef, (snapshot) => {
    const list = snapshot.docs.map((d) => ({ ...d.data(), id: d.id }));
    callback(list);
  });
}

// Subscribe to amenities history
export function subscribeAmenitiesHistory(callback) {
  return onSnapshot(amenitiesHistoryRef, (snapshot) => {
    const list = snapshot.docs.map((d) => ({
      ...d.data(),
      _id: d.id,
    }));
    callback(list);
  });
}

// Get audit logs for a specific amenity
export async function getAmenityAuditLog(amenityId) {
  try {
    const q = query(amenitiesAuditRef, where("amenityId", "==", amenityId));
    const snapshot = await getDocs(q);
    const logs = snapshot.docs.map((d) => ({
      ...d.data(),
      id: d.id,
    }));
    // Sort by timestamp (oldest first for chronological order)
    return logs.sort((a, b) => {
      const timeA = a.timestamp?.seconds || 0;
      const timeB = b.timestamp?.seconds || 0;
      return timeA - timeB;
    });
  } catch (error) {
    console.error("Error fetching amenity audit logs:", error);
    return [];
  }
}


