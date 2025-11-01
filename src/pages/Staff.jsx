import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  createVehicle,
  subscribeActiveVehicles,
  updateVehicle,
  requestVehicle,
  cancelRequest,
  markReady,
  markOut,
  parkAgain,
  scheduleRequest,
  clearSchedule,
} from "../services/valetFirestore";
import Modal from "../components/Modal";
import { showToast } from "../components/Toast";

// ---------- helpers ----------
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
const fmtDT = (t) => (t ? new Date(t).toLocaleString() : "—");
const nowMs = () => Date.now();
const TEN_MIN = 10 * 60 * 1000;

export default function Staff() {
  // ---------- state ----------
  const [vehicles, setVehicles] = useState([]);
  const [filterStatus, setFilterStatus] = useState(""); // active table filter
  const [newOpen, setNewOpen] = useState(false);
  const [newVehicle, setNewVehicle] = useState({
    tag: "",
    guestName: "",
    roomNumber: "",
    phone: "",
    departureDate: "",
  });

  // Park modal
  const [parkOpen, setParkOpen] = useState(false);
  const [parkForTag, setParkForTag] = useState(null);
  const [parkForm, setParkForm] = useState({
    bay: "",
    license: "",
    make: "",
    color: "",
  });

  // notification count & chime
  const unseenCount = useRef(0);
  const [badgeCount, setBadgeCount] = useState(0);
  const prevQueueIds = useRef(new Set());
  const titleBase = useRef(document.title);
  const chimeRef = useRef(null);

  // ---------- subscription ----------
  useEffect(() => {
    const unsub = subscribeActiveVehicles((list) => {
      // ensure stable shape
      const stable = list.map((v) => ({
        ...v,
        status: (v.status || "received").toLowerCase(),
        requested: Boolean(v.requested),
        ack: Boolean(v.ack),
        scheduledAt: v.scheduledAt || null,
        requestedAt: v.requestedAt || null,
        bay: v.bay || "",
        license: v.license || "",
        make: v.make || "",
        color: v.color || "",
      }));

      // detect newly requested vehicles (for chime + badge)
      const queue = stable.filter((v) => v.requested && v.status !== "out");
      const currentIds = new Set(queue.map((v) => v.tag));
      // new requests are in currentIds but not in prevQueueIds
      const newOnes = [...currentIds].filter((id) => !prevQueueIds.current.has(id));
      if (newOnes.length > 0) {
        // play chime once per update if new requests
        playChime();
        unseenCount.current += newOnes.length;
        setBadgeCount(unseenCount.current);
      }
      prevQueueIds.current = currentIds;

      setVehicles(stable);
    });
    return () => unsub && unsub();
  }, []);

  // tab title badge
  useEffect(() => {
    document.title =
      badgeCount > 0 ? `(${badgeCount}) ${titleBase.current}` : titleBase.current;
  }, [badgeCount]);

  // pre-load chime
  useEffect(() => {
    // Use a public/chime.mp3 if present; otherwise generate a short beep
    const audio = new Audio("/chime.mp3");
    audio.preload = "auto";
    chimeRef.current = audio;
  }, []);

  const playChime = () => {
    const a = chimeRef.current;
    if (!a) return;
    // attempt; ignore errors (e.g., autoplay restrictions)
    a.currentTime = 0;
    a.play().catch(() => {});
  };

  // ---------- derived lists ----------
  // Request Queue: requested === true and not 'out'
  const requestQueue = useMemo(() => {
    const q = vehicles
      .filter((v) => v.requested && v.status !== "out")
      .sort((a, b) => (a.requestedAt || 0) - (b.requestedAt || 0));
    return q;
  }, [vehicles]);

  // Scheduled pickups: in the future & not yet requested
  const scheduled = useMemo(() => {
    const now = nowMs();
    return vehicles
      .filter(
        (v) =>
          v.status === "parked" &&
          v.scheduledAt &&
          Number(v.scheduledAt) > now &&
          !v.requested
      )
      .sort((a, b) => Number(a.scheduledAt) - Number(b.scheduledAt));
  }, [vehicles]);

  // Active Vehicles (all), filtered by status if selected
  const [showStatusMenu, setShowStatusMenu] = useState(false);

  // Close status dropdown when clicking outside
  useEffect(() => {
    const close = () => setShowStatusMenu(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const active = useMemo(() => {
    const list = [...vehicles].sort((a, b) => String(a.tag).localeCompare(String(b.tag)));
    if (filterStatus === "departing") {const today = new Date().toISOString().slice(0, 10);return list.filter((v) => v.departureDate === today);}
    return filterStatus ? list.filter((v) => v.status === filterStatus) : list;
  }, [vehicles, filterStatus]);

  // ---------- auto-move scheduled → queue (10 min prior) ----------
  // Client-side guard to avoid spam: remember what we've auto-queued this session
  const autoQueued = useRef(new Set());
  useEffect(() => {
    const t = setInterval(async () => {
      const now = nowMs();
      const due = vehicles.filter(
        (v) =>
          v.status === "parked" &&
          v.scheduledAt &&
          Number(v.scheduledAt) - now <= TEN_MIN &&
          !v.requested
      );
      for (const v of due) {
        if (autoQueued.current.has(v.tag)) continue;
        // mark retrieving + requested + requestedAt
        await updateVehicle(v.tag, {
          status: "retrieving",
          requested: true,
          requestedAt: Date.now(),
          prevStatus: v.status // remember previous status so cancellation can revert
        });
        autoQueued.current.add(v.tag);
      }
    }, 10_000);
    return () => clearInterval(t);
  }, [vehicles]);

  // ---------- actions ----------
  const handleCreate = async () => {
    const { tag, guestName, roomNumber, phone, departureDate } = newVehicle;
    if (!tag || !guestName || !roomNumber || !phone || !departureDate) {
      alert("Please complete Tag, Guest, Room, Phone and Departure Date.");
      return;
    }
    await createVehicle({
      tag,
      guestName,
      roomNumber,
      phone,
      departureDate,
    });
    setNewVehicle({
      tag: "",
      guestName: "",
      roomNumber: "",
      phone: "",
      departureDate: "",
    });
    setNewOpen(false);
    showToast("Vehicle created.");
  };

  const openPark = (v) => {
    setParkForTag(v.tag);
    setParkForm({
      bay: "", // always ask for bay again
      license: v.license || "",
      make: v.make || "",
      color: v.color || "",
    });
    setParkOpen(true);
  };

  const confirmPark = async () => {
    if (!String(parkForm.bay).trim()) {
      alert("Bay number is required.");
      return;
    }
    await parkAgain(
      parkForTag,
      parkForm.bay ?? "",
      parkForm.license ?? "",
      parkForm.make ?? "",
      parkForm.color ?? ""
    );
    setParkOpen(false);
    showToast("Vehicle parked.");
  };

  const ackRequest = async (v) => {
    // acknowledging clears the tab counter once per vehicle
    if (badgeCount > 0 && prevQueueIds.current.has(v.tag)) {
      unseenCount.current = Math.max(0, unseenCount.current - 1);
      setBadgeCount(unseenCount.current);
    }
    // move to retrieving if not already
    if (v.status !== "retrieving") {
      await updateVehicle(v.tag, {
        status: "retrieving",
        ack: true,
      });
    } else {
      await updateVehicle(v.tag, { ack: true });
    }
  };

  const setReady = async (tag) => {
    await markReady(tag);
    showToast("Vehicle ready at driveway.");
  };

  const handOver = async (tag) => {
    await markOut(tag);
    showToast("Vehicle handed over.");
  };

  const queueNow = async (v) => {
    // quick action to move scheduled straight to queue
    await updateVehicle(v.tag, {
      status: "retrieving",
      requested: true,
      requestedAt: Date.now(),
      scheduledAt: null,
      prevStatus: v.status
    });
  };

  const cancelSched = async (tag) => {
    await clearSchedule(tag);
  };

  const setSchedule = async (tag, iso) => {
    const t = new Date(iso).getTime();
    if (isNaN(t)) {
      alert("Invalid date/time");
      return;
    }
    if (t - Date.now() < TEN_MIN) {
      alert("Pickup must be scheduled at least 10 minutes in advance.");
      return;
    }
    await scheduleRequest(tag, t);
  };

  // Cancel a guest request — restore previous status if needed
  const cancelRequestFor = async (tag) => {
    const v = vehicles.find((x) => x.tag === tag);
    if (!v) return;
    // If vehicle is in a 'requested' transient state, revert to prevStatus
    let targetStatus = v.status;
    if (v.status === "requested") {
      targetStatus = v.prevStatus || "parked";
    }
    await updateVehicle(tag, {
      requested: false,
      requestedAt: null,
      status: targetStatus,
      prevStatus: null, // clear stored previous status
    });
    showToast("Request cancelled.");
  };

  // ---------- UI ----------
  return (
    <div className="page pad">
      {/* Header */}
      <div className="row space-between" style={{ marginBottom: 16 }}>
        <h2>Valet Management</h2>
        <button className="btn primary" onClick={() => setNewOpen(true)} style={{ marginLeft: "auto" }}>
          Add Vehicle
        </button>
      </div>

      {/* Request Queue */}
      <section className="card pad" style={{ marginBottom: 16 }}>
        <h3>Request Queue</h3>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tag</th>
                <th>Guest</th>
                <th>Room</th>
                <th>Requested</th>
                <th>Status</th>
                <th>Bay</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {requestQueue.length === 0 && (
                <tr>
                  <td colSpan="7" style={{ textAlign: "center", opacity: 0.7 }}>
                    No current requests.
                  </td>
                </tr>
              )}
              {requestQueue.map((v) => (
                <tr key={`q-${v.tag}`}>
                  <td>{v.tag}</td>
                  <td>{v.guestName}</td>
                  <td>{v.roomNumber}</td>
                  <td>{v.requestedAt ? fmtDT(v.requestedAt) : "—"}</td>
                  <td>
                    <span className={`status-pill status-${v.status}`}>
                      {v.status === "out" ? "Out & About" : cap(v.status)}
                    </span>
                  </td>
                  <td>{v.bay || "—"}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    {/* one button at a time */}
                    {!v.ack && v.status !== "ready" && v.status !== "out" && (
                      <button className="btn secondary" onClick={() => ackRequest(v)}>
                        Acknowledge
                      </button>
                    )}
                    {v.ack && v.status === "retrieving" && (
                      <button className="btn secondary" onClick={() => setReady(v.tag)}>
                        Ready
                      </button>
                    )}
                    {v.status === "ready" && (
                      <button className="btn secondary" onClick={() => handOver(v.tag)}>
                        Hand Over
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Scheduled Pickups */}
      <section className="card pad" style={{ marginBottom: 16 }}>
        <h3>Scheduled Pickups</h3>
        <p style={{ marginTop: 6, marginBottom: 12, fontSize: "0.9em" }}>
          Vehicles will enter the Request Queue 10 minutes before their scheduled pickup time.
        </p>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tag</th>
                <th>Guest</th>
                <th>Room</th>
                <th>Pickup Time</th>
                <th>Status</th>
                <th>Bay</th>
                <th>Quick Actions</th>
              </tr>
            </thead>
            <tbody>
              {scheduled.length === 0 && (
                <tr>
                  <td colSpan="7" style={{ textAlign: "center", opacity: 0.7 }}>
                    No scheduled pickups.
                  </td>
                </tr>
              )}
              {scheduled.map((v) => (
                <tr key={`s-${v.tag}`}>
                  <td>{v.tag}</td>
                  <td>{v.guestName}</td>
                  <td>{v.roomNumber}</td>
                  <td>{fmtDT(v.scheduledAt)}</td>
                  <td>
                    <span className={`status-pill status-${v.status}`}>
                      {v.status === "out" ? "Out & About" : cap(v.status)}
                    </span>
                  </td>
                  <td>{v.bay || "—"}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <button className="btn secondary" onClick={() => queueNow(v)}>
                      Queue Now
                    </button>
                    <button className="btn secondary" onClick={() => cancelSched(v.tag)}>
                      Cancel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Active Vehicles */}
      <section className="card pad">
        <div className="row space-between" style={{ marginBottom: 8 }}>
          <h3>Active Vehicles</h3>
          {/* Filter Bar */}
          <div style={{display: "flex",justifyContent: "flex-end",gap: "12px",position: "relative",marginLeft: "auto"}}>
            <div style={{ position: "relative" }}>
              <button className="btn secondary"
                onClick={(e) => {e.stopPropagation();setShowStatusMenu(!showStatusMenu);}}
                style={{
                  alignItems: "center",
                  gap: "8px",
                  width: "170px",
                  justifyContent: "flex-start",
                  display: "flex",
                  marginLeft: "auto"
                }}
              >
                <span style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  background: filterStatus === "" ? "black"
                    : filterStatus === "received" ? "#777"
                    : filterStatus === "parked" ? "#e8daec"
                    : filterStatus === "requested" ? "#ff5900ff"
                    : filterStatus === "retrieving" ? "#b68b2e"
                    : filterStatus === "ready" ? "#4caf50"
                    : filterStatus === "out" ? "#1976d2"
                    : "black",
                  flex: "0 0 auto"
                }}></span>

                <span style={{
                  flex: 1,
                  textAlign: "right",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  marginLeft: "8px"
                }}>
                  {filterStatus === "" ? "All Statuses" : filterStatus.charAt(0).toUpperCase() + filterStatus.slice(1)}
                </span>

                <span style={{ fontSize: "12px", marginLeft: "8px" }}>▾</span>
              </button>

              {showStatusMenu && (
                <div style={{
                  position: "absolute",
                  right: 0,
                  marginTop: "8px",
                  background: "#fff",
                  borderRadius: "14px",
                  border: "1px solid #ddd",
                  boxShadow: "0 4px 8px rgba(0,0,0,0.08)",
                  width: "160px",
                  zIndex: 20,
                  padding: "6px"
                }}>

                  {[
                    { value: "", label: "All Statuses", color: "black" },
                    { value: "received", label: "Received", color: "#777" },
                    { value: "parked", label: "Parked", color: "#e8daec" },
                    { value: "requested", label: "Requested", color: "rgba(255, 89, 0, 1)" },
                    { value: "retrieving", label: "Retrieving", color: "#b68b2e" },
                    { value: "ready", label: "Ready", color: "#4caf50" },
                    { value: "out", label: "Out", color: "#1976d2" }
                  ].map(s => (
                    <button key={s.value}
                      onClick={() => { setFilterStatus(s.value); setShowStatusMenu(false); }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "8px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        borderRadius: "20px",
                        border: "1px solid #eee",
                        background: filterStatus === s.value ? "#f8f8f8" : "#fff",
                        cursor: "pointer"
                      }}
                    >
                      <span style={{
                        width: "10px",
                        height: "10px",
                        borderRadius: "50%",
                        background: s.color
                      }}></span>
                      {s.label}
                    </button>
                  ))}

                </div>
              )}
            </div>

            {/* Departing Today Toggle */}
            <button className="btn secondary"
              onClick={() =>
                setFilterStatus(filterStatus === "departing" ? "" : "departing")
              }
              style={{
                background: filterStatus === "departing" ? "#000" : "#fff",
                color: filterStatus === "departing" ? "#fff" : "#000"
              }}
            >
              Departing Today
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tag</th>
                <th>Guest</th>
                <th>Room</th>
                <th>License Plate</th>
                <th>Status</th>
                <th>Bay</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {active.length === 0 && (
                <tr>
                  <td colSpan="7" style={{ textAlign: "center", opacity: 0.7 }}>
                    No vehicles to display.
                  </td>
                </tr>
              )}
              {active.map((v) => (
                <tr key={`a-${v.tag}`}>
                  <td>{v.tag}</td>
                  <td>{v.guestName}</td>
                  <td>{v.roomNumber}</td>
                  <td>{v.license || "—"}</td>
                  <td>
                    <span className={`status-pill status-${v.status}`}>
                      {v.status === "out" ? "Out & About" : cap(v.status)}
                    </span>
                  </td>
                  <td>{v.bay || "—"}</td>
                  <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {/* Request (only visible when allowed) */}
                    {v.status === "parked" && !v.requested && (
                      <button className="btn secondary" onClick={() =>
                        updateVehicle(v.tag, {
                          status: "retrieving",
                          requested: true,
                          requestedAt: Date.now(),
                          ack: false,
                          prevStatus: v.status
                        })
                      }>
                        Retrieve
                      </button>
                    )}

                    {/* Park */}
                    {(v.status === "out" || v.status === "received" || v.status === "retrieving" || v.status === "ready") && (
                      <button className="btn secondary" onClick={() => openPark(v)}>
                        Park
                      </button>
                    )}

                    {(v.status === "parked") && (
                      <button className="btn secondary" onClick={() => openPark(v)}>
                        Repark
                      </button>
                    )}

                    {/* Ready / Hand Over quick controls if not in queue list */}
                    {(v.status === "retrieving" || v.status === "parked" || v.status === "requested") && (
                      <button className="btn secondary" onClick={() => setReady(v.tag)}>
                        Ready
                      </button>
                    )}
                    {(v.status === "ready" || v.status === "parked" || v.status === "requested" || v.status === "retrieving") && (
                      <button className="btn secondary" onClick={() => handOver(v.tag)}>
                        Hand Over
                      </button>
                    )}

                    {/* Schedule pickup */}
                    <ScheduleInline v={v} onSet={setSchedule} onClear={cancelSched} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Create Vehicle */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Add Vehicle">
        <div className="col" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <input placeholder="Tag Number" value={newVehicle.tag}
                  onChange={(e) => setNewVehicle({ ...newVehicle, tag: e.target.value })} />
          <input placeholder="Guest Name" value={newVehicle.guestName}
                 onChange={(e) => setNewVehicle({ ...newVehicle, guestName: e.target.value })} />
          <input placeholder="Room Number" value={newVehicle.roomNumber}
                 onChange={(e) => setNewVehicle({ ...newVehicle, roomNumber: e.target.value })} />
          <input placeholder="Phone" value={newVehicle.phone}
                 onChange={(e) => setNewVehicle({ ...newVehicle, phone: e.target.value })} />
          <label style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>Departure Date</label>
          <input type="date" value={newVehicle.departureDate}
                 onChange={(e) => setNewVehicle({ ...newVehicle, departureDate: e.target.value })} />
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn primary" onClick={handleCreate}>Create Vehicle</button>
            <button className="btn secondary" onClick={() => setNewOpen(false)}>Cancel</button>
          </div>
        </div>
      </Modal>

      {/* Park Modal */}
      <Modal open={parkOpen} onClose={() => setParkOpen(false)} title="Return & Park">
        <div className="col" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <input placeholder="Bay (required)" value={parkForm.bay}
                 onChange={(e) => setParkForm({ ...parkForm, bay: e.target.value })} />
          <input placeholder="License Plate (required)" value={parkForm.license}
                 onChange={(e) => setParkForm({ ...parkForm, license: e.target.value })} />
          <input placeholder="Make" value={parkForm.make}
                 onChange={(e) => setParkForm({ ...parkForm, make: e.target.value })} />
          <input placeholder="Color" value={parkForm.color}
                 onChange={(e) => setParkForm({ ...parkForm, color: e.target.value })} />
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn primary" onClick={confirmPark}>Save</button>
            <button className="btn secondary" onClick={() => setParkOpen(false)}>Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// inline scheduling widget for Active table
function ScheduleInline({ v, onSet, onClear }) {
  const [open, setOpen] = useState(false);
  const [iso, setIso] = useState("");

  useEffect(() => {
    if (v.scheduledAt) {
      const d = new Date(Number(v.scheduledAt));
      const pad = (n) => String(n).padStart(2, "0");
      const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
        d.getHours()
      )}:${pad(d.getMinutes())}`;
      setIso(local);
    } else {
      setIso("");
    }
  }, [v.scheduledAt]);

  if (v.status !== "parked") return null;

  return (
    <div className="row" style={{ gap: 6, alignItems: "center" }}>
      {!open ? (
        <>
          {!v.scheduledAt ? (
            <button className="btn secondary" onClick={() => setOpen(true)}>
              Schedule
            </button>
          ) : (
            <>
              <span style={{ fontSize: 12, opacity: 0.8 }}>
                {new Date(Number(v.scheduledAt)).toLocaleString()}
              </span>
              <button className="btn secondary" onClick={() => onClear(v.tag)}>
                Clear
              </button>
              <button className="btn secondary" onClick={() => setOpen(true)}>
                Edit
              </button>
            </>
          )}
        </>
      ) : (
        <>
          <input
            type="datetime-local"
            value={iso}
            onChange={(e) => setIso(e.target.value)}
          />
          <button
            className="btn primary"
            onClick={() => {
              onSet(v.tag, iso);
              setOpen(false);
            }}
          >
            Save
          </button>
          <button className="btn secondary" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </>
      )}
    </div>
  );
}