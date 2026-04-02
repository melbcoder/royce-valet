import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection, onSnapshot, doc, updateDoc, query, orderBy
} from 'firebase/firestore';

const DEPARTMENTS = ['Front Office', 'Housekeeping', 'Maintenance', 'F&B', 'Management', 'Other'];
const STATUS_COLORS = {
  pending:  { background: '#fff8e6', color: '#b45309', border: '1px solid #f0d58a' },
  approved: { background: '#e6f4ea', color: '#166534', border: '1px solid #86efac' },
  paid:     { background: '#e8f0fe', color: '#1e40af', border: '1px solid #93c5fd' },
  rejected: { background: '#fde8e8', color: '#991b1b', border: '1px solid #fca5a5' },
};

function StatusBadge({ status }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.pending;
  return (
    <span style={{ ...s, borderRadius: 9999, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function InvoiceModal({ invoice, onClose, onSave }) {
  const [dept, setDept] = useState(invoice.department || '');
  const [confirmedAmount, setConfirmedAmount] = useState(invoice.confirmedAmount ?? invoice.parsedAmount ?? '');
  const [status, setStatus] = useState(invoice.status || 'pending');
  const [paidDate, setPaidDate] = useState(invoice.paidDate || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave(invoice.id, { department: dept, confirmedAmount: parseFloat(confirmedAmount), status, paidDate });
    setSaving(false);
    onClose();
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}
      onClick={onClose}
    >
      <div className="card pad" style={{ width: 'min(640px, 96vw)', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>Invoice: {invoice.invoiceNumber || invoice.id}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        {/* Header fields */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Supplier</label>
            <strong>{invoice.supplier || '—'}</strong>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Invoice Date</label>
            <strong>{invoice.invoiceDate || '—'}</strong>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Parsed Amount</label>
            <strong>${invoice.parsedAmount?.toFixed(2) ?? '—'}</strong>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Received</label>
            <strong>{invoice.receivedAt ? new Date(invoice.receivedAt).toLocaleDateString() : '—'}</strong>
          </div>
        </div>

        {/* Line items */}
        {invoice.lineItems?.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ marginBottom: 8 }}>Line Items</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #eee' }}>
                  <th style={{ textAlign: 'left', padding: '4px 8px' }}>Description</th>
                  <th style={{ textAlign: 'right', padding: '4px 8px' }}>Qty</th>
                  <th style={{ textAlign: 'right', padding: '4px 8px' }}>Unit Price</th>
                  <th style={{ textAlign: 'right', padding: '4px 8px' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lineItems.map((item, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={{ padding: '4px 8px' }}>{item.description}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>{item.quantity}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>${item.unitPrice?.toFixed(2)}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>${item.total?.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Editable fields */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Department</label>
            <select value={dept} onChange={e => setDept(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid #ddd' }}>
              <option value="">— Assign —</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Confirmed Amount ($)</label>
            <input type="number" value={confirmedAmount} onChange={e => setConfirmedAmount(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid #ddd', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid #ddd' }}>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="paid">Paid</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          {status === 'paid' && (
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Date Paid</label>
              <input type="date" value={paidDate} onChange={e => setPaidDate(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid #ddd', boxSizing: 'border-box' }} />
            </div>
          )}
        </div>

        {invoice.pdfUrl && (
          <a href={invoice.pdfUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginBottom: 16, fontSize: 13, color: '#1e40af' }}>
            View PDF ↗
          </a>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

export default function AccountsPayable() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterDept, setFilterDept] = useState('all');

  useEffect(() => {
    const q = query(collection(db, 'ap_invoices'), orderBy('receivedAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const handleSave = async (id, updates) => {
    await updateDoc(doc(db, 'ap_invoices', id), updates);
  };

  const filtered = invoices.filter(inv => {
    if (filterStatus !== 'all' && inv.status !== filterStatus) return false;
    if (filterDept !== 'all' && inv.department !== filterDept) return false;
    return true;
  });

  const totals = {
    pending:  invoices.filter(i => i.status === 'pending').reduce((s, i) => s + (i.confirmedAmount ?? i.parsedAmount ?? 0), 0),
    approved: invoices.filter(i => i.status === 'approved').reduce((s, i) => s + (i.confirmedAmount ?? i.parsedAmount ?? 0), 0),
    paid:     invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.confirmedAmount ?? i.parsedAmount ?? 0), 0),
  };

  return (
    <div style={{ padding: '0 0 40px' }}>
      <h1 style={{ marginTop: 0 }}>Accounts Payable</h1>

      {/* Summary cards — NOTE: array starts with [ not ([ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {([
          { label: 'Pending', value: totals.pending, ...STATUS_COLORS.pending },
          { label: 'Approved', value: totals.approved, ...STATUS_COLORS.approved },
          { label: 'Paid', value: totals.paid, ...STATUS_COLORS.paid },
        ].map(({ label, value, background, color, border }) => (
          <div key={label} className="card" style={{ padding: 16, background, border }}>
            <div style={{ fontSize: 12, color, fontWeight: 600, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color }}>${value.toFixed(2)}</div>
          </div>
        )))
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd' }}>
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="paid">Paid</option>
          <option value="rejected">Rejected</option>
        </select>
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd' }}>
          <option value="all">All Departments</option>
          {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading invoices…</p>
      ) : filtered.length === 0 ? (
        <div className="card pad" style={{ textAlign: 'center', color: 'var(--muted)' }}>
          No invoices found. Send a PDF invoice to the AP intake email to get started.
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #eee' }}>
                {['Invoice #', 'Supplier', 'Date', 'Amount', 'Dept', 'Status', 'Paid Date', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => (
                <tr key={inv.id} style={{ borderBottom: '1px solid #f5f5f5', cursor: 'pointer' }} onClick={() => setSelected(inv)}>
                  <td style={{ padding: '10px 12px' }}>{inv.invoiceNumber || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{inv.supplier || '—'}</td>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{inv.invoiceDate || '—'}</td>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                    ${(inv.confirmedAmount ?? inv.parsedAmount ?? 0).toFixed(2)}
                    {inv.confirmedAmount == null && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>(parsed)</span>}
                  </td>
                  <td style={{ padding: '10px 12px' }}>{inv.department || <span style={{ color: 'var(--muted)' }}>Unassigned</span>}</td>
                  <td style={{ padding: '10px 12px' }}><StatusBadge status={inv.status || 'pending'} /></td>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{inv.paidDate || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <button className="btn secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={e => { e.stopPropagation(); setSelected(inv); }}>
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <InvoiceModal
          invoice={selected}
          onClose={() => setSelected(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
