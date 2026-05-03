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

const lowRateReportsRef = collection(db, 'reports_low_rate');
const openFoliosReportsRef = collection(db, 'reports_open_folios');

function sanitizeLineItemReviews(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const entries = Object.entries(value)
    .map(([key, review]) => {
      const safeKey = String(key || '').trim().slice(0, 200);
      if (!safeKey || !review || typeof review !== 'object' || Array.isArray(review)) return null;

      return [safeKey, {
        approved: !!review.approved,
        notes: String(review.notes || '').trim().slice(0, 1000),
        updatedBy: String(review.updatedBy || '').trim().slice(0, 100),
        updatedAtMs: Number.isFinite(Number(review.updatedAtMs)) ? Number(review.updatedAtMs) : Date.now(),
      }];
    })
    .filter(Boolean);

  return Object.fromEntries(entries);
}

export function subscribeLowRateReports(callback, onError) {
  const q = query(lowRateReportsRef, orderBy('createdAtMs', 'desc'), limit(40));
  return onSnapshot(
    q,
    (snap) => {
      const reports = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(reports);
    },
    (err) => {
      console.error('reports_low_rate subscription error:', err?.code, err?.message);
      if (onError) onError(err);
    },
  );
}

export async function updateLowRateReportReview(reportId, updates = {}) {
  const safeReportId = String(reportId || '').trim();
  if (!safeReportId) throw new Error('Missing report id');

  const tolerancePct = updates.tolerancePct != null && Number.isFinite(Number(updates.tolerancePct))
    ? Number(updates.tolerancePct)
    : null;

  const payload = {
    reviewChecked: !!updates.reviewChecked,
    reviewNotes: String(updates.reviewNotes || '').trim().slice(0, 2000),
    reviewCheckedBy: String(updates.reviewCheckedBy || '').trim().slice(0, 100),
    lineItemReviews: sanitizeLineItemReviews(updates.lineItemReviews),
    reviewCheckedAt: serverTimestamp(),
  };

  if (tolerancePct !== null) payload.tolerancePct = tolerancePct;

  await updateDoc(doc(lowRateReportsRef, safeReportId), payload);
}

function sanitizeOpenFoliosLineItemReviews(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const entries = Object.entries(value)
    .map(([key, review]) => {
      const safeKey = String(key || '').trim().slice(0, 200);
      if (!safeKey || !review || typeof review !== 'object' || Array.isArray(review)) return null;

      const parsedNewBalance = Number(review.newBalance);
      return [safeKey, {
        verified: !!review.verified,
        notes: String(review.notes || '').trim().slice(0, 1000),
        newBalance: Number.isFinite(parsedNewBalance) ? parsedNewBalance : null,
        updatedBy: String(review.updatedBy || '').trim().slice(0, 100),
        updatedAtMs: Number.isFinite(Number(review.updatedAtMs)) ? Number(review.updatedAtMs) : Date.now(),
      }];
    })
    .filter(Boolean);

  return Object.fromEntries(entries);
}

export function subscribeOpenFoliosReports(callback, onError) {
  const q = query(openFoliosReportsRef, orderBy('createdAtMs', 'desc'), limit(40));
  return onSnapshot(
    q,
    (snap) => {
      const reports = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(reports);
    },
    (err) => {
      console.error('reports_open_folios subscription error:', err?.code, err?.message);
      if (onError) onError(err);
    },
  );
}

export async function updateOpenFoliosReportReview(reportId, updates = {}) {
  const safeReportId = String(reportId || '').trim();
  if (!safeReportId) throw new Error('Missing report id');

  await updateDoc(doc(openFoliosReportsRef, safeReportId), {
    reviewNotes: String(updates.reviewNotes || '').trim().slice(0, 2000),
    reviewCheckedBy: String(updates.reviewCheckedBy || '').trim().slice(0, 100),
    reviewCheckedAt: serverTimestamp(),
    lineItemReviews: sanitizeOpenFoliosLineItemReviews(updates.lineItemReviews),
  });
}
