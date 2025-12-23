import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { subscribeAmenitiesHistory } from '../services/valetFirestore';

export default function AmenitiesHistory() {
  const navigate = useNavigate();
  const [historyItems, setHistoryItems] = useState([]);
  const [filterDate, setFilterDate] = useState('');

  // Subscribe to amenities history
  useEffect(() => {
    const unsubscribe = subscribeAmenitiesHistory((list) => {
      const sorted = [...list].sort((a, b) => {
        const aTime = a.archivedAt?.seconds || 0;
        const bTime = b.archivedAt?.seconds || 0;
        return bTime - aTime; // Most recent first
      });
      setHistoryItems(sorted);
    });
    return () => unsubscribe && unsubscribe();
  }, []);

  // Filter items by date
  const filteredItems = filterDate
    ? historyItems.filter(item => {
        if (!item.archivedAt) return false;
        const itemDate = new Date(item.archivedAt.seconds * 1000).toDateString();
        const filterDateObj = new Date(filterDate).toDateString();
        return itemDate === filterDateObj;
      })
    : historyItems;

  // Get today's items
  const todayItems = historyItems.filter(item => {
    if (!item.archivedAt) return false;
    const itemDate = new Date(item.archivedAt.seconds * 1000).toDateString();
    const today = new Date().toDateString();
    return itemDate === today;
  });

  return (
    <div className="page pad">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ marginBottom: 8 }}>Amenities History</h1>
          <p style={{ color: '#666', margin: 0 }}>View past amenity deliveries</p>
        </div>
        <button className="btn secondary" onClick={() => navigate('/amenities')}>
          Back to Amenities
        </button>
      </div>

      {/* Filter Section */}
      <section className="card pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Filter by date:
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              style={{ padding: '8px 12px' }}
            />
          </label>
          {filterDate && (
            <button className="btn secondary" onClick={() => setFilterDate('')}>
              Clear Filter
            </button>
          )}
          <span style={{ marginLeft: 'auto', color: '#666' }}>
            {filterDate 
              ? `${filteredItems.length} items on ${new Date(filterDate).toLocaleDateString()}`
              : `${todayItems.length} items today | ${historyItems.length} total`
            }
          </span>
        </div>
      </section>

      {/* History Table */}
      <section className="card pad">
        <h3>
          {filterDate 
            ? `Amenities - ${new Date(filterDate).toLocaleDateString()}`
            : 'All Amenities History'
          }
        </h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Description</th>
                <th>Guest Name</th>
                <th>Room</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', opacity: 0.7 }}>
                    {filterDate 
                      ? 'No amenities found for this date'
                      : 'No amenity history yet'
                    }
                  </td>
                </tr>
              )}
              {filteredItems.map((item) => {
                const archivedDate = item.archivedAt 
                  ? new Date(item.archivedAt.seconds * 1000)
                  : null;
                
                return (
                  <tr key={item._id}>
                    <td>
                      {archivedDate 
                        ? archivedDate.toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })
                        : '—'
                      }
                    </td>
                    <td>
                      {archivedDate 
                        ? archivedDate.toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                          })
                        : '—'
                      }
                    </td>
                    <td>{item.description}</td>
                    <td>{item.guestName}</td>
                    <td>{item.roomNumber}</td>
                    <td>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 500,
                        backgroundColor: item.status === 'delivered' ? '#e8f5e9' : '#fff3e0',
                        color: item.status === 'delivered' ? '#2e7d32' : '#e65100'
                      }}>
                        {item.status === 'delivered' ? 'Delivered' : 'Outstanding'}
                      </span>
                    </td>
                    <td>{item.notes || '—'}</td>
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
