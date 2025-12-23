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
import { formatPhoneNumber } from '../utils/phoneFormatter';

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
    tags: [],
    guestName: '',
    roomNumber: '',
    roomStatus: '',
    phone: '',
    numberOfBags: '',
    notes: '',
  });

  const [errors, setErrors] = useState({});
  const [tagInput, setTagInput] = useState('');
  const [editTagInput, setEditTagInput] = useState('');

  // Subscribe to active luggage
  useEffect(() => {
    const unsubscribe = subscribeActiveLuggage((list) => {
      const sorted = [...list].sort((a, b) => String(a.guestName).localeCompare(String(b.guestName)));
      setLuggageItems(sorted);
    });
    return () => unsubscribe && unsubscribe();
  }, []);

  // Auto-delete all luggage at midnight and on page load
  useEffect(() => {
    const deleteAllLuggage = async () => {
      if (luggageItems.length === 0) return;
      
      console.log('Deleting all luggage items...');
      
      // Delete all luggage items
      const deletePromises = luggageItems.map(item => deleteLuggage(item.id));
      await Promise.all(deletePromises);
      
      showToast('All luggage records cleared.');
    };

    // Check if we need to delete on page load
    // This handles the case where the page wasn't open at midnight
    const checkAndDeleteOldLuggage = async () => {
      const lastClearDate = localStorage.getItem('lastLuggageClearDate');
      const today = new Date().toDateString();
      
      if (lastClearDate !== today && luggageItems.length > 0) {
        console.log('New day detected on page load, clearing luggage...');
        await deleteAllLuggage();
        localStorage.setItem('lastLuggageClearDate', today);
      } else if (!lastClearDate) {
        // First time running, set today's date
        localStorage.setItem('lastLuggageClearDate', today);
      }
    };

    checkAndDeleteOldLuggage();

    // Also check every minute for midnight rollover
    let currentDate = new Date().toDateString();
    const checkMidnight = setInterval(async () => {
      const newDate = new Date().toDateString();
      
      if (newDate !== currentDate) {
        console.log('New day detected, deleting all luggage items...');
        await deleteAllLuggage();
        localStorage.setItem('lastLuggageClearDate', newDate);
        currentDate = newDate;
      }
    }, 60000); // Check every minute
    
    return () => clearInterval(checkMidnight);
  }, [luggageItems]);

  const handleCreate = async () => {
    console.log('handleCreate called', newLuggage);
    
    const validationErrors = {
      tags: newLuggage.tags.length === 0,
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
      console.log('Creating luggage with tags:', newLuggage.tags);

      // Format phone number to international format
      const formattedPhone = formatPhoneNumber(newLuggage.phone);

      await createLuggage({
        ...newLuggage,
        phone: formattedPhone,
        numberOfBags: parseInt(newLuggage.numberOfBags) || newLuggage.tags.length,
      });

      setNewLuggage({
        tags: [],
        guestName: '',
        roomNumber: '',
        roomStatus: '',
        phone: '',
        numberOfBags: '',
        notes: '',
      });
      setTagInput('');
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
    setEditTagInput('');
    setEditOpen(true);
  };

  const handleUpdate = async (field, value) => {
    await updateLuggage(editingItem.id, { [field]: value });
    showToast('Luggage updated.');
  };

  const handleDeliver = async (item) => {
    await markLuggageDelivered(item.id);
    
    // If guest was already notified, skip the modal
    if (item.notified) {
      showToast('Luggage delivered (guest already notified).');
      return;
    }
    
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
                <th>Room Status</th>
                <th>Phone</th>
                <th>Bags</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {storedItems.length === 0 && (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', opacity: 0.7 }}>
                    No luggage in storage
                  </td>
                </tr>
              )}
              {storedItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {item.tags?.length > 0 ? item.tags.map((tag, idx) => (
                        <span key={idx} style={{
                          backgroundColor: '#e8f5e9',
                          color: '#2e7d32',
                          padding: '4px 8px',
                          borderRadius: 12,
                          fontSize: 12,
                          fontWeight: 500
                        }}>
                          {tag}
                        </span>
                      )) : '—'}
                    </div>
                  </td>
                  <td>{item.guestName}</td>
                  <td>{item.roomNumber}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        backgroundColor: 
                          item.roomStatus === 'clean' ? '#7fff7f' :
                          item.roomStatus === 'dirty' ? '#ff7f7f' :
                          item.roomStatus === 'occupied' ? '#f4c97a' :
                          '#ddd',
                        display: 'inline-block'
                      }} />
                      <select
                        value={item.roomStatus || ''}
                        onChange={(e) => updateLuggage(item.id, { roomStatus: e.target.value })}
                        style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc' }}
                      >
                        <option value="">Select status</option>
                        <option value="occupied">Occupied</option>
                        <option value="dirty">Dirty</option>
                        <option value="clean">Clean</option>
                      </select>
                    </div>
                  </td>
                  <td>{item.phone}</td>
                  <td>{item.numberOfBags}</td>
                  <td>{item.notes || '—'}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    {!item.notified && (
                      <button className="btn secondary" onClick={() => handleNotify(item)}>
                        <img src="/chat.png" alt="Message" style={{ width: 20, height: 20 }} />
                      </button>
                    )}
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
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {item.tags?.length > 0 ? item.tags.map((tag, idx) => (
                        <span key={idx} style={{
                          backgroundColor: '#e8f5e9',
                          color: '#2e7d32',
                          padding: '4px 8px',
                          borderRadius: 12,
                          fontSize: 12,
                          fontWeight: 500
                        }}>
                          {tag}
                        </span>
                      )) : '—'}
                    </div>
                  </td>
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
            <div style={{ 
              border: `1px solid ${errors.tags ? '#ff4444' : '#ccc'}`, 
              borderRadius: 4, 
              padding: 8, 
              minHeight: 40,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              alignItems: 'center'
            }}>
              {newLuggage.tags.map((tag, index) => (
                <span key={index} style={{
                  background: '#e8f5e9',
                  color: '#2e7d32',
                  padding: '4px 8px',
                  borderRadius: 12,
                  fontSize: 14,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6
                }}>
                  {tag}
                  <button
                    onClick={() => {
                      const newTags = newLuggage.tags.filter((_, i) => i !== index);
                      setNewLuggage({ ...newLuggage, tags: newTags });
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#2e7d32',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: 16,
                      fontWeight: 'bold',
                      lineHeight: 1
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                placeholder="Tag Numbers (required)"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === ' ' && tagInput.trim()) {
                    e.preventDefault();
                    setNewLuggage({ ...newLuggage, tags: [...newLuggage.tags, tagInput.trim()] });
                    setTagInput('');
                    if (errors.tags) setErrors({ ...errors, tags: false });
                  } else if (e.key === 'Backspace' && !tagInput && newLuggage.tags.length > 0) {
                    const newTags = [...newLuggage.tags];
                    newTags.pop();
                    setNewLuggage({ ...newLuggage, tags: newTags });
                  }
                }}
                onBlur={() => {
                  if (tagInput.trim()) {
                    setNewLuggage({ ...newLuggage, tags: [...newLuggage.tags, tagInput.trim()] });
                    setTagInput('');
                    if (errors.tags) setErrors({ ...errors, tags: false });
                  }
                }}
                style={{
                  border: 'none',
                  outline: 'none',
                  flex: 1,
                  minWidth: 120,
                  fontSize: 14
                }}
              />
            </div>
            {errors.tags && <div style={{ color: '#ff4444', fontSize: '12px', marginTop: '4px' }}>*required</div>}
            <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
              Press space after each tag number
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
            <label style={{ fontSize: 12, opacity: 0.7, marginBottom: 4, display: 'block' }}>Room Status</label>
            <select
              value={newLuggage.roomStatus}
              onChange={(e) => setNewLuggage({ ...newLuggage, roomStatus: e.target.value })}
              style={{ width: '100%', padding: '8px', borderRadius: 4, border: '1px solid #ccc' }}
            >
              <option value="">Select status</option>
              <option value="occupied">Occupied</option>
              <option value="dirty">Dirty</option>
              <option value="clean">Clean</option>
            </select>
          </div>

          <div>
            <input
              placeholder="Phone (required)"
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
              <label style={{ fontSize: 12, opacity: 0.7, marginBottom: 4, display: 'block' }}>Tag Numbers</label>
              <div style={{ 
                border: '1px solid #ccc', 
                borderRadius: 4, 
                padding: 8, 
                minHeight: 40,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                alignItems: 'center'
              }}>
                {(editingItem.tags || []).map((tag, index) => (
                  <span key={index} style={{
                    background: '#e8f5e9',
                    color: '#2e7d32',
                    padding: '4px 8px',
                    borderRadius: 12,
                    fontSize: 14,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6
                  }}>
                    {tag}
                    <button
                      onClick={() => {
                        const newTags = editingItem.tags.filter((_, i) => i !== index);
                        setEditingItem({ ...editingItem, tags: newTags });
                        handleUpdate('tags', newTags);
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#2e7d32',
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: 16,
                        fontWeight: 'bold',
                        lineHeight: 1
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  placeholder="Type tag number and press space"
                  value={editTagInput}
                  onChange={(e) => setEditTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === ' ' && editTagInput.trim()) {
                      e.preventDefault();
                      const newTags = [...(editingItem.tags || []), editTagInput.trim()];
                      setEditingItem({ ...editingItem, tags: newTags });
                      handleUpdate('tags', newTags);
                      setEditTagInput('');
                    } else if (e.key === 'Backspace' && !editTagInput && editingItem.tags?.length > 0) {
                      const newTags = [...editingItem.tags];
                      newTags.pop();
                      setEditingItem({ ...editingItem, tags: newTags });
                      handleUpdate('tags', newTags);
                    }
                  }}
                  onBlur={() => {
                    if (editTagInput.trim()) {
                      const newTags = [...(editingItem.tags || []), editTagInput.trim()];
                      setEditingItem({ ...editingItem, tags: newTags });
                      handleUpdate('tags', newTags);
                      setEditTagInput('');
                    }
                  }}
                  style={{
                    border: 'none',
                    outline: 'none',
                    flex: 1,
                    minWidth: 120,
                    fontSize: 14
                  }}
                />
              </div>
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
              <label style={{ fontSize: 12, opacity: 0.7, marginBottom: 4, display: 'block' }}>Room Status</label>
              <select
                value={editingItem.roomStatus || ''}
                onChange={(e) => handleUpdate('roomStatus', e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: 4, border: '1px solid #ccc' }}
              >
                <option value="">Select status</option>
                <option value="occupied">Occupied</option>
                <option value="dirty">Dirty</option>
                <option value="clean">Clean</option>
              </select>
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

