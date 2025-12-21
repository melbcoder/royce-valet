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
  const [notifyModalOpen, setNotifyModalOpen] = useState(false);
  const [itemToNotify, setItemToNotify] = useState(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null);
  
  const [newLuggage, setNewLuggage] = useState({
    tags: '',
    guestName: '',
    roomNumber: '',
    phone: '',
    numberOfBags: '',
    notes: '',
  });

  const [errors, setErrors] = useState({});

  // Subscribe to active luggage
  useEffect(() => {
    const unsubscribe = subscribeActiveLuggage((list) => {
      const sorted = [...list].sort((a, b) => String(a.guestName).localeCompare(String(b.guestName)));
      setLuggageItems(sorted);
    });
    return () => unsubscribe && unsubscribe();
  }, []);

  // Auto-delete all luggage at midnight
  useEffect(() => {
    let currentDate = new Date().toDateString();
    
    const checkMidnight = setInterval(async () => {
      const newDate = new Date().toDateString();
      
      // If the date has changed, delete all luggage
      if (newDate !== currentDate) {
        console.log('New day detected, deleting all luggage items...');
        
        // Delete all luggage items
        const deletePromises = luggageItems.map(item => deleteLuggage(item.id));
        await Promise.all(deletePromises);
        
        currentDate = newDate;
        showToast('New day - all luggage records cleared.');
      }
    }, 60000); // Check every minute
    
    return () => clearInterval(checkMidnight);
  }, [luggageItems]);

  const handleCreate = async () => {
    console.log('handleCreate called', newLuggage);
    
    const validationErrors = {
      tags: !String(newLuggage.tags).trim(),
      guestName: !String(newLuggage.guestName).trim(),
      roomNumber: !String(newLuggage.roomNumber).trim(),
      phone: !String(newLuggage.phone).trim(),
    };

    setErrors(validationErrors);

    if (Object.values(validationErrors).some(e => e)) {
      console.log('Validation failed', validationErrors);
      return;
    }

    try {
      // Split tags by comma and trim whitespace
      const tagsArray = newLuggage.tags.split(',').map(tag => tag.trim()).filter(tag => tag);
      console.log('Creating luggage with tags:', tagsArray);

      await createLuggage({
        ...newLuggage,
        tags: tagsArray,
        numberOfBags: parseInt(newLuggage.numberOfBags) || tagsArray.length,
      });

      setNewLuggage({
        tags: '',
        guestName: '',
        roomNumber: '',
        phone: '',
        numberOfBags: '',
        notes: '',
      });
      setErrors({});
      setNewOpen(false);
      showToast('Luggage item created.');
    } catch (error) {
      console.error('Error creating luggage:', error);
      showToast('Error creating luggage item: ' + error.message);
    }
  };

  const openEdit = (item) => {
    setEditingItem(item);
    setEditOpen(true);
  };

  const handleUpdate = async (field, value) => {
    await updateLuggage(editingItem.id, { [field]: value });
    showToast('Luggage updated.');
  };

  const handleDeliver = async (item) => {
    await markLuggageDelivered(item.id);
    
    // Show modal to ask if user wants to notify the guest
    setItemToNotify(item);
    setNotifyModalOpen(true);
  };

  const confirmNotification = async () => {
    if (itemToNotify) {
      try {
        await sendRoomReadySMS(itemToNotify.phone, itemToNotify.roomNumber);
        await updateLuggage(itemToNotify.id, { notified: true });
        showToast('Luggage delivered and guest notified via SMS.');
      } catch (error) {
        console.error('Failed to send SMS:', error);
        await updateLuggage(itemToNotify.id, { notified: false });
        showToast('Luggage delivered (SMS notification failed to send).');
      }
    }
    setNotifyModalOpen(false);
    setItemToNotify(null);
  };

  const declineNotification = async () => {
    if (itemToNotify) {
      await updateLuggage(itemToNotify.id, { notified: false });
      showToast('Luggage delivered (no notification sent).');
    }
    setNotifyModalOpen(false);
    setItemToNotify(null);
  };

  const handleNotify = async (item) => {
    try {
      await sendRoomReadySMS(item.phone, item.roomNumber);
      await updateLuggage(item.id, { notified: true });
      showToast('Guest notified via SMS.');
    } catch (error) {
      console.error('Failed to send SMS:', error);
      showToast('Failed to send SMS notification.');
    }
  };

  const handleDelete = (id) => {
    setItemToDelete(id);
    setDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (itemToDelete) {
      await deleteLuggage(itemToDelete);
      showToast('Luggage item deleted.');
    }
    setDeleteModalOpen(false);
    setItemToDelete(null);
  };

  const cancelDelete = () => {
    setDeleteModalOpen(false);
    setItemToDelete(null);
  };

  const storedItems = luggageItems.filter(item => item.status === 'stored');
  const deliveredItems = luggageItems.filter(item => item.status === 'delivered');

  return (
    <div className="page pad">
      {/* Header */}
      <div className="row space-between" style={{ marginBottom: 16 }}>
        <h2>Luggage Storage</h2>
        <button className="btn primary" onClick={() => setNewOpen(true)} style={{ marginLeft: 'auto' }}>
          Add Luggage
        </button>
      </div>

      {/* Stored Luggage */}
      <section className="card pad" style={{ marginBottom: 16 }}>
        <h3>In Storage ({storedItems.length})</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tags</th>
                <th>Guest Name</th>
                <th>Room</th>
                <th>Phone</th>
                <th>Bags</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {storedItems.length === 0 && (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', opacity: 0.7 }}>
                    No luggage in storage
                  </td>
                </tr>
              )}
              {storedItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.tags?.join(', ') || '—'}</td>
                  <td>{item.guestName}</td>
                  <td>{item.roomNumber}</td>
                  <td>{item.phone}</td>
                  <td>{item.numberOfBags}</td>
                  <td>{item.notes || '—'}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn secondary" onClick={() => openEdit(item)}>
                      <img src="/edit.png" alt="Edit" style={{ width: 20, height: 20 }} />
                    </button>
                    <button className="btn secondary" onClick={() => handleDeliver(item)}>
                      <img src="/tick.png" alt="Deliver" style={{ width: 20, height: 20 }} />
                    </button>
                    <button className="btn secondary" onClick={() => handleDelete(item.id)}>
                      <img src="/bin.png" alt="Delete" style={{ width: 20, height: 20 }} />
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
                <th>Tags</th>
                <th>Guest Name</th>
                <th>Room</th>
                <th>Bags</th>
                <th>Delivered At</th>
                <th>Notified</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {deliveredItems.length === 0 && (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', opacity: 0.7 }}>
                    No luggage delivered today
                  </td>
                </tr>
              )}
              {deliveredItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.tags?.join(', ') || '—'}</td>
                  <td>{item.guestName}</td>
                  <td>{item.roomNumber}</td>
                  <td>{item.numberOfBags}</td>
                  <td>{item.deliveredAt ? new Date(item.deliveredAt.seconds * 1000).toLocaleString() : '—'}</td>
                  <td>{item.notified ? 'Yes' : 'No'}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    {!item.notified && (
                      <button className="btn secondary" onClick={() => handleNotify(item)}>
                        <img src="/chat.png" alt="Notify" style={{ width: 20, height: 20 }} />
                      </button>
                    )}
                    <button className="btn secondary" onClick={() => handleDelete(item.id)}>
                      <img src="/bin.png" alt="Delete" style={{ width: 20, height: 20 }} />
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
              placeholder="Tag Numbers (required, comma-separated)"
              value={newLuggage.tags}
              onChange={(e) => {
                setNewLuggage({ ...newLuggage, tags: e.target.value });
                if (errors.tags) setErrors({ ...errors, tags: false });
              }}
              style={{ width: '100%', borderColor: errors.tags ? '#ff4444' : undefined }}
            />
            {errors.tags && <div style={{ color: '#ff4444', fontSize: '12px', marginTop: '4px' }}>*required</div>}
            <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
              Enter multiple tag numbers separated by commas
            </div>
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
              placeholder="Phone (required, format: +61400000000)"
              value={newLuggage.phone}
              onChange={(e) => {
                setNewLuggage({ ...newLuggage, phone: e.target.value });
                if (errors.phone) setErrors({ ...errors, phone: false });
              }}
              style={{ width: '100%', borderColor: errors.phone ? '#ff4444' : undefined }}
            />
            {errors.phone && <div style={{ color: '#ff4444', fontSize: '12px', marginTop: '4px' }}>*required</div>}
          </div>

          <input
            type="number"
            placeholder="Number of Bags (optional)"
            value={newLuggage.numberOfBags}
            onChange={(e) => setNewLuggage({ ...newLuggage, numberOfBags: e.target.value })}
            style={{ width: '100%' }}
            min="0"
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
              <label style={{ fontSize: 12, opacity: 0.7, marginBottom: 4, display: 'block' }}>Tag Numbers (comma-separated)</label>
              <input
                defaultValue={editingItem.tags?.join(', ') || ''}
                onBlur={(e) => {
                  const tagsArray = e.target.value.split(',').map(tag => tag.trim()).filter(tag => tag);
                  handleUpdate('tags', tagsArray);
                }}
                style={{ width: '100%' }}
                placeholder="101, 102, 103"
              />
            </div>

            <div>
              <label style={{ fontSize: 12, opacity: 0.7, marginBottom: 4, display: 'block' }}>Room Number</label>
              <input
                defaultValue={editingItem.roomNumber}
                onBlur={(e) => handleUpdate('roomNumber', e.target.value)}
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

      {/* Notification Confirmation Modal */}
      <Modal open={notifyModalOpen} onClose={() => setNotifyModalOpen(false)} title="Send SMS Notification">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ marginBottom: 16 }}>
            Would you like to send an SMS notification to the guest that their room is ready?
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn primary" onClick={confirmNotification}>
              Yes, Send SMS
            </button>
            <button className="btn secondary" onClick={declineNotification}>
              No
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal open={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} title="Confirm Delete">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ marginBottom: 16 }}>
            Are you sure you want to delete this luggage item? This action cannot be undone.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn primary" onClick={confirmDelete}>
              Yes, Delete
            </button>
            <button className="btn secondary" onClick={cancelDelete}>
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

