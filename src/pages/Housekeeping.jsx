import React from 'react';
import { Link } from 'react-router-dom';

export default function Housekeeping() {
  return (
    <section className="card pad" style={{ maxWidth: 920, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: 8 }}>Housekeeping</h1>
          <p style={{ margin: 0, color: '#5f6368' }}>
            Housekeeping tools and quick links.
          </p>
        </div>
        <Link to="/room-status" className="btn" style={{ textDecoration: 'none' }}>
          Open Room Status
        </Link>
      </div>

      <div
        style={{
          marginTop: 20,
          border: '1px solid #e4e7ec',
          borderRadius: 10,
          padding: 16,
          background: '#fafbfc',
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 10, fontSize: 18 }}>Available</h2>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>Room status live view</li>
          <li>Navigation entry point for future housekeeping modules</li>
        </ul>
      </div>
    </section>
  );
}
