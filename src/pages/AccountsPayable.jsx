import React, { useState, useEffect, useRef } from 'react';
import { auth, db } from '../firebase';
import {
  collection, onSnapshot, doc, updateDoc, query, orderBy
} from 'firebase/firestore';

const DEPARTMENTS = ['Reservations', 'Front Office', 'Housekeeping', 'Maintenance', 'F&B', 'Management', 'Other'];
const TYPE_FILTER_OPTIONS = ['supplier', 'commission'];
const STATUS_FILTER_OPTIONS = ['pending', 'approved', 'paid'];
const DEPARTMENT_FILTER_OPTIONS = [...DEPARTMENTS, '__unassigned'];
const TYPE_OPTIONS = [
  { value: 'supplier', label: 'Supplier' },
  { value: 'commission', label: 'Commission' },
];
const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'paid', label: 'Paid' },
];
const DEPARTMENT_OPTIONS = [
  ...DEPARTMENTS.map(value => ({ value, label: value })),
  { value: '__unassigned', label: 'Unassigned' },
];
const STATUS_COLORS = {
  pending:  { background: '#fff8e6', color: '#b45309', border: '1px solid #f0d58a' },
  approved: { background: '#e6f4ea', color: '#166534', border: '1px solid #86efac' },
  paid:     { background: '#e8f0fe', color: '#1e40af', border: '1px solid #93c5fd' },
  rejected: { background: '#fde8e8', color: '#991b1b', border: '1px solid #fca5a5' },
};

/* ── empty row factories ── */
const emptySupplierItem = () => ({
  description: '', quantity: 1, unitPrice: '', total: '', status: 'pending',
});
const emptyCommissionItem = () => ({
  guestName: '', bookingNumber: '', departureDate: '',
  reservationTotal: '', commissionPercent: '', totalCommission: '', status: 'pending',
});

/* ── Supplier line-items table ── */
function SupplierLineItems({ lineItems, setLineItems, inputStyle }) {
  const update = (idx, field, value) => {
    setLineItems(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      if (field === 'quantity' || field === 'unitPrice') {
        const qty = parseFloat(field === 'quantity' ? value : updated[idx].quantity) || 0;
        const price = parseFloat(field === 'unitPrice' ? value : updated[idx].unitPrice) || 0;
        updated[idx].total = qty && price ? (qty * price).toFixed(2) : '';
      }
      return updated;
    });
  };
  const add = () => setLineItems(prev => [...prev, emptySupplierItem()]);
  const remove = idx => setLineItems(prev => prev.length <= 1 ? [emptySupplierItem()] : prev.filter((_, i) => i !== idx));
  const toggleStatus = idx => {
    setLineItems(prev => {
      const updated = [...prev];
      const cur = updated[idx].status || 'pending';
      updated[idx] = { ...updated[idx], status: cur === 'approved' ? 'pending' : 'approved' };
      return updated;
    });
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Line Items</h3>
        <button className="btn secondary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={add}>+ Add Item</button>
      </div>
      <div style={{ border: '1px solid #eee', borderRadius: 6, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9f9f9', borderBottom: '1px solid #eee' }}>
              <th style={{ textAlign: 'left', padding: '8px', fontWeight: 600 }}>Description</th>
              <th style={{ textAlign: 'right', padding: '8px', fontWeight: 600, width: 70 }}>Qty</th>
              <th style={{ textAlign: 'right', padding: '8px', fontWeight: 600, width: 100 }}>Unit Price</th>
              <th style={{ textAlign: 'right', padding: '8px', fontWeight: 600, width: 100 }}>Total</th>
              <th style={{ textAlign: 'center', padding: '8px', fontWeight: 600, width: 90 }}>Approve</th>
              <th style={{ width: 36, padding: '8px' }}></th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((item, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid #f5f5f5' }}>
                <td style={{ padding: 4 }}>
                  <input value={item.description} onChange={e => update(idx, 'description', e.target.value)}
                    placeholder="Item description" style={{ ...inputStyle, padding: '6px 8px' }} />
                </td>
                <td style={{ padding: 4 }}>
                  <input type="number" min="0" value={item.quantity}
                    onChange={e => update(idx, 'quantity', e.target.value)}
                    style={{ ...inputStyle, padding: '6px 8px', textAlign: 'right' }} />
                </td>
                <td style={{ padding: 4 }}>
                  <input type="number" min="0" step="0.01" value={item.unitPrice}
                    onChange={e => update(idx, 'unitPrice', e.target.value)} placeholder="0.00"
                    style={{ ...inputStyle, padding: '6px 8px', textAlign: 'right' }} />
                </td>
                <td style={{ padding: 4 }}>
                  <input type="number" min="0" step="0.01" value={item.total}
                    onChange={e => update(idx, 'total', e.target.value)} placeholder="0.00"
                    style={{ ...inputStyle, padding: '6px 8px', textAlign: 'right' }} />
                </td>
                <td style={{ padding: 4, textAlign: 'center' }}>
                  <button onClick={() => toggleStatus(idx)}
                    style={{ border: 'none', borderRadius: 9999, padding: '2px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      background: item.status === 'approved' ? '#e6f4ea' : '#fff8e6',
                      color: item.status === 'approved' ? '#166534' : '#b45309',
                    }}>
                    {item.status === 'approved' ? '✓ Approved' : 'Pending'}
                  </button>
                </td>
                <td style={{ padding: 4, textAlign: 'center' }}>
                  <button onClick={() => remove(idx)}
                    style={{ background: 'none', border: 'none', color: '#991b1b', cursor: 'pointer', fontSize: 16, padding: '2px 6px' }}
                    title="Remove item">×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ── Commission line-items table ── */
function CommissionLineItems({ lineItems, setLineItems, inputStyle }) {
  const update = (idx, field, value) => {
    setLineItems(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      if (field === 'reservationTotal' || field === 'commissionPercent') {
        const resTotal = parseFloat(field === 'reservationTotal' ? value : updated[idx].reservationTotal) || 0;
        const pct = parseFloat(field === 'commissionPercent' ? value : updated[idx].commissionPercent) || 0;
        updated[idx].totalCommission = resTotal && pct ? ((resTotal * pct) / 100).toFixed(2) : '';
      }
      return updated;
    });
  };
  const add = () => setLineItems(prev => [...prev, emptyCommissionItem()]);
  const remove = idx => setLineItems(prev => prev.length <= 1 ? [emptyCommissionItem()] : prev.filter((_, i) => i !== idx));
  const toggleStatus = idx => {
    setLineItems(prev => {
      const updated = [...prev];
      const cur = updated[idx].status || 'pending';
      updated[idx] = { ...updated[idx], status: cur === 'approved' ? 'pending' : 'approved' };
      return updated;
    });
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Commission Items</h3>
        <button className="btn secondary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={add}>+ Add Item</button>
      </div>
      <div style={{ border: '1px solid #eee', borderRadius: 6, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 750 }}>
          <thead>
            <tr style={{ background: '#f9f9f9', borderBottom: '1px solid #eee' }}>
              <th style={{ textAlign: 'left', padding: '8px', fontWeight: 600 }}>Guest Name</th>
              <th style={{ textAlign: 'left', padding: '8px', fontWeight: 600, width: 110 }}>Booking #</th>
              <th style={{ textAlign: 'center', padding: '8px', fontWeight: 600, width: 110 }}>Departure</th>
              <th style={{ textAlign: 'right', padding: '8px', fontWeight: 600, width: 110 }}>Res. Total</th>
              <th style={{ textAlign: 'right', padding: '8px', fontWeight: 600, width: 70 }}>Comm %</th>
              <th style={{ textAlign: 'right', padding: '8px', fontWeight: 600, width: 100 }}>Commission</th>
              <th style={{ textAlign: 'center', padding: '8px', fontWeight: 600, width: 90 }}>Approve</th>
              <th style={{ width: 36, padding: '8px' }}></th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((item, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid #f5f5f5' }}>
                <td style={{ padding: 4 }}>
                  <input value={item.guestName || ''} onChange={e => update(idx, 'guestName', e.target.value)}
                    placeholder="Guest name" style={{ ...inputStyle, padding: '6px 8px' }} />
                </td>
                <td style={{ padding: 4 }}>
                  <input value={item.bookingNumber || ''} onChange={e => update(idx, 'bookingNumber', e.target.value)}
                    placeholder="BK-001" style={{ ...inputStyle, padding: '6px 8px' }} />
                </td>
                <td style={{ padding: 4 }}>
                  <input type="date" value={item.departureDate || ''} onChange={e => update(idx, 'departureDate', e.target.value)}
                    style={{ ...inputStyle, padding: '6px 8px' }} />
                </td>
                <td style={{ padding: 4 }}>
                  <input type="number" min="0" step="0.01" value={item.reservationTotal || ''}
                    onChange={e => update(idx, 'reservationTotal', e.target.value)} placeholder="0.00"
                    style={{ ...inputStyle, padding: '6px 8px', textAlign: 'right' }} />
                </td>
                <td style={{ padding: 4 }}>
                  <input type="number" min="0" max="100" step="0.1" value={item.commissionPercent || ''}
                    onChange={e => update(idx, 'commissionPercent', e.target.value)} placeholder="%"
                    style={{ ...inputStyle, padding: '6px 8px', textAlign: 'right' }} />
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600, fontSize: 13 }}>
                  {item.totalCommission ? `$${Number(item.totalCommission).toFixed(2)}` : '—'}
                </td>
                <td style={{ padding: 4, textAlign: 'center' }}>
                  <button onClick={() => toggleStatus(idx)}
                    style={{ border: 'none', borderRadius: 9999, padding: '2px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      background: item.status === 'approved' ? '#e6f4ea' : '#fff8e6',
                      color: item.status === 'approved' ? '#166534' : '#b45309',
                    }}>
                    {item.status === 'approved' ? '✓ Approved' : 'Pending'}
                  </button>
                </td>
                <td style={{ padding: 4, textAlign: 'center' }}>
                  <button onClick={() => remove(idx)}
                    style={{ background: 'none', border: 'none', color: '#991b1b', cursor: 'pointer', fontSize: 16, padding: '2px 6px' }}
                    title="Remove item">×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FilterDropdown({ label, options, selectedValues, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = event => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggle = value => {
    if (selectedValues.includes(value)) {
      onChange(selectedValues.filter(v => v !== value));
      return;
    }
    onChange([...selectedValues, value]);
  };

  const allValues = options.map(o => o.value);
  const allSelected = selectedValues.length === options.length;
  const selectedLabels = options.filter(o => selectedValues.includes(o.value)).map(o => o.label);

  let summary = `${selectedValues.length} selected`;
  if (allSelected) summary = `All ${label}`;
  if (selectedValues.length === 0) summary = `No ${label.toLowerCase()} selected`;
  if (selectedValues.length > 0 && selectedValues.length <= 2) summary = selectedLabels.join(', ');

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          padding: '8px 12px',
          minWidth: 210,
          textAlign: 'left',
          borderRadius: 8,
          border: '1px solid #ddd',
          background: '#fff',
          color: '#111',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <strong>{label}:</strong> {summary}
        </span>
        <span style={{ color: '#666', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 20,
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,.12)',
            minWidth: 240,
            maxWidth: 280,
            padding: 10,
          }}
        >
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button
              type="button"
              style={{
                padding: '4px 8px',
                fontSize: 12,
                border: '1px solid #ddd',
                background: '#fff',
                borderRadius: 6,
                cursor: 'pointer',
              }}
              onClick={() => onChange(allValues)}
            >
              Select all
            </button>
            <button
              type="button"
              style={{
                padding: '4px 8px',
                fontSize: 12,
                border: '1px solid #ddd',
                background: '#fff',
                borderRadius: 6,
                cursor: 'pointer',
              }}
              onClick={() => onChange(allValues)}
            >
              Reset
            </button>
          </div>

          <div style={{ maxHeight: 220, overflowY: 'auto', display: 'grid', gap: 2 }}>
            {options.map(option => (
              <label
                key={option.value}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  textTransform: 'none',
                  letterSpacing: 'normal',
                  color: '#111',
                  padding: '6px 4px',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedValues.includes(option.value)}
                  onChange={() => toggle(option.value)}
                  style={{ margin: 0 }}
                />
                <span style={{ textTransform: 'none', letterSpacing: 'normal' }}>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Invoice Modal ── */
function InvoiceModal({ invoice, onClose, onSave, onDelete }) {
  const [invoiceType, setInvoiceType] = useState(invoice.invoiceType || 'supplier');
  const [supplier, setSupplier] = useState(invoice.supplier || '');
  const [invoiceNumber, setInvoiceNumber] = useState(invoice.invoiceNumber || '');
  const [invoiceDate, setInvoiceDate] = useState(invoice.invoiceDate || '');
  const [dept, setDept] = useState(invoice.department || ((invoice.invoiceType || 'supplier') === 'commission' ? 'Reservations' : ''));
  const [paidDate, setPaidDate] = useState(invoice.paidDate || '');
  const [notes, setNotes] = useState(invoice.notes || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [supplierItems, setSupplierItems] = useState(
    invoice.invoiceType !== 'commission' && invoice.lineItems?.length
      ? invoice.lineItems : [emptySupplierItem()]
  );
  const [commissionItems, setCommissionItems] = useState(
    invoice.invoiceType === 'commission' && invoice.lineItems?.length
      ? invoice.lineItems : [emptyCommissionItem()]
  );

  const activeItems = invoiceType === 'commission' ? commissionItems : supplierItems;

  const invoiceTotal = invoiceType === 'commission'
    ? commissionItems.reduce((s, i) => s + (parseFloat(i.totalCommission) || 0), 0)
    : supplierItems.reduce((s, i) => s + (parseFloat(i.total) || 0), 0);

  const filledItems = invoiceType === 'commission'
    ? activeItems.filter(i => (i.guestName || '').trim())
    : activeItems.filter(i => (i.description || '').trim());
  const approvedCount = filledItems.filter(i => i.status === 'approved').length;
  const totalItems = filledItems.length;

  const handleSave = async () => {
    setSaving(true);
    let cleanedItems;
    if (invoiceType === 'commission') {
      cleanedItems = commissionItems
        .filter(i => (i.guestName || '').trim())
        .map(i => ({
          guestName: i.guestName,
          bookingNumber: i.bookingNumber || '',
          departureDate: i.departureDate || '',
          reservationTotal: parseFloat(i.reservationTotal) || 0,
          commissionPercent: parseFloat(i.commissionPercent) || 0,
          totalCommission: parseFloat(i.totalCommission) || 0,
          status: i.status || 'pending',
        }));
    } else {
      cleanedItems = supplierItems
        .filter(i => (i.description || '').trim())
        .map(i => ({
          description: i.description,
          quantity: parseFloat(i.quantity) || 0,
          unitPrice: parseFloat(i.unitPrice) || 0,
          total: parseFloat(i.total) || 0,
          status: i.status || 'pending',
        }));
    }
    await onSave(invoice.id, {
      invoiceType,
      supplier,
      invoiceNumber,
      invoiceDate,
      department: dept,
      confirmedAmount: invoiceTotal || null,
      paidDate,
      notes,
      lineItems: cleanedItems,
    });
    setSaving(false);
    onClose();
  };

  const handleDelete = async () => {
    const ok = window.confirm('Delete this invoice permanently? This cannot be undone.');
    if (!ok) return;
    try {
      setDeleting(true);
      await onDelete(invoice.id);
      onClose();
    } catch (err) {
      alert(err?.message || 'Failed to delete invoice');
    } finally {
      setDeleting(false);
    }
  };

  const fieldLabel = { fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 };
  const inputStyle = { width: '100%', padding: '8px', borderRadius: 6, border: '1px solid #ddd', boxSizing: 'border-box' };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
      onClick={onClose}
    >
      <div className="card pad" style={{ width: 'min(1100px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>
            {invoice.invoiceNumber ? `Invoice: ${invoice.invoiceNumber}` : 'Review Invoice'}
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
              <a href={`/api/pdf-link?id=${encodeURIComponent(invoice.id)}`} target="_blank" rel="noreferrer"
                style={{ fontSize: 13, color: '#1e40af' }}>Open in new tab ↗</a>
            </div>
            <iframe src={`/api/pdf-link?id=${encodeURIComponent(invoice.id)}`} title="Invoice PDF"
              style={{ width: '100%', height: 400, border: '1px solid #ddd', borderRadius: 6, background: '#f5f5f5' }} />
          </div>
        ) : (
          <div style={{ marginBottom: 16, padding: 16, background: '#fff8e6', border: '1px solid #f0d58a', borderRadius: 6, fontSize: 13, color: '#b45309' }}>
            No PDF attachment was found in the received email.
          </div>
        )}

        {/* Invoice type toggle */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[{ value: 'supplier', label: 'Supplier Invoice' }, { value: 'commission', label: 'Commission Invoice' }].map(t => (
            <button key={t.value} className={`btn ${invoiceType === t.value ? '' : 'secondary'}`}
              style={{ padding: '6px 16px', fontSize: 13 }}
              onClick={() => {
                setInvoiceType(t.value);
                if (t.value === 'commission' && !dept) setDept('Reservations');
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Invoice details */}
        <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Invoice Details</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
          <div>
            <label style={fieldLabel}>{invoiceType === 'commission' ? 'Travel Agent' : 'Supplier'}</label>
            <input value={supplier} onChange={e => setSupplier(e.target.value)}
              placeholder={invoiceType === 'commission' ? 'Travel agent name' : 'Company name'} style={inputStyle} />
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
            <label style={fieldLabel}>Date Paid</label>
            <input type="date" value={paidDate} onChange={e => setPaidDate(e.target.value)} style={inputStyle} />
          </div>
        </div>

        {/* Line items - type-specific */}
        <div style={{ marginBottom: 20 }}>
          {invoiceType === 'commission'
            ? <CommissionLineItems lineItems={commissionItems} setLineItems={setCommissionItems} inputStyle={inputStyle} />
            : <SupplierLineItems lineItems={supplierItems} setLineItems={setSupplierItems} inputStyle={inputStyle} />
          }

          {/* Totals bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, padding: '8px 12px', background: '#f9f9f9', borderRadius: 6, border: '1px solid #eee' }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>
              {totalItems > 0 && `${approvedCount} of ${totalItems} items approved`}
            </span>
            <strong style={{ fontSize: 15 }}>Invoice Total: ${invoiceTotal.toFixed(2)}</strong>
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 20 }}>
          <label style={fieldLabel}>Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Add any notes about this invoice…"
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            className="btn secondary"
            onClick={handleDelete}
            disabled={deleting || saving}
            style={{ color: '#991b1b', borderColor: '#fca5a5' }}
          >
            {deleting ? 'Deleting…' : 'Delete Invoice'}
          </button>
          <button className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Main page ── */
export default function AccountsPayable() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [filterStatuses, setFilterStatuses] = useState(STATUS_FILTER_OPTIONS);
  const [filterDepts, setFilterDepts] = useState(DEPARTMENT_FILTER_OPTIONS);
  const [filterTypes, setFilterTypes] = useState(TYPE_FILTER_OPTIONS);

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

  const handleDelete = async id => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Not authenticated');

    const idToken = await currentUser.getIdToken();
    const res = await fetch('/api/delete-invoice', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ id }),
    });

    let payload = {};
    try {
      payload = await res.json();
    } catch {
      payload = {};
    }

    if (!res.ok) {
      throw new Error(payload.error || payload.detail || 'Failed to delete invoice');
    }
  };

  const getInvoiceStatus = inv => {
    if (inv.paidDate) return 'paid';
    const items = inv.lineItems || [];
    if (items.length > 0 && items.every(i => i.status === 'approved')) return 'approved';
    return 'pending';
  };

  const filtered = invoices.filter(inv => {
    const type = inv.invoiceType || 'supplier';
    const status = getInvoiceStatus(inv);
    const dept = inv.department || '__unassigned';

    if (!filterTypes.includes(type)) return false;
    if (!filterStatuses.includes(status)) return false;
    if (!filterDepts.includes(dept)) return false;
    return true;
  });

  const totals = {
    pending:  invoices.filter(i => !(i.lineItems || []).every(li => li.status === 'approved')).reduce((s, i) => s + (i.confirmedAmount ?? 0), 0),
    approved: invoices.filter(i => (i.lineItems || []).length > 0 && (i.lineItems || []).every(li => li.status === 'approved') && !i.paidDate).reduce((s, i) => s + (i.confirmedAmount ?? 0), 0),
    paid:     invoices.filter(i => !!i.paidDate).reduce((s, i) => s + (i.confirmedAmount ?? 0), 0),
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
        <FilterDropdown
          label="Type"
          options={TYPE_OPTIONS}
          selectedValues={filterTypes}
          onChange={setFilterTypes}
        />
        <FilterDropdown
          label="Status"
          options={STATUS_OPTIONS}
          selectedValues={filterStatuses}
          onChange={setFilterStatuses}
        />
        <FilterDropdown
          label="Department"
          options={DEPARTMENT_OPTIONS}
          selectedValues={filterDepts}
          onChange={setFilterDepts}
        />
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
                {['Received', 'Type', 'Supplier', 'Amount', 'Items', 'Dept', 'PDF', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => {
                const items = inv.lineItems || [];
                const approved = items.filter(i => i.status === 'approved').length;
                return (
                  <tr key={inv.id} style={{ borderBottom: '1px solid #f5f5f5', cursor: 'pointer' }} onClick={() => setSelected(inv)}>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontSize: 13 }}>
                      {inv.receivedAt ? new Date(inv.receivedAt).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 12 }}>
                      <span style={{ background: inv.invoiceType === 'commission' ? '#ede9fe' : '#e8f0fe',
                        color: inv.invoiceType === 'commission' ? '#6b21a8' : '#1e40af',
                        borderRadius: 9999, padding: '2px 8px', fontWeight: 600 }}>
                        {inv.invoiceType === 'commission' ? 'Commission' : 'Supplier'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {inv.supplier || <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>Not entered</span>}
                    </td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      {inv.confirmedAmount != null ? `$${Number(inv.confirmedAmount).toFixed(2)}` : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontSize: 12 }}>
                      {items.length > 0 ? (
                        <span style={{ color: approved === items.length ? '#166534' : '#b45309' }}>
                          {approved}/{items.length} approved
                        </span>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {inv.department || <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {inv.storagePath
                        ? <span style={{ color: '#22c55e', fontSize: 16 }} title="PDF attached">���</span>
                        : <span style={{ color: '#aaa', fontSize: 12 }} title="No PDF">—</span>}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn secondary" style={{ padding: '4px 10px', fontSize: 12 }}
                          onClick={e => { e.stopPropagation(); setSelected(inv); }}>Review</button>
                        <button
                          className="btn secondary"
                          style={{ padding: '4px 10px', fontSize: 12, color: '#991b1b', borderColor: '#fca5a5' }}
                          onClick={async e => {
                            e.stopPropagation();
                            const ok = window.confirm('Delete this invoice permanently? This cannot be undone.');
                            if (!ok) return;
                            try {
                              await handleDelete(inv.id);
                              if (selected?.id === inv.id) setSelected(null);
                            } catch (err) {
                              alert(err?.message || 'Failed to delete invoice');
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <InvoiceModal
          invoice={selected}
          onClose={() => setSelected(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
