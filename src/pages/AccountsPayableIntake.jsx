import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';

const Step = ({ n, title, children, done }) => (
  <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
    <div style={{
      flexShrink: 0, width: 32, height: 32, borderRadius: '50%',
      background: done ? '#166534' : 'var(--gold, #c9a84c)',
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: 14
    }}>
      {done ? '✓' : n}
    </div>
    <div style={{ flex: 1 }}>
      <h3 style={{ margin: '4px 0 8px' }}>{title}</h3>
      {children}
    </div>
  </div>
);

const Code = ({ children }) => (
  <code style={{
    display: 'block', background: '#f5f5f5', border: '1px solid #e0e0e0',
    borderRadius: 6, padding: '10px 14px', fontSize: 13,
    fontFamily: 'monospace', whiteSpace: 'pre', overflowX: 'auto', marginTop: 8
  }}>
    {children}
  </code>
);

export default function AccountsPayableIntake() {
  const [copied, setCopied] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { ok, status, body }
  const [latestInvoice, setLatestInvoice] = useState(null);
  const [firestoreOk, setFirestoreOk] = useState(null);

  // Watch for the most recent invoice in Firestore to confirm end-to-end
  useEffect(() => {
    const q = query(collection(db, 'ap_invoices'), orderBy('receivedAt', 'desc'), limit(1));
    const unsub = onSnapshot(
      q,
      snap => {
        setFirestoreOk(true);
        if (!snap.empty) setLatestInvoice({ id: snap.docs[0].id, ...snap.docs[0].data() });
      },
      () => setFirestoreOk(false)
    );
    return () => unsub();
  }, []);

  const copy = (text, key) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    });
  };

  const runWebhookTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Simulate a minimal SendGrid Inbound Parse POST (no real PDF — tests connectivity)
      const formData = new FormData();
      formData.append('from', 'test-sender@example.com');
      formData.append('to', 'invoices@yourdomain.com');
      formData.append('subject', 'TEST Invoice #TEST-001');
      formData.append('text',
        'Invoice #TEST-001\nDate: 01/01/2025\nFrom: Test Supplier\nTotal: $500.00\n'
      );

      const res = await fetch('/api/ap-webhook', { method: 'POST', body: formData });
      const text = await res.text();
      let body;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { raw: text };
      }
      if (!res.ok && !body.error) {
        body.error = res.statusText || 'Request failed';
      }
      setTestResult({ ok: res.ok, status: res.status, body });
    } catch (err) {
      setTestResult({ ok: false, status: 0, body: { error: err.message } });
    } finally {
      setTesting(false);
    }
  };

  const webhookUrl = `${window.location.origin}/api/ap-webhook`;
  const exampleEmail = 'invoices@mail.yourdomain.com';

  const StatusDot = ({ ok }) => (
    <span style={{
      display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
      background: ok === null ? '#aaa' : ok ? '#22c55e' : '#ef4444',
      marginRight: 6
    }} />
  );

  return (
    <div style={{ maxWidth: 720, padding: '0 0 48px' }}>
      <h1 style={{ marginTop: 0 }}>Inbound Email Setup</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 32 }}>
        Since you already use Twilio, you have access to <strong>SendGrid</strong> at the same account.
        Follow these steps to start receiving invoices by email. The PDF will be stored automatically
        and you can then manually enter the invoice details from the Accounts Payable page.
      </p>

      {/* ── Live status panel ── */}
      <div className="card" style={{ padding: 20, marginBottom: 32, border: '1px solid #e0e0e0' }}>
        <h3 style={{ marginTop: 0, marginBottom: 16 }}>Connection Status</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          <div style={{ fontSize: 14 }}>
            <StatusDot ok={firestoreOk} />
            <strong>Firestore</strong>
            {firestoreOk === null && <span style={{ color: 'var(--muted)', marginLeft: 6 }}>Checking…</span>}
            {firestoreOk === true && <span style={{ color: '#166534', marginLeft: 6 }}>Connected — ap_invoices collection reachable</span>}
            {firestoreOk === false && <span style={{ color: '#991b1b', marginLeft: 6 }}>Cannot reach Firestore — check security rules</span>}
          </div>
          <div style={{ fontSize: 14 }}>
            <StatusDot ok={testResult === null ? null : testResult.ok} />
            <strong>Webhook endpoint</strong>
            {testResult === null && <span style={{ color: 'var(--muted)', marginLeft: 6 }}>Not tested yet</span>}
            {testResult?.ok && <span style={{ color: '#166534', marginLeft: 6 }}>Responded {testResult.status} OK</span>}
            {testResult && !testResult.ok && (
              <span style={{ color: '#991b1b', marginLeft: 6 }}>
                Failed — {testResult.status} {testResult.body?.error || testResult.body?.detail || 'Unknown error'}
              </span>
            )}
          </div>
          {latestInvoice && (
            <div style={{ fontSize: 14 }}>
              <StatusDot ok={true} />
              <strong>Last invoice received:</strong>
              <span style={{ color: 'var(--muted)', marginLeft: 6 }}>
                {latestInvoice.subject || latestInvoice.id}
                {latestInvoice.hasPdf ? ' · PDF attached' : ' · No PDF'}
                {' · '}
                {latestInvoice.receivedAt ? new Date(latestInvoice.receivedAt).toLocaleString() : ''}
              </span>
            </div>
          )}
        </div>

        <button
          className="btn"
          onClick={runWebhookTest}
          disabled={testing}
          style={{ marginRight: 8 }}
        >
          {testing ? 'Sending test…' : 'Send Test Webhook POST'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          Sends a simulated invoice email directly to your webhook (no real email needed)
        </span>

        {testResult && (
          <pre style={{
            marginTop: 12, background: '#f5f5f5', border: '1px solid #e0e0e0',
            borderRadius: 6, padding: 12, fontSize: 12, overflowX: 'auto'
          }}>
            {JSON.stringify(testResult.body, null, 2)}
          </pre>
        )}
      </div>

      {/* ── Setup steps ── */}
      <Step n={1} title="Log into SendGrid via Twilio">
        <p style={{ margin: '0 0 8px', fontSize: 14 }}>
          Go to <a href="https://app.sendgrid.com" target="_blank" rel="noreferrer">app.sendgrid.com</a> and
          sign in with your Twilio credentials (or SSO).
        </p>
      </Step>

      <Step n={2} title="Add an MX record to your domain DNS">
        <p style={{ margin: '0 0 8px', fontSize: 14 }}>
          At your domain registrar (GoDaddy, Cloudflare, etc.), add this DNS record:
        </p>
        <Code>{`Type:     MX\nHost:     mail\nValue:    mx.sendgrid.net\nPriority: 10`}</Code>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>
          DNS changes can take up to 24 hours to propagate.
        </p>
      </Step>

      <Step n={3} title="Configure Inbound Parse in SendGrid">
        <p style={{ margin: '0 0 8px', fontSize: 14 }}>
          In SendGrid: <strong>Settings → Inbound Parse → Add Host & URL</strong>
        </p>
        <ul style={{ fontSize: 14, margin: '0 0 8px', paddingLeft: 20 }}>
          <li>Receiving Domain: <code>mail.yourdomain.com</code></li>
          <li>
            Destination URL:
            <button
              onClick={() => copy(webhookUrl, 'webhook')}
              style={{ marginLeft: 8, fontSize: 12, padding: '2px 8px', borderRadius: 4, border: '1px solid #ddd', cursor: 'pointer', background: '#f5f5f5' }}
            >
              {copied === 'webhook' ? '✓ Copied' : 'Copy URL'}
            </button>
            <Code>{webhookUrl}</Code>
          </li>
          <li>Tick: <strong>Check incoming emails for spam</strong> (optional)</li>
          <li>Leave <strong>"POST the raw, full MIME message"</strong> unchecked (either mode works, but unchecked is recommended)</li>
        </ul>
      </Step>

      <Step n={4} title="Set environment variables on your server">
        <Code>{`FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}\nFIREBASE_STORAGE_BUCKET=your-project.appspot.com\nSENDGRID_WEBHOOK_SECRET=pick-a-random-secret`}</Code>
      </Step>

      <Step n={5} title="Update the intake email in Nav.jsx">
        <Code>{`const AP_INTAKE_EMAIL = 'invoices@mail.yourdomain.com';`}</Code>
      </Step>

      <Step n={6} title="Send a real test email">
        <p style={{ margin: '0 0 8px', fontSize: 14 }}>
          Send an email with a PDF attachment to:
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <code style={{ background: '#f5f5f5', padding: '6px 12px', borderRadius: 6, fontSize: 14 }}>
            {exampleEmail}
          </code>
          <button
            onClick={() => copy(exampleEmail, 'email')}
            style={{ fontSize: 12, padding: '4px 10px', borderRadius: 4, border: '1px solid #ddd', cursor: 'pointer', background: '#f5f5f5' }}
          >
            {copied === 'email' ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>
          After sending, the invoice should appear in the <strong>Accounts Payable</strong> table within seconds.
          Click into it to view the PDF and manually enter the invoice details.
          Use the <em>Send Test Webhook POST</em> button above to verify connectivity without needing a real email first.
        </p>
      </Step>

      <div style={{ padding: 16, background: '#e8f0fe', border: '1px solid #93c5fd', borderRadius: 8, fontSize: 14 }}>
        <strong>💡 Tip:</strong> You can use any prefix before <code>@mail.yourdomain.com</code>.
        Consider giving each supplier their own address (e.g. <code>acme@mail.yourdomain.com</code>) to auto-detect the supplier name.
      </div>
    </div>
  );
}
