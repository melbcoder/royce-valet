/**
 * Arrival List CSV report parser and Firestore enrichment.
 *
 * The Arrival List is a PMS export containing all arriving guests with contact
 * details (phone, room number, rego, ETA, etc.). It covers all guests — not just
 * valet — so we use it to *enrich* existing valetExpectedArrivals docs rather than
 * creating new ones. Matching is done by Res No.
 *
 * Expected CSV headers (any order):
 *   Res No, Name, Loyalty Membership Type, Phone, Room No, Status,
 *   People, Balance, Arrive, Depart, ETA, BCode, Rego, Notes, No Of Visits
 */

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }
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

function getHeaderIndex(headers, candidates) {
  for (const candidate of candidates) {
    const index = headers.indexOf(candidate);
    if (index >= 0) return index;
  }
  return -1;
}

function normalizeKeyToken(value, fallback = 'na') {
  const token = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return token || fallback;
}

function parseArrivalListDate(raw) {
  if (!raw) return '';
  const str = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

/**
 * Returns true if the CSV text looks like an Arrival List export.
 * Detection: must have res_no + (room_no or phone) headers.
 */
export function isArrivalListCsv(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < Math.min(5, lines.length); i += 1) {
    const normalized = parseCsvLine(lines[i]).map(normalizeHeader);
    if (
      normalized.includes('res_no') &&
      (normalized.includes('room_no') || normalized.includes('phone'))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Parse an Arrival List CSV into row objects.
 */
export function parseArrivalListCsv(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];

  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  let headerIdx = -1;
  let headers = [];

  for (let i = 0; i < Math.min(5, lines.length); i += 1) {
    const normalized = parseCsvLine(lines[i]).map(normalizeHeader);
    if (
      normalized.includes('res_no') &&
      (normalized.includes('room_no') || normalized.includes('phone'))
    ) {
      headerIdx = i;
      headers = normalized;
      break;
    }
  }

  if (headerIdx < 0) return [];

  const idx = {
    resNo:   getHeaderIndex(headers, ['res_no']),
    name:    getHeaderIndex(headers, ['name']),
    phone:   getHeaderIndex(headers, ['phone']),
    roomNo:  getHeaderIndex(headers, ['room_no']),
    status:  getHeaderIndex(headers, ['status']),
    arrive:  getHeaderIndex(headers, ['arrive']),
    depart:  getHeaderIndex(headers, ['depart']),
    eta:     getHeaderIndex(headers, ['eta']),
    rego:    getHeaderIndex(headers, ['rego']),
    notes:   getHeaderIndex(headers, ['notes']),
  };

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const resNo = idx.resNo >= 0 ? String(cols[idx.resNo] || '').trim() : '';
    if (!resNo) continue;

    const rawPhone = idx.phone >= 0 ? String(cols[idx.phone] || '').trim() : '';
    // Skip obviously empty/zero phone values
    const phone = rawPhone === '0' || rawPhone === '00' ? '' : rawPhone;

    rows.push({
      resNo,
      fullName: idx.name >= 0 ? String(cols[idx.name] || '').trim() : '',
      phone,
      roomNumber: idx.roomNo >= 0 ? String(cols[idx.roomNo] || '').trim() : '',
      status: idx.status >= 0 ? String(cols[idx.status] || '').trim() : '',
      arrive: idx.arrive >= 0 ? parseArrivalListDate(cols[idx.arrive]) : '',
      depart: idx.depart >= 0 ? parseArrivalListDate(cols[idx.depart]) : '',
      eta: idx.eta >= 0 ? String(cols[idx.eta] || '').trim() : '',
      rego: idx.rego >= 0 ? String(cols[idx.rego] || '').trim() : '',
      notes: idx.notes >= 0 ? String(cols[idx.notes] || '').trim() : '',
    });
  }

  return rows;
}

/**
 * Ingest an Arrival List CSV: enrich matching valetExpectedArrivals docs
 * with contact details. Creates NO new documents.
 *
 * @returns {{ enriched: number, total: number }}
 */
export async function ingestArrivalListPayload({ csv, db, sourceEmail = '', subject = '', filename = '' }) {
  const rows = parseArrivalListCsv(csv);
  if (rows.length === 0) return { enriched: 0, total: 0 };

  const collectionRef = db.collection('valetExpectedArrivals');
  const nowIso = new Date().toISOString();
  const batchSize = 400;

  // Build a map: docId (normalizedResNo) → enrichment payload
  const enrichments = new Map();
  for (const row of rows) {
    const docId = normalizeKeyToken(row.resNo, 'unknown');
    if (docId === 'unknown') continue;

    // Merge multiple rows for the same resNo (e.g. linked reservations) — first phone wins
    if (enrichments.has(docId)) {
      const existing = enrichments.get(docId);
      if (!existing.phone && row.phone) existing.phone = row.phone;
      if (!existing.roomNumber && row.roomNumber) existing.roomNumber = row.roomNumber;
      if (!existing.rego && row.rego) existing.rego = row.rego;
    } else {
      enrichments.set(docId, {
        fullName: row.fullName,
        phone: row.phone,
        roomNumber: row.roomNumber,
        eta: row.eta,
        rego: row.rego,
        notes: row.notes,
      });
    }
  }

  // Only enrich docs that already exist in valetExpectedArrivals
  let enriched = 0;
  const docIds = [...enrichments.keys()];

  for (let i = 0; i < docIds.length; i += batchSize) {
    const chunk = docIds.slice(i, i + batchSize);

    // Firestore 'in' queries are limited to 30 items
    const inChunkSize = 30;
    for (let j = 0; j < chunk.length; j += inChunkSize) {
      const ids = chunk.slice(j, j + inChunkSize);
      const snap = await collectionRef.where('__name__', 'in', ids).get();
      if (snap.empty) continue;

      const batch = db.batch();
      for (const docSnap of snap.docs) {
        const enrichment = enrichments.get(docSnap.id);
        if (!enrichment) continue;
        const payload = {};
        if (enrichment.fullName) payload.fullName = enrichment.fullName;
        if (enrichment.phone) payload.phone = enrichment.phone;
        if (enrichment.roomNumber) payload.roomNumber = enrichment.roomNumber;
        if (enrichment.eta) payload.eta = enrichment.eta;
        if (enrichment.rego) payload.rego = enrichment.rego;
        if (enrichment.notes) payload.notes = enrichment.notes;
        payload.arrivalListUpdatedAt = nowIso;
        batch.set(docSnap.ref, payload, { merge: true });
        enriched += 1;
      }
      await batch.commit();
    }
  }

  return { enriched, total: rows.length };
}
