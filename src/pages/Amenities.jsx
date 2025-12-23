import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createAmenity,
  subscribeActiveAmenities,
  updateAmenity,
  markAmenityDelivered,
  deleteAmenity,
  archiveAmenity,
} from '../services/valetFirestore';
import { showToast } from '../components/Toast';
import Modal from '../components/Modal';

export default function Amenities() {
  const navigate = useNavigate();
  const [amenityItems, setAmenityItems] = useState([]);
  const [newOpen, setNewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef(null);
  
  const [newAmenity, setNewAmenity] = useState({
    description: '',
    guestName: '',
    roomNumber: '',
    roomStatus: '',
    deliveryDate: '',
    notes: '',
  });

  const [errors, setErrors] = useState({});

  // Subscribe to active amenities
  useEffect(() => {
    const unsubscribe = subscribeActiveAmenities((list) => {
      const sorted = [...list].sort((a, b) => String(a.roomNumber).localeCompare(String(b.roomNumber)));
      setAmenityItems(sorted);
    });
    return () => unsubscribe && unsubscribe();
  }, []);

  // Auto-archive today's amenities at midnight
  useEffect(() => {
    let currentDate = new Date().toDateString();
    
    const checkMidnight = setInterval(async () => {
      const newDate = new Date().toDateString();
      
      // If the date has changed, archive yesterday's amenities
      if (newDate !== currentDate) {
        console.log('New day detected, archiving previous day amenities...');
        
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        
        // Archive all items from yesterday or earlier
        const itemsToArchive = amenityItems.filter(item => {
          return item.deliveryDate && item.deliveryDate <= yesterdayStr;
        });
        
        for (const item of itemsToArchive) {
          await archiveAmenity(item.id, item);
        }
        
        currentDate = newDate;
        if (itemsToArchive.length > 0) {
          showToast(`Archived ${itemsToArchive.length} amenity items from previous day(s).`);
        }
      }
    }, 60000); // Check every minute
    
    return () => clearInterval(checkMidnight);
  }, [amenityItems]);

  const handleCreate = async () => {
    const validationErrors = {
      description: !String(newAmenity.description).trim(),
      guestName: !String(newAmenity.guestName).trim(),
      roomNumber: !String(newAmenity.roomNumber).trim(),
    };

    setErrors(validationErrors);

    if (Object.values(validationErrors).some(e => e)) {
      return;
    }

    try {
      await createAmenity(newAmenity);
      
      setNewAmenity({
        description: '',
        guestName: '',
        roomNumber: '',
        roomStatus: '',
        deliveryDate: '',
        notes: '',
      });
      setNewOpen(false);
      setErrors({});
      showToast('Amenity item created.');
    } catch (err) {
      console.error('Error creating amenity:', err);
      alert('Failed to create amenity item');
    }
  };

  const openEdit = (item) => {
    setEditingItem({ ...item });
    setEditOpen(true);
    setErrors({});
  };

  const handleEdit = async () => {
    const validationErrors = {
      description: !String(editingItem.description).trim(),
      guestName: !String(editingItem.guestName).trim(),
      roomNumber: !String(editingItem.roomNumber).trim(),
    };

    setErrors(validationErrors);

    if (Object.values(validationErrors).some(e => e)) {
      return;
    }

    try {
      await updateAmenity(editingItem.id, {
        description: editingItem.description,
        guestName: editingItem.guestName,
        roomNumber: editingItem.roomNumber,
        roomStatus: editingItem.roomStatus,
        deliveryDate: editingItem.deliveryDate,
        notes: editingItem.notes,
      });
      setEditOpen(false);
      setEditingItem(null);
      setErrors({});
      showToast('Amenity item updated.');
    } catch (err) {
      console.error('Error updating amenity:', err);
      alert('Failed to update amenity item');
    }
  };

  const handleDeliver = async (item) => {
    try {
      await markAmenityDelivered(item.id);
      showToast(`Amenity for ${item.guestName} marked as delivered.`);
    } catch (err) {
      console.error('Error delivering amenity:', err);
      alert('Failed to mark amenity as delivered');
    }
  };

  const handleDelete = (id) => {
    setItemToDelete(id);
    setDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (itemToDelete) {
      await deleteAmenity(itemToDelete);
      showToast('Amenity item deleted.');
    }
    setDeleteModalOpen(false);
    setItemToDelete(null);
  };

  const cancelDelete = () => {
    setDeleteModalOpen(false);
    setItemToDelete(null);
  };

  const handleCSVUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploadError('');

    try {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        setUploadError('CSV file is empty or invalid');
        return;
      }

      // Parse CSV
      const headers = lines[0].split(',').map(h => h.trim());
      const descIndex = headers.findIndex(h => h.toLowerCase().includes('description'));
      const roomIndex = headers.findIndex(h => h.toLowerCase().includes('room'));
      const nameIndex = headers.findIndex(h => h.toLowerCase().includes('name'));

      if (descIndex === -1 || roomIndex === -1 || nameIndex === -1) {
        setUploadError('CSV must contain Description, Room No, and Name columns');
        return;
      }

      const amenities = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        
        if (values.length < 3) continue;

        const description = values[descIndex] || '';
        const roomNumber = values[roomIndex] || '';
        const guestName = values[nameIndex] || '';

        if (description && roomNumber && guestName) {
          // Default to tomorrow's date for CSV uploads
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const tomorrowStr = tomorrow.toISOString().split('T')[0];
          
          amenities.push({
            description,
            roomNumber,
            guestName,
            roomStatus: '',
            deliveryDate: tomorrowStr,
            notes: '',
          });
        }
      }

      if (amenities.length === 0) {
        setUploadError('No valid amenity entries found in CSV');
        return;
      }

      // Create all amenities
      for (const amenity of amenities) {
        await createAmenity(amenity);
      }

      showToast(`Successfully imported ${amenities.length} amenity items`);
      
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      console.error('Error parsing CSV:', err);
      setUploadError('Failed to parse CSV file. Please check the format.');
    }
  };

  // Get today's and tomorrow's date strings
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  // Filter amenities by date
  const todayAmenities = amenityItems.filter(item => item.deliveryDate === today);
  const tomorrowAmenities = amenityItems.filter(item => item.deliveryDate === tomorrowStr);
  
  // Further filter today's items by status
  const todayOutstanding = todayAmenities.filter(item => item.status === 'outstanding');
  const todayDelivered = todayAmenities.filter(item => item.status === 'delivered');

  return (
    <div className="page pad">
      <div className="row space-between" style={{ marginBottom: 16 }}>
        <h2>Amenities</h2>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="btn secondary" onClick={() => fileInputRef.current?.click()}>
            Upload CSV
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleCSVUpload}
            style={{ display: 'none' }}
          />
          <button className="btn primary" onClick={() => { setNewOpen(true); setErrors({}); }}>
            Add Amenity
          </button>
          <button className="btn secondary" onClick={() => navigate('/amenities-history')}>
            View History
          </button>
        </div>
      </div>

      {uploadError && (
        <div style={{ 
          backgroundColor: '#fee', 
          color: '#c33', 
          padding: '12px', 
          borderRadius: '4px', 
          marginBottom: '16px',
          border: '1px solid #fcc'
        }}>
          {uploadError}
        </div>
      )}

      {/* Today's Outstanding Amenities */}
      <section className="card pad" style={{ marginBottom: 16 }}>
        <h3>Today's Amenities - Outstanding ({todayOutstanding.length})</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Guest Name</th>
                <th>Room</th>
                <th>Room Status</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {todayOutstanding.length === 0 && (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', opacity: 0.7 }}>
                    No outstanding amenities for today
                  </td>
                </tr>
              )}
              {todayOutstanding.map((item) => (
                <tr key={item.id}>                  <td>{item.deliveryDate ? new Date(item.deliveryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>                  <td>{item.description}</td>
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
                        onChange={(e) => updateAmenity(item.id, { roomStatus: e.target.value })}
                        style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc' }}
                      >
                        <option value="">Select status</option>
                        <option value="occupied">Occupied</option>
                        <option value="dirty">Dirty</option>
                        <option value="clean">Clean</option>
                      </select>
                    </div>
                  </td>
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

      {/* Today's Delivered Amenities */}
      <section className="card pad" style={{ marginBottom: 16 }}>
        <h3>Today's Amenities - Delivered ({todayDelivered.length})</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Guest Name</th>
                <th>Room</th>
                <th>Delivered At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {todayDelivered.length === 0 && (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', opacity: 0.7 }}>
                    No amenities delivered today
                  </td>
                </tr>
              )}
              {todayDelivered.map((item) => (
                <tr key={item.id}>
                  <td>{item.deliveryDate ? new Date(item.deliveryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
                  <td>{item.description}</td>
                  <td>{item.guestName}</td>
                  <td>{item.roomNumber}</td>
                  <td>
                    {item.deliveredAt ? 
                      new Date(item.deliveredAt.seconds * 1000).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                      }) : '—'}
                  </td>
                  <td>
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

      {/* Tomorrow's Amenities */}
      <section className="card pad">
        <h3>Tomorrow's Amenities ({tomorrowAmenities.length})</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Guest Name</th>
                <th>Room</th>
                <th>Room Status</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tomorrowAmenities.length === 0 && (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', opacity: 0.7 }}>
                    No amenities scheduled for tomorrow
                  </td>
                </tr>
              )}
              {tomorrowAmenities.map((item) => (
                <tr key={item.id}>
                  <td>{item.deliveryDate ? new Date(item.deliveryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
                  <td>{item.description}</td>
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
                        onChange={(e) => updateAmenity(item.id, { roomStatus: e.target.value })}
                        style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc' }}
                      >
                        <option value="">Select status</option>
                        <option value="occupied">Occupied</option>
                        <option value="dirty">Dirty</option>
                        <option value="clean">Clean</option>
                      </select>
                    </div>
                  </td>
                  <td>{item.notes || '—'}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn secondary" onClick={() => openEdit(item)}>
                      <img src="/edit.png" alt="Edit" style={{ width: 20, height: 20 }} />
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

      {/* Add Amenity Modal */}
      <Modal open={newOpen} onClose={() => { setNewOpen(false); setErrors({}); }}>
        <h2>Add Amenity</h2>
        <label>
          Description *
          <input
            value={newAmenity.description}
            onChange={(e) => setNewAmenity({ ...newAmenity, description: e.target.value })}
            placeholder="e.g., Amenity- Bandini Prosecco"
            style={{ borderColor: errors.description ? '#ff4444' : undefined }}
          />
          {errors.description && <span style={{ color: '#ff4444', fontSize: 12 }}>Required</span>}
        </label>

        <label>
          Guest Name *
          <input
            value={newAmenity.guestName}
            onChange={(e) => setNewAmenity({ ...newAmenity, guestName: e.target.value })}
            placeholder="e.g., EWINGTON Daniel"
            style={{ borderColor: errors.guestName ? '#ff4444' : undefined }}
          />
          {errors.guestName && <span style={{ color: '#ff4444', fontSize: 12 }}>Required</span>}
        </label>

        <label>
          Room Number *
          <input
            value={newAmenity.roomNumber}
            onChange={(e) => setNewAmenity({ ...newAmenity, roomNumber: e.target.value })}
            placeholder="e.g., 619"
            style={{ borderColor: errors.roomNumber ? '#ff4444' : undefined }}
          />
          {errors.roomNumber && <span style={{ color: '#ff4444', fontSize: 12 }}>Required</span>}
        </label>

        <label>
          Delivery Date *
          <input
            type="date"
            value={newAmenity.deliveryDate}
            onChange={(e) => setNewAmenity({ ...newAmenity, deliveryDate: e.target.value })}
            style={{ borderColor: errors.deliveryDate ? '#ff4444' : undefined }}
          />
          {errors.deliveryDate && <span style={{ color: '#ff4444', fontSize: 12 }}>Required</span>}
        </label>

        <label>          Delivery Date *
          <input
            type="date"
            value={newAmenity.deliveryDate}
            onChange={(e) => setNewAmenity({ ...newAmenity, deliveryDate: e.target.value })}
            style={{ borderColor: errors.deliveryDate ? '#ff4444' : undefined }}
          />
          {errors.deliveryDate && <span style={{ color: '#ff4444', fontSize: 12 }}>Required</span>}
        </label>

        <label>          Room Status
          <select
            value={newAmenity.roomStatus}
            onChange={(e) => setNewAmenity({ ...newAmenity, roomStatus: e.target.value })}
          >
            <option value="">Select status</option>
            <option value="occupied">Occupied</option>
            <option value="dirty">Dirty</option>
            <option value="clean">Clean</option>
          </select>
        </label>

        <label>
          Notes
          <textarea
            value={newAmenity.notes}
            onChange={(e) => setNewAmenity({ ...newAmenity, notes: e.target.value })}
            placeholder="Additional notes..."
            rows={3}
          />
        </label>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn primary" onClick={handleCreate}>
            Create
          </button>
          <button className="btn secondary" onClick={() => { setNewOpen(false); setErrors({}); }}>
            Cancel
          </button>
        </div>
      </Modal>

      {/* Edit Amenity Modal */}
      <Modal open={editOpen} onClose={() => { setEditOpen(false); setEditingItem(null); setErrors({}); }}>
        <h2>Edit Amenity</h2>
        {editingItem && (
          <>
            <label>
              Description *
              <input
                value={editingItem.description}
                onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                style={{ borderColor: errors.description ? '#ff4444' : undefined }}
              />
              {errors.description && <span style={{ color: '#ff4444', fontSize: 12 }}>Required</span>}
            </label>

            <label>
              Guest Name *
              <input
                value={editingItem.guestName}
                onChange={(e) => setEditingItem({ ...editingItem, guestName: e.target.value })}
                style={{ borderColor: errors.guestName ? '#ff4444' : undefined }}
              />
              {errors.guestName && <span style={{ color: '#ff4444', fontSize: 12 }}>Required</span>}
            </label>

            <label>
              Room Number *
              <input
                value={editingItem.roomNumber}
                onChange={(e) => setEditingItem({ ...editingItem, roomNumber: e.target.value })}
                style={{ borderColor: errors.roomNumber ? '#ff4444' : undefined }}
              />
              {errors.roomNumber && <span style={{ color: '#ff4444', fontSize: 12 }}>Required</span>}
            </label>

            <label>
              Delivery Date *
              <input
                type="date"
                value={editingItem.deliveryDate}
                onChange={(e) => setEditingItem({ ...editingItem, deliveryDate: e.target.value })}
                style={{ borderColor: errors.deliveryDate ? '#ff4444' : undefined }}
              />
              {errors.deliveryDate && <span style={{ color: '#ff4444', fontSize: 12 }}>Required</span>}
            </label>

            <label>              Delivery Date *
              <input
                type="date"
                value={editingItem.deliveryDate}
                onChange={(e) => setEditingItem({ ...editingItem, deliveryDate: e.target.value })}
                style={{ borderColor: errors.deliveryDate ? '#ff4444' : undefined }}
              />
              {errors.deliveryDate && <span style={{ color: '#ff4444', fontSize: 12 }}>Required</span>}
            </label>

            <label>              Room Status
              <select
                value={editingItem.roomStatus}
                onChange={(e) => setEditingItem({ ...editingItem, roomStatus: e.target.value })}
              >
                <option value="">Select status</option>
                <option value="occupied">Occupied</option>
                <option value="dirty">Dirty</option>
                <option value="clean">Clean</option>
              </select>
            </label>

            <label>
              Notes
              <textarea
                value={editingItem.notes}
                onChange={(e) => setEditingItem({ ...editingItem, notes: e.target.value })}
                rows={3}
              />
            </label>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn primary" onClick={handleEdit}>
                Save
              </button>
              <button className="btn secondary" onClick={() => { setEditOpen(false); setEditingItem(null); setErrors({}); }}>
                Cancel
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal open={deleteModalOpen} onClose={cancelDelete}>
        <h2>Delete Amenity</h2>
        <p>Are you sure you want to delete this amenity item?</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn primary" onClick={confirmDelete}>
            Delete
          </button>
          <button className="btn secondary" onClick={cancelDelete}>
            Cancel
          </button>
        </div>
      </Modal>
    </div>
  );
}
