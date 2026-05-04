import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';
import { auth, db } from '../firebase';
import { getCurrentUser } from '../services/valetFirestore';
import {
  subscribeCancellationReports,
  subscribeLowRateReports,
  subscribeOpenFoliosReports,
  updateCancellationReportReview,
  updateLowRateReportReview,
  updateOpenFoliosReportReview,
} from '../services/reportsService';

function getLineItemKey(item, idx) {
  return [item?.reservationId || 'reservation', item?.checkInDate || 'date', item?.rowNumber || idx]
    .map((value) => String(value || '').trim())
    .join('__');
}

function getOpenFoliosLineItemKey(item, idx) {
  return [item?.reservationId || 'reservation', item?.checkOutDate || 'date', item?.rowNumber || idx]
    .map((value) => String(value || '').trim())
    .join('__');
}

function getCancellationLineItemKey(item, idx) {
  return [item?.reservationId || 'reservation', item?.eventDate || 'date', item?.rowNumber || idx]
    .map((value) => String(value || '').trim())
    .join('__');
}

function parseVarianceFilter(value) {
  const normalized = String(value || '').replace(/[^\d.-]/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.abs(parsed) : null;
}

function shouldShowReservation(item, varianceThreshold) {
  if (varianceThreshold == null) return true;
  if (item?.variancePct == null) return true;
  return Math.abs(Number(item.variancePct)) >= varianceThreshold;
}

function getApprovalSummary({ reservations = [], lineItemReviews = {}, varianceThreshold = null } = {}) {
  // Only rows outside the acceptable variance need to be approved.
  const actionableRows = reservations.filter((item) => shouldShowReservation(item, varianceThreshold));

  if (actionableRows.length === 0) {
    return {
      approvedCount: 0,
      totalCount: 0,
      status: 'all-approved',
      color: '#2e7d32',
      label: 'No lines require verification',
    };
  }

  const approvedCount = actionableRows.reduce((count, item, idx) => {
    const key = getLineItemKey(item, idx);
    return count + (lineItemReviews[key]?.approved ? 1 : 0);
  }, 0);

  if (approvedCount === 0) {
    return {
      approvedCount,
      totalCount: actionableRows.length,
      status: 'none-approved',
      color: '#c62828',
      label: 'No verified lines',
    };
  }

  if (approvedCount === actionableRows.length) {
    return {
      approvedCount,
      totalCount: actionableRows.length,
      status: 'all-approved',
      color: '#2e7d32',
      label: 'All lines verified',
    };
  }

  return {
    approvedCount,
    totalCount: actionableRows.length,
    status: 'partial-approved',
    color: '#f9a825',
    label: 'Some lines verified',
  };
}

function getOpenFoliosVerificationSummary({ reservations = [], lineItemReviews = {} } = {}) {
  if (!Array.isArray(reservations) || reservations.length === 0) {
    return {
      verifiedCount: 0,
      totalCount: 0,
      color: '#2e7d32',
      label: 'No lines to verify',
    };
  }

  const verifiedCount = reservations.reduce((count, item, idx) => {
    const key = getOpenFoliosLineItemKey(item, idx);
    return count + (lineItemReviews[key]?.verified ? 1 : 0);
  }, 0);

  if (verifiedCount === 0) {
    return {
      verifiedCount,
      totalCount: reservations.length,
      color: '#c62828',
      label: 'No verified lines',
    };
  }

  if (verifiedCount === reservations.length) {
    return {
      verifiedCount,
      totalCount: reservations.length,
      color: '#2e7d32',
      label: 'All lines verified',
    };
  }

  return {
    verifiedCount,
    totalCount: reservations.length,
    color: '#f9a825',
    label: 'Some lines verified',
  };
}

function isCancellationVerificationRequired(item) {
  const leadTime = parseLeadTime(item?.leadTimeDays);
  return leadTime != null && leadTime < 2;
}

function getCancellationVerificationSummary({ reservations = [], lineItemReviews = {} } = {}) {
  const actionableRows = reservations.filter((item) => isCancellationVerificationRequired(item));

  if (actionableRows.length === 0) {
    return {
      verifiedCount: 0,
      totalCount: 0,
      color: '#2e7d32',
      label: 'No lines require verification',
    };
  }

  const verifiedCount = actionableRows.reduce((count, item, idx) => {
    const key = getCancellationLineItemKey(item, idx);
    return count + (lineItemReviews[key]?.verified ? 1 : 0);
  }, 0);

  if (verifiedCount === 0) {
    return {
      verifiedCount,
      totalCount: actionableRows.length,
      color: '#c62828',
      label: 'No verified lines',
    };
  }

  if (verifiedCount === actionableRows.length) {
    return {
      verifiedCount,
      totalCount: actionableRows.length,
      color: '#2e7d32',
      label: 'All lines verified',
    };
  }

  return {
    verifiedCount,
    totalCount: actionableRows.length,
    color: '#f9a825',
    label: 'Some lines verified',
  };
}

function fmtCurrency(value, currency = 'AUD') {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: currency || 'AUD',
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function fmtPct(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return `${Number(value).toFixed(2)}%`;
}

function parseLeadTime(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function Reports() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);
  const openFoliosFileInputRef = useRef(null);
  const cancellationFileInputRef = useRef(null);
  const [selectedReportId, setSelectedReportId] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');
  const [lineItemReviews, setLineItemReviews] = useState({});
  const [varianceFilterInput, setVarianceFilterInput] = useState('');
  const [importSuccess, setImportSuccess] = useState('');

  const [openFoliosReports, setOpenFoliosReports] = useState([]);
  const [openFoliosLoading, setOpenFoliosLoading] = useState(true);
  const [openFoliosLoadError, setOpenFoliosLoadError] = useState('');
  const [openFoliosActionError, setOpenFoliosActionError] = useState('');
  const [openFoliosImporting, setOpenFoliosImporting] = useState(false);
  const [openFoliosSelectedReportId, setOpenFoliosSelectedReportId] = useState('');
  const [openFoliosReviewSaving, setOpenFoliosReviewSaving] = useState(false);
  const [openFoliosReviewNotes, setOpenFoliosReviewNotes] = useState('');
  const [openFoliosLineItemReviews, setOpenFoliosLineItemReviews] = useState({});
  const [openFoliosImportSuccess, setOpenFoliosImportSuccess] = useState('');

  const [cancellationReports, setCancellationReports] = useState([]);
  const [cancellationLoading, setCancellationLoading] = useState(true);
  const [cancellationLoadError, setCancellationLoadError] = useState('');
  const [cancellationActionError, setCancellationActionError] = useState('');
  const [cancellationImporting, setCancellationImporting] = useState(false);
  const [cancellationImportSuccess, setCancellationImportSuccess] = useState('');
  const [selectedCancellationReportId, setSelectedCancellationReportId] = useState('');
  const [applyLeadTimeFilter, setApplyLeadTimeFilter] = useState(true);
  const [cancellationReviewSaving, setCancellationReviewSaving] = useState(false);
  const [cancellationLineItemReviews, setCancellationLineItemReviews] = useState({});

  useEffect(() => {
    const unsubscribe = subscribeLowRateReports(
      (items) => {
        setReports(items);
        setLoading(false);
      },
      (err) => {
        setLoadError(`Failed to load reports: ${err?.message || err?.code || 'Unknown error'}`);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, []); // stable — subscription never needs to restart

  useEffect(() => {
    const unsubscribe = subscribeOpenFoliosReports(
      (items) => {
        setOpenFoliosReports(items);
        setOpenFoliosLoading(false);
      },
      (err) => {
        setOpenFoliosLoadError(`Failed to load open folios reports: ${err?.message || err?.code || 'Unknown error'}`);
        setOpenFoliosLoading(false);
      },
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeCancellationReports(
      (items) => {
        setCancellationReports(items);
        setCancellationLoading(false);
      },
      (err) => {
        setCancellationLoadError(`Failed to load cancellation reports: ${err?.message || err?.code || 'Unknown error'}`);
        setCancellationLoading(false);
      },
    );

    return () => unsubscribe();
  }, []);

  const selectedReport = useMemo(
    () => reports.find((r) => r.id === selectedReportId) || null,
    [reports, selectedReportId]
  );

  const selectedOpenFoliosReport = useMemo(
    () => openFoliosReports.find((r) => r.id === openFoliosSelectedReportId) || null,
    [openFoliosReports, openFoliosSelectedReportId]
  );

  const selectedCancellationReport = useMemo(
    () => cancellationReports.find((r) => r.id === selectedCancellationReportId) || null,
    [cancellationReports, selectedCancellationReportId]
  );

  useEffect(() => {
    if (!selectedReport) return;
    setReviewNotes(String(selectedReport.reviewNotes || ''));
    setLineItemReviews(selectedReport.lineItemReviews && typeof selectedReport.lineItemReviews === 'object' ? selectedReport.lineItemReviews : {});
    setVarianceFilterInput(selectedReport.tolerancePct != null ? String(selectedReport.tolerancePct) : '');
  }, [selectedReport]);

  useEffect(() => {
    if (!selectedOpenFoliosReport) return;
    setOpenFoliosReviewNotes(String(selectedOpenFoliosReport.reviewNotes || ''));
    setOpenFoliosLineItemReviews(
      selectedOpenFoliosReport.lineItemReviews && typeof selectedOpenFoliosReport.lineItemReviews === 'object'
        ? selectedOpenFoliosReport.lineItemReviews
        : {}
    );
  }, [selectedOpenFoliosReport]);

  useEffect(() => {
    if (!selectedCancellationReport) return;
    setCancellationLineItemReviews(
      selectedCancellationReport.lineItemReviews && typeof selectedCancellationReport.lineItemReviews === 'object'
        ? selectedCancellationReport.lineItemReviews
        : {}
    );
  }, [selectedCancellationReport]);

  const varianceThreshold = useMemo(() => parseVarianceFilter(varianceFilterInput), [varianceFilterInput]);

  const filteredReservations = useMemo(
    () => (selectedReport?.reservations || []).filter((item) => shouldShowReservation(item, varianceThreshold)),
    [selectedReport, varianceThreshold]
  );

  const selectedApprovalSummary = useMemo(
    () => getApprovalSummary({
      reservations: selectedReport?.reservations || [],
      lineItemReviews,
      varianceThreshold,
    }),
    [selectedReport, lineItemReviews, varianceThreshold]
  );

  const selectedOpenFoliosSummary = useMemo(
    () => getOpenFoliosVerificationSummary({
      reservations: selectedOpenFoliosReport?.reservations || [],
      lineItemReviews: openFoliosLineItemReviews,
    }),
    [selectedOpenFoliosReport, openFoliosLineItemReviews]
  );

  const filteredCancellationReservations = useMemo(() => {
    const rows = selectedCancellationReport?.reservations || [];
    if (!applyLeadTimeFilter) return rows;
    return rows.filter((item) => {
      const leadTime = parseLeadTime(item.leadTimeDays);
      return leadTime != null && leadTime < 2;
    });
  }, [selectedCancellationReport, applyLeadTimeFilter]);

  const selectedCancellationSummary = useMemo(
    () => getCancellationVerificationSummary({
      reservations: selectedCancellationReport?.reservations || [],
      lineItemReviews: cancellationLineItemReviews,
    }),
    [selectedCancellationReport, cancellationLineItemReviews]
  );

  function updateLineItemReview(item, idx, field, value) {
    const key = getLineItemKey(item, idx);
    setLineItemReviews((current) => ({
      ...current,
      [key]: {
        ...(current[key] || {}),
        [field]: value,
      },
    }));
  }

  function updateOpenFoliosLineItemReview(item, idx, field, value) {
    const key = getOpenFoliosLineItemKey(item, idx);
    setOpenFoliosLineItemReviews((current) => ({
      ...current,
      [key]: {
        ...(current[key] || {}),
        [field]: value,
      },
    }));
  }

  function updateCancellationLineItemReview(item, idx, field, value) {
    const key = getCancellationLineItemKey(item, idx);
    setCancellationLineItemReviews((current) => ({
      ...current,
      [key]: {
        ...(current[key] || {}),
        [field]: value,
      },
    }));
  }

  async function handleImportCsv(e) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    setActionError('');
    setImportSuccess('');

    if (!file) return;

    try {
      setImporting(true);
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setActionError('Not authenticated. Please log in again.');
        return;
      }

      const csv = await file.text();
      const idToken = await currentUser.getIdToken();

      const response = await fetch('/api/ap-webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          action: 'low-rate-ingest',
          csv,
          source: 'manual-upload',
        }),
      });

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      const data = contentType.includes('application/json')
        ? await response.json().catch(() => ({}))
        : {};
      if (!response.ok) {
        const detail = typeof data.detail === 'string' && data.detail.trim() ? `: ${data.detail.trim()}` : '';
        if (data.error) {
          throw new Error(`${data.error}${detail}`);
        }

        if (response.status === 404 && import.meta.env.DEV) {
          throw new Error('Import endpoint not reachable in local Vite dev. Set VITE_APP_URL to your deployed app URL or run the app behind Vercel.');
        }

        throw new Error(`Import failed (${response.status})`);
      }

      const reportId = typeof data.reportId === 'string' ? data.reportId.trim() : '';
      if (reportId) {
        try {
          const reportSnap = await getDoc(doc(db, 'reports_low_rate', reportId));
          if (reportSnap.exists()) {
            setSelectedReportId(reportId);
            setLoadError('');
            setImportSuccess(`CSV imported and low-rate checks completed. Report: ${reportId}`);
          } else {
            setImportSuccess(`CSV imported and low-rate checks completed. Report: ${reportId}`);
            setLoadError('Import succeeded, but this app session cannot read that report. Check Firebase project/env alignment.');
          }
        } catch (err) {
          const detail = err?.message || err?.code || 'Unknown error';
          setImportSuccess(`CSV imported and low-rate checks completed. Report: ${reportId}`);
          setLoadError(`Import succeeded, but report read failed: ${detail}`);
        }
      } else {
        setImportSuccess('CSV imported and low-rate checks completed.');
      }
    } catch (err) {
      setActionError(err.message || 'Failed to import CSV');
    } finally {
      setImporting(false);
    }
  }

  async function handleSaveReview() {
    if (!selectedReport) return;

    try {
      setReviewSaving(true);
      setActionError('');
      const currentUser = getCurrentUser();
      const serializedLineItemReviews = Object.fromEntries(
        Object.entries(lineItemReviews).map(([key, review]) => [key, {
          approved: !!review?.approved,
          notes: String(review?.notes || ''),
          updatedBy: currentUser?.username || 'Unknown',
          updatedAtMs: Date.now(),
        }])
      );

      await updateLowRateReportReview(selectedReport.id, {
        reviewChecked: selectedApprovalSummary.totalCount > 0 && selectedApprovalSummary.approvedCount === selectedApprovalSummary.totalCount,
        reviewNotes,
        reviewCheckedBy: currentUser?.username || 'Unknown',
        lineItemReviews: serializedLineItemReviews,
        tolerancePct: varianceThreshold,
      });
    } catch (err) {
      setActionError(err.message || 'Failed to save review');
    } finally {
      setReviewSaving(false);
    }
  }

  async function handleImportOpenFoliosCsv(e) {
    const file = e.target.files?.[0];
    if (openFoliosFileInputRef.current) openFoliosFileInputRef.current.value = '';
    setOpenFoliosActionError('');
    setOpenFoliosImportSuccess('');

    if (!file) return;

    try {
      setOpenFoliosImporting(true);
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setOpenFoliosActionError('Not authenticated. Please log in again.');
        return;
      }

      const csv = await file.text();
      const idToken = await currentUser.getIdToken();

      const response = await fetch('/api/ap-webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          action: 'open-folios-ingest',
          csv,
          source: 'manual-upload-open-folios',
        }),
      });

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      const data = contentType.includes('application/json')
        ? await response.json().catch(() => ({}))
        : {};

      if (!response.ok) {
        const detail = typeof data.detail === 'string' && data.detail.trim() ? `: ${data.detail.trim()}` : '';
        if (data.error) {
          throw new Error(`${data.error}${detail}`);
        }
        throw new Error(`Open folios import failed (${response.status})`);
      }

      const reportId = typeof data.reportId === 'string' ? data.reportId.trim() : '';
      if (reportId) {
        try {
          const reportSnap = await getDoc(doc(db, 'reports_open_folios', reportId));
          if (reportSnap.exists()) {
            setOpenFoliosSelectedReportId(reportId);
            setOpenFoliosLoadError('');
            setOpenFoliosImportSuccess(`Open folios CSV imported. Report: ${reportId}`);
          } else {
            setOpenFoliosImportSuccess(`Open folios CSV imported. Report: ${reportId}`);
            setOpenFoliosLoadError('Import succeeded, but this app session cannot read that report. Check Firebase project/env alignment.');
          }
        } catch (err) {
          const detail = err?.message || err?.code || 'Unknown error';
          setOpenFoliosImportSuccess(`Open folios CSV imported. Report: ${reportId}`);
          setOpenFoliosLoadError(`Import succeeded, but report read failed: ${detail}`);
        }
      } else {
        setOpenFoliosImportSuccess('Open folios CSV imported.');
      }
    } catch (err) {
      setOpenFoliosActionError(err.message || 'Failed to import Open Folios CSV');
    } finally {
      setOpenFoliosImporting(false);
    }
  }

  async function handleSaveOpenFoliosReview() {
    if (!selectedOpenFoliosReport) return;

    try {
      setOpenFoliosReviewSaving(true);
      setOpenFoliosActionError('');
      const currentUser = getCurrentUser();
      const serializedLineItemReviews = Object.fromEntries(
        Object.entries(openFoliosLineItemReviews).map(([key, review]) => [key, {
          verified: !!review?.verified,
          notes: String(review?.notes || ''),
          newBalance: review?.newBalance === '' || review?.newBalance == null ? null : Number(review.newBalance),
          updatedBy: currentUser?.username || 'Unknown',
          updatedAtMs: Date.now(),
        }])
      );

      await updateOpenFoliosReportReview(selectedOpenFoliosReport.id, {
        reviewNotes: openFoliosReviewNotes,
        reviewCheckedBy: currentUser?.username || 'Unknown',
        lineItemReviews: serializedLineItemReviews,
      });
    } catch (err) {
      setOpenFoliosActionError(err.message || 'Failed to save Open Folios review');
    } finally {
      setOpenFoliosReviewSaving(false);
    }
  }

  async function handleImportCancellationCsv(e) {
    const file = e.target.files?.[0];
    if (cancellationFileInputRef.current) cancellationFileInputRef.current.value = '';
    setCancellationActionError('');
    setCancellationImportSuccess('');

    if (!file) return;

    try {
      setCancellationImporting(true);
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setCancellationActionError('Not authenticated. Please log in again.');
        return;
      }

      const csv = await file.text();
      const idToken = await currentUser.getIdToken();

      const response = await fetch('/api/ap-webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          action: 'cancellations-ingest',
          csv,
          source: 'manual-upload-cancellations',
        }),
      });

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      const data = contentType.includes('application/json')
        ? await response.json().catch(() => ({}))
        : {};

      if (!response.ok) {
        const detail = typeof data.detail === 'string' && data.detail.trim() ? `: ${data.detail.trim()}` : '';
        if (data.error) {
          throw new Error(`${data.error}${detail}`);
        }
        throw new Error(`Cancellation import failed (${response.status})`);
      }

      const reportId = typeof data.reportId === 'string' ? data.reportId.trim() : '';
      if (reportId) {
        try {
          const reportSnap = await getDoc(doc(db, 'reports_cancellations', reportId));
          if (reportSnap.exists()) {
            setSelectedCancellationReportId(reportId);
            setCancellationLoadError('');
            setCancellationImportSuccess(`Cancellations/no-shows CSV imported. Report: ${reportId}`);
          } else {
            setCancellationImportSuccess(`Cancellations/no-shows CSV imported. Report: ${reportId}`);
            setCancellationLoadError('Import succeeded, but this app session cannot read that report. Check Firebase project/env alignment.');
          }
        } catch (err) {
          const detail = err?.message || err?.code || 'Unknown error';
          setCancellationImportSuccess(`Cancellations/no-shows CSV imported. Report: ${reportId}`);
          setCancellationLoadError(`Import succeeded, but report read failed: ${detail}`);
        }
      } else {
        setCancellationImportSuccess('Cancellations/no-shows CSV imported.');
      }
    } catch (err) {
      setCancellationActionError(err.message || 'Failed to import cancellations/no-shows CSV');
    } finally {
      setCancellationImporting(false);
    }
  }

  async function handleSaveCancellationReview() {
    if (!selectedCancellationReport) return;

    try {
      setCancellationReviewSaving(true);
      setCancellationActionError('');
      const currentUser = getCurrentUser();
      const serializedLineItemReviews = Object.fromEntries(
        Object.entries(cancellationLineItemReviews).map(([key, review]) => [key, {
          verified: !!review?.verified,
          notes: String(review?.notes || ''),
          updatedBy: currentUser?.username || 'Unknown',
          updatedAtMs: Date.now(),
        }])
      );

      await updateCancellationReportReview(selectedCancellationReport.id, {
        reviewCheckedBy: currentUser?.username || 'Unknown',
        lineItemReviews: serializedLineItemReviews,
      });
    } catch (err) {
      setCancellationActionError(err.message || 'Failed to save cancellations review');
    } finally {
      setCancellationReviewSaving(false);
    }
  }

  return (
    <section className="card pad">
      <h2 style={{ marginTop: 0, marginBottom: 12 }}>Reports</h2>

      <div style={{ marginBottom: 16, padding: 12, border: '1px solid #ddd', borderRadius: 8, background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>Daily Low Rate Report</h3>
        <button className="btn primary" type="button" onClick={() => fileInputRef.current?.click()} disabled={importing}>
          {importing ? 'Importing...' : 'Upload CSV'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleImportCsv}
          style={{ display: 'none' }}
        />
      </div>

      {importSuccess && <div style={{ color: '#2f7d32', marginBottom: 12 }}>{importSuccess}</div>}
      {actionError && <div style={{ color: '#b00020', marginBottom: 12 }}>{actionError}</div>}
      {loadError && <div style={{ color: '#b00020', marginBottom: 12 }}>{loadError}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
        <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', maxHeight: 700, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 10, borderBottom: '1px solid #ddd', background: '#f4f6fb', fontWeight: 600 }}>
            Recent Reports
          </div>

          {loading ? (
            <div style={{ padding: 12, color: '#666' }}>Loading reports...</div>
          ) : reports.length === 0 ? (
            <div style={{ padding: 12, color: '#666' }}>No reports yet.</div>
          ) : (
            <div style={{ maxHeight: 500, overflowY: 'auto' }}>
              {reports.map((report) => {
                const active = report.id === selectedReportId;
                const reportThreshold = parseVarianceFilter(String(report.tolerancePct ?? ''));
                const approvalSummary = getApprovalSummary({
                  reservations: report.reservations || [],
                  lineItemReviews: report.lineItemReviews || {},
                  varianceThreshold: reportThreshold,
                });
                const unapprovedCount = approvalSummary.totalCount - approvalSummary.approvedCount;
                const lowOutsideThreshold = (report.reservations || []).filter(
                  (item) => item.status === 'low' && shouldShowReservation(item, reportThreshold)
                ).length;
                return (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() => setSelectedReportId((current) => (current === report.id ? '' : report.id))}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      borderBottom: '1px solid #eee',
                      background: active ? '#eef3ff' : '#fff',
                      padding: 10,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontWeight: 600 }}>{report.reportDate || '-'}</div>
                      <span
                        aria-label={approvalSummary.label}
                        title={`${approvalSummary.label} (${approvalSummary.approvedCount}/${approvalSummary.totalCount})`}
                        style={{
                          width: 10,
                          height: 10,
                          minWidth: 10,
                          borderRadius: '50%',
                          background: approvalSummary.color,
                          display: 'inline-block',
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 12, color: '#555', marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <span style={{ background: '#fdecea', color: '#b42318', border: '1px solid #f3c5c1', borderRadius: 999, padding: '2px 8px', fontWeight: 600 }}>
                        Low: {lowOutsideThreshold}
                      </span>
                      <span style={{ background: '#fff4e5', color: '#9a5f00', border: '1px solid #f4d8a8', borderRadius: 999, padding: '2px 8px', fontWeight: 600 }}>
                        No Ref: {report.missingReferenceCount || 0}
                      </span>
                      {unapprovedCount > 0 && (
                        <span style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 999, padding: '2px 8px', fontWeight: 600 }}>
                          Unverified: {unapprovedCount}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', maxHeight: 700, display: 'flex', flexDirection: 'column' }}>
          {!selectedReport ? (
            <div style={{ padding: 12, color: '#666' }}>Select a report to review.</div>
          ) : (
            <>
              <div style={{ padding: 12, borderBottom: '1px solid #ddd', background: '#f4f6fb' }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Report Date: {selectedReport.reportDate || '-'}</div>
                <div style={{ fontSize: 13, color: '#555' }}>
                  Source: {selectedReport.sourceLabel || '-'} | Imported rows: {selectedReport.totalRows || 0} | Checked rows: {selectedReport.totalChecked || 0}
                </div>
              </div>

              <div style={{ padding: 12, borderBottom: '1px solid #eee' }}>
                <textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  rows={3}
                  placeholder="Review notes"
                  style={{ width: '100%', marginBottom: 8 }}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                    Verification: {selectedApprovalSummary.approvedCount}/{selectedApprovalSummary.totalCount} lines verified
                  </div>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span>Acceptable variance %</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={varianceFilterInput}
                      onChange={(e) => setVarianceFilterInput(e.target.value)}
                      placeholder="10"
                      style={{ width: 96 }}
                    />
                  </label>
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                    Showing {filteredReservations.length} of {(selectedReport.reservations || []).length} reservations
                  </div>
                </div>
                <button type="button" className="btn secondary" onClick={handleSaveReview} disabled={reviewSaving}>
                  {reviewSaving ? 'Saving...' : 'Save'}
                </button>
              </div>

              <div style={{ overflow: 'auto', flex: 1 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#fafafa' }}>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Reservation</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Guest</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Room</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Stay Date</th>
                      <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #eee' }}>Booked</th>
                      <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #eee' }}>BAR</th>
                      <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #eee' }}>Variance</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Verification Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReservations.map((item, idx) => {
                      const isLow = item.status === 'low';
                      const isNoRef = item.status === 'no-reference';
                      const reviewKey = getLineItemKey(item, idx);
                      const lineReview = lineItemReviews[reviewKey] || {};

                      return (
                        <tr key={`${item.reservationId || idx}-${idx}`} style={{ background: isLow ? '#fff1f1' : isNoRef ? '#fffbea' : '#fff' }}>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>{item.reservationId || '-'}</td>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>{item.guestName || '-'}</td>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>{item.roomType || '-'}</td>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>{item.checkInDate || '-'}</td>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0', textAlign: 'right' }}>
                            {fmtCurrency(item.bookedRate, item.bookedCurrency)}
                          </td>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0', textAlign: 'right' }}>
                            {fmtCurrency(item.referenceRate, item.referenceCurrency)}
                          </td>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0', textAlign: 'right' }}>
                            {item.variance == null ? '-' : `${fmtCurrency(item.variance, item.bookedCurrency)} (${fmtPct(item.variancePct)})`}
                          </td>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0', minWidth: 240 }}>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                              <input
                                type="checkbox"
                                checked={!!lineReview.approved}
                                onChange={(e) => updateLineItemReview(item, idx, 'approved', e.target.checked)}
                              />
                              <span>Verified</span>
                            </label>
                            <textarea
                              value={String(lineReview.notes || '')}
                              onChange={(e) => updateLineItemReview(item, idx, 'notes', e.target.value)}
                              rows={2}
                              placeholder="Add verification note"
                              style={{ width: '100%', resize: 'vertical' }}
                            />
                          </td>
                        </tr>
                      );
                    })}
                    {filteredReservations.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ padding: 12, color: '#666', textAlign: 'center' }}>
                          No reservations fall outside the selected variance threshold.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ marginTop: 28, marginBottom: 16, padding: 12, border: '1px solid #ddd', borderRadius: 8, background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>Daily Open Folios Report</h3>
        <button className="btn primary" type="button" onClick={() => openFoliosFileInputRef.current?.click()} disabled={openFoliosImporting}>
          {openFoliosImporting ? 'Importing...' : 'Upload CSV'}
        </button>
        <input
          ref={openFoliosFileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleImportOpenFoliosCsv}
          style={{ display: 'none' }}
        />
      </div>

      {openFoliosImportSuccess && <div style={{ color: '#2f7d32', marginBottom: 12 }}>{openFoliosImportSuccess}</div>}
      {openFoliosActionError && <div style={{ color: '#b00020', marginBottom: 12 }}>{openFoliosActionError}</div>}
      {openFoliosLoadError && <div style={{ color: '#b00020', marginBottom: 12 }}>{openFoliosLoadError}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
        <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', maxHeight: 700, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 10, borderBottom: '1px solid #ddd', background: '#f4f6fb', fontWeight: 600 }}>
            Recent Reports
          </div>

          {openFoliosLoading ? (
            <div style={{ padding: 12, color: '#666' }}>Loading reports...</div>
          ) : openFoliosReports.length === 0 ? (
            <div style={{ padding: 12, color: '#666' }}>No open folios reports yet.</div>
          ) : (
            <div style={{ maxHeight: 500, overflowY: 'auto' }}>
              {openFoliosReports.map((report) => {
                const active = report.id === openFoliosSelectedReportId;
                const verificationSummary = getOpenFoliosVerificationSummary({
                  reservations: report.reservations || [],
                  lineItemReviews: report.lineItemReviews || {},
                });
                const unverifiedCount = verificationSummary.totalCount - verificationSummary.verifiedCount;

                return (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() => setOpenFoliosSelectedReportId((current) => (current === report.id ? '' : report.id))}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      borderBottom: '1px solid #eee',
                      background: active ? '#eef3ff' : '#fff',
                      padding: 10,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontWeight: 600 }}>{report.reportDate || '-'}</div>
                      <span
                        aria-label={verificationSummary.label}
                        title={`${verificationSummary.label} (${verificationSummary.verifiedCount}/${verificationSummary.totalCount})`}
                        style={{
                          width: 10,
                          height: 10,
                          minWidth: 10,
                          borderRadius: '50%',
                          background: verificationSummary.color,
                          display: 'inline-block',
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 12, color: '#555', marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <span style={{ background: '#eaf6ed', color: '#166534', border: '1px solid #b7dfc2', borderRadius: 999, padding: '2px 8px', fontWeight: 600 }}>
                        Outstanding: {report.outstandingCount || 0}
                      </span>
                      <span style={{ background: '#eef3ff', color: '#1d4ed8', border: '1px solid #c7d7ff', borderRadius: 999, padding: '2px 8px', fontWeight: 600 }}>
                        Total: {fmtCurrency(report.totalOutstandingBalance || 0, 'AUD')}
                      </span>
                      {unverifiedCount > 0 && (
                        <span style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 999, padding: '2px 8px', fontWeight: 600 }}>
                          Unverified: {unverifiedCount}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', maxHeight: 700, display: 'flex', flexDirection: 'column' }}>
          {!selectedOpenFoliosReport ? (
            <div style={{ padding: 12, color: '#666' }}>Select an open folios report to review.</div>
          ) : (
            <>
              <div style={{ padding: 12, borderBottom: '1px solid #ddd', background: '#f4f6fb' }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Report Date: {selectedOpenFoliosReport.reportDate || '-'}</div>
                <div style={{ fontSize: 13, color: '#555' }}>
                  Source: {selectedOpenFoliosReport.sourceLabel || '-'} | Imported rows: {selectedOpenFoliosReport.totalRows || 0} | Outstanding rows: {selectedOpenFoliosReport.outstandingCount || 0}
                </div>
              </div>

              <div style={{ padding: 12, borderBottom: '1px solid #eee' }}>
                <textarea
                  value={openFoliosReviewNotes}
                  onChange={(e) => setOpenFoliosReviewNotes(e.target.value)}
                  rows={3}
                  placeholder="Open folios review notes"
                  style={{ width: '100%', marginBottom: 8 }}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                    Verification: {selectedOpenFoliosSummary.verifiedCount}/{selectedOpenFoliosSummary.totalCount} lines verified
                  </div>
                </div>
                <button type="button" className="btn secondary" onClick={handleSaveOpenFoliosReview} disabled={openFoliosReviewSaving}>
                  {openFoliosReviewSaving ? 'Saving...' : 'Save'}
                </button>
              </div>

              <div style={{ overflow: 'auto', flex: 1 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#fafafa' }}>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Reservation</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Guest</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Room</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Check-out</th>
                      <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #eee' }}>Current Balance</th>
                      <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #eee' }}>New Balance</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedOpenFoliosReport.reservations || []).map((item, idx) => {
                      const rowKey = getOpenFoliosLineItemKey(item, idx);
                      const lineReview = openFoliosLineItemReviews[rowKey] || {};

                      return (
                        <tr key={`${item.reservationId || idx}-${idx}`}>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>{item.reservationId || '-'}</td>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>{item.guestName || '-'}</td>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>{item.room || '-'}</td>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>{item.checkOutDate || '-'}</td>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0', textAlign: 'right' }}>
                            {fmtCurrency(item.currentBalance, 'AUD')}
                          </td>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0', textAlign: 'right', minWidth: 130 }}>
                            <input
                              type="number"
                              step="0.01"
                              value={lineReview.newBalance ?? ''}
                              placeholder={String(item.currentBalance ?? '')}
                              onChange={(e) => updateOpenFoliosLineItemReview(item, idx, 'newBalance', e.target.value)}
                              style={{ width: 120, textAlign: 'right' }}
                            />
                          </td>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0', minWidth: 280 }}>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                              <input
                                type="checkbox"
                                checked={!!lineReview.verified}
                                onChange={(e) => updateOpenFoliosLineItemReview(item, idx, 'verified', e.target.checked)}
                              />
                              <span>Verified</span>
                            </label>
                            <textarea
                              value={String(lineReview.notes || '')}
                              onChange={(e) => updateOpenFoliosLineItemReview(item, idx, 'notes', e.target.value)}
                              rows={2}
                              placeholder="Add note"
                              style={{ width: '100%', resize: 'vertical' }}
                            />
                          </td>
                        </tr>
                      );
                    })}
                    {(selectedOpenFoliosReport.reservations || []).length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ padding: 12, color: '#666', textAlign: 'center' }}>
                          No checked-out reservations with outstanding balance were found for this date.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ marginTop: 28, marginBottom: 16, padding: 12, border: '1px solid #ddd', borderRadius: 8, background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>Daily Cancellations / No Shows Report</h3>
        <button className="btn primary" type="button" onClick={() => cancellationFileInputRef.current?.click()} disabled={cancellationImporting}>
          {cancellationImporting ? 'Importing...' : 'Upload CSV'}
        </button>
        <input
          ref={cancellationFileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleImportCancellationCsv}
          style={{ display: 'none' }}
        />
      </div>

      {cancellationImportSuccess && <div style={{ color: '#2f7d32', marginBottom: 12 }}>{cancellationImportSuccess}</div>}
      {cancellationActionError && <div style={{ color: '#b00020', marginBottom: 12 }}>{cancellationActionError}</div>}
      {cancellationLoadError && <div style={{ color: '#b00020', marginBottom: 12 }}>{cancellationLoadError}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
        <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', maxHeight: 700, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 10, borderBottom: '1px solid #ddd', background: '#f4f6fb', fontWeight: 600 }}>
            Recent Reports
          </div>

          {cancellationLoading ? (
            <div style={{ padding: 12, color: '#666' }}>Loading reports...</div>
          ) : cancellationReports.length === 0 ? (
            <div style={{ padding: 12, color: '#666' }}>No cancellations/no-shows reports yet.</div>
          ) : (
            <div style={{ maxHeight: 500, overflowY: 'auto' }}>
              {cancellationReports.map((report) => {
                const active = report.id === selectedCancellationReportId;
                const verificationSummary = getCancellationVerificationSummary({
                  reservations: report.reservations || [],
                  lineItemReviews: report.lineItemReviews || {},
                });
                return (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() => setSelectedCancellationReportId((current) => (current === report.id ? '' : report.id))}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      borderBottom: '1px solid #eee',
                      background: active ? '#eef3ff' : '#fff',
                      padding: 10,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontWeight: 600 }}>{report.reportDate || '-'}</div>
                      <span
                        aria-label={verificationSummary.label}
                        title={`${verificationSummary.label} (${verificationSummary.verifiedCount}/${verificationSummary.totalCount})`}
                        style={{
                          width: 10,
                          height: 10,
                          minWidth: 10,
                          borderRadius: '50%',
                          background: verificationSummary.color,
                          display: 'inline-block',
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 12, color: '#555', marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <span style={{ background: '#fdecea', color: '#b42318', border: '1px solid #f3c5c1', borderRadius: 999, padding: '2px 8px', fontWeight: 600 }}>
                        Cancellations: {report.cancellations || 0}
                      </span>
                      <span style={{ background: '#fff4e5', color: '#9a5f00', border: '1px solid #f4d8a8', borderRadius: 999, padding: '2px 8px', fontWeight: 600 }}>
                        No Shows: {report.noShows || 0}
                      </span>
                      <span style={{ background: '#eef3ff', color: '#1d4ed8', border: '1px solid #c7d7ff', borderRadius: 999, padding: '2px 8px', fontWeight: 600 }}>
                        Outside Policy: {report.shortLeadTimeCount || 0}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', maxHeight: 700, display: 'flex', flexDirection: 'column' }}>
          {!selectedCancellationReport ? (
            <div style={{ padding: 12, color: '#666' }}>Select a cancellations/no-shows report to review.</div>
          ) : (
            <>
              <div style={{ padding: 12, borderBottom: '1px solid #ddd', background: '#f4f6fb' }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Report Date: {selectedCancellationReport.reportDate || '-'}</div>
                <div style={{ fontSize: 13, color: '#555' }}>
                  Source: {selectedCancellationReport.sourceLabel || '-'} | Imported rows: {selectedCancellationReport.totalRows || 0} | Parsed rows: {selectedCancellationReport.totalParsedRows || 0}
                </div>
              </div>

              <div style={{ padding: 12, borderBottom: '1px solid #eee' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={applyLeadTimeFilter}
                    onChange={(e) => setApplyLeadTimeFilter(e.target.checked)}
                  />
                  <span style={{ whiteSpace: 'nowrap' }}>Filter Based on Lead Time</span>
                </label>
                <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>
                  Showing {filteredCancellationReservations.length} of {(selectedCancellationReport.reservations || []).length} rows
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>
                  Verification: {selectedCancellationSummary.verifiedCount}/{selectedCancellationSummary.totalCount} lines verified
                </div>
                <button type="button" className="btn secondary" onClick={handleSaveCancellationReview} disabled={cancellationReviewSaving} style={{ marginTop: 8 }}>
                  {cancellationReviewSaving ? 'Saving...' : 'Save'}
                </button>
              </div>

              <div style={{ overflow: 'auto', flex: 1 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#fafafa' }}>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Reservation</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Guest</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Type</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Arrive</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Depart</th>
                      <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #eee' }}>Lead Time (Days)</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Verification Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCancellationReservations.map((item, idx) => {
                      const isNoShow = item.type === 'no-show';
                      const requiresVerification = isCancellationVerificationRequired(item);
                      const reviewKey = getCancellationLineItemKey(item, idx);
                      const lineReview = cancellationLineItemReviews[reviewKey] || {};
                      return (
                        <tr key={`${item.reservationId || idx}-${idx}`} style={{ background: isNoShow ? '#fff4e5' : '#fff' }}>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>{item.reservationId || '-'}</td>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>{item.guestName || '-'}</td>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>
                            <span
                              style={isNoShow
                                ? { background: '#fff4e5', color: '#9a5f00', border: '1px solid #f4d8a8', borderRadius: 999, padding: '2px 8px', fontWeight: 600 }
                                : { background: '#fdecea', color: '#b42318', border: '1px solid #f3c5c1', borderRadius: 999, padding: '2px 8px', fontWeight: 600 }}
                            >
                              {isNoShow ? 'No Show' : 'Cancellation'}
                            </span>
                          </td>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>{item.arriveDate || '-'}</td>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>{item.departDate || '-'}</td>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0', textAlign: 'right' }}>{item.leadTimeDays ?? '-'}</td>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0', minWidth: 280 }}>
                            {requiresVerification && (
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                <input
                                  type="checkbox"
                                  checked={!!lineReview.verified}
                                  onChange={(e) => updateCancellationLineItemReview(item, idx, 'verified', e.target.checked)}
                                />
                                <span>Verified</span>
                              </label>
                            )}
                            <textarea
                              value={String(lineReview.notes || '')}
                              onChange={(e) => updateCancellationLineItemReview(item, idx, 'notes', e.target.value)}
                              rows={2}
                              placeholder={requiresVerification ? 'Add verification note' : 'Optional note'}
                              style={{ width: '100%', resize: 'vertical' }}
                            />
                          </td>
                        </tr>
                      );
                    })}
                    {filteredCancellationReservations.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ padding: 12, color: '#666', textAlign: 'center' }}>
                          No rows match the current lead-time filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}