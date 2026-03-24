import React, { useState, useEffect, useRef } from 'react';
import Cropper from 'react-easy-crop';
import Modal from '../components/Modal';
import { showToast } from '../components/Toast';
import {
  createContractor,
  updateContractor,
  updateContractorHistory,
  subscribeActiveContractors,
  subscribeContractorHistory,
  subscribeSettings,
  markContractorSignedOut,
  storage,
  getCurrentUser,
} from '../services/valetFirestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { getCroppedImage } from '../utils/cropImage';

// ---- Helpers ----
const escHtml = (s) =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmtDateTime = (ms) => {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-AU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

const fmtDate = (ms) => {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString('en-AU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

const fmtDuration = (signedInMs, signedOutMs) => {
  if (!signedInMs || !signedOutMs) return '—';
  const diff = signedOutMs - signedInMs;
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const DEFAULT_PHOTO_RETENTION_DAYS = 7;
const isOlderThanPhotoRetention = (ms, retentionDays) =>
  Boolean(ms && Date.now() - ms > retentionDays * 24 * 60 * 60 * 1000);

const EMPTY_FORM = {
  name: '',
  phone: '',
  company: '',
  worksDescription: '',
  masterKeyNumber: '',
};

// ---- Thermal print badge generator ----
function printBadge(contractor) {
  const photo = contractor.photoUrl || null;
  const signedInTime = fmtDateTime(contractor.signedInAtMs);
  const date = fmtDate(contractor.signedInAtMs);

  const photoBlock = photo
    ? `<img class="photo" src="${escHtml(photo)}" alt="Contractor photo" />`
    : `<div class="photo no-photo">👤</div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Contractor Badge — ${escHtml(contractor.name)}</title>
  <style>
    @page { size: 100mm 62mm; margin: 0; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      background: #fff;
      color: #000;
      width: 100mm;
      height: 62mm;
      overflow: hidden;
    }
    .badge {
      width: 100mm;
      height: 62mm;
      padding: 3mm 3.5mm 2.5mm;
      display: flex;
      flex-direction: column;
      border: 1.5px solid #000;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 2mm;
      border-bottom: 1px solid #000;
      margin-bottom: 2.5mm;
    }
    .hotel { font-size: 11.5pt; font-weight: 900; text-transform: uppercase; letter-spacing: .12em; }
    .badge-type {
      font-size: 8.5pt; font-weight: bold;
      background: #000; color: #fff;
      padding: 1px 5px; border-radius: 2px;
      text-transform: uppercase; letter-spacing: .06em;
    }
    .body { display: flex; flex: 1; gap: 2.2mm; overflow: hidden; }
    .photo {
      width: 92px; height: 92px;
      object-fit: cover;
      border-radius: 4px;
      border: 1.5px solid #999;
      flex-shrink: 0;
    }
    .no-photo {
      width: 92px; height: 92px;
      border-radius: 4px;
      border: 1.5px solid #999;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 38pt;
      background: #f0f0f0;
      flex-shrink: 0;
    }
    .details { flex: 1; display: flex; flex-direction: column; gap: 1mm; overflow: hidden; }
    .name { font-size: 12pt; font-weight: 900; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .company { font-size: 9pt; color: #444; margin-bottom: .3mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row { display: flex; gap: 1.2mm; font-size: 8.2pt; line-height: 1.2; align-items: flex-start; }
    .lbl { font-weight: bold; white-space: nowrap; min-width: 18mm; flex-shrink: 0; }
    .val { color: #222; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .footer {
      font-size: 8pt; color: #666;
      border-top: 1px solid #ccc;
      padding-top: 1.5mm; margin-top: 1.5mm;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
  </style>
</head>
<body>
  <div class="badge">
    <div class="header">
      <div class="hotel">The Royce Hotel</div>
      <div class="badge-type">Visitor / Contractor</div>
    </div>
    <div class="body">
      ${photoBlock}
      <div class="details">
        <div class="name">${escHtml(contractor.name)}</div>
        <div class="company">${escHtml(contractor.company)}</div>
        <div class="row"><span class="lbl">Works:</span><span class="val">${escHtml(contractor.worksDescription)}</span></div>
        <div class="row"><span class="lbl">Master Key #:</span><span class="val">${escHtml(contractor.masterKeyNumber)}</span></div>
        <div class="row"><span class="lbl">Sign-in Time:</span><span class="val">${escHtml(signedInTime)}</span></div>
        <div class="row"><span class="lbl" style="color:#c0392b;font-weight:900;">Valid Until:</span><span class="val" style="color:#c0392b;font-weight:700;">End of ${escHtml(date)}</span></div>
      </div>
    </div>
    <div class="footer">
      <span>This badge must be worn at all times and returned on departure</span>
    </div>
  </div>
  <script>window.onload = () => { setTimeout(() => { window.print(); }, 350); }</script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=440,height=340,toolbar=0,menubar=0,scrollbars=0');
  if (win) {
    win.document.write(html);
    win.document.close();
  } else {
    showToast('Allow pop-ups in your browser to print contractor badges.');
  }
}

// ---- Component ----
export default function ContractorSignIn() {
  const [contractors, setContractors] = useState([]);
  const [signInOpen, setSignInOpen] = useState(false);
  const [signOutConfirm, setSignOutConfirm] = useState(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [formErrors, setFormErrors] = useState({});

  // Photo state
  const [capturedPhoto, setCapturedPhoto] = useState(null); // base64 data URL
  const [photoToCrop, setPhotoToCrop] = useState(null);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const fileInputRef = useRef(null);

  // History
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deletingPhotoId, setDeletingPhotoId] = useState(null);
  const autoCleanupInProgress = useRef(new Set());
  const [photoRetentionDays, setPhotoRetentionDays] = useState(DEFAULT_PHOTO_RETENTION_DAYS);
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');

  // Subscribe to active contractors
  useEffect(() => {
    const unsub = subscribeActiveContractors(setContractors);
    return () => unsub && unsub();
  }, []);

  // Subscribe to contractor history
  useEffect(() => {
    const unsub = subscribeContractorHistory(setHistory);
    return () => unsub && unsub();
  }, []);

  // Subscribe to app settings for photo retention
  useEffect(() => {
    const unsubscribe = subscribeSettings((appSettings) => {
      const parsed = Number(appSettings?.contractorPhotoRetentionDays);
      if (Number.isInteger(parsed) && parsed > 0) {
        setPhotoRetentionDays(parsed);
      } else {
        setPhotoRetentionDays(DEFAULT_PHOTO_RETENTION_DAYS);
      }
    });
    return () => unsubscribe && unsubscribe();
  }, []);

  // ---- Automatically remove expired history photos ----
  useEffect(() => {
    const cleanupExpiredPhotos = async () => {
      const expiredWithPhotos = history.filter(
        (record) =>
          Boolean(record?.photoUrl) &&
          isOlderThanPhotoRetention(record?.signedOutAtMs, photoRetentionDays) &&
          !autoCleanupInProgress.current.has(record._id)
      );

      for (const record of expiredWithPhotos) {
        if (!record.id || !record._id) continue;

        autoCleanupInProgress.current.add(record._id);
        try {
          const photoRef = ref(storage, `contractors/${record.id}/photo.jpg`);
          await deleteObject(photoRef);
          await updateContractorHistory(record._id, { photoUrl: null });
        } catch (err) {
          // Keep this quiet in UI to avoid noisy toasts during background cleanup.
          console.error('Auto photo cleanup failed:', err);
        } finally {
          autoCleanupInProgress.current.delete(record._id);
        }
      }
    };

    if (history.length > 0) {
      cleanupExpiredPhotos();
    }
  }, [history, photoRetentionDays]);

  // ---- Delete photo from a history record ----
  const handleDeleteHistoryPhoto = async (record) => {
    if (!record.id) return;
    setDeletingPhotoId(record._id);
    try {
      const photoRef = ref(storage, `contractors/${record.id}/photo.jpg`);
      await deleteObject(photoRef);
      await updateContractorHistory(record._id, { photoUrl: null });
      showToast('Photo deleted.');
    } catch (err) {
      console.error(err);
      showToast('Failed to delete photo.');
    } finally {
      setDeletingPhotoId(null);
    }
  };

  // ---- Photo selection (native file input — opens camera on mobile) ----
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast('Image must be smaller than 10MB.');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setPhotoToCrop(reader.result);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
      setCropModalOpen(true);
    };
    reader.readAsDataURL(file);
    // Reset so the same file can be re-selected
    e.target.value = '';
  };

  // ---- Modal open/close ----
  const handleOpenModal = () => {
    setForm({ ...EMPTY_FORM });
    setFormErrors({});
    setCapturedPhoto(null);
    setSignInOpen(true);
  };

  const handleCloseModal = () => {
    setCapturedPhoto(null);
    setPhotoToCrop(null);
    setCropModalOpen(false);
    setForm({ ...EMPTY_FORM });
    setFormErrors({});
    setSignInOpen(false);
  };

  const handleCropComplete = (_, croppedPixels) => {
    setCroppedAreaPixels(croppedPixels);
  };

  const handleApplyCrop = async () => {
    if (!photoToCrop || !croppedAreaPixels) return;

    try {
      const croppedImage = await getCroppedImage(photoToCrop, croppedAreaPixels);
      setCapturedPhoto(croppedImage);
      setCropModalOpen(false);
      setPhotoToCrop(null);
    } catch (error) {
      console.error('Failed to crop image:', error);
      showToast('Failed to crop image. Please try another photo.');
    }
  };

  const handleCancelCrop = () => {
    setCropModalOpen(false);
    setPhotoToCrop(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
  };

  // ---- Form helpers ----
  const setField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFormErrors((e) => ({ ...e, [key]: false }));
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = true;
    if (!form.phone.trim()) e.phone = true;
    if (!form.company.trim()) e.company = true;
    if (!form.worksDescription.trim()) e.worksDescription = true;
    if (!form.masterKeyNumber.trim()) e.masterKeyNumber = true;
    return e;
  };

  // ---- Sign in submit ----
  const handleSignIn = async () => {
    const errs = validate();
    if (Object.keys(errs).length) {
      setFormErrors(errs);
      return;
    }
    setSaving(true);
    try {
      const docId = await createContractor({ ...form });

      if (capturedPhoto) {
        try {
          // Convert data URL to Blob without fetch (avoids CSP issues)
          const byteString = atob(capturedPhoto.split(',')[1]);
          const mimeType = capturedPhoto.split(',')[0].split(':')[1].split(';')[0];
          const byteArray = new Uint8Array(byteString.length);
          for (let i = 0; i < byteString.length; i++) byteArray[i] = byteString.charCodeAt(i);
          const blob = new Blob([byteArray], { type: mimeType });
          const photoRef = ref(storage, `contractors/${docId}/photo.jpg`);
          await uploadBytes(photoRef, blob);
          const url = await getDownloadURL(photoRef);
          await updateContractor(docId, { photoUrl: url });
        } catch (photoErr) {
          console.error('Photo upload failed:', photoErr);
          showToast(`${form.name} signed in — photo upload failed.`);
        }
      }

      showToast(`${form.name} has been signed in.`);
      handleCloseModal();
    } catch (err) {
      console.error(err);
      showToast('Sign-in failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // ---- Sign out ----
  const handleSignOut = async (contractor) => {
    try {
      await markContractorSignedOut(contractor.id, contractor);
      showToast(`${contractor.name} has been signed out.`);
      setSignOutConfirm(null);
    } catch {
      showToast('Failed to sign out contractor.');
    }
  };

  const currentUser = getCurrentUser();

  return (
    <div className="page pad">
      {/* ---- Page Header ---- */}
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>Contractor Sign In</h2>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>
            {contractors.length > 0
              ? `${contractors.length} contractor${contractors.length !== 1 ? 's' : ''} currently on site`
              : 'No contractors currently on site'}
          </p>
        </div>
        <button className="btn" onClick={handleOpenModal} title="Sign in a new contractor">
          Add Contractor
        </button>
      </div>

      {/* ---- Active Contractors Table ---- */}
      <section className="card pad">
        {contractors.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🪪</div>
            <p style={{ margin: 0 }}>No contractors are currently signed in.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Works</th>
                  <th>Key #</th>
                  <th>Signed In</th>
                  <th>Signed In By</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {contractors.map((c) => (
                  <tr key={c.id}>
                    <td style={{ width: 52 }}>
                      {c.photoUrl ? (
                        <img
                          src={c.photoUrl}
                          alt={c.name}
                          style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, border: '1px solid rgba(0,0,0,.12)', display: 'block' }}
                        />
                      ) : (
                        <div style={{ width: 44, height: 44, borderRadius: 8, background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
                          👤
                        </div>
                      )}
                    </td>
                    <td>
                      <strong>{c.name}</strong>
                      {c.phone && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.phone}</div>}
                    </td>
                    <td>{c.company}</td>
                    <td style={{ maxWidth: 200 }}>
                      <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {c.worksDescription}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontFamily: 'monospace', background: '#f5f5f5', padding: '2px 6px', borderRadius: 4, fontSize: 13 }}>
                        {c.masterKeyNumber}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDateTime(c.signedInAtMs)}</td>
                    <td>{c.signedInBy?.username || '—'}</td>
                    <td>
                      <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                        <button
                          className="btn secondary"
                          onClick={() => printBadge(c)}
                          title="Print thermal ID badge"
                        >
                          <img src="/id-card.png" alt="Print Badge" style={{ width: 20, height: 20 }} />
                        </button>
                        <button
                          className="btn"
                          style={{ fontSize: 12, padding: '6px 12px', background: '#c0392b', borderColor: '#c0392b', whiteSpace: 'nowrap' }}
                          onClick={() => setSignOutConfirm(c)}
                          title="Sign out this contractor"
                        >
                          Sign Out
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- History Section ---- */}
      <div style={{ marginTop: 32 }}>
        <button
          onClick={() => setHistoryOpen((o) => !o)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '4px 0', marginBottom: 12,
          }}
        >
          <h2 style={{ margin: 0 }}>Contractor History</h2>
          <span style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
            {history.length} record{history.length !== 1 ? 's' : ''}
          </span>
          <span style={{ fontSize: 18, color: 'var(--muted)' }}>{historyOpen ? '▲' : '▼'}</span>
        </button>

        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
          Note: Contractor photos are retained for {photoRetentionDays} days after sign-out, then removed automatically.
        </div>

        {historyOpen && (() => {
          // Derive filtered list inside render so it stays reactive
          const fromMs = historyDateFrom ? new Date(historyDateFrom).setHours(0, 0, 0, 0) : null;
          const toMs   = historyDateTo   ? new Date(historyDateTo).setHours(23, 59, 59, 999) : null;
          const filtered = history.filter((c) => {
            const t = c.signedOutAtMs || c.signedInAtMs || 0;
            if (fromMs && t < fromMs) return false;
            if (toMs   && t > toMs)   return false;
            return true;
          });
          const isFiltered = historyDateFrom || historyDateTo;

          return (
            <section className="card pad">
              {/* Date filter bar */}
              <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                <div className="field" style={{ flex: '1 1 160px', gap: 4 }}>
                  <label style={{ fontSize: 11 }}>From</label>
                  <input
                    type="date"
                    value={historyDateFrom}
                    onChange={(e) => setHistoryDateFrom(e.target.value)}
                    style={{ padding: '8px 10px' }}
                  />
                </div>
                <div className="field" style={{ flex: '1 1 160px', gap: 4 }}>
                  <label style={{ fontSize: 11 }}>To</label>
                  <input
                    type="date"
                    value={historyDateTo}
                    onChange={(e) => setHistoryDateTo(e.target.value)}
                  />
                </div>
                {isFiltered && (
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, paddingBottom: 1 }}>
                    <span style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {filtered.length} of {history.length} shown
                    </span>
                    <button
                      className="btn secondary"
                      style={{ fontSize: 12, padding: '8px 14px' }}
                      onClick={() => { setHistoryDateFrom(''); setHistoryDateTo(''); }}
                      title="Clear the date filter and show all records"
                    >
                      Clear Filter
                    </button>
                  </div>
                )}
              </div>

              {filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>
                  <p style={{ margin: 0 }}>
                    {isFiltered ? 'No records match the selected date range.' : 'No contractor history yet.'}
                  </p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th></th>
                        <th>Name</th>
                        <th>Company</th>
                        <th>Works</th>
                        <th>Key #</th>
                        <th>Signed In</th>
                        <th>Signed Out</th>
                        <th>Duration</th>
                        <th>Authorised By</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((c) => {
                        const photoExpired = isOlderThanPhotoRetention(c.signedOutAtMs, photoRetentionDays);
                        const retentionMs = photoRetentionDays * 24 * 60 * 60 * 1000;
                        return (
                          <tr key={c._id}>
                            <td style={{ width: 52 }}>
                              {c.photoUrl ? (
                                <img
                                  src={c.photoUrl}
                                  alt={c.name}
                                  style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, border: '1px solid rgba(0,0,0,.12)', display: 'block' }}
                                />
                              ) : (
                                <div style={{ width: 44, height: 44, borderRadius: 8, background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
                                  👤
                                </div>
                              )}
                            </td>
                            <td>
                              <strong>{c.name}</strong>
                              {c.phone && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.phone}</div>}
                            </td>
                            <td>{c.company}</td>
                            <td style={{ maxWidth: 180 }}>
                              <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                {c.worksDescription}
                              </span>
                            </td>
                            <td>
                              <span style={{ fontFamily: 'monospace', background: '#f5f5f5', padding: '2px 6px', borderRadius: 4, fontSize: 13 }}>
                                {c.masterKeyNumber}
                              </span>
                            </td>
                            <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDateTime(c.signedInAtMs)}</td>
                            <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDateTime(c.signedOutAtMs)}</td>
                            <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDuration(c.signedInAtMs, c.signedOutAtMs)}</td>
                            <td>{c.signedInBy?.username || '—'}</td>
                            <td>
                              {c.photoUrl && photoExpired && (
                                <button
                                  className="btn secondary"
                                  style={{ fontSize: 12, padding: '6px 12px', whiteSpace: 'nowrap', borderColor: '#c0392b', color: '#c0392b' }}
                                  disabled={deletingPhotoId === c._id}
                                  onClick={() => handleDeleteHistoryPhoto(c)}
                                  title={`Photo is older than ${photoRetentionDays} days — delete to free up storage`}
                                >
                                  {deletingPhotoId === c._id ? 'Deleting…' : '🗑️ Delete Photo'}
                                </button>
                              )}
                              {c.photoUrl && !photoExpired && (
                                <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                                  Photo kept for {Math.ceil((retentionMs - (Date.now() - c.signedOutAtMs)) / 86_400_000)}d more
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })()}
      </div>

      {/* ---- Sign In Modal ---- */}
      <Modal open={signInOpen} title="Contractor Sign In" onClose={handleCloseModal}>
        <div style={{ maxHeight: 'calc(100vh - 160px)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingRight: 2 }}>

          {/* Auto-populated metadata banner */}
          <div style={{ padding: '10px 16px', background: '#f8f8f4', borderRadius: 10, fontSize: 13, color: 'var(--muted)', border: '1px solid rgba(0,0,0,.08)', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <span>👤 Signing in as: <strong style={{ color: 'var(--text)' }}>{currentUser?.username || 'Unknown'}</strong></span>
            <span>🕐 Time: <strong style={{ color: 'var(--text)' }}>{new Date().toLocaleString()}</strong></span>
          </div>

          {/* Contractor details */}
          <div className="grid cols-2">
            <div className="field">
              <label>Full Name *</label>
              <input
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="Contractor's full name"
                autoFocus
                style={formErrors.name ? { borderColor: '#e53e3e' } : {}}
              />
              {formErrors.name && <span style={{ color: '#e53e3e', fontSize: 12 }}>Name is required</span>}
            </div>

            <div className="field">
              <label>Phone Number *</label>
              <input
                value={form.phone}
                onChange={(e) => setField('phone', e.target.value)}
                placeholder="Contractor's phone number"
                type="tel"
                style={formErrors.phone ? { borderColor: '#e53e3e' } : {}}
              />
              {formErrors.phone && <span style={{ color: '#e53e3e', fontSize: 12 }}>Phone number is required</span>}
            </div>

            <div className="field">
              <label>Company *</label>
              <input
                value={form.company}
                onChange={(e) => setField('company', e.target.value)}
                placeholder="Company or trading name"
                style={formErrors.company ? { borderColor: '#e53e3e' } : {}}
              />
              {formErrors.company && <span style={{ color: '#e53e3e', fontSize: 12 }}>Company is required</span>}
            </div>

            <div className="field">
              <label>Master Key Number *</label>
              <input
                value={form.masterKeyNumber}
                onChange={(e) => setField('masterKeyNumber', e.target.value)}
                placeholder="Key number issued to contractor"
                style={formErrors.masterKeyNumber ? { borderColor: '#e53e3e' } : {}}
              />
              {formErrors.masterKeyNumber && <span style={{ color: '#e53e3e', fontSize: 12 }}>Master key number is required</span>}
            </div>
          </div>

          <div className="field">
            <label>Works Being Completed *</label>
            <textarea
              value={form.worksDescription}
              onChange={(e) => setField('worksDescription', e.target.value)}
              placeholder="Describe the works to be carried out on the property…"
              rows={3}
              style={{ resize: 'vertical', ...(formErrors.worksDescription ? { borderColor: '#e53e3e' } : {}) }}
            />
            {formErrors.worksDescription && <span style={{ color: '#e53e3e', fontSize: 12 }}>Works description is required</span>}
          </div>

          {/* ---- Photo Section ---- */}
          <div className="field">
            <label>
              Contractor Photo{' '}
              <span style={{ fontWeight: 400, color: 'var(--muted)', textTransform: 'none', letterSpacing: 0 }}>
                (optional — printed on ID badge)
              </span>
            </label>
            {/* Hidden file input — capture="user" opens front camera on mobile */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="user"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            {capturedPhoto ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <img
                  src={capturedPhoto}
                  alt="Contractor"
                  style={{
                    width: '100%',
                    maxHeight: 300,
                    objectFit: 'cover',
                    borderRadius: 10,
                    border: '1px solid rgba(0,0,0,.12)',
                  }}
                />
                <div className="row">
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => fileInputRef.current?.click()}
                    title="Replace the contractor's photo"
                  >
                    🔄 Replace Photo
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setCapturedPhoto(null)}
                    title="Remove the photo"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <div
                style={{
                  border: '2px dashed rgba(0,0,0,.15)',
                  borderRadius: 10,
                  padding: '28px 20px',
                  textAlign: 'center',
                  background: '#fafaf8',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <span style={{ fontSize: 36 }}>📷</span>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>No photo taken yet</p>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => fileInputRef.current?.click()}
                  title="Take or upload a photo of the contractor"
                >
                  Add Photo
                </button>
              </div>
            )}
          </div>

          {/* Submit row */}
          <div className="row" style={{ justifyContent: 'flex-end', paddingTop: 4 }}>
            <button className="btn secondary" onClick={handleCloseModal} disabled={saving} title="Cancel and close">
              Cancel
            </button>
            <button className="btn" onClick={handleSignIn} disabled={saving} title="Submit and sign in this contractor">
              {saving ? 'Signing In…' : 'Sign In Contractor'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={cropModalOpen} title="Crop Contractor Photo" onClose={handleCancelCrop}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ position: 'relative', width: '100%', height: '55vh', minHeight: 320, background: '#111', borderRadius: 12, overflow: 'hidden' }}>
            {photoToCrop && (
              <Cropper
                image={photoToCrop}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="rect"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={handleCropComplete}
              />
            )}
          </div>

          <div className="field" style={{ gap: 8 }}>
            <label style={{ marginBottom: 0 }}>Zoom</label>
            <input
              type="range"
              min="1"
              max="3"
              step="0.05"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
            <small style={{ color: 'var(--muted)' }}>
              Drag the photo to center the person, then zoom to remove excess background.
            </small>
          </div>

          <div className="row" style={{ justifyContent: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
            <button type="button" className="btn secondary" onClick={handleCancelCrop}>
              Cancel
            </button>
            <button type="button" className="btn primary" onClick={handleApplyCrop}>
              Apply Crop
            </button>
          </div>
        </div>
      </Modal>

      {/* ---- Sign Out Confirmation Modal ---- */}
      <Modal
        open={Boolean(signOutConfirm)}
        title="Confirm Sign Out"
        onClose={() => setSignOutConfirm(null)}
      >
        {signOutConfirm && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p>
              Sign out <strong>{signOutConfirm.name}</strong> from{' '}
              <strong>{signOutConfirm.company}</strong>?
            </p>
            <div
              style={{
                padding: '12px 16px',
                background: '#fff8f0',
                border: '1px solid rgba(192,57,43,.3)',
                borderRadius: 10,
                fontSize: 13,
              }}
            >
              ⚠️ Please confirm master key{' '}
              <strong>#{signOutConfirm.masterKeyNumber}</strong> has been returned
              before signing out.
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn secondary" onClick={() => setSignOutConfirm(null)} title="Cancel and keep contractor signed in">
                Cancel
              </button>
              <button
                className="btn"
                style={{ background: '#c0392b', borderColor: '#c0392b' }}
                onClick={() => handleSignOut(signOutConfirm)}
                title="Confirm master key returned and sign out this contractor"
              >
                Confirm Sign Out
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
