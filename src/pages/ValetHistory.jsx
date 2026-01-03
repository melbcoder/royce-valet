import React, { useEffect, useState } from "react";
import {
  subscribeHistory,
  reinstateVehicle,
} from "../services/valetFirestore";
import { showToast } from "../components/Toast";
import PhotoModal from "../components/PhotoModal";

// Reusable Photo Icon Component
const CameraIcon = () => (
  <img src="/camera.png" alt="Camera" style={{ width: "20px", height: "20px" }} />
);

export default function History() {
  const [history, setHistory] = useState([]);
  const [search, setSearch] = useState("");
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [photoTag, setPhotoTag] = useState(null);

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
    </section>
  );
}