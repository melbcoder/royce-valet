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

const emptyLineItem = () => ({ description: '', quantity: 1, unitPrice: '', total: '' });

function InvoiceModal({ invoice, onClose, onSave }) {
  const [supplier, setSupplier] = useState(invoice.supplier || '');
  const [invoiceNumber, setInvoiceNumber] = useState(invoice.invoiceNumber || '');
  const [invoiceDate, setInvoiceDate] = useState(invoice.invoiceDate || '');
  const [dept, setDept] = useState(invoice.department || '');
  const [confirmedAmount, setConfirmedAmount] = useState(invoice.confirmedAmount ?? '');
  const [status, setStatus] = useState(invoice.status || 'pending');
  const [paidDate, setPaidDate] = useState(invoice.paidDate || '');
  const [notes, setNotes] = useState(invoice.notes || '');
  const [lineItems, setLineItems] = useState(
    invoice.lineItems?.length ? invoice.lineItems : [emptyLineItem()]
  );
  const [saving, setSaving] = useState(false);

  const updateLineItem = (idx, field, value) => {
    setLineItems(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      // Auto-calc total when qty or unitPrice changes
      if (field === 'quantity' || field === 'unitPrice') {
        const qty = parseFloat(field === 'quantity' ? value : updated[idx].quantity) || 0;
        const price = parseFloat(field === 'unitPrice' ? value : updated[idx].unitPrice) || 0;
        updated[idx].total = qty && price ? (qty * price).toFixed(2) : '';
      }
      return updated;
    });
  };

  const addLineItem = () => setLineItems(prev => [...prev, emptyLineItem()]);

  const removeLineItem = (idx) => {
    setLineItems(prev => prev.length <= 1 ? [emptyLineItem()] : prev.filter((_, i) => i !== idx));
  };

  // Auto-sum line item totals into confirmed amount
  const lineItemsTotal = lineItems.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);

  const handleSave = async () => {
    setSaving(true);
    const cleanedItems = lineItems
      .filter(item => item.description.trim())
      .map(item => ({
        description: item.description,
        quantity: parseFloat(item.quantity) || 0,
        unitPrice: parseFloat(item.unitPrice) || 0,
        total: parseFloat(item.total) || 0,
      }));
    await onSave(invoice.id, {
      supplier,
      invoiceNumber,
      invoiceDate,
      department: dept,
      confirmedAmount: confirmedAmount !== '' ? parseFloat(confirmedAmount) : null,
      status,
      paidDate,
      notes,
      lineItems: cleanedItems,
    });
    setSaving(false);
    onClose();
  };

  const fieldLabel = { fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 };
  const inputStyle = { width: '100%', padding: '8px', borderRadius: 6, border: '1px solid #ddd', boxSizing: 'border-box' };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}
      onClick={onClose}
    >
      <div className="card pad" style={{ width: 'min(800px, 96vw)', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>
            {invoice.invoiceNumber ? `Invoice: ${invoice.invoiceNumber}` : 'New Invoice'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        {/* Email info */}
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, padding: 12, background: '#f9f9f9', borderRadius: 6, border: '1px solid #eee' }}>
          <div><strong>From:</strong> {invoice.fromEmail || '—'}</div>
          <div><strong>Subject:</strong> {invoice.subject || '—'}</div>
          <div><strong>Received:</strong> {invoice.receivedAt ? new Date(invoice.receivedAt).toLocaleString() : '—'}</div>
        </div>

        {/* PDF viewer */}
        {invoice.storagePath ? (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <strong style={{ fontSize: 14 }}>PDF Attachment</strong>
              <a
                href={`/api/pdf-link?id=${encodeURIComponent(invoice.id)}`}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 13, color: '#1e40af' }}
              >
                Open in new tab ↗
              </a>
            </div>
            <iframe
              src={`/api/pdf-link?id=${encodeURIComponent(invoice.id)}`}
              title="Invoice PDF"
              style={{ width: '100%', height: 400, border: '1px solid #ddd', borderRadius: 6, background: '#f5f5f5' }}
            />
          </div>
        ) : (
          <div style={{ marginBottom: 16, padding: 16, background: '#fff8e6', border: '1px solid #f0d58a', borderRadius: 6, fontSize: 13, color: '#b45309' }}>
            No PDF attachment was found in the received email.
          </div>
        )}

        {/* Invoice details - manual entry */}
        <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Invoice Details</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          <div>
            <label style={fieldLabel}>Supplier</label>
            <input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Company name" style={inputStyle} />
          </div>
          <div>
            <label style={fieldLabel}>Invoice Number</label>
            <input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="INV-001" style={inputStyle} />
          </div>
          <div>
            <label style={fieldLabel}>Invoice Date</label>
            <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={fieldLabel}>Department</label>
            <select value={dept} onChange={e => setDept(e.target.value)} style={inputStyle}>
              <option value="">— Assign —</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label style={fieldLabel}>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle}>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="paid">Paid</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          {status === 'paid' && (
            <div>
              <label style={fieldLabel}>Date Paid</label>
              <input type="date" value={paidDate} onChange={e => setPaidDate(e.target.value)} style={inputStyle} />
            </div>
          )}
        </div>

        {/* Line items */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Line Items</h3>
            <button className="btn secondary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={addLineItem}>
              + Add Item
            </button>
          </div>
          <div style={{ border: '1px solid #eee', borderRadius: 6, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9f9f9', borderBottom: '1px solid #eee' }}>
                  <th style={{ textAlign: 'left', padding: '8px', fontWeight: 600 }}>Description</th>
                  <th style={{ textAlign: 'right', padding: '8px', fontWeight: 600, width: 70 }}>Qty</th>
                  <th style={{ textAlign: 'right', padding: '8px', fontWeight: 600, width: 100 }}>Unit Price</th>
                  <th style={{ textAlign: 'right', padding: '8px', fontWeight: 600, width: 100 }}>Total</th>
                  <th style={{ width: 36, padding: '8px' }}></th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={{ padding: 4 }}>
                      <input
                        value={item.description}
                        onChange={e => updateLineItem(idx, 'description', e.target.value)}
                        placeholder="Item description"
                        style={{ ...inputStyle, padding: '6px 8px' }}
                      />
                    </td>
                    <td style={{ padding: 4 }}>
                      <input
                        type="number"
                        min="0"
                        value={item.quantity}
                        onChange={e => updateLineItem(idx, 'quantity', e.target.value)}
                        style={{ ...inputStyle, padding: '6px 8px', textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ padding: 4 }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={e => updateLineItem(idx, 'unitPrice', e.target.value)}
                        placeholder="0.00"
                        style={{ ...inputStyle, padding: '6px 8px', textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ padding: 4 }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.total}
                        onChange={e => updateLineItem(idx, 'total', e.target.value)}
                        placeholder="0.00"
                        style={{ ...inputStyle, padding: '6px 8px', textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ padding: 4, textAlign: 'center' }}>
                      <button
                        onClick={() => removeLineItem(idx)}
                        style={{ background: 'none', border: 'none', color: '#991b1b', cursor: 'pointer', fontSize: 16, padding: '2px 6px' }}
                        title="Remove item"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lineItemsTotal > 0 && (
            <div style={{ textAlign: 'right', marginTop: 8, fontSize: 14 }}>
              <strong>Line Items Total: ${lineItemsTotal.toFixed(2)}</strong>
            </div>
          )}
        </div>

        {/* Total amount */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          <div>
            <label style={fieldLabel}>
              Invoice Total ($)
              {lineItemsTotal > 0 && confirmedAmount === '' && (
                <button
                  onClick={() => setConfirmedAmount(lineItemsTotal.toFixed(2))}
                  style={{ marginLeft: 8, fontSize: 11, padding: '1px 6px', borderRadius: 4, border: '1px solid #ddd', cursor: 'pointer', background: '#f5f5f5' }}
                >
                  Use line items total
                </button>
              )}
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={confirmedAmount}
              onChange={e => setConfirmedAmount(e.target.value)}
              placeholder="0.00"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={fieldLabel}>Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" style={inputStyle} />
          </div>
        </div>

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
    pending:  invoices.filter(i => i.status === 'pending').reduce((s, i) => s + (i.confirmedAmount ?? 0), 0),
    approved: invoices.filter(i => i.status === 'approved').reduce((s, i) => s + (i.confirmedAmount ?? 0), 0),
    paid:     invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.confirmedAmount ?? 0), 0),
  };

  return (
    <div style={{ padding: '0 0 40px' }}>
      <h1 style={{ marginTop: 0 }}>Accounts Payable</h1>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Pending', value: totals.pending, ...STATUS_COLORS.pending },
          { label: 'Approved', value: totals.approved, ...STATUS_COLORS.approved },
          { label: 'Paid', value: totals.paid, ...STATUS_COLORS.paid },
        ].map(({ label, value, background, color, border }) => (
          <div key={label} className="card" style={{ padding: 16, background, border }}>
            <div style={{ fontSize: 12, color, fontWeight: 600, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color }}>${value.toFixed(2)}</div>
          </div>
        ))}
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
                {['Received', 'From', 'Subject', 'Supplier', 'Amount', 'Dept', 'Status', 'PDF', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => (
                <tr key={inv.id} style={{ borderBottom: '1px solid #f5f5f5', cursor: 'pointer' }} onClick={() => setSelected(inv)}>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontSize: 13 }}>
                    {inv.receivedAt ? new Date(inv.receivedAt).toLocaleDateString() : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 13, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {inv.fromEmail || '—'}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 13, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {inv.subject || '—'}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {inv.supplier || <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>Not entered</span>}
                  </td>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                    {inv.confirmedAmount != null ? `$${Number(inv.confirmedAmount).toFixed(2)}` : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {inv.department || <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 12px' }}><StatusBadge status={inv.status || 'pending'} /></td>
                  <td style={{ padding: '10px 12px' }}>
                    {inv.storagePath ? (
                      <span style={{ color: '#22c55e', fontSize: 16 }} title="PDF attached">���</span>
                    ) : (
                      <span style={{ color: '#aaa', fontSize: 12 }} title="No PDF">—</span>
                    )}
                  </td>
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
