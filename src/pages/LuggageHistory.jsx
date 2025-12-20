import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function LuggageHistory() {
  const navigate = useNavigate();

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ marginBottom: 8 }}>Luggage History</h1>
          <p style={{ color: '#666', margin: 0 }}>View past luggage storage and retrieval records</p>
        </div>
        <button className="btn secondary" onClick={() => navigate('/luggage')}>
          Back to Luggage
        </button>
      </div>

      <section className="card pad">
        <h2 style={{ marginTop: 0 }}>No History Yet</h2>
        <p>Luggage history will appear here once you start managing luggage items.</p>
        <p>History will include:</p>
        <ul>
          <li>Stored luggage items</li>
          <li>Retrieval dates and times</li>
          <li>Guest information</li>
          <li>Storage duration</li>
          <li>Staff who handled each item</li>
        </ul>
      </section>
    </div>
  );
}
