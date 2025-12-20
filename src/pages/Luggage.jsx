import React, { useState } from 'react';

export default function Luggage() {
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ marginBottom: 8 }}>Luggage Storage</h1>
        <p style={{ color: '#666', margin: 0 }}>Manage guest luggage storage and retrieval</p>
      </div>

      <section className="card pad" style={{ marginBottom: 24 }}>
        <h2 style={{ marginTop: 0 }}>Coming Soon</h2>
        <p>The luggage storage management system is under development.</p>
        <p>Features will include:</p>
        <ul>
          <li>Check-in luggage items with photos</li>
          <li>Track storage locations</li>
          <li>Request and deliver luggage to guests</li>
          <li>Storage duration tracking</li>
          <li>Guest notification system</li>
        </ul>
      </section>
    </div>
  );
}
