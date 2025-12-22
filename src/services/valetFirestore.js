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

import { db } from "../firebase";

// Get storage from the existing Firebase app (imported from firebase.js)
export const storage = getStorage();

// Firestore collections
const vehiclesRef = collection(db, "vehicles");
const historyRef = collection(db, "history");
const usersRef = collection(db, "users");
const luggageRef = collection(db, "luggage");
const luggageHistoryRef = collection(db, "luggageHistory");

// Create / check-in vehicle
export async function createVehicle(data) {
  const v = {
    tag: data.tag,
    guestName: data.guestName,
    roomNumber: data.roomNumber,
    phone: data.phone,
    status: "received",

    license: "",
    make: "",
    color: "",
    bay: "",
    departureDate: data.departureDate,

    scheduledAt: null,
    requested: false,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(doc(vehiclesRef, data.tag), v);
}

// Staff: update vehicle
export async function updateVehicle(tag, updates) {
  await updateDoc(doc(vehiclesRef, tag), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

// Guest: request pickup
export async function requestVehicle(tag) {
  await updateVehicle(tag, {
    status: "requested",
    requested: true,
    scheduledAt: null,
  });
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
  await updateVehicle(tag, { status: "ready" });
}

// Staff: vehicle handed to guest
export async function markOut(tag) {
  await updateVehicle(tag, { status: "out", requested: false });
}

// Staff: re-park returned vehicle
export async function parkAgain(tag, bay, license, make, color) {
  await updateVehicle(tag, {
    status: "parked",
    bay: bay ?? "",
    license: license ?? "",
    make: make ?? "",
    color: color ?? "",
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
    // Create Firebase Auth account
    const email = "admin@royce-valet.internal";
    const userCredential = await createUserWithEmailAndPassword(auth, email, "admin123");
    
    // Create Firestore record
    const userId = `user-${Date.now()}`;
    await setDoc(doc(usersRef, userId), {
      uid: userCredential.user.uid,
      username: "admin",
      role: "admin",
      createdAt: serverTimestamp(),
    });
    return userId;
  } catch (error) {
    console.error('Error creating default admin:', error);
    throw error;
  }
}

// Authenticate user with Firebase Auth
export async function authenticateUser(username, password) {
  const { signInWithEmailAndPassword } = await import('firebase/auth');
  const { auth } = await import('../firebase');
  
  try {
    // Firebase Auth requires email format, so we append domain
    const email = `${username.toLowerCase().trim()}@royce-valet.internal`;
    console.log('Attempting Firebase Auth with email:', email);
    
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    console.log('Firebase Auth successful for UID:', userCredential.user.uid);
    
    // Get user data from Firestore
    const q = query(usersRef, where("username", "==", username.toLowerCase().trim()));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      console.error('User authenticated in Firebase Auth but not found in Firestore');
      return null;
    }
    
    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();
    console.log('User data retrieved from Firestore:', { id: userDoc.id, username: userData.username });
    
    return {
      id: userDoc.id,
      uid: userCredential.user.uid,
      username: userData.username,
      role: userData.role,
      createdAt: userData.createdAt,
    };
  } catch (error) {
    console.error('Authentication error:', error);
    // Re-throw the error so Login component can display the specific error message
    throw error;
  }
}

// Create new user with Firebase Auth
export async function createUser(userData) {
  const { createUserWithEmailAndPassword } = await import('firebase/auth');
  const { auth } = await import('../firebase');
  
  try {
    // Firebase Auth requires email format, so we append domain
    const normalizedUsername = userData.username.toLowerCase().trim();
    const email = `${normalizedUsername}@royce-valet.internal`;
    console.log('Creating user with email:', email);
    
    const userCredential = await createUserWithEmailAndPassword(auth, email, userData.password);
    console.log('Firebase Auth user created with UID:', userCredential.user.uid);
    
    // Store user data in Firestore
    const userId = `user-${Date.now()}`;
    await setDoc(doc(usersRef, userId), {
      uid: userCredential.user.uid,
      username: normalizedUsername,
      role: userData.role || "user",
      createdAt: serverTimestamp(),
    });
    console.log('Firestore user document created with ID:', userId);
    return userId;
  } catch (error) {
    console.error('Error creating user:', error);
    throw error;
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
  const item = {
    tags: data.tags || [], // Array of tag numbers
    guestName: data.guestName,
    roomNumber: data.roomNumber,
    roomStatus: data.roomStatus || "",
    phone: data.phone,
    numberOfBags: data.numberOfBags || 0,
    status: "stored", // stored, delivered
    notes: data.notes || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // Use guest name + timestamp as document ID since we may have multiple tags
  const docId = `${data.guestName.replace(/\s+/g, '-')}-${Date.now()}`;
  await setDoc(doc(luggageRef, docId), item);
  return docId;
}

// Update luggage item
export async function updateLuggage(id, updates) {
  await updateDoc(doc(luggageRef, id), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

// Mark luggage as delivered to room
export async function markLuggageDelivered(id) {
  await updateLuggage(id, { status: "delivered", deliveredAt: serverTimestamp() });
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

