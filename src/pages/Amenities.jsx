import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Amenities() {
  const navigate = useNavigate();

  return (
    <div className="page pad">
      <div className="row space-between" style={{ marginBottom: 16 }}>
        <h2>Amenities</h2>
        <button className="btn secondary" onClick={() => navigate('/amenities-history')} style={{ marginLeft: 'auto' }}>
          View History
        </button>
      </div>

      <section className="card pad" style={{ marginBottom: 16 }}>
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
