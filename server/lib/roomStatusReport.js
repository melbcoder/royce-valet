/**
 * roomStatusReport.js
 *
 * Parses the "Room No Status Verification Report" CSV exported by the PMS
 * and writes the results to the Firestore `roomStatus` collection.
 *
 * Expected CSV headers (case-insensitive):
 *   Room No, Status, Guest Name, Arrive, Depart, Recp - Pax, ...
 *
 * Normalised status values stored in Firestore:
 *   clean | dirty | occupied | maintenance | unknown
 */

const ROOM_STATUS_MAP = {
  'Vac Cln': 'clean',
  'Vac Dty': 'dirty',
  'Vac Ins': 'inspection',
  'Occ':     'occupied',
  'Maint':   'maintenance',
};

function normalizeRoomStatus(raw) {
  const trimmed = String(raw || '').trim();
  return ROOM_STATUS_MAP[trimmed] || trimmed.toLowerCase() || 'unknown';
}

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch   = line[i];
    const next = line[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
      continue;
    }
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { out.push(current); current = ''; continue; }
    current += ch;
  }

  out.push(current);
  return out.map((v) => String(v || '').trim());
}

function normalizeHeader(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const MONTH_MAP = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * Parse "15 May 2026" → "2026-05-15".
 * Also accepts ISO "2026-05-15" as-is.
 */
function parseDate(raw) {
  if (!raw) return '';
  const str = String(raw).trim();

  const longMatch = str.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (longMatch) {
    const d = longMatch[1].padStart(2, '0');
    const m = MONTH_MAP[longMatch[2].toLowerCase().slice(0, 3)];
    const y = longMatch[3];
    if (m) return `${y}-${m}-${d}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  return '';
}

/**
 * Parse a Room Status CSV text.
 * Returns an array of room objects.
 */
export function parseRoomStatusCsv(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];

  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  // Find header row — must contain both "room_no" and "status"
  let headerIdx = -1;
  let headers = [];
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const cols = parseCsvLine(lines[i]);
    const normalized = cols.map(normalizeHeader);
    if (normalized.includes('room_no') && normalized.includes('status')) {
      headerIdx = i;
      headers = normalized;
      break;
    }
  }

  if (headerIdx < 0) return [];

  const idx = {
    roomNo:    headers.indexOf('room_no'),
    status:    headers.indexOf('status'),
    guestName: headers.indexOf('guest_name'),
    arrive:    headers.findIndex((h) => h === 'arrive' || h === 'arrive_date' || h === 'arrival'),
    depart:    headers.findIndex((h) => h === 'depart' || h === 'depart_date' || h === 'departure'),
    // "Recp - Pax" normalises to "recp___pax" or similar — match by prefix
    pax:       headers.findIndex((h) => h.startsWith('recp') && h.includes('pax')),
  };

  const rooms = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols  = parseCsvLine(lines[i]);
    const roomNo = idx.roomNo >= 0 ? String(cols[idx.roomNo] || '').trim() : '';
    if (!roomNo) continue;

    const rawStatus  = idx.status    >= 0 ? String(cols[idx.status]    || '').trim() : '';
    const guestName  = idx.guestName >= 0 ? String(cols[idx.guestName] || '').trim() : '';
    const arrive     = idx.arrive    >= 0 ? parseDate(cols[idx.arrive])               : '';
    const depart     = idx.depart    >= 0 ? parseDate(cols[idx.depart])               : '';
    const paxRaw     = idx.pax       >= 0 ? String(cols[idx.pax]       || '').trim() : '';
    const pax        = paxRaw ? (parseInt(paxRaw, 10) || 0) : 0;

    rooms.push({ roomNo, status: normalizeRoomStatus(rawStatus), rawStatus, guestName, arrive, depart, pax });
  }

  return rooms;
}

/**
 * Verify that the CSV text looks like a Room Status report.
 * Returns true when the header row contains both "room_no" and "status".
 */
export function isRoomStatusCsv(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const normalized = parseCsvLine(lines[i]).map(normalizeHeader);
    if (normalized.includes('room_no') && normalized.includes('status')) return true;
  }
  return false;
}

/**
 * Parse and write room statuses to Firestore.
 * Uses batched set() so every call is a full replace of all rooms in the report.
 * Returns { count } — the number of rooms written.
 */
export async function ingestRoomStatusCsvPayload({ csv, db }) {
  const rooms = parseRoomStatusCsv(csv);
  if (rooms.length === 0) return { count: 0 };

  const updatedAt  = new Date().toISOString();
  const BATCH_SIZE = 500; // Firestore batch limit

  for (let i = 0; i < rooms.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const room of rooms.slice(i, i + BATCH_SIZE)) {
      const docRef = db.collection('roomStatus').doc(room.roomNo);
      batch.set(docRef, {
        roomNo:    room.roomNo,
        status:    room.status,
        rawStatus: room.rawStatus,
        guestName: room.guestName,
        arrive:    room.arrive,
        depart:    room.depart,
        pax:       room.pax,
        updatedAt,
      });
    }
    await batch.commit();
  }

  return { count: rooms.length };
}
