import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createAmenity,
  subscribeActiveAmenities,
  updateAmenity,
  markAmenityDelivered,
  deleteAmenity,
  archiveAmenity,
  getSettings,
} from '../services/valetFirestore';
import { showToast } from '../components/Toast';
import Modal from '../components/Modal';
import { getTodayInTimezone, getTomorrowInTimezone } from '../utils/timezoneUtils';

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

  // Auto-archive old amenities at midnight and on page load
  useEffect(() => {
    const archiveOldAmenities = async () => {
      // Get the configured timezone
      const settings = await getSettings();
      const timezone = settings.timezone || 'America/Los_Angeles';
      const todayLocal = getTodayInTimezone(timezone);
      const tomorrowLocal = getTomorrowInTimezone(timezone);
      
      console.log('Checking for old amenities to archive. Today:', todayLocal, 'Tomorrow:', tomorrowLocal);
      
      // Archive all items that are NOT today or tomorrow
      const itemsToArchive = amenityItems.filter(item => {
        const shouldArchive = item.deliveryDate && item.deliveryDate !== todayLocal && item.deliveryDate !== tomorrowLocal;
        if (shouldArchive) {
          console.log('Will archive amenity with date:', item.deliveryDate);
        }
        return shouldArchive;
      });
      
      if (itemsToArchive.length > 0) {
        console.log(`Archiving ${itemsToArchive.length} old amenity items...`);
        for (const item of itemsToArchive) {
          await archiveAmenity(item.id, item);
        }
        showToast(`Archived ${itemsToArchive.length} amenity items from previous day(s).`);
      }
    };

    // Run immediately on mount/when amenityItems changes
    archiveOldAmenities();

    // Also check every minute for midnight rollover
    let currentDate = new Date().toDateString();
    const checkMidnight = setInterval(async () => {
      const newDate = new Date().toDateString();
      
      if (newDate !== currentDate) {
        console.log('New day detected, running archive check...');
        await archiveOldAmenities();
        currentDate = newDate;
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
      const dateIndex = headers.findIndex(h => h.toLowerCase().includes('date'));
      const descIndex = headers.findIndex(h => h.toLowerCase().includes('description'));
      const roomIndex = headers.findIndex(h => h.toLowerCase().includes('room'));
      const nameIndex = headers.findIndex(h => h.toLowerCase().includes('name'));

      if (descIndex === -1 || roomIndex === -1 || nameIndex === -1) {
        setUploadError('CSV must contain Description, Room No, and Name columns');
        return;
      }

      // Get today and tomorrow in local time
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const tomorrowDate = new Date();
      tomorrowDate.setDate(tomorrowDate.getDate() + 1);
      const tomorrowStr = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}`;

      const amenities = [];
      let skippedCount = 0;

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        
        if (values.length < 3) continue;

        const description = values[descIndex] || '';
        const roomNumber = values[roomIndex] || '';
        let guestName = values[nameIndex] || '';
        
        // Swap name format from "SURNAME FirstName" to "FirstName SURNAME"
        if (guestName) {
          const parts = guestName.split(' ');
          let firstNameStartIndex = -1;
          
          // Find where the first name starts (first word that's not all uppercase, excluding '&')
          for (let i = 0; i < parts.length; i++) {
            const word = parts[i];
            // Skip '&' symbols
            if (word === '&') continue;
            
            // Check if this word has any lowercase letters (indicates first name)
            if (word !== word.toUpperCase()) {
              firstNameStartIndex = i;
              break;
            }
          }
          
          // If we found where first name starts, swap surname and first name
          if (firstNameStartIndex > 0) {
            const surname = parts.slice(0, firstNameStartIndex).join(' ');
            const firstName = parts.slice(firstNameStartIndex).join(' ');
            guestName = `${firstName} ${surname}`;
          }
        }
        
        // Parse date from CSV if available
        let deliveryDate = tomorrowStr; // default to tomorrow
        if (dateIndex !== -1 && values[dateIndex]) {
          try {
            // Parse date format like "23 Dec 2025"
            const dateStr = values[dateIndex];
            const parsedDate = new Date(dateStr);
            
            if (!isNaN(parsedDate.getTime())) {
              // Get the date in local timezone to avoid timezone offset issues
              const year = parsedDate.getFullYear();
              const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
              const day = String(parsedDate.getDate()).padStart(2, '0');
              deliveryDate = `${year}-${month}-${day}`;
              
              // Check if date is today or tomorrow
              if (deliveryDate !== today && deliveryDate !== tomorrowStr) {
                console.log(`Skipping amenity with date ${deliveryDate} (today: ${today}, tomorrow: ${tomorrowStr})`);
                skippedCount++;
                continue; // Skip this amenity
              }
            }
          } catch (err) {
            console.error('Error parsing date:', err);
          }
        }

        if (description && roomNumber && guestName) {
          amenities.push({
            description,
            roomNumber,
            guestName,
            roomStatus: '',
            deliveryDate,
            notes: '',
          });
        }
      }

      if (amenities.length === 0 && skippedCount === 0) {
        setUploadError('No valid amenity entries found in CSV');
        return;
      }

      // Create all amenities
      for (const amenity of amenities) {
        await createAmenity(amenity);
      }

      // Show appropriate message
      if (skippedCount > 0) {
        if (amenities.length > 0) {
          showToast(`Successfully imported ${amenities.length} amenity items. ${skippedCount} amenity item(s) were not uploaded - please check their date (must be today or tomorrow).`);
        } else {
          setUploadError(`${skippedCount} amenity item(s) were not uploaded - please check their date (must be today or tomorrow).`);
        }
      } else {
        showToast(`Successfully imported ${amenities.length} amenity items`);
      }
      
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
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}`;

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
        
        <div style={{ marginBottom: 16 }}>
          <input
            value={newAmenity.description}
            onChange={(e) => setNewAmenity({ ...newAmenity, description: e.target.value })}
            placeholder="Amenity Description*"
            style={{ width: '100%', borderColor: errors.description ? '#ff4444' : undefined }}
          />
          {errors.description && <div style={{ color: '#ff4444', fontSize: '12px', marginTop: '4px' }}>*required</div>}
        </div>

        <div style={{ marginBottom: 16 }}>
          <input
            value={newAmenity.guestName}
            onChange={(e) => setNewAmenity({ ...newAmenity, guestName: e.target.value })}
            placeholder="Guest Name*"
            style={{ width: '100%', borderColor: errors.guestName ? '#ff4444' : undefined }}
          />
          {errors.guestName && <div style={{ color: '#ff4444', fontSize: '12px', marginTop: '4px' }}>*required</div>}
        </div>

        <div style={{ marginBottom: 16 }}>
          <input
            value={newAmenity.roomNumber}
            onChange={(e) => setNewAmenity({ ...newAmenity, roomNumber: e.target.value })}
            placeholder="Room Number*"
            style={{ width: '100%', borderColor: errors.roomNumber ? '#ff4444' : undefined }}
          />
          {errors.roomNumber && <div style={{ color: '#ff4444', fontSize: '12px', marginTop: '4px' }}>*required</div>}
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, opacity: 0.7, marginBottom: 4, display: 'block' }}>Delivery Date*</label>
          <input
            type="date"
            value={newAmenity.deliveryDate}
            onChange={(e) => setNewAmenity({ ...newAmenity, deliveryDate: e.target.value })}
            style={{ width: '100%', borderColor: errors.deliveryDate ? '#ff4444' : undefined }}
          />
          {errors.deliveryDate && <div style={{ color: '#ff4444', fontSize: '12px', marginTop: '4px' }}>*required</div>}
        </div>

        <div style={{ marginBottom: 16 }}>
          <textarea
            value={newAmenity.notes}
            onChange={(e) => setNewAmenity({ ...newAmenity, notes: e.target.value })}
            placeholder="Additional notes..."
            rows={3}
            style={{ width: '100%' }}
          />
        </div>

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
            <div style={{ marginBottom: 16 }}>
              <input
                value={editingItem.description}
                onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                placeholder="Amenity Description*"
                style={{ width: '100%', borderColor: errors.description ? '#ff4444' : undefined }}
              />
              {errors.description && <div style={{ color: '#ff4444', fontSize: '12px', marginTop: '4px' }}>*required</div>}
            </div>

            <div style={{ marginBottom: 16 }}>
              <input
                value={editingItem.guestName}
                onChange={(e) => setEditingItem({ ...editingItem, guestName: e.target.value })}
                placeholder="Guest Name*"
                style={{ width: '100%', borderColor: errors.guestName ? '#ff4444' : undefined }}
              />
              {errors.guestName && <div style={{ color: '#ff4444', fontSize: '12px', marginTop: '4px' }}>*required</div>}
            </div>

            <div style={{ marginBottom: 16 }}>
              <input
                value={editingItem.roomNumber}
                onChange={(e) => setEditingItem({ ...editingItem, roomNumber: e.target.value })}
                placeholder="Room Number*"
                style={{ width: '100%', borderColor: errors.roomNumber ? '#ff4444' : undefined }}
              />
              {errors.roomNumber && <div style={{ color: '#ff4444', fontSize: '12px', marginTop: '4px' }}>*required</div>}
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, opacity: 0.7, marginBottom: 4, display: 'block' }}>Delivery Date*</label>
              <input
                type="date"
                value={editingItem.deliveryDate}
                onChange={(e) => setEditingItem({ ...editingItem, deliveryDate: e.target.value })}
                style={{ width: '100%', borderColor: errors.deliveryDate ? '#ff4444' : undefined }}
              />
              {errors.deliveryDate && <div style={{ color: '#ff4444', fontSize: '12px', marginTop: '4px' }}>*required</div>}
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, opacity: 0.7, marginBottom: 4, display: 'block' }}>Room Status</label>
              <select
                value={editingItem.roomStatus}
                onChange={(e) => setEditingItem({ ...editingItem, roomStatus: e.target.value })}
                style={{ width: '100%', padding: '8px', borderRadius: 4, border: '1px solid #ccc' }}
              >
                <option value="">Select status</option>
                <option value="occupied">Occupied</option>
                <option value="dirty">Dirty</option>
                <option value="clean">Clean</option>
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <textarea
                value={editingItem.notes}
                onChange={(e) => setEditingItem({ ...editingItem, notes: e.target.value })}
                placeholder="Additional notes..."
                rows={3}
                style={{ width: '100%' }}
              />
            </div>

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
