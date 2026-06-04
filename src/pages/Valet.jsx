import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createVehicle,
  subscribeActiveVehicles,
  subscribeExpectedArrivals,
  updateVehicle,
  requestVehicle,
  cancelRequest,
  markReady,
  markOut,
  parkAgain,
  scheduleRequest,
  clearSchedule,
  getVehicleAuditLog,
  archiveVehicle,
  reinstateVehicle,
} from "../services/valetFirestore";
import { sendWelcomeSMS } from "../services/smsService";
import Modal from "../components/Modal";
import { showToast } from "../components/Toast";
import PhotoModal from "../components/PhotoModal";
import { formatPhoneNumber } from "../utils/phoneFormatter";
import { countryCodes } from "../utils/countryCodes";
import CountryCodeSelect from "../components/CountryCodeSelect";
import { getSettings } from "../services/valetFirestore";

// ---------- helpers ----------
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
const displayVehicleStatus = (status) => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'out') return 'Out';
  if (normalized === 'received') return 'Arrived';
  return cap(normalized);
};
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

const getPrimaryCode = (codeStr) =>
  String(codeStr || "").split(",")[0]?.trim() || "";

const normalizeImportedGuestName = (value) => {
  const cleaned = String(value || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';

  const titleAliases = {
    mr: 'Mr',
    mrs: 'Mrs',
    ms: 'Ms',
    miss: 'Miss',
    mx: 'Mx',
    dr: 'Dr',
    prof: 'Prof',
    sir: 'Sir',
    dame: 'Dame',
    lady: 'Lady',
  };

  const normalizeTitle = (token) => {
    const key = String(token || '').replace(/\./g, '').trim().toLowerCase();
    return titleAliases[key] || '';
  };

  const applyTitleOrdering = (parts) => {
    if (!Array.isArray(parts) || parts.length === 0) return [];
    const copy = [...parts];

    const firstTitle = normalizeTitle(copy[0]);
    if (firstTitle) {
      copy[0] = firstTitle;
      return copy;
    }

    const lastTitle = normalizeTitle(copy[copy.length - 1]);
    if (lastTitle) {
      const withoutLast = copy.slice(0, -1);
      return [lastTitle, ...withoutLast];
    }

    return copy;
  };

  // Handle "Surname, First".
  if (cleaned.includes(',')) {
    const [lastName, firstName] = cleaned.split(',').map((part) => part.trim());
    const orderedFirstNameParts = applyTitleOrdering(String(firstName || '').split(' ').filter(Boolean));
    return [...orderedFirstNameParts, lastName].filter(Boolean).join(' ').trim();
  }

  const parts = cleaned.split(' ');
  if (parts.length < 2) return cleaned;

  // Handle common import format "SURNAME First Name".
  const firstTokenLooksLikeSurname = /^[A-Z][A-Z'\-]+$/.test(parts[0]);
  if (!firstTokenLooksLikeSurname) return cleaned;

  const [surname, ...firstNames] = parts;
  const orderedFirstNames = applyTitleOrdering(firstNames);
  return [...orderedFirstNames, surname].join(' ').trim();
};

const resolveCountryCode = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const match = raw.match(/\+\d[\d-]*/);
  if (match) {
    const digits = match[0].replace(/\D/g, "");
    return digits ? `+${digits}` : "";
  }

  const iso = raw.replace(/[^a-z]/gi, "").toUpperCase();
  const isoMatch = countryCodes.find((c) => c.iso.toUpperCase() === iso);
  if (isoMatch) return getPrimaryCode(isoMatch.code);

  const nameMatch = countryCodes.find((c) => c.name.toLowerCase() === raw.toLowerCase());
  if (nameMatch) return getPrimaryCode(nameMatch.code);

  return "";
};

// Split a raw phone (e.g. "+61419503937" or "0416745550") into
// { countryCode: "+61", localDigits: "419503937" } for form pre-fill.
const parsePhoneForForm = (raw) => {
  const s = String(raw || '').replace(/[\s\-\(\)]/g, '');
  if (!s) return { countryCode: '', localDigits: '' };

  if (!s.startsWith('+')) {
    const digits = s.replace(/\D/g, '').replace(/^0+/, '');
    if (!digits) return { countryCode: '', localDigits: '' };
    return { countryCode: '+61', localDigits: digits };
  }

  const withoutPlus = s.slice(1).replace(/\D/g, '');
  for (const len of [3, 2, 1]) {
    if (withoutPlus.length <= len) continue;
    const candidateCode = '+' + withoutPlus.slice(0, len);
    const found = countryCodes.find((c) => getPrimaryCode(c.code) === candidateCode);
    if (found) return { countryCode: candidateCode, localDigits: withoutPlus.slice(len) };
  }
  return { countryCode: '', localDigits: withoutPlus };
};

const parseMoney = (value) => {
  const normalized = String(value || '').replace(/[^\d.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatMoney = (value) => {
  const parsed = parseMoney(value);
  if (parsed === null) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(parsed);
};

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

// Reusable Audit Icon Component
const AuditIcon = () => (
  <img src="/audit.png" alt="Audit" style={{ width: "20px", height: "20px" }} />
);

export default function Staff() {
  const navigate = useNavigate();
  
  // ---------- state ----------
  const [vehicles, setVehicles] = useState([]);
  const [expectedArrivals, setExpectedArrivals] = useState([]);
  const [expectedImportSummary, setExpectedImportSummary] = useState('Waiting for PMS AddOn email to reports@mail.concierge.xin.');
  const [valetParkingPrice, setValetParkingPrice] = useState(70);
  const [filterStatus, setFilterStatus] = useState(""); // active table filter
  const [newOpen, setNewOpen] = useState(false);
  const [arrivalSource, setArrivalSource] = useState(null);
  const [newVehicle, setNewVehicle] = useState({
    resNo: "",
    tag: "",
    guestName: "",
    roomNumber: "",
    countryCode: "",
    phone: "",
    departureDate: "",
  });
  const [newVehicleErrors, setNewVehicleErrors] = useState({
    resNo: false,
    tag: false,
    guestName: false,
    roomNumber: false,
    countryCode: false,
    phone: false,
    departureDate: false,
  });

  // Park modal
  const [parkOpen, setParkOpen] = useState(false);
  const [parkForTag, setParkForTag] = useState(null);
  const [parkForm, setParkForm] = useState({
    bay: "",
    license: "",
    make: "",
    color: "",
    guestName: "",
    roomNumber: "",
  });
  const [parkErrors, setParkErrors] = useState({
    bay: false,
    license: false,
    guestName: false,
    roomNumber: false,
  });

  // Departure confirmation modal
  const [departureModalOpen, setDepartureModalOpen] = useState(false);
  const [departureTag, setDepartureTag] = useState(null);

  // Photo modal
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [photoTag, setPhotoTag] = useState(null);

  // Audit modal
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [auditTag, setAuditTag] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

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

  useEffect(() => {
    let active = true;
    getSettings()
      .then((settings) => {
        if (!active) return;
        const parsed = Number(settings?.valetParkingPrice);
        setValetParkingPrice(Number.isFinite(parsed) ? parsed : 70);
      })
      .catch((error) => {
        console.error('Failed to load valet price setting:', error);
      });

    return () => {
      active = false;
    };
  }, []);

  // tab title badge

  useEffect(() => {
    const unsub = subscribeExpectedArrivals((list) => {
      const sorted = [...list].sort((a, b) => {
        const timeA = Date.parse(a.updatedAt || a.importedAt || 0) || 0;
        const timeB = Date.parse(b.updatedAt || b.importedAt || 0) || 0;
        return timeB - timeA;
      });

      setExpectedArrivals(sorted);
      setExpectedImportSummary(
        sorted.length > 0
          ? `Synced ${sorted.length} expected arrival(s) from reports@mail.concierge.xin.`
          : 'Waiting for PMS AddOn email to reports@mail.concierge.xin.'
      );
    });

    return () => unsub && unsub();
  }, []);
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
  const [viewMode, setViewMode] = useState("tiles"); // "tiles" or "map"
  const [showPendingArrivals, setShowPendingArrivals] = useState(false);

  const vehiclesByExpectedArrivalId = useMemo(() => {
    const map = new Map();
    vehicles.forEach((v) => {
      const id = String(v.expectedArrivalId || '').trim();
      if (id) map.set(id, v);
    });
    return map;
  }, [vehicles]);

  // Expected arrivals that are still waiting to be ticketed.
  const expectedArrivalRows = useMemo(() => {
    return expectedArrivals.filter((row) => {
      const workflowStatus = String(row.workflowStatus || '').trim().toLowerCase();
      if (workflowStatus) return workflowStatus === 'expected';

      // Backward compatibility for older rows before workflowStatus existed.
      const status = String(row.status || '').trim().toLowerCase();
      return status === 'confirmed' && !row.mergedAt;
    });
  }, [expectedArrivals]);

  // Arrived rows that were auto-created and still need manual ticket activation.
  const pendingActivationArrivalRows = useMemo(() => {
    return expectedArrivals.filter((row) => {
      const rowId = String(row.id || row.rowDocId || '').trim();
      if (!rowId) return false;

      const workflowStatus = String(row.workflowStatus || '').trim().toLowerCase();
      if (workflowStatus !== 'arrived') return false;

      const linkedVehicle = vehiclesByExpectedArrivalId.get(rowId);
      if (!linkedVehicle) return true;

      return linkedVehicle.autoCreatedFromCsv && linkedVehicle.status === 'received';
    });
  }, [expectedArrivals, vehiclesByExpectedArrivalId]);

  // Close status dropdown when clicking outside
  useEffect(() => {
    const close = () => setShowStatusMenu(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const active = useMemo(() => {
    // Filter out departed vehicles and unactivated CSV placeholders.
    const list = [...vehicles]
      .filter((v) => v.status !== "departed")
      .filter((v) => !(v.autoCreatedFromCsv && v.status === 'received'))
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
  const startExpectedArrival = (row) => {
    const rowId = String(row.id || row.rowDocId || '').trim();
    const linkedVehicle = rowId ? vehiclesByExpectedArrivalId.get(rowId) : null;
    const importedName = normalizeImportedGuestName(row.fullName || row.surname || '');

    setArrivalSource(row);
    const { countryCode: preFillCode, localDigits: preFillPhone } = parsePhoneForForm(linkedVehicle?.phone || row.phone || '');
    setNewVehicle({
      resNo: row.resNo || '',
      tag: linkedVehicle?.tag || '',
      guestName: linkedVehicle?.guestName || importedName,
      roomNumber: linkedVehicle?.roomNumber || row.roomNumber || '',
      countryCode: preFillCode,
      phone: preFillPhone,
      departureDate: linkedVehicle?.departureDate || row.depart || row.departureDate || '',
    });
    setNewVehicleErrors({
      resNo: false,
      tag: false,
      guestName: false,
      roomNumber: false,
      countryCode: false,
      phone: false,
      departureDate: false,
    });
    setNewOpen(true);
  };

  const handleCreate = async () => {
    const { resNo, tag, guestName, roomNumber, countryCode, phone, departureDate } = newVehicle;
    const parsedCode = resolveCountryCode(countryCode);
    const effectiveCode = parsedCode || "+61";
    const phoneDigits = String(phone).replace(/\D/g, "").replace(/^0+/, "");
    
    const errors = {
      resNo: !String(resNo).trim(),
      tag: !String(tag).trim(),
      guestName: !String(guestName).trim(),
      roomNumber: !String(roomNumber).trim(),
      countryCode: Boolean(countryCode && !parsedCode),
      phone: !String(phone).trim() || phoneDigits.length === 0,
      departureDate: !String(departureDate).trim(),
    };

    setNewVehicleErrors(errors);

    // If any errors, don't proceed
    if (Object.values(errors).some(e => e)) {
      return;
    }

    // Format phone number to international format
    const formattedPhone = formatPhoneNumber(`${effectiveCode}${phoneDigits}`);

    const resetForm = () => {
      setNewVehicle({
        resNo: '',
        tag: '',
        guestName: '',
        roomNumber: '',
        countryCode: '',
        phone: '',
        departureDate: '',
      });
      setNewVehicleErrors({
        resNo: false,
        tag: false,
        guestName: false,
        roomNumber: false,
        countryCode: false,
        phone: false,
        departureDate: false,
      });
      setNewOpen(false);
      setArrivalSource(null);
    };

    try {
      await createVehicle({
        resNo,
        expectedArrivalId: arrivalSource?.id || '',
        tag,
        guestName,
        roomNumber,
        phone: formattedPhone,
        departureDate,
      });
    } catch (error) {
      console.error("Failed to create vehicle:", error);
      showToast("Failed to create vehicle. Please try again.");
      return;
    }

    resetForm();

    // Send welcome SMS with guest link
    try {
      const smsResult = await sendWelcomeSMS(formattedPhone, tag);
      if (smsResult?.skipped) {
        showToast('Vehicle created (welcome SMS is disabled in settings).');
      } else {
        showToast("Vehicle created and guest notified via SMS.");
      }
    } catch (error) {
      console.error("Failed to send SMS:", error);
      showToast("Vehicle created (SMS failed to send).");
    }
  };

  const openPark = (v) => {
    setParkForTag(v.tag);
    setParkForm({
      bay: "", // always ask for bay again
      license: v.license || "",
      make: v.make || "",
      color: v.color || "",
      guestName: v.guestName || "",
      roomNumber: v.roomNumber || "",
    });
    setParkErrors({
      bay: false,
      license: false,
      guestName: false,
      roomNumber: false,
    });
    setParkOpen(true);
  };

  const confirmPark = async () => {
    const errors = {
      bay: !String(parkForm.bay).trim(),
      license: !String(parkForm.license).trim(),
      guestName: !String(parkForm.guestName).trim(),
      roomNumber: !String(parkForm.roomNumber).trim(),
    };

    setParkErrors(errors);

    // If any errors, don't proceed
    if (Object.values(errors).some(e => e)) {
      return;
    }
    
    await parkAgain(
      parkForTag,
      parkForm.bay ?? "",
      parkForm.license.toUpperCase() ?? "", // Capitalize license plate
      parkForm.make ?? "",
      parkForm.color ?? ""
    );
    
    // Update guest name and room number
    await updateVehicle(parkForTag, {
      guestName: parkForm.guestName,
      roomNumber: parkForm.roomNumber,
    });
    
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
      const vehicle = vehicles.find(v => v.tag === tag);
      
      if (vehicle) {
        try {
          // Archive the vehicle and get the history document ID
          const historyDocId = await archiveVehicle(tag, vehicle);
          
          setDepartureModalOpen(false);
          setDepartureTag(null);
          
          showToast("Vehicle moved to history.", async () => {
            // Undo: restore from history using the document ID
            await reinstateVehicle(historyDocId, vehicle);
          });
        } catch (error) {
          console.error('Error archiving vehicle:', error);
          showToast('Failed to archive vehicle.');
          setDepartureModalOpen(false);
          setDepartureTag(null);
        }
      }
    } else {
      setDepartureModalOpen(false);
      setDepartureTag(null);
    }
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

  const handleViewAudit = async (tag) => {
    setAuditTag(tag);
    setAuditModalOpen(true);
    setAuditLoading(true);
    setAuditLogs([]);
    
    try {
      const logs = await getVehicleAuditLog(tag);
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

  // ---------- UI ----------
  return (
    <div className="page pad">
      {/* Header */}
      <div className="row space-between" style={{ marginBottom: 16 }}>
        <h2>Valet Management</h2>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="btn secondary" onClick={() => navigate('/valet-history')} title="Go to valet history">
            View History
          </button>
          <button className="btn primary" onClick={() => setNewOpen(true)} title="Add a new vehicle">
            Add Vehicle
          </button>
        </div>
      </div>

      <section className="card pad" style={{ marginBottom: 16 }}>
        <div className="row space-between" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <div>
            <h3 style={{ marginBottom: 6 }}>Expected Arrivals</h3>
          </div>
        </div>

        {expectedImportSummary && (
          <div style={{ marginBottom: 10, color: '#2e7d32', fontSize: 13 }}>
            {expectedImportSummary}
          </div>
        )}

        <ExpectedArrivalsTileView
          rows={expectedArrivalRows}
          valetParkingPrice={valetParkingPrice}
          onCreateTicket={startExpectedArrival}
        />

        {pendingActivationArrivalRows.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <button
              className="btn secondary"
              onClick={() => setShowPendingArrivals((prev) => !prev)}
              style={{ marginBottom: 10 }}
              title="Show or hide arrived rows pending ticket activation"
            >
              {showPendingArrivals ? 'Hide' : 'Show'} Arrived Pending Activation ({pendingActivationArrivalRows.length})
            </button>

            {showPendingArrivals && (
              <ExpectedArrivalsTileView
                rows={pendingActivationArrivalRows}
                valetParkingPrice={valetParkingPrice}
                onCreateTicket={startExpectedArrival}
              />
            )}
          </div>
        )}
      </section>

      {/* Request Queue */}
      <section className="card pad" style={{ marginBottom: 16 }}>
        <h3>Request Queue</h3>
        <RequestQueueTileView
          vehicles={requestQueue}
          onAck={ackRequest}
          onHandOver={handOver}
          onCancel={cancelRequestFor}
        />
      </section>

      {/* Scheduled Pickups */}
      <section className="card pad" style={{ marginBottom: 16 }}>
        <h3>Scheduled Pickups</h3>
        <ScheduledPickupTileView
          vehicles={scheduled}
          onQueueNow={queueNow}
          onCancel={cancelSched}
        />
      </section>

      {/* Active Vehicles */}
      <section className="card pad">
        <div className="row space-between" style={{ marginBottom: 8 }}>
          <h3>Active Vehicles</h3>
          {/* Filter Bar */}
          <div style={{display: "flex",justifyContent: "flex-end",gap: "12px",position: "relative",marginLeft: "auto",alignItems: "center"}}>
            {/* View Mode Toggle */}
            <div style={{ display: "flex", gap: "4px", background: "#f0f0f0", borderRadius: "8px", padding: "4px" }}>
              <button
                className="btn secondary"
                onClick={() => setViewMode("tiles")}
                style={{
                  padding: "6px 16px",
                  background: viewMode === "tiles" ? "#fff" : "transparent",
                  border: "none",
                  boxShadow: viewMode === "tiles" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  fontSize: "14px"
                }}
              >
                Tiles
              </button>
              <button
                className="btn secondary"
                onClick={() => setViewMode("map")}
                style={{
                  padding: "6px 16px",
                  background: viewMode === "map" ? "#fff" : "transparent",
                  border: "none",
                  boxShadow: viewMode === "map" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  fontSize: "14px"
                }}
              >
                Map
              </button>
            </div>

            <div style={{display: "flex",justifyContent: "flex-end",gap: "12px",position: "relative"}}>
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
        </div>

        {viewMode === "map" ? (
          <ParkingMapView 
            vehicles={active} 
            onPark={openPark}
            onReady={setReady}
            onHandOver={handOver}
            onPhotos={openPhotos}
            onAudit={handleViewAudit}
          />
        ) : (
          <VehicleTileView
            vehicles={active}
            onPark={openPark}
            onReady={setReady}
            onHandOver={handOver}
            onPhotos={openPhotos}
            onAudit={handleViewAudit}
            onSchedule={setSchedule}
            onCancelSchedule={cancelSched}
          />
        )}
      </section>

      {/* Create Vehicle */}
      <Modal open={newOpen} onClose={() => { setNewOpen(false); setArrivalSource(null); }} title={arrivalSource ? "Create Ticket" : "Add Vehicle"}>
        <div className="col" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {arrivalSource && (
            <div style={{ border: '1px solid #d0d5dd', borderRadius: 12, padding: 12, background: '#f8fafc', fontSize: 13 }}>
              <strong>Imported PMS row:</strong> {arrivalSource.resNo} / {normalizeImportedGuestName(arrivalSource.fullName || arrivalSource.surname || '')}
              {(arrivalSource.fullName || arrivalSource.surname) && (
                <div style={{ marginTop: 4, color: '#667085' }}>
                  Contact details pre-filled from Arrival List. Please assign a tag number to complete check-in.
                </div>
              )}
              {!(arrivalSource.fullName || arrivalSource.surname) && (
                <div style={{ marginTop: 4, color: '#667085' }}>
                  Enter the guest's full name, tag number, room number, and phone to complete the check-in.
                </div>
              )}
              <div style={{ marginTop: 4, color: Math.abs((arrivalSource.amount || 0) - valetParkingPrice) > 0.01 ? '#c62828' : '#2e7d32' }}>
                {Math.abs((arrivalSource.amount || 0) - valetParkingPrice) > 0.01
                  ? `Amount ${formatMoney(arrivalSource.amount)} does not match valet price ${formatMoney(valetParkingPrice)}.`
                  : `Amount matches valet price ${formatMoney(valetParkingPrice)}.`}
              </div>
            </div>
          )}
          <div>
            <input 
              placeholder="Reservation Number (required)" 
              value={newVehicle.resNo}
              onChange={(e) => {
                setNewVehicle({ ...newVehicle, resNo: e.target.value });
                if (newVehicleErrors.resNo) setNewVehicleErrors({ ...newVehicleErrors, resNo: false });
              }}
              style={{ borderColor: newVehicleErrors.resNo ? "#ff4444" : undefined }}
            />
            {newVehicleErrors.resNo && (
              <div style={{ color: "#ff4444", fontSize: "12px", marginTop: "4px" }}>
                *this field is required
              </div>
            )}
          </div>
          <div>
            <input 
              placeholder="Tag Number (required)" 
              value={newVehicle.tag}
              onChange={(e) => {
                setNewVehicle({ ...newVehicle, tag: e.target.value });
                if (newVehicleErrors.tag) setNewVehicleErrors({ ...newVehicleErrors, tag: false });
              }}
              style={{ borderColor: newVehicleErrors.tag ? "#ff4444" : undefined }}
            />
            {newVehicleErrors.tag && (
              <div style={{ color: "#ff4444", fontSize: "12px", marginTop: "4px" }}>
                *this field is required
              </div>
            )}
          </div>

          <div>
            <input 
              placeholder={arrivalSource ? "First name + surname (required)" : "Guest Name (required)"} 
              value={newVehicle.guestName}
              onChange={(e) => {
                setNewVehicle({ ...newVehicle, guestName: e.target.value });
                if (newVehicleErrors.guestName) setNewVehicleErrors({ ...newVehicleErrors, guestName: false });
              }}
              style={{ borderColor: newVehicleErrors.guestName ? "#ff4444" : undefined }}
            />
            {newVehicleErrors.guestName && (
              <div style={{ color: "#ff4444", fontSize: "12px", marginTop: "4px" }}>
                *this field is required
              </div>
            )}
          </div>

          <div>
            <input 
              placeholder="Room Number (required)" 
              value={newVehicle.roomNumber}
              onChange={(e) => {
                setNewVehicle({ ...newVehicle, roomNumber: e.target.value });
                if (newVehicleErrors.roomNumber) setNewVehicleErrors({ ...newVehicleErrors, roomNumber: false });
              }}
              style={{ borderColor: newVehicleErrors.roomNumber ? "#ff4444" : undefined }}
            />
            {newVehicleErrors.roomNumber && (
              <div style={{ color: "#ff4444", fontSize: "12px", marginTop: "4px" }}>
                *this field is required
              </div>
            )}
          </div>

          <div>
            <div className="row" style={{ gap: 8 }}>
              <div style={{ minWidth: 170, flex: "0 0 170px" }}>
                <CountryCodeSelect
                  value={newVehicle.countryCode}
                  onChange={(value) => {
                    setNewVehicle({ ...newVehicle, countryCode: value });
                    if (newVehicleErrors.countryCode) setNewVehicleErrors({ ...newVehicleErrors, countryCode: false });
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <input 
                  placeholder="Phone (required)" 
                  value={newVehicle.phone}
                  onChange={(e) => {
                    setNewVehicle({ ...newVehicle, phone: e.target.value });
                    if (newVehicleErrors.phone) setNewVehicleErrors({ ...newVehicleErrors, phone: false });
                  }}
                  style={{ borderColor: newVehicleErrors.phone ? "#ff4444" : undefined }}
                />
              </div>
            </div>
            {(newVehicleErrors.countryCode || newVehicleErrors.phone) && (
              <div style={{ color: "#ff4444", fontSize: "12px", marginTop: "4px" }}>
                {newVehicleErrors.countryCode && "*country code is required"}
                {newVehicleErrors.countryCode && newVehicleErrors.phone ? " | " : ""}
                {newVehicleErrors.phone && "*phone is required"}
              </div>
            )}
          </div>

          <div>
            <label style={{ fontSize: 12, opacity: 0.7, marginBottom: 4, display: "block" }}>
              Departure Date (required)
            </label>
            <input 
              type="date" 
              value={newVehicle.departureDate}
              onChange={(e) => {
                setNewVehicle({ ...newVehicle, departureDate: e.target.value });
                if (newVehicleErrors.departureDate) setNewVehicleErrors({ ...newVehicleErrors, departureDate: false });
              }}
              style={{ borderColor: newVehicleErrors.departureDate ? "#ff4444" : undefined }}
            />
            {newVehicleErrors.departureDate && (
              <div style={{ color: "#ff4444", fontSize: "12px", marginTop: "4px" }}>
                *this field is required
              </div>
            )}
          </div>

          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn primary" onClick={handleCreate} title="Create ticket from this arrival row">{arrivalSource ? 'Create Ticket' : 'Create Vehicle'}</button>
            <button className="btn secondary" onClick={() => { setNewOpen(false); setArrivalSource(null); }} title="Cancel and close">Cancel</button>
          </div>
        </div>
      </Modal>

      {/* Park Modal */}
      <Modal open={parkOpen} onClose={() => setParkOpen(false)} title="Return & Park">
        <div className="col" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <input 
              placeholder="Bay (required)" 
              value={parkForm.bay}
              onChange={(e) => {
                setParkForm({ ...parkForm, bay: e.target.value });
                if (parkErrors.bay) setParkErrors({ ...parkErrors, bay: false });
              }}
              style={{ borderColor: parkErrors.bay ? "#ff4444" : undefined }}
            />
            {parkErrors.bay && (
              <div style={{ color: "#ff4444", fontSize: "12px", marginTop: "4px" }}>
                *this field is required
              </div>
            )}
          </div>

          <div>
            <input 
              placeholder="License Plate (required)" 
              value={parkForm.license}
              onChange={(e) => {
                setParkForm({ ...parkForm, license: e.target.value.toUpperCase() });
                if (parkErrors.license) setParkErrors({ ...parkErrors, license: false });
              }}
              style={{ 
                borderColor: parkErrors.license ? "#ff4444" : undefined
              }}
            />
            {parkErrors.license && (
              <div style={{ color: "#ff4444", fontSize: "12px", marginTop: "4px" }}>
                *this field is required
              </div>
            )}
          </div>

          <input 
            placeholder="Make" 
            value={parkForm.make}
            onChange={(e) => setParkForm({ ...parkForm, make: e.target.value })} 
          />

          <input 
            placeholder="Color" 
            value={parkForm.color}
            onChange={(e) => setParkForm({ ...parkForm, color: e.target.value })} 
          />

          <div>
            <input 
              placeholder="Guest Name (required)" 
              value={parkForm.guestName}
              onChange={(e) => {
                setParkForm({ ...parkForm, guestName: e.target.value });
                if (parkErrors.guestName) setParkErrors({ ...parkErrors, guestName: false });
              }}
              style={{ borderColor: parkErrors.guestName ? "#ff4444" : undefined }}
            />
            {parkErrors.guestName && (
              <div style={{ color: "#ff4444", fontSize: "12px", marginTop: "4px" }}>
                *this field is required
              </div>
            )}
          </div>

          <div>
            <input 
              placeholder="Room Number (required)" 
              value={parkForm.roomNumber}
              onChange={(e) => {
                setParkForm({ ...parkForm, roomNumber: e.target.value });
                if (parkErrors.roomNumber) setParkErrors({ ...parkErrors, roomNumber: false });
              }}
              style={{ borderColor: parkErrors.roomNumber ? "#ff4444" : undefined }}
            />
            {parkErrors.roomNumber && (
              <div style={{ color: "#ff4444", fontSize: "12px", marginTop: "4px" }}>
                *this field is required
              </div>
            )}
          </div>

          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn primary" onClick={confirmPark} title="Save parking details">Save</button>
            <button className="btn secondary" onClick={() => setParkOpen(false)} title="Cancel and close">Cancel</button>
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
            <button className="btn primary" onClick={confirmDeparture} title="Confirm departure and archive vehicle">
              Yes, Mark Departed
            </button>
            <button className="btn secondary" onClick={declineDeparture} title="Cancel — do not mark as departed">
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

      {/* Audit Log Modal */}
      <Modal open={auditModalOpen} onClose={() => setAuditModalOpen(false)} title={`Audit Trail - Tag #${auditTag}`}>
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
            <button className="btn secondary" onClick={() => setAuditModalOpen(false)} title="Close audit log">
              Close
            </button>
          </div>
        </div>
      </Modal>

    </div>
  );
}

// Parking Map View Component
function ParkingMapView({ vehicles, onPark, onReady, onHandOver, onPhotos, onAudit }) {
  const [hoveredBay, setHoveredBay] = useState(null);
  const [selectedVehicle, setSelectedVehicle] = useState(null);

  // Create a map of bay number to vehicle
  const bayToVehicle = useMemo(() => {
    const map = {};
    vehicles.forEach(v => {
      if (v.bay) {
        map[v.bay.toString()] = v;
      }
    });
    return map;
  }, [vehicles]);

  // Get status color for a bay
  const getBayColor = (bayNum) => {
    const vehicle = bayToVehicle[bayNum.toString()];
    if (!vehicle) return "#e8f5e9"; // vacant - light green
    
    switch (vehicle.status) {
      case "received": return "#9e9e9e"; // gray
      case "parked": return "#e8daec"; // light purple
      case "requested": return "#ff5900"; // orange
      case "retrieving": return "#ffa726"; // amber
      case "ready": return "#4caf50"; // green
      case "out": return "#1976d2"; // blue
      default: return "#e0e0e0"; // gray
    }
  };

  // Render a parking bay
  const ParkingBay = ({ number, x, y, width = 95, height = 200 }) => {
    const vehicle = bayToVehicle[number.toString()];
    const color = getBayColor(number);
    const isHovered = hoveredBay === number;

    return (
      <g
        onMouseEnter={() => setHoveredBay(number)}
        onMouseLeave={() => setHoveredBay(null)}
        onClick={() => vehicle && setSelectedVehicle(vehicle)}
        style={{ cursor: vehicle ? "pointer" : "default" }}
      >
        {/* Bay rectangle */}
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={color}
          stroke={isHovered ? "#000" : "#666"}
          strokeWidth={isHovered ? 3 : 1.5}
          rx="4"
        />
        
        {/* Bay number */}
        <text
          x={x + width / 2}
          y={y + 30}
          textAnchor="middle"
          fontSize="24"
          fontWeight="bold"
          fill="#333"
        >
          {number}
        </text>

        {/* Vehicle info if occupied */}
        {vehicle && (
          <>
            <text
              x={x + width / 2}
              y={y + 65}
              textAnchor="middle"
              fontSize="11"
              fill="#333"
              fontWeight="500"
            >
              #{vehicle.tag}
            </text>
            <text
              x={x + width / 2}
              y={y + 85}
              textAnchor="middle"
              fontSize="10"
              fill="#555"
            >
              {vehicle.guestName?.length > 12 
                ? vehicle.guestName.substring(0, 12) + '...' 
                : vehicle.guestName}
            </text>
            <text
              x={x + width / 2}
              y={y + 102}
              textAnchor="middle"
              fontSize="10"
              fill="#555"
            >
              Rm {vehicle.roomNumber}
            </text>
            {vehicle.make && (
              <text
                x={x + width / 2}
                y={y + 120}
                textAnchor="middle"
                fontSize="9"
                fill="#666"
              >
                {vehicle.make?.length > 12 
                  ? vehicle.make.substring(0, 12) + '...' 
                  : vehicle.make}
              </text>
            )}
            {vehicle.license && (
              <text
                x={x + width / 2}
                y={y + 135}
                textAnchor="middle"
                fontSize="9"
                fontWeight="600"
                fill="#333"
              >
                {vehicle.license}
              </text>
            )}
          </>
        )}

        {/* Status indicator */}
        {vehicle && (
          <circle
            cx={x + width - 15}
            cy={y + 15}
            r="8"
            fill={color}
            stroke="#fff"
            strokeWidth="2"
          />
        )}
      </g>
    );
  };

  return (
    <div style={{ position: "relative" }}>
      {/* Legend */}
      <div style={{ 
        display: "flex", 
        gap: "16px", 
        marginBottom: "16px", 
        flexWrap: "wrap",
        padding: "12px",
        background: "#f8f8f8",
        borderRadius: "8px"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ width: "16px", height: "16px", background: "#e8f5e9", border: "1px solid #666", borderRadius: "3px" }}></div>
          <span style={{ fontSize: "13px" }}>Vacant</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ width: "16px", height: "16px", background: "#e8daec", border: "1px solid #666", borderRadius: "3px" }}></div>
          <span style={{ fontSize: "13px" }}>Parked</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ width: "16px", height: "16px", background: "#ff5900", border: "1px solid #666", borderRadius: "3px" }}></div>
          <span style={{ fontSize: "13px" }}>Requested</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ width: "16px", height: "16px", background: "#ffa726", border: "1px solid #666", borderRadius: "3px" }}></div>
          <span style={{ fontSize: "13px" }}>Retrieving</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ width: "16px", height: "16px", background: "#4caf50", border: "1px solid #666", borderRadius: "3px" }}></div>
          <span style={{ fontSize: "13px" }}>Ready</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ width: "16px", height: "16px", background: "#1976d2", border: "1px solid #666", borderRadius: "3px" }}></div>
          <span style={{ fontSize: "13px" }}>Out</span>
        </div>
      </div>

      {/* SVG Map */}
      <svg viewBox="0 0 900 700" style={{ width: "100%", height: "auto", background: "#f5f5f5", borderRadius: "8px" }}>
        {/* Top Row - Bays 1-5 */}
        <ParkingBay number={1} x={790} y={10} />
        <ParkingBay number={2} x={685} y={10} />
        <ParkingBay number={3} x={260} y={10} />
        <ParkingBay number={4} x={155} y={10} />
        <ParkingBay number={5} x={50} y={10} />

        {/* Elevator */}
        <rect x={395} y={80} width={250} height={120} fill="#ffcc80" stroke="#666" strokeWidth="2" rx="6" />
        <text x={520} y={150} textAnchor="middle" fontSize="22" fontWeight="bold" fill="#333">Elevator</text>

        {/* Right Side - Bays 6-7 */}
        <ParkingBay number={6} x={785} y={250} width={110} height={200} /> {/* Accessible bay - wider */}
        <ParkingBay number={7} x={680} y={250} width={95} />

        {/* Middle Group - Bays 8-10 */}
        <ParkingBay number={8} x={575} y={250} />
        <ParkingBay number={9} x={470} y={250} />
        <ParkingBay number={10} x={365} y={250} />

        {/* Left Group Top - Bays 11-13 */}
        <ParkingBay number={11} x={260} y={250} />
        <ParkingBay number={12} x={155} y={250} />
        <ParkingBay number={13} x={50} y={250} />

        {/* Bottom Row - Bays 15-21 */}
        <ParkingBay number={15} x={680} y={470} />
        <ParkingBay number={16} x={575} y={470} />
        <ParkingBay number={17} x={470} y={470} />
        <ParkingBay number={18} x={365} y={470} />
        <ParkingBay number={19} x={260} y={470} />
        <ParkingBay number={20} x={155} y={470} />
        <ParkingBay number={21} x={50} y={470} />

        {/* Wall where bay 14 would be */}
        <rect x={785} y={470} width={110} height={200} fill="#999" stroke="#666" strokeWidth="2" rx="4" />
      </svg>

      {/* Vehicle Detail Modal */}
      {selectedVehicle && (
        <div
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            background: "#fff",
            padding: "24px",
            borderRadius: "12px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
            zIndex: 1000,
            minWidth: "400px",
            maxWidth: "500px"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "16px" }}>
            <h3 style={{ margin: 0 }}>Vehicle #{selectedVehicle.tag} - Bay {selectedVehicle.bay}</h3>
            <button
              onClick={() => setSelectedVehicle(null)}
              style={{
                background: "none",
                border: "none",
                fontSize: "24px",
                cursor: "pointer",
                padding: "0",
                lineHeight: "1"
              }}
            >
              ×
            </button>
          </div>

          <div style={{ marginBottom: "20px" }}>
            <div style={{ marginBottom: "8px" }}>
              <strong>Guest:</strong> {selectedVehicle.guestName} (Room {selectedVehicle.roomNumber})
            </div>
            <div style={{ marginBottom: "8px" }}>
              <strong>Vehicle:</strong> {selectedVehicle.color} {selectedVehicle.make}
            </div>
            {selectedVehicle.license && (
              <div style={{ marginBottom: "8px" }}>
                <strong>License:</strong> {selectedVehicle.license}
              </div>
            )}
            <div style={{ marginBottom: "8px" }}>
              <strong>Status:</strong>{" "}
              <span className={`status-pill status-${selectedVehicle.status}`}>
                {displayVehicleStatus(selectedVehicle.status)}
              </span>
            </div>
            {selectedVehicle.departureDate && (
              <div style={{ marginBottom: "8px" }}>
                <strong>Departure:</strong> {fmtDate(selectedVehicle.departureDate)}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button className="btn secondary" onClick={() => { onPark(selectedVehicle); setSelectedVehicle(null); }} title="Park / update parking details">
              <ParkIcon /> Park
            </button>
            {(selectedVehicle.status === "retrieving" || selectedVehicle.status === "parked" || selectedVehicle.status === "requested") && (
              <button className="btn secondary" onClick={() => { onReady(selectedVehicle.tag); setSelectedVehicle(null); }} title="Mark vehicle as ready for handover">
                <ReadyIcon /> Ready
              </button>
            )}
            {(selectedVehicle.status === "ready" || selectedVehicle.status === "parked" || selectedVehicle.status === "requested" || selectedVehicle.status === "retrieving") && (
              <button className="btn secondary" onClick={() => { onHandOver(selectedVehicle.tag); setSelectedVehicle(null); }} title="Hand over vehicle to guest">
                <HandOverIcon /> Hand Over
              </button>
            )}
            <button className="btn secondary" onClick={() => { onPhotos(selectedVehicle.tag); setSelectedVehicle(null); }} title="View or add vehicle photos">
              <CameraIcon /> Photos
            </button>
            <button className="btn secondary" onClick={() => { onAudit(selectedVehicle.tag); setSelectedVehicle(null); }} title="View audit log">
              <AuditIcon /> Audit
            </button>
          </div>
        </div>
      )}

      {/* Modal Backdrop */}
      {selectedVehicle && (
        <div
          onClick={() => setSelectedVehicle(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 999
          }}
        />
      )}
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

// inline scheduling widget for vehicle tiles
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
            <button className="btn secondary" onClick={() => setOpen(true)} title="Schedule a pickup time">
              <ScheduleIcon />
            </button>
          ) : (
            <>
              <span style={{ fontSize: 12, opacity: 0.8 }}>
                {new Date(Number(v.scheduledAt)).toLocaleString()}
              </span>
              <button className="btn secondary" onClick={() => onClear(v.tag)} title="Clear scheduled pickup">
                Clear
              </button>
              <button className="btn secondary" onClick={() => setOpen(true)} title="Edit scheduled pickup time">
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
            title="Save scheduled pickup time"
          >
            Save
          </button>
          <button className="btn secondary" onClick={() => setOpen(false)} title="Cancel editing schedule">
            Cancel
          </button>
        </>      )}
    </div>
  );
}

function ExpectedArrivalsTileView({ rows, valetParkingPrice, onCreateTicket }) {
  if (rows.length === 0) {
    return (
      <div style={{ padding: 16, border: "1px dashed #d0d5dd", borderRadius: 12, color: "#667085", fontSize: 14 }}>
        No PMS rows received yet.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
      {rows.map((row) => {
        const isArrived = String(row.workflowStatus || '').toLowerCase() === 'arrived';
        const amountMismatch = Math.abs((row.amount || 0) - valetParkingPrice) > 0.01;
        const isEnriched = Boolean(row.phone || row.roomNumber || row.fullName);
        const displayName = normalizeImportedGuestName(row.fullName || row.surname || '') || '-';
        return (
          <div
            key={row.id}
            style={{
              border: `1px solid ${isArrived ? '#ffe0b2' : '#d0d5dd'}`,
              borderRadius: 12,
              padding: 14,
              background: isArrived ? '#fffaf5' : '#fff',
              display: "flex",
              flexDirection: "column",
              gap: 10
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Res {row.resNo || "-"}</strong>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                {isEnriched && (
                  <span className="status-pill" style={{ background: "#e3f2fd", color: "#1565c0", fontSize: 11 }}>
                    Enriched
                  </span>
                )}
                {isArrived
                  ? <span className="status-pill" style={{ background: "#fff3e0", color: "#e65100" }}>Arrived</span>
                  : <span className="status-pill">Expected</span>
                }
              </div>
            </div>
            <div style={{ fontSize: 14, opacity: 0.9 }}>
              <div><strong>Guest:</strong> {displayName}</div>
              {row.roomNumber && <div><strong>Room:</strong> {row.roomNumber}</div>}
              {row.phone && <div><strong>Phone:</strong> {row.phone}</div>}
              <div><strong>Arrive:</strong> {row.arrive || "-"}</div>
              <div><strong>Depart:</strong> {row.depart || "-"}</div>
              {row.eta && <div><strong>ETA:</strong> {row.eta}</div>}
              {row.rego && <div><strong>Rego:</strong> {row.rego}</div>}
              <div><strong>Amount:</strong> {formatMoney(row.amount)}</div>
            </div>
            <span
              className="status-pill"
              style={{
                alignSelf: "flex-start",
                background: amountMismatch ? "#ffebee" : "#e8f5e9",
                color: amountMismatch ? "#c62828" : "#2e7d32",
              }}
            >
              {amountMismatch ? `Mismatch vs AUD ${valetParkingPrice.toFixed(2)}` : "Matches valet price"}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn secondary" onClick={() => onCreateTicket(row)} title="Create a valet ticket and complete guest details">
                Create Ticket
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RequestQueueTileView({ vehicles, onAck, onHandOver, onCancel }) {
  if (vehicles.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 24, opacity: 0.7 }}>
        No vehicles in request queue.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
      {vehicles.map((v) => (
        <div
          key={`q-${v.tag}`}
          style={{ border: "1px solid #d0d5dd", borderRadius: 12, padding: 14, background: "#fff", display: "flex", flexDirection: "column", gap: 10 }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>#{v.tag}</strong>
            <span className={`status-pill status-${v.status}`}>{displayVehicleStatus(v.status)}</span>
          </div>
          <div style={{ fontSize: 14, opacity: 0.9 }}>
            <div><strong>Guest:</strong> {v.guestName}</div>
            <div><strong>Room:</strong> {v.roomNumber}</div>
            <div><strong>Vehicle:</strong> {v.color} {v.make} {v.license ? `• ${v.license}` : ""}</div>
            <div><strong>Requested:</strong> {fmtTime(v.requestedAt)}</div>
            <div><strong>Bay:</strong> {v.bay || "-"}</div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {!v.ack && (
              <button className="btn secondary" onClick={() => onAck(v)} title="Acknowledge request">
                <AcknowledgeIcon />
              </button>
            )}
            <button className="btn secondary" onClick={() => onHandOver(v.tag)} title="Hand over vehicle to guest">
              <HandOverIcon />
            </button>
            <button className="btn secondary" onClick={() => onCancel(v.tag)} title="Cancel request">
              <CancelIcon />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ScheduledPickupTileView({ vehicles, onQueueNow, onCancel }) {
  if (vehicles.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 24, opacity: 0.7 }}>
        No scheduled pickups.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
      {vehicles.map((v) => (
        <div
          key={`s-${v.tag}`}
          style={{ border: "1px solid #d0d5dd", borderRadius: 12, padding: 14, background: "#fff", display: "flex", flexDirection: "column", gap: 10 }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>#{v.tag}</strong>
            <span className={`status-pill status-${v.status}`}>{displayVehicleStatus(v.status)}</span>
          </div>
          <div style={{ fontSize: 14, opacity: 0.9 }}>
            <div><strong>Guest:</strong> {v.guestName}</div>
            <div><strong>Room:</strong> {v.roomNumber}</div>
            <div><strong>Vehicle:</strong> {v.color} {v.make} {v.license ? `• ${v.license}` : ""}</div>
            <div><strong>Scheduled:</strong> {fmtDT(v.scheduledAt)}</div>
            <div><strong>Bay:</strong> {v.bay || "-"}</div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="btn secondary" onClick={() => onQueueNow(v)} title="Move to request queue immediately">
              Queue Now
            </button>
            <button className="btn secondary" onClick={() => onCancel(v.tag)} title="Cancel scheduled pickup">
              <CancelIcon />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// Vehicle Tile View Component
function VehicleTileView({ vehicles, onPark, onReady, onHandOver, onPhotos, onAudit, onSchedule, onCancelSchedule }) {
  if (vehicles.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 40, opacity: 0.7 }}>
        <p>No vehicles to display.</p>
      </div>
    );
  }

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
      gap: "16px",
      padding: "8px"
    }}>
      {vehicles.map((v) => (
        <div
          key={`tile-${v.tag}`}
          style={{
            border: "1px solid #d0d5dd",
            borderRadius: "12px",
            padding: "16px",
            background: "#fff",
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            transition: "all 0.2s"
          }}
          onMouseEnter={(e) => e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)"}
          onMouseLeave={(e) => e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.08)"}
        >
          {/* Header with tag and status */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
            <div>
              <div style={{ fontSize: "20px", fontWeight: "600", color: "#1a1a1a" }}>
                #{v.tag}
              </div>
              <div style={{ fontSize: "13px", opacity: 0.6 }}>
                {v.guestName}
              </div>
              {v.autoCreatedFromCsv && (
                <div
                  style={{
                    marginTop: "6px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "3px 8px",
                    borderRadius: "999px",
                    background: "#eef4ff",
                    color: "#1d4ed8",
                    fontSize: "11px",
                    fontWeight: 600,
                  }}
                  title="This docket was automatically created from an expected arrivals CSV row"
                >
                  Auto-created from expected arrival
                </div>
              )}
            </div>
            <span className={`status-pill status-${v.status}`} style={{ fontSize: "11px" }}>
              {displayVehicleStatus(v.status)}
            </span>
          </div>

          {/* Incomplete indicator for received status */}
          {v.status === "received" && (
            <div style={{
              padding: "8px 12px",
              background: "#fff3cd",
              border: "1px solid #ffc107",
              borderRadius: "6px",
              fontSize: "12px",
              color: "#856404",
              fontWeight: "500"
            }}>
              ! Missing details - activate to complete check-in
            </div>
          )}

          {/* Details */}
          <div style={{ fontSize: "13px", display: "flex", flexDirection: "column", gap: "6px", opacity: 0.8 }}>
            <div><strong>Room:</strong> {v.roomNumber}</div>
            {v.bay && <div><strong>Bay:</strong> {v.bay}</div>}
            <div><strong>Vehicle:</strong> {v.color} {v.make}</div>
            {v.license && <div><strong>Plate:</strong> {v.license}</div>}
            {v.departureDate && <div><strong>Depart:</strong> {fmtDate(v.departureDate)}</div>}
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
            <button 
              className="btn secondary" 
              onClick={() => onPark(v)} 
              style={{ flex: "1", minWidth: "60px", padding: "6px 8px", fontSize: "12px" }}
              title="Park / update parking details"
            >
              <ParkIcon /> Park
            </button>
            {(v.status === "retrieving" || v.status === "parked" || v.status === "requested") && (
              <button 
                className="btn secondary" 
                onClick={() => onReady(v.tag)}
                style={{ flex: "1", minWidth: "60px", padding: "6px 8px", fontSize: "12px" }}
                title="Mark vehicle as ready for handover"
              >
                <ReadyIcon /> Ready
              </button>
            )}
            {(v.status === "ready" || v.status === "parked" || v.status === "requested" || v.status === "retrieving") && (
              <button 
                className="btn secondary" 
                onClick={() => onHandOver(v.tag)}
                style={{ flex: "1", minWidth: "60px", padding: "6px 8px", fontSize: "12px" }}
                title="Hand over vehicle to guest"
              >
                <HandOverIcon /> Hand Over
              </button>
            )}
            <button 
              className="btn secondary" 
              onClick={() => onPhotos(v.tag)}
              style={{ flex: "0 0 auto", padding: "6px 8px", fontSize: "12px" }}
              title="View or add vehicle photos"
            >
              <CameraIcon />
            </button>
            <button 
              className="btn secondary" 
              onClick={() => onAudit(v.tag)}
              style={{ flex: "0 0 auto", padding: "6px 8px", fontSize: "12px" }}
              title="View audit log"
            >
              <AuditIcon />
            </button>
          </div>
          <ScheduleInline v={v} onSet={onSchedule} onClear={onCancelSchedule} />
        </div>
      ))}
    </div>
  );
}