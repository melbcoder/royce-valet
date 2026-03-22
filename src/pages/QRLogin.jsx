import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../firebase';

export default function QRLogin() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('Verifying QR code…');
  const [error, setError] = useState('');

  useEffect(() => {
    const token = searchParams.get('t');

    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      setError('This QR code link is invalid. Please scan a fresh code.');
      return;
    }

    async function redeem() {
      try {
        // Exchange the one-time token for a Firebase Custom Token
        const res = await fetch('/api/redeem-login-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        const data = await res.json();

        if (!res.ok) {
          setError(data.error || 'Sign-in failed. The QR code may have expired — please generate a new one.');
          return;
        }

        setStatus('Authenticating…');

        // Sign in to Firebase with the custom token
        const credential = await signInWithCustomToken(auth, data.customToken);

        setStatus('Loading your profile…');

        // Extract the user's claims (username, role, mustChangePassword) embedded in the token
        const idTokenResult = await credential.user.getIdTokenResult();
        const claims = idTokenResult.claims;

        // Reproduce the same localStorage shape used by the normal login flow
        localStorage.setItem('currentUser', JSON.stringify({
          id: credential.user.uid,
          uid: credential.user.uid,
          username: claims.username || '',
          role: claims.role || 'staff',
          mustChangePassword: claims.mustChangePassword || false,
        }));

        if (claims.mustChangePassword) {
          window.location.href = '/force-change-password';
          return;
        }

        navigate('/dashboard');
      } catch (err) {
        console.error('QR login error:', err);
        setError('Sign-in failed. The QR code may have expired — please generate a new one from the desktop.');
      }
    }

    redeem();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: 'calc(100vh - 160px)',
      padding: 20,
    }}>
      <section className="card pad" style={{ maxWidth: 380, width: '100%', textAlign: 'center', padding: 40 }}>
        {error ? (
          <>
            <div style={{ fontSize: 52, marginBottom: 16 }}>❌</div>
            <h2 style={{ marginBottom: 12 }}>Sign-in Failed</h2>
            <p style={{ color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>{error}</p>
            <a href="/login" className="btn" style={{ display: 'inline-block', textDecoration: 'none' }}>
              Go to Login
            </a>
          </>
        ) : (
          <>
            <div style={{ fontSize: 52, marginBottom: 16 }}>🔐</div>
            <h2 style={{ marginBottom: 12 }}>Signing in…</h2>
            <p style={{ color: 'var(--muted)', lineHeight: 1.6 }}>{status}</p>
            {/* Subtle loading pulse */}
            <div style={{
              marginTop: 24,
              height: 4,
              borderRadius: 999,
              background: 'rgba(191,164,111,0.2)',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: '40%',
                borderRadius: 999,
                background: 'var(--gold)',
                animation: 'qr-pulse 1.2s ease-in-out infinite',
              }} />
            </div>
            <style>{`
              @keyframes qr-pulse {
                0%   { transform: translateX(-100%); }
                100% { transform: translateX(350%); }
              }
            `}</style>
          </>
        )}
      </section>
    </div>
  );
}
