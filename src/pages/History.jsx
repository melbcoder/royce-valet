import React, { useEffect, useState } from "react";
import {
  subscribeActiveVehicles,
  updateVehicle,
  deleteVehicle,
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
    const unsub = subscribeActiveVehicles((list) => {
      // Filter only departed vehicles
      const departed = list.filter((v) => v.status === "departed");
      setHistory(departed);

      // Check for vehicles older than 7 days and remove them
      cleanupOldVehicles(departed);
    });
    return unsub;
  }, []);

  const cleanupOldVehicles = async (departedVehicles) => {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    let removedCount = 0;

    for (const vehicle of departedVehicles) {
      // Get the departure timestamp (updatedAt is when status was changed to departed)
      let departureTime;
      
      if (vehicle.updatedAt?.toDate) {
        departureTime = vehicle.updatedAt.toDate().getTime();
      } else if (vehicle.updatedAt) {
        departureTime = vehicle.updatedAt;
      } else {
        continue; // Skip if no timestamp
      }

      // If older than 7 days, delete
      if (departureTime < sevenDaysAgo) {
        try {
          console.log(`Deleting vehicle ${vehicle.tag} (departed ${new Date(departureTime).toLocaleDateString()})`);
          await deleteVehicle(vehicle.tag);
          removedCount++;
        } catch (error) {
          console.error(`Failed to delete vehicle ${vehicle.tag}:`, error);
        }
      }
    }

    if (removedCount > 0) {
      showToast(`Removed ${removedCount} vehicle(s) older than 7 days from database.`);
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

  // group by departure date (using updatedAt as proxy for when departed status was set)
  const grouped = {};
  filtered.forEach((v) => {
    const d = v.updatedAt?.toDate
      ? v.updatedAt.toDate().toLocaleDateString()
      : new Date().toLocaleDateString();
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(v);
  });

  const todayStr = new Date().toLocaleDateString();

  return (
    <section className="card pad">
      <h2>Departed Vehicles</h2>

      <input
        className="field"
        placeholder="Search by guest name, tag, or room"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 15 }}
      />

      {Object.keys(grouped)
        .sort((a, b) => new Date(b) - new Date(a))
        .map((date) => (
          <div key={date} style={{ marginBottom: 25 }}>
            <h3 style={{ marginBottom: 10 }}>{date}</h3>

            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: "80px" }}>Tag</th>
                  <th style={{ width: "150px" }}>Guest</th>
                  <th style={{ width: "100px" }}>Room</th>
                  <th style={{ width: "200px" }}>Vehicle</th>
                  <th style={{ width: "150px" }}>Actions</th>
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
                          onClick={() => updateVehicle(v.tag, { status: "out" })}
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