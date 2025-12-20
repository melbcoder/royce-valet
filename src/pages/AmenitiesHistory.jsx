import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function AmenitiesHistory() {
  const navigate = useNavigate();

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ marginBottom: 8 }}>Amenities History</h1>
          <p style={{ color: '#666', margin: 0 }}>View past amenity requests and concierge services</p>
        </div>
        <button className="btn secondary" onClick={() => navigate('/amenities')}>
          Back to Amenities
        </button>
      </div>

      <section className="card pad">
        <h2 style={{ marginTop: 0 }}>No History Yet</h2>
        <p>Amenity and service request history will appear here once you start managing requests.</p>
        <p>History will include:</p>
        <ul>
          <li>Completed service requests</li>
          <li>Guest satisfaction ratings</li>
          <li>Service completion times</li>
          <li>Special requests and notes</li>
          <li>Staff assignments</li>
        </ul>
      </section>
    </div>
  );
}
