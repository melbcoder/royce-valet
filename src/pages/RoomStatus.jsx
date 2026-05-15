import React, { useEffect, useMemo, useState } from 'react';
import { subscribeRoomStatus } from '../services/valetFirestore';

const STATUS_META = {
  clean: { label: 'Clean', color: '#2e7d32', bg: '#e8f5e9' },
  dirty: { label: 'Dirty', color: '#c62828', bg: '#ffebee' },
  occupied: { label: 'Occupied', color: '#ef6c00', bg: '#fff3e0' },
  maintenance: { label: 'Maintenance', color: '#6a1b9a', bg: '#f3e5f5' },
  unknown: { label: 'Unknown', color: '#455a64', bg: '#eceff1' },
};

function formatTimestamp(value) {
  if (!value) return 'N/A';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return 'N/A';
  return dt.toLocaleString();
}

function getStatusMeta(status) {
  return STATUS_META[status] || STATUS_META.unknown;
}

function normalizeRoomSortKey(roomNo) {
  return String(roomNo || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export default function RoomStatus() {
  const [roomMap, setRoomMap] = useState({});
  const [statusFilter, setStatusFilter] = useState('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const unsubscribe = subscribeRoomStatus((map) => {
      setRoomMap(map || {});
    });
    return () => unsubscribe && unsubscribe();
  }, []);

  const rooms = useMemo(() => {
    return Object.entries(roomMap || {})
      .map(([docId, item]) => ({
        roomNo: String(item.roomNo || docId || '').trim(),
        status: String(item.status || 'unknown').toLowerCase(),
        rawStatus: String(item.rawStatus || ''),
        updatedAt: item.updatedAt || '',
      }))
      .filter((item) => item.roomNo)
      .sort((a, b) => normalizeRoomSortKey(a.roomNo).localeCompare(normalizeRoomSortKey(b.roomNo), undefined, { numeric: true }));
  }, [roomMap]);

  const counts = useMemo(() => {
    const out = { all: rooms.length, clean: 0, dirty: 0, occupied: 0, maintenance: 0, unknown: 0 };
    rooms.forEach((room) => {
      const key = STATUS_META[room.status] ? room.status : 'unknown';
      out[key] += 1;
    });
    return out;
  }, [rooms]);

  const filteredRooms = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return rooms.filter((room) => {
      if (statusFilter !== 'all' && room.status !== statusFilter) return false;
      if (!normalizedQuery) return true;

      return (
        room.roomNo.toLowerCase().includes(normalizedQuery)
        || room.status.toLowerCase().includes(normalizedQuery)
        || room.rawStatus.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [rooms, query, statusFilter]);

  return (
    <div className="page pad">
      <div className="row space-between" style={{ marginBottom: 16, alignItems: 'flex-end' }}>
        <div>
          <h2 style={{ marginBottom: 6 }}>Room Status</h2>
          <div style={{ fontSize: 13, opacity: 0.7 }}>
            Live status database fed by the hotel room-status CSV email.
          </div>
        </div>
      </div>

      <section className="card pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>All Rooms</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{counts.all}</div>
          </div>
          {['clean', 'occupied', 'dirty', 'maintenance', 'unknown'].map((key) => {
            const meta = getStatusMeta(key);
            return (
              <div key={key} style={{ border: `1px solid ${meta.color}33`, background: meta.bg, borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 12, color: meta.color }}>{meta.label}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: meta.color }}>{counts[key]}</div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 10 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search room, status, or raw status"
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="clean">Clean</option>
            <option value="occupied">Occupied</option>
            <option value="dirty">Dirty</option>
            <option value="maintenance">Maintenance</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
      </section>

      <section className="card pad">
        <h3 style={{ marginTop: 0 }}>Rooms ({filteredRooms.length})</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Room</th>
                <th>Status</th>
                <th>Raw Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {filteredRooms.length === 0 && (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', opacity: 0.7 }}>
                    No room status rows found.
                  </td>
                </tr>
              )}
              {filteredRooms.map((room) => {
                const meta = getStatusMeta(room.status);
                return (
                  <tr key={room.roomNo}>
                    <td style={{ fontWeight: 600 }}>{room.roomNo}</td>
                    <td>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          background: meta.bg,
                          color: meta.color,
                          border: `1px solid ${meta.color}44`,
                          borderRadius: 999,
                          padding: '3px 10px',
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: meta.color,
                            display: 'inline-block',
                          }}
                        />
                        {meta.label}
                      </span>
                    </td>
                    <td>{room.rawStatus || 'N/A'}</td>
                    <td>{formatTimestamp(room.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
