import React, { useEffect, useState } from "react";
import {
  subscribeActiveVehicles,
  updateVehicle,
} from "../services/valetFirestore";

export default function History() {
  const [history, setHistory] = useState([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const unsub = subscribeActiveVehicles((list) => {
      // Filter only departed vehicles
      const departed = list.filter((v) => v.status === "departed");
      setHistory(departed);
    });
    return unsub;
  }, []);

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
                  <th>Tag</th>
                  <th>Guest</th>
                  <th>Room</th>
                  <th>Vehicle</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {grouped[date].map((v) => (
                  <tr key={v._id}>
                    <td>{v.tag}</td>
                    <td>{v.guestName}</td>
                    <td>{v.roomNumber}</td>
                    <td>{v.color + " " + v.make + " • " + (v.license || "—")}</td>
                    <td>
                      {date === todayStr && (
                        <button
                          className="btn secondary"
                          onClick={() => updateVehicle(v.tag, { status: "out" })}
                        >
                          Reinstate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}