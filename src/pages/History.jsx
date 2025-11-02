import React, { useEffect, useState } from "react";

export default function History({ history }) { // Accept history as a prop
  const [search, setSearch] = useState("");

  useEffect(() => {
    // Load history if needed
  }, []);

  // Filter by search (guest or tag)
  const filtered = history.filter((v) => {
    const term = search.toLowerCase();
    return (
      v.tag?.toString().includes(term) ||
      v.guestName?.toLowerCase().includes(term) ||
      v.roomNumber?.toString().includes(term)
    );
  });

  // Group by departure date (archivedAt)
  const grouped = {};
  filtered.forEach((v) => {
    const d = v.archivedAt?.toDate
      ? v.archivedAt.toDate().toLocaleDateString()
      : "";
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
                  <th>Bay</th>
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {grouped[date].map((v) => (
                  <tr key={v._id}>
                    <td>{v.tag}</td>
                    <td>{v.guestName}</td>
                    <td>{v.roomNumber}</td>
                    <td>
                      {v.color} {v.make}
                      <br />
                      {v.license}
                    </td>
                    <td>{v.bay}</td>
                    <td>
                      {date === todayStr && (
                        <button
                          className="btn secondary"
                          onClick={() => reinstateVehicle(v._id, v)}
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