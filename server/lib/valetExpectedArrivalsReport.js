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
  return out.map((value) => String(value || '').trim());
}

function normalizeHeader(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseMoney(value) {
  const cleaned = String(value || '').replace(/[^\d.-]/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(raw) {
  if (!raw) return '';
  const str = String(raw).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
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

function normalizeTagToken(value, fallback = '') {
  const token = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return token || fallback;
}

function tinyHash(value) {
  const raw = String(value || '');
  let acc = 0;
  for (let i = 0; i < raw.length; i += 1) {
    acc = (acc * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return acc.toString(36).toUpperCase().slice(0, 5) || '0';
}

function buildExpectedArrivalDocId(row) {
  const resPart = normalizeKeyToken(row.resNo, 'unknown');
  const fingerprint = [
    row.guestNo,
    row.surname,
    row.arrive,
    row.depart,
    row.addOn,
    row.from,
    row.to,
    row.addOnSundry,
    row.amountRaw,
  ]
    .map((value) => normalizeKeyToken(value, 'na'))
    .join('__');

  return `${resPart}__${tinyHash(fingerprint)}`;
}

function buildArrivedVehicleTag(row, docId) {
  const resPart = normalizeTagToken(row.resNo, 'RES').slice(-8);
  const guestPart = normalizeTagToken(row.guestNo || row.surname, 'G').slice(-4);
  const hashPart = tinyHash(docId);
  return `AR${resPart}${guestPart}${hashPart}`.slice(0, 20);
}

function normalizeReservationStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function deriveWorkflowStatus(value) {
  const normalized = normalizeReservationStatus(value);
  if (normalized === 'arrived') return 'arrived';
  if (normalized === 'confirmed') return 'expected';
  return 'ignored';
}

export function parseValetExpectedArrivalsCsv(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];

  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  let headerIdx = -1;
  let headers = [];

  for (let i = 0; i < Math.min(5, lines.length); i += 1) {
    const normalized = parseCsvLine(lines[i]).map(normalizeHeader);
    if (normalized.includes('res_no') && normalized.includes('add_on_type')) {
      headerIdx = i;
      headers = normalized;
      break;
    }
  }

  if (headerIdx < 0) return [];

  const idx = {
    propertyName: getHeaderIndex(headers, ['property_name']),
    resNo: getHeaderIndex(headers, ['res_no']),
    guestNo: getHeaderIndex(headers, ['guest_no']),
    status: getHeaderIndex(headers, ['status']),
    surname: getHeaderIndex(headers, ['surname']),
    arrive: getHeaderIndex(headers, ['arrive']),
    depart: getHeaderIndex(headers, ['depart']),
    addOnType: getHeaderIndex(headers, ['add_on_type']),
    addOn: getHeaderIndex(headers, ['add_on']),
    from: getHeaderIndex(headers, ['from']),
    to: getHeaderIndex(headers, ['to']),
    addOnSundry: getHeaderIndex(headers, ['add_on_sundry']),
    amount: getHeaderIndex(headers, ['amount']),
  };

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const resNo = idx.resNo >= 0 ? String(cols[idx.resNo] || '').trim() : '';
    if (!resNo) continue;

    const addOnType = idx.addOnType >= 0 ? String(cols[idx.addOnType] || '').trim() : '';
    if (!/valet\s*parking/i.test(addOnType)) continue;

    const amount = idx.amount >= 0 ? parseMoney(cols[idx.amount]) : null;
    const depart = idx.depart >= 0 ? parseDate(cols[idx.depart]) : '';
    const arrive = idx.arrive >= 0 ? parseDate(cols[idx.arrive]) : '';

    rows.push({
      propertyName: idx.propertyName >= 0 ? String(cols[idx.propertyName] || '').trim() : '',
      resNo,
      guestNo: idx.guestNo >= 0 ? String(cols[idx.guestNo] || '').trim() : '',
      status: idx.status >= 0 ? String(cols[idx.status] || '').trim() : '',
      surname: idx.surname >= 0 ? String(cols[idx.surname] || '').trim() : '',
      arrive,
      depart,
      addOnType,
      addOn: idx.addOn >= 0 ? String(cols[idx.addOn] || '').trim() : '',
      from: idx.from >= 0 ? String(cols[idx.from] || '').trim() : '',
      to: idx.to >= 0 ? String(cols[idx.to] || '').trim() : '',
      addOnSundry: idx.addOnSundry >= 0 ? String(cols[idx.addOnSundry] || '').trim() : '',
      amount,
      amountRaw: idx.amount >= 0 ? String(cols[idx.amount] || '').trim() : '',
      importedAt: new Date().toISOString(),
    });
  }

  return rows;
}

export async function ingestValetExpectedArrivalsCsvPayload({ csv, db, sourceEmail = '', subject = '', filename = '' }) {
  const rows = parseValetExpectedArrivalsCsv(csv);
  const collectionRef = db.collection('valetExpectedArrivals');
  const vehiclesRef = db.collection('vehicles');
  const batchSize = 400;

  // Read all existing docs, keyed by their document ID
  const existingSnap = await collectionRef.get();
  const existingByDocId = new Map(
    existingSnap.docs.map((docSnap) => {
      const data = docSnap.data() || {};
      return [docSnap.id, { ref: docSnap.ref, data }];
    })
  );

  if (rows.length === 0) {
    return { count: 0 };
  }

  // Build one doc ID per CSV row so a reservation can carry multiple vehicles.
  const seenDocIds = new Set();
  const occurrenceByBaseDocId = new Map();
  const rowsWithDocIds = [];
  for (const row of rows) {
    const baseDocId = buildExpectedArrivalDocId(row);
    const seenCount = occurrenceByBaseDocId.get(baseDocId) || 0;
    occurrenceByBaseDocId.set(baseDocId, seenCount + 1);

    const docId = seenCount === 0 ? baseDocId : `${baseDocId}__${seenCount + 1}`;
    seenDocIds.add(docId);
    rowsWithDocIds.push({ row, docId });
  }

  const nowIso = new Date().toISOString();

  // Upsert: write/update each row from the CSV
  for (let i = 0; i < rowsWithDocIds.length; i += batchSize) {
    const batch = db.batch();
    for (const { row, docId } of rowsWithDocIds.slice(i, i + batchSize)) {
      const existing = existingByDocId.get(docId);
      const existingData = existing?.data || {};

      // Preserve merge state if this reservation was already ticketed
      const alreadyMerged = Boolean(existingData.mergedAt);
      const csvWorkflowStatus = deriveWorkflowStatus(row.status);
      const workflowStatus = alreadyMerged ? 'arrived' : csvWorkflowStatus;

      batch.set(collectionRef.doc(docId), {
        ...row,
        rowDocId: docId,
        workflowStatus,
        // Preserve contact enrichment from Arrival List if present
        ...(existingData.phone ? { phone: existingData.phone } : {}),
        ...(existingData.roomNumber ? { roomNumber: existingData.roomNumber } : {}),
        ...(existingData.fullName ? { fullName: existingData.fullName } : {}),
        ...(existingData.rego ? { rego: existingData.rego } : {}),
        // Preserve merge metadata
        ...(alreadyMerged ? { mergedAt: existingData.mergedAt } : {}),
        ...(existingData.mergedVehicleTag ? { mergedVehicleTag: existingData.mergedVehicleTag } : {}),
        ...(existingData.mergeState ? { mergeState: existingData.mergeState } : {}),
        sourceEmail,
        subject,
        filename,
        updatedAt: nowIso,
      });
    }
    await batch.commit();
  }

  // Delete stale docs: in Firestore but not in this CSV, and not yet merged
  const stale = existingSnap.docs.filter((docSnap) => {
    if (seenDocIds.has(docSnap.id)) return false; // still in CSV
    const data = docSnap.data() || {};
    // Keep merged records so history is preserved
    return data.workflowStatus !== 'arrived' && !data.mergedAt;
  });

  for (let i = 0; i < stale.length; i += batchSize) {
    const batch = db.batch();
    for (const docSnap of stale.slice(i, i + batchSize)) {
      batch.delete(docSnap.ref);
    }
    await batch.commit();
  }

  // Auto-upsert active valet dockets for reservations that are already arrived.
  for (const { row, docId } of rowsWithDocIds) {
    const byExpectedSnap = await vehiclesRef
      .where('expectedArrivalId', '==', docId)
      .limit(1)
      .get();

    if (!byExpectedSnap.empty) {
      const existingDoc = byExpectedSnap.docs[0];
      const existingVehicle = existingDoc.data() || {};
      await existingDoc.ref.set(
        {
          ...existingVehicle,
          resNo: row.resNo,
          expectedArrivalId: docId,
          autoCreatedFromCsv: true,
          source: 'expected-arrivals-csv',
          expectedStatus: row.status,
          guestName: existingVehicle.guestName || row.surname || '',
          departureDate: existingVehicle.departureDate || row.depart || '',
          updatedAt: nowIso,
        },
        { merge: true }
      );

      await collectionRef.doc(docId).set(
        {
          mergedAt: nowIso,
          mergedVehicleTag: existingVehicle.tag || existingDoc.id,
          mergeState: 'merged',
          workflowStatus: 'arrived',
          updatedAt: nowIso,
        },
        { merge: true }
      );
      continue;
    }

    if (normalizeReservationStatus(row.status) !== 'arrived') continue;

    const autoTag = buildArrivedVehicleTag(row, docId);
    const tagDoc = vehiclesRef.doc(autoTag);
    const tagSnap = await tagDoc.get();
    const existingByTag = tagSnap.exists ? (tagSnap.data() || {}) : null;

    await tagDoc.set(
      {
        tag: autoTag,
        resNo: row.resNo,
        expectedArrivalId: docId,
        autoCreatedFromCsv: true,
        source: 'expected-arrivals-csv',
        expectedStatus: row.status,
        guestName: existingByTag?.guestName || row.surname || '',
        roomNumber: existingByTag?.roomNumber || '',
        phone: existingByTag?.phone || '',
        status: existingByTag?.status || 'received',
        license: existingByTag?.license || '',
        make: existingByTag?.make || '',
        color: existingByTag?.color || '',
        bay: existingByTag?.bay || '',
        departureDate: existingByTag?.departureDate || row.depart || '',
        scheduledAt: existingByTag?.scheduledAt || null,
        requested: existingByTag?.requested || false,
        createdAt: existingByTag?.createdAt || nowIso,
        updatedAt: nowIso,
      },
      { merge: true }
    );

    await collectionRef.doc(docId).set(
      {
        mergedAt: nowIso,
        mergedVehicleTag: autoTag,
        mergeState: 'merged',
        workflowStatus: 'arrived',
        updatedAt: nowIso,
      },
      { merge: true }
    );
  }

  return { count: rowsWithDocIds.length };
}
