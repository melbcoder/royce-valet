import React, { useState } from 'react';

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

  const copy = (text, key) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    });
  };

  const webhookUrl = `${window.location.origin}/api/ap-webhook`;
  const exampleEmail = 'invoices@mail.yourdomain.com';

  return (
    <div style={{ maxWidth: 720, padding: '0 0 48px' }}>
      <h1 style={{ marginTop: 0 }}>Inbound Email Setup</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 32 }}>
        Since you already use Twilio, you have access to <strong>SendGrid</strong> at the same account.
        Follow these steps to start receiving invoices by email.
      </p>

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
        <Code>{`Type:     MX
Host:     mail          (gives you @mail.yourdomain.com)
Value:    mx.sendgrid.net
Priority: 10`}</Code>
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
          <li>Destination URL:
            <button
              onClick={() => copy(webhookUrl, 'webhook')}
              style={{ marginLeft: 8, fontSize: 12, padding: '2px 8px', borderRadius: 4, border: '1px solid #ddd', cursor: 'pointer', background: '#f5f5f5' }}
            >
              {copied === 'webhook' ? '✓ Copied' : 'Copy URL'}
            </button>
            <Code>{webhookUrl}</Code>
          </li>
          <li>Tick: <strong>POST the raw, full MIME message</strong></li>
        </ul>
      </Step>

      <Step n={4} title="Set environment variables on your server">
        <p style={{ margin: '0 0 8px', fontSize: 14 }}>Add these to your deployment environment:</p>
        <Code>{`FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
FIREBASE_STORAGE_BUCKET=your-project.appspot.com
SENDGRID_WEBHOOK_SECRET=pick-a-random-secret`}</Code>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>
          Get your service account key from Firebase Console → Project Settings → Service Accounts.
        </p>
      </Step>

      <Step n={5} title="Update the intake email in Nav.jsx">
        <p style={{ margin: '0 0 8px', fontSize: 14 }}>
          In <code>src/components/Nav.jsx</code>, update the constant:
        </p>
        <Code>{`const AP_INTAKE_EMAIL = 'invoices@mail.yourdomain.com';`}</Code>
      </Step>

      <Step n={6} title="Test it">
        <p style={{ margin: '0 0 8px', fontSize: 14 }}>
          Send a test email with a PDF attachment to:
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
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
          After sending, check the <strong>Accounts Payable Overview</strong> — the invoice should appear within seconds.
        </p>
      </Step>

      <div style={{ padding: 16, background: '#e8f0fe', border: '1px solid #93c5fd', borderRadius: 8, fontSize: 14 }}>
        <strong>💡 Tip:</strong> You can use any prefix before <code>@mail.yourdomain.com</code> —
        it all routes to the same webhook. Consider giving each supplier their own address
        (e.g. <code>acme@mail.yourdomain.com</code>) to auto-detect the supplier name.
      </div>
    </div>
  );
}
