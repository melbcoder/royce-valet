import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createLuggage,
  subscribeActiveLuggage,
  updateLuggage,
  markLuggageDelivered,
  deleteLuggage,
} from '../services/valetFirestore';
import { sendRoomReadySMS } from '../services/smsService';
import { showToast } from '../components/Toast';
import Modal from '../components/Modal';

export default function Luggage() {
  const navigate = useNavigate();
  const [luggageItems, setLuggageItems] = useState([]);
  const [newOpen, setNewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  
  const [newLuggage, setNewLuggage] = useState({
    tag: '',
    guestName: '',
    roomNumber: '',
    phone: '',
    arrivalDate: '',
    numberOfBags: '',
    location: '',
    notes: '',
  });

  const [errors, setErrors] = useState({});

  // Subscribe to active luggage
  useEffect(() => {
    const unsubscribe = subscribeActiveLuggage((list) => {
      const sorted = [...list].sort((a, b) => String(a.tag).localeCompare(String(b.tag)));
      setLuggageItems(sorted);
    });
    return () => unsubscribe && unsubscribe();
  }, []);

  const handleCreate = async () => {
    const validationErrors = {
      tag: !String(newLuggage.tag).trim(),
      guestName: !String(newLuggage.guestName).trim(),
      roomNumber: !String(newLuggage.roomNumber).trim(),
      phone: !String(newLuggage.phone).trim(),
      arrivalDate: !String(newLuggage.arrivalDate).trim(),
    };

    setErrors(validationErrors);

    if (Object.values(validationErrors).some(e => e)) {
      return;
    }

    await createLuggage({
      ...newLuggage,
      numberOfBags: parseInt(newLuggage.numberOfBags) || 0,
    });

    setNewLuggage({
      tag: '',
      guestName: '',
      roomNumber: '',
      phone: '',
      arrivalDate: '',
      numberOfBags: '',
      location: '',
      notes: '',
    });
    setErrors({});
    setNewOpen(false);
    showToast('Luggage item created.');
  };

  const openEdit = (item) => {
    setEditingItem(item);
    setEditOpen(true);
  };

  const handleUpdate = async (field, value) => {
    await updateLuggage(editingItem.tag, { [field]: value });
    showToast('Luggage updated.');
  };

  const handleDeliver = async (item) => {
    await markLuggageDelivered(item.tag);
    
    // Send SMS notification
    try {
      await sendRoomReadySMS(item.phone, item.roomNumber);
      showToast('Luggage delivered and guest notified via SMS.');
    } catch (error) {
      console.error('Failed to send SMS:', error);
      showToast('Luggage delivered (SMS failed to send).');
    }
  };

  const handleDelete = async (tag) => {
    if (confirm('Are you sure you want to delete this luggage item?')) {
      await deleteLuggage(tag);
      showToast('Luggage item deleted.');
    }
  };

  const storedItems = luggageItems.filter(item => item.status === 'stored');
  const deliveredItems = luggageItems.filter(item => item.status === 'delivered');

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ marginBottom: 8 }}>Luggage Storage</h1>
          <p style={{ color: '#666', margin: 0 }}>Manage guest luggage storage and delivery</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn secondary" onClick={() => navigate('/luggage-history')}>
            View History
          </button>
          <button className="btn primary" onClick={() => setNewOpen(true)}>
            Add Luggage
          </button>
        </div>
      </div>

      {/* Stored Luggage */}
      <section className="card pad" style={{ marginBottom: 24 }}>
        <h3>In Storage ({storedItems.length})</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tag</th>
                <th>Guest Name</th>
                <th>Room</th>
                <th>Phone</th>
                <th>Arrival Date</th>
                <th>Bags</th>
                <th>Location</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {storedItems.length === 0 && (
                <tr>
                  <td colSpan="9" style={{ textAlign: 'center', opacity: 0.7 }}>
                    No luggage in storage
                  </td>
                </tr>
              )}
              {storedItems.map((item) => (
                <tr key={item.tag}>
                  <td>#{item.tag}</td>
                  <td>{item.guestName}</td>
                  <td>{item.roomNumber}</td>
                  <td>{item.phone}</td>
                  <td>{item.arrivalDate}</td>
                  <td>{item.numberOfBags}</td>
                  <td>{item.location || '—'}</td>
                  <td>{item.notes || '—'}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn secondary" onClick={() => openEdit(item)}>
                      Edit
                    </button>
                    <button className="btn primary" onClick={() => handleDeliver(item)}>
                      Deliver
                    </button>
                    <button className="btn secondary" onClick={() => handleDelete(item.tag)} style={{ color: '#ff4444' }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Delivered Luggage */}
      <section className="card pad">
        <h3>Delivered Today ({deliveredItems.length})</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tag</th>
                <th>Guest Name</th>
                <th>Room</th>
                <th>Bags</th>
                <th>Delivered At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {deliveredItems.length === 0 && (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', opacity: 0.7 }}>
                    No luggage delivered today
                  </td>
                </tr>
              )}
              {deliveredItems.map((item) => (
                <tr key={item.tag}>
                  <td>#{item.tag}</td>
                  <td>{item.guestName}</td>
                  <td>{item.roomNumber}</td>
                  <td>{item.numberOfBags}</td>
                  <td>{item.deliveredAt ? new Date(item.deliveredAt.seconds * 1000).toLocaleString() : '—'}</td>
                  <td>
                    <button className="btn secondary" onClick={() => handleDelete(item.tag)} style={{ color: '#ff4444' }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Create Modal */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Add Luggage">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <input
              placeholder="Tag Number (required)"
              value={newLuggage.tag}
              onChange={(e) => {
                setNewLuggage({ ...newLuggage, tag: e.target.value });
                if (errors.tag) setErrors({ ...errors, tag: false });
              }}
              style={{ width: '100%', borderColor: errors.tag ? '#ff4444' : undefined }}
            />
            {errors.tag && <div style={{ color: '#ff4444', fontSize: '12px', marginTop: '4px' }}>*required</div>}
          </div>

          <div>
            <input
              placeholder="Guest Name (required)"
              value={newLuggage.guestName}
              onChange={(e) => {
                setNewLuggage({ ...newLuggage, guestName: e.target.value });
                if (errors.guestName) setErrors({ ...errors, guestName: false });
              }}
              style={{ width: '100%', borderColor: errors.guestName ? '#ff4444' : undefined }}
            />
            {errors.guestName && <div style={{ color: '#ff4444', fontSize: '12px', marginTop: '4px' }}>*required</div>}
          </div>

          <div>
            <input
              placeholder="Room Number (required)"
              value={newLuggage.roomNumber}
              onChange={(e) => {
                setNewLuggage({ ...newLuggage, roomNumber: e.target.value });
                if (errors.roomNumber) setErrors({ ...errors, roomNumber: false });
              }}
              style={{ width: '100%', borderColor: errors.roomNumber ? '#ff4444' : undefined }}
            />
            {errors.roomNumber && <div style={{ color: '#ff4444', fontSize: '12px', marginTop: '4px' }}>*required</div>}
          </div>

          <div>
            <input
              placeholder="Phone (required, format: +1234567890)"
              value={newLuggage.phone}
              onChange={(e) => {
                setNewLuggage({ ...newLuggage, phone: e.target.value });
                if (errors.phone) setErrors({ ...errors, phone: false });
              }}
              style={{ width: '100%', borderColor: errors.phone ? '#ff4444' : undefined }}
            />
            {errors.phone && <div style={{ color: '#ff4444', fontSize: '12px', marginTop: '4px' }}>*required</div>}
          </div>

          <div>
            <label style={{ fontSize: 12, opacity: 0.7, marginBottom: 4, display: 'block' }}>
              Arrival Date (required)
            </label>
            <input
              type="date"
              value={newLuggage.arrivalDate}
              onChange={(e) => {
                setNewLuggage({ ...newLuggage, arrivalDate: e.target.value });
                if (errors.arrivalDate) setErrors({ ...errors, arrivalDate: false });
              }}
              style={{ width: '100%', borderColor: errors.arrivalDate ? '#ff4444' : undefined }}
            />
            {errors.arrivalDate && <div style={{ color: '#ff4444', fontSize: '12px', marginTop: '4px' }}>*required</div>}
          </div>

          <input
            type="number"
            placeholder="Number of Bags"
            value={newLuggage.numberOfBags}
            onChange={(e) => setNewLuggage({ ...newLuggage, numberOfBags: e.target.value })}
            style={{ width: '100%' }}
            min="0"
          />

          <input
            placeholder="Storage Location (optional)"
            value={newLuggage.location}
            onChange={(e) => setNewLuggage({ ...newLuggage, location: e.target.value })}
            style={{ width: '100%' }}
          />

          <textarea
            placeholder="Notes (optional)"
            value={newLuggage.notes}
            onChange={(e) => setNewLuggage({ ...newLuggage, notes: e.target.value })}
            style={{ width: '100%', minHeight: 80, fontFamily: 'inherit' }}
          />

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn primary" onClick={handleCreate}>Create</button>
            <button className="btn secondary" onClick={() => setNewOpen(false)}>Cancel</button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      {editingItem && (
        <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Luggage">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, opacity: 0.7, marginBottom: 4, display: 'block' }}>Storage Location</label>
              <input
                defaultValue={editingItem.location}
                onBlur={(e) => handleUpdate('location', e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label style={{ fontSize: 12, opacity: 0.7, marginBottom: 4, display: 'block' }}>Number of Bags</label>
              <input
                type="number"
                defaultValue={editingItem.numberOfBags}
                onBlur={(e) => handleUpdate('numberOfBags', parseInt(e.target.value) || 0)}
                style={{ width: '100%' }}
                min="0"
              />
            </div>

            <div>
              <label style={{ fontSize: 12, opacity: 0.7, marginBottom: 4, display: 'block' }}>Notes</label>
              <textarea
                defaultValue={editingItem.notes}
                onBlur={(e) => handleUpdate('notes', e.target.value)}
                style={{ width: '100%', minHeight: 80, fontFamily: 'inherit' }}
              />
            </div>

            <button className="btn secondary" onClick={() => setEditOpen(false)}>Close</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

