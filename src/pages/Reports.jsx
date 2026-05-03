import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';
import { auth, db } from '../firebase';
import { getCurrentUser } from '../services/valetFirestore';
import { subscribeLowRateReports, updateLowRateReportReview } from '../services/reportsService';

function getLineItemKey(item, idx) {
  return [item?.reservationId || 'reservation', item?.checkInDate || 'date', item?.rowNumber || idx]
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

export default function Reports() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [importing, setImporting] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedReportId, setSelectedReportId] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');
  const [lineItemReviews, setLineItemReviews] = useState({});
  const [varianceFilterInput, setVarianceFilterInput] = useState('');
  const [importSuccess, setImportSuccess] = useState('');

  const selectedReportIdRef = useRef(selectedReportId);
  selectedReportIdRef.current = selectedReportId;

  useEffect(() => {
    const unsubscribe = subscribeLowRateReports(
      (items) => {
        setReports(items);
        setLoading(false);
        if (!selectedReportIdRef.current && items.length > 0) {
          setSelectedReportId(items[0].id);
        }
      },
      (err) => {
        setLoadError(`Failed to load reports: ${err?.message || err?.code || 'Unknown error'}`);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, []); // stable — subscription never needs to restart

  const selectedReport = useMemo(
    () => reports.find((r) => r.id === selectedReportId) || null,
    [reports, selectedReportId]
  );

  useEffect(() => {
    if (!selectedReport) return;
    setReviewNotes(String(selectedReport.reviewNotes || ''));
    setLineItemReviews(selectedReport.lineItemReviews && typeof selectedReport.lineItemReviews === 'object' ? selectedReport.lineItemReviews : {});
    setVarianceFilterInput(selectedReport.tolerancePct != null ? String(selectedReport.tolerancePct) : '');
  }, [selectedReport]);

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

  async function handleImportCsv() {
    setActionError('');
    setImportSuccess('');

    if (!selectedFile) {
      setActionError('Please choose a CSV file first.');
      return;
    }

    try {
      setImporting(true);
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setActionError('Not authenticated. Please log in again.');
        return;
      }

      const csv = await selectedFile.text();
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
      setSelectedFile(null);
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

  return (
    <section className="card pad">
      <h2 style={{ marginTop: 0, marginBottom: 12 }}>Reports</h2>

      <div style={{ marginBottom: 16, padding: 12, border: '1px solid #ddd', borderRadius: 8, background: '#fafafa' }}>
        <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 18 }}>Daily Low Rate Report</h3>
        <p style={{ marginTop: 0, marginBottom: 8, color: 'var(--muted)' }}>
          Upload the previous day reservation CSV. The system checks booked rates against BAR rates (from CSV inline fields or an optional external lookup endpoint), then flags potential low-rate issues.
        </p>
        <p style={{ marginTop: 0, marginBottom: 0, color: 'var(--muted)', fontSize: 13 }}>
          Automation target email: <strong>reports@mail.concierge.xin</strong>
        </p>
        <p style={{ marginTop: 8, marginBottom: 0, color: 'var(--muted)', fontSize: 13 }}>
          SendGrid inbound automation is supported via <strong>/api/ap-webhook/&lt;SENDGRID_WEBHOOK_SECRET&gt;</strong>, using the same route-secret pattern as Accounts Payable.
        </p>
        <p style={{ marginTop: 8, marginBottom: 0, color: 'var(--muted)', fontSize: 13 }}>
          Manual upload uses <strong>/api/ap-webhook</strong> with bearer auth and action <strong>low-rate-ingest</strong>.
        </p>
      </div>

      <div style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
        />
        <button className="btn primary" type="button" onClick={handleImportCsv} disabled={importing}>
          {importing ? 'Importing...' : 'Import CSV & Run Checks'}
        </button>
      </div>

      {importSuccess && <div style={{ color: '#2f7d32', marginBottom: 12 }}>{importSuccess}</div>}
      {actionError && <div style={{ color: '#b00020', marginBottom: 12 }}>{actionError}</div>}
      {loadError && <div style={{ color: '#b00020', marginBottom: 12 }}>{loadError}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
        <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid #ddd', background: '#f4f6fb', fontWeight: 600 }}>
            Recent Low Rate Reports
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
                    onClick={() => setSelectedReportId(report.id)}
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
                    <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
                      Low: {lowOutsideThreshold} | No Ref: {report.missingReferenceCount || 0}
                      {unapprovedCount > 0 && (
                        <span style={{ color: '#c62828', marginLeft: 6, fontWeight: 600 }}>
                          · {unapprovedCount} unverified
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
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
                  {reviewSaving ? 'Saving...' : 'Save Review & Verification Notes'}
                </button>
              </div>

              <div style={{ overflowX: 'auto' }}>
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
    </section>
  );
}