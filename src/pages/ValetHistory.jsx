import React, { useEffect, useState } from "react";
import {
  subscribeHistory,
  reinstateVehicle,
  getVehicleAuditLogFromHistory,
} from "../services/valetFirestore";
import { showToast } from "../components/Toast";
import PhotoModal from "../components/PhotoModal";
import Modal from "../components/Modal";

// Reusable Photo Icon Component
const CameraIcon = () => (
  <img src="/camera.png" alt="Camera" style={{ width: "20px", height: "20px" }} />
);

// Reusable Audit Icon Component
const AuditIcon = () => (
  <img src="/audit.png" alt="Audit" style={{ width: "20px", height: "20px" }} />
);

export default function History() {
  const [history, setHistory] = useState([]);
  const [search, setSearch] = useState("");
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [photoTag, setPhotoTag] = useState(null);
  
  // Audit modal state
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [auditVehicle, setAuditVehicle] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  useEffect(() => {
    const unsub = subscribeHistory((list) => {
      // All vehicles from valetHistory collection
      setHistory(list);
    });
    return unsub;
  }, []);

  const handleReinstate = async (vehicle) => {
    try {
      await reinstateVehicle(vehicle._id, vehicle);
      showToast("Vehicle reinstated to active list.");
    } catch (error) {
      console.error('Error reinstating vehicle:', error);
      showToast("Failed to reinstate vehicle.");
    }
  };

  const openPhotos = (tag) => {
    setPhotoTag(tag);
    setPhotoModalOpen(true);
  };

  // filter by search (guest or tag)
  const filtered = history.filter((v) => {
    const term = search.toLowerCase();
    return (
      v.tag?.toString().includes(term) ||
      v.guestName?.toLowerCase().includes(term) ||
      v.roomNumber?.toString().includes(term)
    );
  });

  // group by archived date
  const grouped = {};
  filtered.forEach((v) => {
    const d = v.archivedAt?.toDate
      ? v.archivedAt.toDate().toLocaleDateString()
      : new Date().toLocaleDateString();
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(v);
  });

  const todayStr = new Date().toLocaleDateString();

  const handleViewAudit = async (vehicle) => {
    setAuditVehicle(vehicle);
    setAuditModalOpen(true);
    setAuditLoading(true);
    setAuditLogs([]);
    
    try {
      const logs = await getVehicleAuditLogFromHistory(vehicle._id);
      setAuditLogs(logs);
    } catch (error) {
      console.error('Error loading audit logs:', error);
      showToast('Failed to load audit history.');
    } finally {
      setAuditLoading(false);
    }
  };

  const formatAuditTimestamp = (timestamp) => {
    if (!timestamp || !timestamp.seconds) return '—';
    return new Date(timestamp.seconds * 1000).toLocaleString();
  };

  const formatAuditAction = (action) => {
    const actionMap = {
      'created': 'Vehicle Checked In',
      'updated': 'Details Updated',
      'parked': 'Parked',
      'requested': 'Pickup Requested',
      'marked_ready': 'Marked Ready',
      'handed_over': 'Handed Over to Guest'
    };
    return actionMap[action] || action;
  };

  const formatAuditDetails = (action, details) => {
    if (!details || Object.keys(details).length === 0) return null;
    
    const entries = Object.entries(details).map(([key, value]) => {
      if (typeof value === 'object' && value !== null) {
        return `${key}: ${JSON.stringify(value)}`;
      }
      return `${key}: ${value}`;
    });
    
    return entries.join(', ');
  };

  return (
    <section className="card pad">
      <h2>Departed Vehicles History</h2>

      <input
        className="field"
        placeholder="Search by guest name, tag, or room"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 15 }}
      />

      {Object.keys(grouped).length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, opacity: 0.7 }}>
          <p>No departed vehicles in history.</p>
        </div>
      )}

      {Object.keys(grouped)
        .sort((a, b) => new Date(b) - new Date(a))
        .map((date) => (
          <div key={date} style={{ marginBottom: 25 }}>
            <h3 style={{ marginBottom: 10 }}>{date}</h3>

            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: "80px" }}>Tag</th>
                  <th style={{ width: "200px" }}>Guest</th>
                  <th style={{ width: "100px" }}>Room</th>
                  <th style={{ width: "250px" }}>Vehicle</th>
                  <th style={{ width: "200px" }}>Actions</th>
                </tr>
              </thead>

              <tbody>
                {grouped[date].map((v) => (
                  <tr key={v._id}>
                    <td>{"#" + v.tag}</td>
                    <td>{v.guestName}</td>
                    <td>{v.roomNumber}</td>
                    <td>{v.color + " " + v.make + " • " + (v.license || "—")}</td>
                    <td style={{ display: "flex", gap: 6 }}>
                      {date === todayStr && (
                        <button
                          className="btn secondary"
                          onClick={() => handleReinstate(v)}
                        >
                          Reinstate
                        </button>
                      )}

                      {/* Add & View Photos */}
                      <button className="btn secondary" onClick={() => openPhotos(v.tag)}>
                        <CameraIcon />
                      </button>

                      {/* View Audit Log */}
                      <button className="btn secondary" onClick={() => handleViewAudit(v)} title="View Audit Log">
                        <AuditIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {/* Photo Modal */}
      <PhotoModal
        open={photoModalOpen}
        onClose={() => {
          setPhotoModalOpen(false);
          setPhotoTag(null);
        }}
        vehicleTag={photoTag}
        vehicle={history.find(v => v.tag === photoTag)}
      />

      {/* Audit Log Modal */}
      <Modal open={auditModalOpen} onClose={() => setAuditModalOpen(false)} title={`Audit Trail - Tag #${auditVehicle?.tag}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {auditLoading ? (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <p>Loading audit history...</p>
            </div>
          ) : auditLogs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, opacity: 0.7 }}>
              <p>No audit history available for this vehicle.</p>
            </div>
          ) : (
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              <table className="table" style={{ fontSize: 14 }}>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Action</th>
                    <th>User</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log, index) => (
                    <tr key={log.id || index}>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>
                        {formatAuditTimestamp(log.timestamp)}
                      </td>
                      <td style={{ fontWeight: 500 }}>
                        {formatAuditAction(log.action)}
                      </td>
                      <td>
                        {log.user?.username || 'System'}
                        {log.user?.role && (
                          <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 4 }}>
                            ({log.user.role})
                          </span>
                        )}
                      </td>
                      <td style={{ fontSize: 13 }}>
                        {formatAuditDetails(log.action, log.details) || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn secondary" onClick={() => setAuditModalOpen(false)}>
              Close
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}