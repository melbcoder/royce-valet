import React from 'react';

export default function AccountsPayable() {
  return (
    <div className="card pad">
      <h1 style={{ marginTop: 0 }}>Accounts Payable</h1>
      <p style={{ color: 'var(--muted)' }}>
        Placeholder page for AP invoice intake.
      </p>

      <div style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 8 }}>Planned workflow</h3>
        <ul style={{ marginTop: 0 }}>
          <li>Receive invoice emails with PDF attachments</li>
          <li>Auto-upload attachments to storage</li>
          <li>Extract invoice header + line items for review</li>
        </ul>
      </div>
    </div>
  );
}
