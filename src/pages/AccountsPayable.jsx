import React from 'react';

export default function AccountsPayable() {
  return (
    <div className="card pad">
      <h1 style={{ marginTop: 0 }}>Accounts Payable</h1>
      <p style={{ color: 'var(--muted)' }}>
        AP intake is scaffolded. Next step is enabling real inbound email + PDF processing.
      </p>

      <div style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 8 }}>Implementation checklist</h3>
        <ol style={{ marginTop: 0, paddingLeft: 20 }}>
          <li>Set up inbound provider (SES/SendGrid/Mailgun) and real AP mailbox.</li>
          <li>Create webhook endpoint to receive emails and attachments.</li>
          <li>Validate sender/domain and reject unsafe attachments.</li>
          <li>Upload PDF to storage and create invoice record in DB.</li>
          <li>Run OCR/parser and extract header + line items.</li>
          <li>Route low-confidence rows to Line Item Review.</li>
        </ol>
      </div>

      <div style={{ marginTop: 16, padding: 12, border: '1px solid #f0d58a', borderRadius: 8, background: '#fff8e6' }}>
        <strong>Current status:</strong> Using placeholder intake email in nav.
      </div>
    </div>
  );
}
