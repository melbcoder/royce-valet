import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Amenities() {
  const navigate = useNavigate();

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ marginBottom: 8 }}>Amenities</h1>
          <p style={{ color: '#666', margin: 0 }}>Manage arrival amenities</p>
        </div>
        <button className="btn secondary" onClick={() => navigate('/amenities-history')}>
          View History
        </button>
      </div>

      <section className="card pad" style={{ marginBottom: 24 }}>
        <h2 style={{ marginTop: 0 }}>Coming Soon</h2>
        <p>The amenities and concierge services system is under development.</p>
        <p>Features will include:</p>
        <ul>
          <li>Room service requests</li>
          <li>Spa and wellness bookings</li>
          <li>Restaurant reservations</li>
          <li>Transportation arrangements</li>
          <li>Special requests and experiences</li>
          <li>Housekeeping services</li>
          <li>Activity and tour bookings</li>
        </ul>
      </section>
    </div>
  );
}
