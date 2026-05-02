import { useEffect, useMemo, useRef, useState } from 'react';
import { auth } from '../firebase';
import { getCurrentUser } from '../services/valetFirestore';
import { subscribeLowRateReports, updateLowRateReportReview } from '../services/reportsService';

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
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedReportId, setSelectedReportId] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewChecked, setReviewChecked] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');
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
        setError(`Failed to load reports: ${err?.message || err?.code || 'Unknown error'}`);
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
    setReviewChecked(!!selectedReport.reviewChecked);
    setReviewNotes(String(selectedReport.reviewNotes || ''));
  }, [selectedReport]);

  async function handleImportCsv() {
    setError('');
    setImportSuccess('');

    if (!selectedFile) {
      setError('Please choose a CSV file first.');
      return;
    }

    try {
      setImporting(true);
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setError('Not authenticated. Please log in again.');
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

      setImportSuccess('CSV imported and low-rate checks completed.');
      setSelectedFile(null);
    } catch (err) {
      setError(err.message || 'Failed to import CSV');
    } finally {
      setImporting(false);
    }
  }

  async function handleSaveReview() {
    if (!selectedReport) return;

    try {
      setReviewSaving(true);
      setError('');
      const currentUser = getCurrentUser();
      await updateLowRateReportReview(selectedReport.id, {
        reviewChecked,
        reviewNotes,
        reviewCheckedBy: currentUser?.username || 'Unknown',
      });
    } catch (err) {
      setError(err.message || 'Failed to save review');
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
          Upload the previous day reservation CSV. The system checks booked rates against reference rates (from CSV inline fields or an optional external lookup endpoint), then flags potential low-rate issues.
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
      {error && <div style={{ color: '#b00020', marginBottom: 12 }}>{error}</div>}

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
                    <div style={{ fontWeight: 600 }}>{report.reportDate || '-'}</div>
                    <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
                      Checked: {report.totalChecked || 0} | Low: {report.lowCount || 0} | No Ref: {report.missingReferenceCount || 0}
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
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={reviewChecked}
                    onChange={(e) => setReviewChecked(e.target.checked)}
                  />
                  <span>Checked over and approved</span>
                </label>
                <textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  rows={3}
                  placeholder="Review notes"
                  style={{ width: '100%', marginBottom: 8 }}
                />
                <button type="button" className="btn secondary" onClick={handleSaveReview} disabled={reviewSaving}>
                  {reviewSaving ? 'Saving...' : 'Save Review'}
                </button>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#fafafa' }}>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>B/C</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Reservation</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Guest</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Room</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Stay Date</th>
                      <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #eee' }}>Booked</th>
                      <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #eee' }}>Reference</th>
                      <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #eee' }}>Variance</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedReport.reservations || []).map((item, idx) => {
                      const isLow = item.status === 'low';
                      const isNoRef = item.status === 'no-reference';

                      return (
                        <tr key={`${item.reservationId || idx}-${idx}`} style={{ background: isLow ? '#fff1f1' : isNoRef ? '#fffbea' : '#fff' }}>
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>
                            {item.statusCode ? `${item.statusCode}${item.statusLabel ? ` (${item.statusLabel})` : ''}` : '-'}
                          </td>
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
                          <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0', fontWeight: 600 }}>
                            {item.status || '-'}
                          </td>
                        </tr>
                      );
                    })}
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