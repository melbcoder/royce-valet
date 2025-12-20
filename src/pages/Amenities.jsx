import React, { useState } from 'react';

export default function Amenities() {
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ marginBottom: 8 }}>Amenities & Services</h1>
        <p style={{ color: '#666', margin: 0 }}>Manage guest amenity requests and concierge services</p>
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
