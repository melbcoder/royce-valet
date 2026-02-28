import React, { useState, useEffect, useRef, useCallback } from 'react';
import Modal from '../components/Modal';
import { showToast } from '../components/Toast';
import {
  createContractor,
  updateContractor,
  subscribeActiveContractors,
  markContractorSignedOut,
  storage,
  getCurrentUser,
} from '../services/valetFirestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

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
    .hotel { font-size: 8.5pt; font-weight: 900; text-transform: uppercase; letter-spacing: .12em; }
    .badge-type {
      font-size: 6.5pt; font-weight: bold;
      background: #000; color: #fff;
      padding: 1px 5px; border-radius: 2px;
      text-transform: uppercase; letter-spacing: .06em;
    }
    .body { display: flex; flex: 1; gap: 3mm; overflow: hidden; }
    .photo {
      width: 68px; height: 68px;
      object-fit: cover;
      border-radius: 4px;
      border: 1.5px solid #999;
      flex-shrink: 0;
    }
    .no-photo {
      width: 68px; height: 68px;
      border-radius: 4px;
      border: 1.5px solid #999;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26pt;
      background: #f0f0f0;
      flex-shrink: 0;
    }
    .details { flex: 1; display: flex; flex-direction: column; gap: 1.3mm; overflow: hidden; }
    .name { font-size: 10pt; font-weight: 900; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .company { font-size: 7pt; color: #444; margin-bottom: .5mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row { display: flex; gap: 1.5mm; font-size: 6.5pt; line-height: 1.3; align-items: flex-start; }
    .lbl { font-weight: bold; white-space: nowrap; min-width: 22mm; flex-shrink: 0; }
    .val { color: #222; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .footer {
      font-size: 5.5pt; color: #666;
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
        <div class="row"><span class="lbl">Authorised By:</span><span class="val">${escHtml(contractor.signedInBy?.username || '—')}</span></div>
      </div>
    </div>
    <div class="footer">
      <span>Date: ${escHtml(date)}</span>
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

  // Camera state
  const [cameraOpen, setCameraOpen] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState(null); // base64 data URL
  const streamRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // Subscribe to active contractors
  useEffect(() => {
    const unsub = subscribeActiveContractors(setContractors);
    return () => unsub && unsub();
  }, []);

  // ---- Camera logic ----
  const startCamera = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
      }
    } catch {
      showToast('Camera unavailable or permission denied.');
      setCameraOpen(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Start camera whenever the section opens (and no photo yet captured)
  useEffect(() => {
    if (cameraOpen && !capturedPhoto && !streamRef.current) {
      startCamera();
    }
  }, [cameraOpen, capturedPhoto, startCamera]);

  const handleToggleCamera = () => {
    if (cameraOpen) {
      stopCamera();
      setCameraOpen(false);
      setCapturedPhoto(null);
    } else {
      setCameraOpen(true);
    }
  };

  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setCapturedPhoto(dataUrl);
    stopCamera();
  };

  const handleRetake = () => {
    setCapturedPhoto(null);
    // The useEffect will restart the camera stream
  };

  // ---- Modal open/close ----
  const handleOpenModal = () => {
    setForm({ ...EMPTY_FORM });
    setFormErrors({});
    setCapturedPhoto(null);
    setCameraOpen(false);
    setSignInOpen(true);
  };

  const handleCloseModal = () => {
    stopCamera();
    setCameraOpen(false);
    setCapturedPhoto(null);
    setForm({ ...EMPTY_FORM });
    setFormErrors({});
    setSignInOpen(false);
  };

  // ---- Form helpers ----
  const setField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFormErrors((e) => ({ ...e, [key]: false }));
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = true;
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
          const blob = await fetch(capturedPhoto).then((r) => r.blob());
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
        <button className="btn" onClick={handleOpenModal}>
          + Sign In Contractor
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
                          style={{ fontSize: 12, padding: '6px 12px', whiteSpace: 'nowrap' }}
                          onClick={() => printBadge(c)}
                          title="Print thermal ID badge"
                        >
                          🖨️ Print Badge
                        </button>
                        <button
                          className="btn"
                          style={{ fontSize: 12, padding: '6px 12px', background: '#c0392b', borderColor: '#c0392b', whiteSpace: 'nowrap' }}
                          onClick={() => setSignOutConfirm(c)}
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
              <label>Phone Number</label>
              <input
                value={form.phone}
                onChange={(e) => setField('phone', e.target.value)}
                placeholder="Optional"
                type="tel"
              />
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

          {/* ---- Camera Section ---- */}
          <div style={{ border: '1px solid rgba(0,0,0,.12)', borderRadius: 12, overflow: 'hidden' }}>
            <button
              type="button"
              onClick={handleToggleCamera}
              style={{
                width: '100%', padding: '12px 16px',
                background: cameraOpen ? '#f5f5f5' : '#fafaf8',
                border: 'none', cursor: 'pointer',
                textAlign: 'left', fontWeight: 600, fontSize: 14,
                display: 'flex', alignItems: 'center', gap: 10,
              }}
            >
              <span style={{ fontSize: 20 }}>📷</span>
              {capturedPhoto && !cameraOpen ? (
                <span style={{ color: '#27ae60' }}>
                  Photo captured ✓{' '}
                  <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 12 }}>
                    — click to retake
                  </span>
                </span>
              ) : cameraOpen ? (
                <span>Close Camera</span>
              ) : (
                <span>
                  Take Contractor Photo{' '}
                  <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 12 }}>
                    optional — printed on ID badge
                  </span>
                </span>
              )}
            </button>

            {cameraOpen && (
              <div style={{ padding: 14, background: '#111', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                {capturedPhoto ? (
                  <>
                    <img
                      src={capturedPhoto}
                      alt="Captured"
                      style={{ width: '100%', maxWidth: 440, borderRadius: 8 }}
                    />
                    <button
                      className="btn secondary"
                      onClick={handleRetake}
                      style={{ background: '#fff', color: '#000' }}
                    >
                      🔄 Retake Photo
                    </button>
                  </>
                ) : (
                  <>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      style={{ width: '100%', maxWidth: 440, borderRadius: 8, background: '#333', display: 'block' }}
                    />
                    <button className="btn" onClick={handleCapture}>
                      📸 Capture Photo
                    </button>
                  </>
                )}
                <canvas ref={canvasRef} style={{ display: 'none' }} />
              </div>
            )}
          </div>

          {/* Submit row */}
          <div className="row" style={{ justifyContent: 'flex-end', paddingTop: 4 }}>
            <button className="btn secondary" onClick={handleCloseModal} disabled={saving}>
              Cancel
            </button>
            <button className="btn" onClick={handleSignIn} disabled={saving}>
              {saving ? 'Signing In…' : 'Sign In Contractor'}
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
              <button className="btn secondary" onClick={() => setSignOutConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn"
                style={{ background: '#c0392b', borderColor: '#c0392b' }}
                onClick={() => handleSignOut(signOutConfirm)}
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
