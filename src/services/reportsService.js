import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';

const reportsRef = collection(db, 'reports_low_rate');

export function subscribeLowRateReports(callback) {
  const q = query(reportsRef, orderBy('createdAtMs', 'desc'), limit(40));
  return onSnapshot(q, (snap) => {
    const reports = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(reports);
  });
}

export async function updateLowRateReportReview(reportId, updates = {}) {
  const safeReportId = String(reportId || '').trim();
  if (!safeReportId) throw new Error('Missing report id');

  await updateDoc(doc(reportsRef, safeReportId), {
    reviewChecked: !!updates.reviewChecked,
    reviewNotes: String(updates.reviewNotes || '').trim().slice(0, 2000),
    reviewCheckedBy: String(updates.reviewCheckedBy || '').trim().slice(0, 100),
    reviewCheckedAt: serverTimestamp(),
  });
}
