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
  runTransaction,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";

import { db } from "./firebase";

// Get storage from the existing Firebase app (imported from firebase.js)
export const storage = getStorage();

// Firestore collections
const vehiclesRef = collection(db, "vehicles");
const historyRef = collection(db, "history");

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
  
  // Decrement badge counter if request was active
  const updates = {
    requested: false,
    requestedAt: null,
    status: targetStatus,
    prevStatus: null,
    updatedAt: serverTimestamp(),
  };

  // If there was an active request, decrement the badge
  if (vehicle.requested) {
    const badgeRef = doc(db, 'meta', 'badge');
    await runTransaction(db, async (transaction) => {
      const badgeSnap = await transaction.get(badgeRef);
      const currentCount = badgeSnap.exists() ? (badgeSnap.data().count || 0) : 0;
      const newCount = Math.max(0, currentCount - 1);
      
      transaction.set(badgeRef, { count: newCount }, { merge: true });
      transaction.update(docRef, updates);
    });
  } else {
    await updateDoc(docRef, updates);
  }
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
