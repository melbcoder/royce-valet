import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { auth } from '../firebase';
import { signOut, onAuthStateChanged } from 'firebase/auth';

const TOKEN_TTL = 60; // seconds the QR code stays valid

export default function Nav() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const isStaffPage = [
    '/dashboard',
    '/valet',
    '/valet-history',
    '/luggage',
    '/amenities',
    '/luggage-history',
    '/amenities-history',
    '/maintenance',
    '/maintenance/jobs',
    '/maintenance/contractor-sign-in'
  ].includes(location.pathname);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const isMaintenancePage = location.pathname.startsWith('/maintenance');

  // ── QR modal state ──────────────────────────────────────────────────────────
  const [qrOpen, setQrOpen] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(TOKEN_TTL);
  const canvasRef = useRef(null);
  const countdownRef = useRef(null);
  const qrUrlRef = useRef(null); // store the generated URL to draw later

  const stopCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  const closeQR = useCallback(() => {
    stopCountdown();
    setQrOpen(false);
    setQrError('');
    setSecondsLeft(TOKEN_TTL);
    qrUrlRef.current = null;
  }, [stopCountdown]);

  // Draw the QR onto the canvas element once it's available
  const drawQR = useCallback(async (canvas, url) => {
    if (!canvas || !url) return;
    try {
      const QRCode = (await import('qrcode')).default;
      await QRCode.toCanvas(canvas, url, {
        width: 220,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });
    } catch (err) {
      console.error('QR draw error:', err);
    }
  }, []);

  // Callback ref: fires when the canvas mounts into the DOM
  const canvasCallbackRef = useCallback((node) => {
    canvasRef.current = node;
    if (node && qrUrlRef.current) {
      drawQR(node, qrUrlRef.current);
    }
  }, [drawQR]);

  const generateQR = useCallback(async () => {
    setQrLoading(true);
    setQrError('');
    qrUrlRef.current = null;

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not authenticated');
      const idToken = await currentUser.getIdToken();

      const res = await fetch('/api/generate-login-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate QR');

      const url = `${window.location.origin}/qr-login?t=${data.token}`;
      qrUrlRef.current = url;

      // If the canvas is already in the DOM, draw immediately
      if (canvasRef.current) {
        await drawQR(canvasRef.current, url);
      }
      // Otherwise, canvasCallbackRef will draw it when the canvas mounts

      // Start 60-second countdown
      stopCountdown();
      setSecondsLeft(TOKEN_TTL);
      countdownRef.current = setInterval(() => {
        setSecondsLeft(prev => {
          if (prev <= 1) {
            stopCountdown();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      console.error('QR generation error:', err);
      setQrError(err.message || 'Failed to generate QR code');
    } finally {
      setQrLoading(false);
    }
  }, [stopCountdown, drawQR]);

  // Generate QR when modal first opens
  useEffect(() => {
    if (qrOpen) generateQR();
    return () => { if (!qrOpen) stopCountdown(); };
  }, [qrOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up on unmount
  useEffect(() => () => stopCountdown(), [stopCountdown]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
      alert('Failed to logout. Please try again.');
    }
  };

  if (!isAuthenticated) return null;

  const navLinkStyle = (isActive) => ({
    textDecoration: 'none',
    color: isActive ? '#000' : '#333',
    fontWeight: isActive ? 'bold' : 500,
    padding: '8px 12px',
    borderRadius: '6px',
    transition: 'background 0.2s',
    marginRight: '8px',
    background: 'transparent'
  });

  return (
    <>
      <NavLink to="/valet" style={({ isActive }) => navLinkStyle(isActive)}>
        Valet
      </NavLink>
      <NavLink to="/luggage" style={({ isActive }) => navLinkStyle(isActive)}>
        Luggage
      </NavLink>
      <NavLink to="/amenities" style={({ isActive }) => navLinkStyle(isActive)}>
        Amenities
      </NavLink>
      <div
        onMouseEnter={() => setMaintenanceOpen(true)}
        onMouseLeave={() => setMaintenanceOpen(false)}
        style={{ position: 'relative', display: 'inline-block' }}
      >
        <NavLink
          to="/maintenance"
          style={() => navLinkStyle(isMaintenancePage)}
        >
          Maintenance ▾
        </NavLink>
        {maintenanceOpen && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              background: '#fff',
              border: '1px solid #ddd',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
              padding: 6,
              zIndex: 50,
              minWidth: 200
            }}
          >
            <NavLink
              to="/maintenance/jobs"
              style={({ isActive }) => ({
                ...navLinkStyle(isActive),
                display: 'block',
                marginRight: 0
              })}
            >
              Maintenance Jobs
            </NavLink>
            <NavLink
              to="/maintenance/contractor-sign-in"
              style={({ isActive }) => ({
                ...navLinkStyle(isActive),
                display: 'block',
                marginRight: 0
              })}
            >
              Contractor Sign In
            </NavLink>
          </div>
        )}
      </div>
      
      {isStaffPage && (
        <>
          {/* ── Mobile Login QR button ── */}
          <button
            onClick={() => setQrOpen(true)}
            className="tag"
            title="Mobile login"
            style={{ cursor: 'pointer', marginLeft: 4, background: 'none', border: 'none', padding: 0 }}
          >
            <img 
              src="/qr-code.png" 
              alt="Generate QR code" 
              style={{ width: 24, height: 24, display: 'block' }}
            />
          </button>

          <button 
            onClick={handleLogout}
            className="btn secondary"
            style={{ padding: '8px 16px', fontSize: '14px', marginLeft: '8px' }}
          >
            Logout
          </button>
        </>
      )}

      {/* ── QR Modal ── */}
      {qrOpen && ReactDOM.createPortal(
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
            overflow: 'auto',
            padding: '24px 0',
          }}
          onClick={closeQR}
        >
          <div
            className="card pad"
            style={{ width: 'min(340px, 92vw)', textAlign: 'center', padding: 28, margin: 'auto', flexShrink: 0 }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>Mobile Login</h2>
              <button onClick={closeQR} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            {qrLoading ? (
              <div style={{ padding: '40px 0', color: 'var(--muted)' }}>Generating QR code…</div>
            ) : qrError ? (
              <div>
                <p style={{ color: '#c93030', marginBottom: 16 }}>{qrError}</p>
                <button className="btn" onClick={generateQR}>Try Again</button>
              </div>
            ) : (
              <>
                {/* QR canvas */}
                <div style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  padding: 12, borderRadius: 16, border: '1px solid rgba(0,0,0,.1)',
                  marginBottom: 16,
                  opacity: secondsLeft === 0 ? 0.2 : 1,
                  transition: 'opacity 0.4s',
                }}>
                  <canvas ref={canvasCallbackRef} />
                </div>

                {secondsLeft > 0 ? (
                  <>
                    {/* Countdown bar */}
                    <div style={{
                      height: 4, borderRadius: 999,
                      background: 'rgba(0,0,0,.1)',
                      marginBottom: 8,
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${(secondsLeft / TOKEN_TTL) * 100}%`,
                        borderRadius: 999,
                        background: secondsLeft > 15 ? 'var(--gold)' : '#c93030',
                        transition: 'width 1s linear, background 0.5s',
                      }} />
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 4px 0' }}>
                      Expires in <strong style={{ color: secondsLeft <= 15 ? '#c93030' : 'inherit' }}>{secondsLeft}s</strong>
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
                      Scan with your phone to sign in instantly
                    </p>
                  </>
                ) : (
                  <div>
                    <p style={{ color: '#c93030', marginBottom: 12, fontWeight: 600 }}>QR code expired</p>
                    <button className="btn" onClick={generateQR}>Generate New QR</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}