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
import PhotoModal from "../components/PhotoModal";

// ---------- helpers ----------
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
const fmtDT = (t) => (t ? new Date(t).toLocaleString() : "—");
// time only (HH:MM) — accepts ms or ISO string
const fmtTime = (t) =>
  t ? new Date(Number(t)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
// format date as DD-MM-YYYY
const fmtDate = (dateStr) => {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "—";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
};
const nowMs = () => Date.now();
const TEN_MIN = 10 * 60 * 1000;

// Reusable Park Icon Component
const ParkIcon = () => (
  <img src="/parked-car.png" alt="Park" style={{ width: "20px", height: "20px" }} />
);

// Reusable Ready Icon Component
const ReadyIcon = () => (
  <img src="/tick.png" alt="Ready" style={{ width: "20px", height: "20px" }} />
);

// Reusable Hand Over Icon Component
const HandOverIcon = () => (
  <img src="/hand-over.png" alt="Hand Over" style={{ width: "20px", height: "20px" }} />
);

// Reusable Schedule Icon Component
const ScheduleIcon = () => (
  <img src="/schedule.png" alt="Schedule" style={{ width: "20px", height: "20px" }} />
);

// Reusable Cancel Icon Component
const CancelIcon = () => (
  <img src="/cancel.png" alt="Cancel" style={{ width: "20px", height: "20px" }} />
);

// Reusable Acknowledge Icon Component
const AcknowledgeIcon = () => (
  <img src="/acknowledge.png" alt="Acknowledge" style={{ width: "20px", height: "20px" }} />
);

// Reusable Photo Icon Component
const CameraIcon = () => (
  <img src="/camera.png" alt="Camera" style={{ width: "20px", height: "20px" }} />
);

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

  // Departure confirmation modal
  const [departureModalOpen, setDepartureModalOpen] = useState(false);
  const [departureTag, setDepartureTag] = useState(null);

  // Photo modal
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [photoTag, setPhotoTag] = useState(null);

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
        // normalize timestamps: accept number or ISO string
        scheduledAt: v.scheduledAt
          ? (Number(v.scheduledAt) || Date.parse(v.scheduledAt))
          : null,
        requestedAt: v.requestedAt
          ? (Number(v.requestedAt) || Date.parse(v.requestedAt))
          : null,
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
    // Filter out departed vehicles
    const list = [...vehicles]
      .filter((v) => v.status !== "departed")
      .sort((a, b) => String(a.tag).localeCompare(String(b.tag)));
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
        // mark requested (enqueue) — staff will ack to move to retrieving
        await updateVehicle(v.tag, {
          status: "requested",
           requested: true,
           requestedAt: Date.now(),
           scheduledAt: null,
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
    // clear bay when marking ready
    await updateVehicle(tag, { bay: "" });
    showToast("Vehicle ready at driveway.");
  };

  const handOver = async (tag) => {
    const v = vehicles.find((x) => x.tag === tag);
    const today = new Date().toISOString().slice(0, 10);
    const departureDate = v?.departureDate || "";
    
    // Check if departure date is today or earlier
    if (departureDate && departureDate <= today) {
      // Show custom modal instead of window.confirm
      setDepartureTag(tag);
      setDepartureModalOpen(true);
      return;
    }
    
    // Normal hand over flow
    await markOut(tag);
    // clear bay when handing over
    await updateVehicle(tag, { bay: "" });
    showToast("Vehicle handed over.");
  };

  const confirmDeparture = async () => {
    if (departureTag) {
      const tag = departureTag;
      await updateVehicle(tag, { 
        status: "departed", 
        bay: "", 
        requested: false, 
        requestedAt: null 
      });
      showToast("Vehicle marked as departed.", async () => {
        // Undo: set status back to "out"
        await updateVehicle(tag, { 
          status: "out"
        });
      });
    }
    setDepartureModalOpen(false);
    setDepartureTag(null);
  };

  const declineDeparture = async () => {
    if (departureTag) {
      // Normal hand over flow
      await markOut(departureTag);
      await updateVehicle(departureTag, { bay: "" });
      showToast("Vehicle handed over.");
    }
    setDepartureModalOpen(false);
    setDepartureTag(null);
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

    // decrement tab badge if this request was counted as unseen
    if (unseenCount.current > 0 && (prevQueueIds.current.has(tag) || v.requested)) {
      unseenCount.current = Math.max(0, unseenCount.current - 1);
      setBadgeCount(unseenCount.current);
      // remove from prevQueueIds so it won't be considered "new" again
      prevQueueIds.current.delete(tag);
    }

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

  const openPhotos = (tag) => {
    setPhotoTag(tag);
    setPhotoModalOpen(true);
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
                <th>Vehicle</th>
                <th>Requested At</th>
                <th>Status</th>
                <th>Bay</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {requestQueue.length === 0 && (
                <tr>
                  <td colSpan="8" style={{ textAlign: "center", opacity: 0.7 }}>
                    No current requests.
                  </td>
                </tr>
              )}
              {requestQueue.map((v) => (
                <tr key={`q-${v.tag}`}>
                  <td>{"#" + v.tag}</td>
                  <td>{v.guestName}</td>
                  <td>{v.roomNumber}</td>
                  <td>{v.color + " " + v.make + " • " + (v.license || "—")}</td>
                  <td>{v.requestedAt ? fmtTime(v.requestedAt) : "—"}</td>
                  <td>
                    <span className={`status-pill status-${v.status}`}>
                      {v.status === "out" ? "Out" : cap(v.status)}
                    </span>
                  </td>
                  <td>{v.bay || "—"}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    {/* one button at a time */}
                    {v.status === "requested" && (
                      <button className="btn secondary" onClick={() => ackRequest(v)}>
                        <AcknowledgeIcon />
                      </button>
                    )}
                    {v.status === "retrieving" && (
                      <button className="btn secondary" onClick={() => setReady(v.tag)}>
                        <ReadyIcon />
                      </button>
                    )}
                    {v.status === "ready" && (
                      <button className="btn secondary" onClick={() => handOver(v.tag)}>
                        <HandOverIcon />
                      </button>
                    )}
                    {v.status !== "out" && (
                      <button className="btn secondary" onClick={() => cancelRequestFor(v.tag)}>
                        <CancelIcon />
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
                <th>Vehicle</th>
                <th>Pickup Time</th>
                <th>Status</th>
                <th>Bay</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {scheduled.length === 0 && (
                <tr>
                  <td colSpan="8" style={{ textAlign: "center", opacity: 0.7 }}>
                    No scheduled pickups.
                  </td>
                </tr>
              )}
              {scheduled.map((v) => (
                <tr key={`s-${v.tag}`}>
                  <td>{"#" + v.tag}</td>
                  <td>{v.guestName}</td>
                  <td>{v.roomNumber}</td>
                  <td>{v.color + " " + v.make + " • " + (v.license || "—")}</td>
                  <td>{fmtDT(v.scheduledAt)}</td>
                  <td>
                    <span className={`status-pill status-${v.status}`}>
                      {v.status === "out" ? "Out" : cap(v.status)}
                    </span>
                  </td>
                  <td>{v.bay || "—"}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <button className="btn secondary" onClick={() => queueNow(v)}>
                      Queue Now
                    </button>
                    <button className="btn secondary" onClick={() => cancelSched(v.tag)}>
                      <CancelIcon />
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
                <th>Departure</th>
                <th>Vehicle</th>
                <th>Status</th>
                <th>Bay</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {active.length === 0 && (
                <tr>
                  <td colSpan="8" style={{ textAlign: "center", opacity: 0.7 }}>
                    No vehicles to display.
                  </td>
                </tr>
              )}
              {active.map((v) => (
                <tr key={`a-${v.tag}`}>
                  <td>{"#" + v.tag}</td>
                  <td>{v.guestName}</td>
                  <td>{v.roomNumber}</td>
                  <td><EditableDepartureDate vehicle={v} /></td>
                  <td>{v.color + " " + v.make + " • " + (v.license || "—")}</td>
                  <td>
                    <span className={`status-pill status-${v.status}`}>
                      {v.status === "out" ? "Out" : cap(v.status)}
                    </span>
                  </td>
                  <td>{v.bay || "—"}</td>
                  <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {/* Request (only visible when allowed) */}
                    {/* {v.status === "parked" && !v.requested && (
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
                    )} */}

                    {/* Park */}
                    <button className="btn secondary" onClick={() => openPark(v)}>
                      <ParkIcon />
                    </button>

                    {/* Ready */}
                    {(v.status === "retrieving" || v.status === "parked" || v.status === "requested") && (
                      <button className="btn secondary" onClick={() => setReady(v.tag)}>
                        <ReadyIcon />
                      </button>
                    )}
                    
                    {/* Hand Over */}
                    {(v.status === "ready" || v.status === "parked" || v.status === "requested" || v.status === "retrieving") && (
                      <button className="btn secondary" onClick={() => handOver(v.tag)}>
                        <HandOverIcon />
                      </button>
                    )}

                    {/* Add & View Photos */}
                    <button className="btn secondary" onClick={() => openPhotos(v.tag)}>
                      <CameraIcon />
                    </button>

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
          <input placeholder="Guest Name" value={parkForm.guestName}
                 onChange={(e) => setParkForm({ ...parkForm, guestName: e.target.value })} />
          <input placeholder="Room Number" value={parkForm.roomNumber}
                 onChange={(e) => setParkForm({ ...parkForm, roomNumber: e.target.value })} />
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn primary" onClick={confirmPark}>Save</button>
            <button className="btn secondary" onClick={() => setParkOpen(false)}>Cancel</button>
          </div>
        </div>
      </Modal>

      {/* Departure Confirmation Modal */}
      <Modal open={departureModalOpen} onClose={() => setDepartureModalOpen(false)} title="Confirm Departure">
        <div className="col" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ marginBottom: 16 }}>
            Mark this vehicle as departed? This will move this vehicle to the history page.
          </p>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn primary" onClick={confirmDeparture}>
              Yes, Mark Departed
            </button>
            <button className="btn secondary" onClick={declineDeparture}>
              No
            </button>
          </div>
        </div>
      </Modal>

      {/* Photo Upload Modal */}
      <PhotoModal
        open={photoModalOpen}
        onClose={() => {
          setPhotoModalOpen(false);
          setPhotoTag(null);
        }}
        vehicleTag={photoTag}
        vehicle={vehicles.find(v => v.tag === photoTag)}
      />
    </div>
  );
}

// Editable departure date component
function EditableDepartureDate({ vehicle }) {
  const [date, setDate] = useState(vehicle.departureDate || "");

  useEffect(() => {
    setDate(vehicle.departureDate || "");
  }, [vehicle.departureDate]);

  const handleDateChange = async (e) => {
    const newDate = e.target.value;
    setDate(newDate);
    
    // Auto-save when date changes
    if (newDate !== vehicle.departureDate) {
      await updateVehicle(vehicle.tag, { departureDate: newDate });
      showToast("Departure date updated.");
    }
  };

  return (
    <div className="row" style={{ gap: 6, alignItems: "center" }}>
      <input
        type="date"
        value={date}
        onChange={handleDateChange}
        style={{ fontSize: "14px", padding: "4px 6px" }}
        title="Select departure date"
      />
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
              <ScheduleIcon />
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