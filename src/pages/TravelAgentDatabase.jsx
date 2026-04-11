import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, orderBy,
} from 'firebase/firestore';

const emptyAgent = () => ({
  name: '', email: '', iataCode: '', standardCommission: '',
  bankName: '', bankBSB: '', bankAccountNumber: '', bankSwift: '',
});

function AgentModal({ agent, onClose, onSave }) {
  const isNew = !agent?.id;
  const [form, setForm] = useState(isNew ? emptyAgent() : { ...agent });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) { alert('Name is required'); return; }
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = { width: '100%', padding: '8px', borderRadius: 6, border: '1px solid #ddd', boxSizing: 'border-box' };
  const fieldLabel = { fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
      onClick={onClose}
    >
      <div className="card pad" style={{ width: 'min(600px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0 }}>{isNew ? 'Add Travel Agent' : 'Edit Travel Agent'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={fieldLabel}>Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Agency name" style={inputStyle} />
          </div>
          <div>
            <label style={fieldLabel}>Email</label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="invoices@agency.com" style={inputStyle} />
          </div>
          <div>
            <label style={fieldLabel}>IATA Code</label>
            <input value={form.iataCode} onChange={e => set('iataCode', e.target.value)} placeholder="12-345678" style={inputStyle} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={fieldLabel}>Standard Commission %</label>
            <input type="number" min="0" max="100" step="0.1" value={form.standardCommission} onChange={e => set('standardCommission', e.target.value)} placeholder="10" style={{ ...inputStyle, maxWidth: 200 }} />
          </div>

          <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #eee', paddingTop: 12, marginTop: 4 }}>
            <h3 style={{ margin: '0 0 2px', fontSize: 14, color: 'var(--muted)' }}>Bank Details</h3>
          </div>
          <div>
            <label style={fieldLabel}>Bank Name</label>
            <input value={form.bankName} onChange={e => set('bankName', e.target.value)} placeholder="National Australia Bank" style={inputStyle} />
          </div>
          <div>
            <label style={fieldLabel}>BSB</label>
            <input value={form.bankBSB} onChange={e => set('bankBSB', e.target.value)} placeholder="082-001" style={inputStyle} />
          </div>
          <div>
            <label style={fieldLabel}>Account Number</label>
            <input value={form.bankAccountNumber} onChange={e => set('bankAccountNumber', e.target.value)} placeholder="310126258" style={inputStyle} />
          </div>
          <div>
            <label style={fieldLabel}>SWIFT / BIC</label>
            <input value={form.bankSwift} onChange={e => set('bankSwift', e.target.value)} placeholder="NATAAU3302S" style={inputStyle} />
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

export default function TravelAgentDatabase() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'travel_agents'), orderBy('name'));
    const unsub = onSnapshot(q, snap => {
      setAgents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const handleSave = async (form) => {
    const { id, ...data } = form;
    if (id) {
      await updateDoc(doc(db, 'travel_agents', id), { ...data, updatedAt: new Date().toISOString() });
    } else {
      await addDoc(collection(db, 'travel_agents'), { ...data, createdAt: new Date().toISOString() });
    }
  };

  const handleDelete = async (agentId) => {
    const ok = window.confirm('Delete this travel agent? This cannot be undone.');
    if (!ok) return;
    await deleteDoc(doc(db, 'travel_agents', agentId));
  };

  const filtered = agents.filter(a => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (a.name || '').toLowerCase().includes(s)
      || (a.email || '').toLowerCase().includes(s)
      || (a.iataCode || '').toLowerCase().includes(s);
  });

  return (
    <div style={{ padding: '0 0 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Travel Agent Database</h1>
        <button className="btn" onClick={() => setEditing({})}>+ Add Travel Agent</button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email or IATA code…"
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', width: 320, fontSize: 13 }}
        />
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="card pad" style={{ textAlign: 'center', color: 'var(--muted)' }}>
          {search
            ? 'No travel agents match your search.'
            : 'No travel agents yet. Add one manually or they will be created automatically when a commission invoice is received.'}
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #eee' }}>
                {['Name', 'Email', 'IATA Code', 'Std. Commission', 'Bank Details', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(agent => (
                <tr
                  key={agent.id}
                  style={{ borderBottom: '1px solid #f5f5f5', cursor: 'pointer' }}
                  onClick={() => setEditing(agent)}
                >
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>
                    {agent.name}
                    {agent.autoCreated && (
                      <span style={{ marginLeft: 8, fontSize: 11, background: '#fff8e6', color: '#b45309', border: '1px solid #f0d58a', borderRadius: 9999, padding: '1px 6px' }}>
                        Auto-added
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--muted)', fontSize: 13 }}>{agent.email || '—'}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 13 }}>{agent.iataCode || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    {agent.standardCommission != null && agent.standardCommission !== ''
                      ? <span style={{ background: '#e8f0fe', color: '#1e40af', borderRadius: 9999, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>{agent.standardCommission}%</span>
                      : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 13, color: 'var(--muted)' }}>
                    {agent.bankName
                      ? `${agent.bankName}${agent.bankBSB ? ` (${agent.bankBSB})` : ''}`
                      : '—'}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn secondary"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        onClick={e => { e.stopPropagation(); setEditing(agent); }}
                      >
                        Edit
                      </button>
                      <button
                        className="btn secondary"
                        style={{ padding: '4px 10px', fontSize: 12, color: '#991b1b', borderColor: '#fca5a5' }}
                        onClick={e => { e.stopPropagation(); handleDelete(agent.id); }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing !== null && (
        <AgentModal
          agent={editing?.id ? editing : null}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
