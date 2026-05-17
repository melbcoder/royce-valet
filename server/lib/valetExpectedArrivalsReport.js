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

function buildArrivedVehicleTag(row, docId) {
  const resPart = normalizeTagToken(row.resNo, 'RES').slice(-8);
  const guestPart = normalizeTagToken(row.guestNo || row.surname, 'G').slice(-4);
  const hashPart = tinyHash(docId);
  return `AR${resPart}${guestPart}${hashPart}`.slice(0, 20);
}

function normalizeReservationStatus(value) {
  return String(value || '').trim().toLowerCase();
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

  const existing = await collectionRef.get();
  const existingMergeMeta = new Map(
    existing.docs.map((docSnap) => {
      const data = docSnap.data() || {};
      return [docSnap.id, {
        mergedAt: data.mergedAt || null,
        mergedVehicleTag: data.mergedVehicleTag || null,
        mergeState: data.mergeState || null,
      }];
    })
  );
  const batchSize = 400;

  for (let i = 0; i < existing.docs.length; i += batchSize) {
    const batch = db.batch();
    for (const docSnap of existing.docs.slice(i, i + batchSize)) {
      batch.delete(docSnap.ref);
    }
    await batch.commit();
  }

  if (rows.length === 0) {
    return { count: 0 };
  }

  const docIdCounts = new Map();
  const rowsWithDocIds = rows.map((row) => {
    const baseDocId = [
      normalizeKeyToken(row.resNo),
      normalizeKeyToken(row.guestNo || row.surname),
      normalizeKeyToken(row.from),
      normalizeKeyToken(row.to),
      normalizeKeyToken(row.addOnSundry),
    ].join('_').slice(0, 120);

    const seen = docIdCounts.get(baseDocId) || 0;
    docIdCounts.set(baseDocId, seen + 1);
    const docId = seen === 0 ? baseDocId : `${baseDocId}_${seen + 1}`;

    return { row, docId };
  });

  for (let i = 0; i < rowsWithDocIds.length; i += batchSize) {
    const batch = db.batch();
    for (const { row, docId } of rowsWithDocIds.slice(i, i + batchSize)) {
      const priorMerge = existingMergeMeta.get(docId) || {};
      batch.set(collectionRef.doc(docId), {
        ...row,
        rowDocId: docId,
        ...(priorMerge.mergedAt ? { mergedAt: priorMerge.mergedAt } : {}),
        ...(priorMerge.mergedVehicleTag ? { mergedVehicleTag: priorMerge.mergedVehicleTag } : {}),
        ...(priorMerge.mergeState ? { mergeState: priorMerge.mergeState } : {}),
        sourceEmail,
        subject,
        filename,
        updatedAt: new Date().toISOString(),
      });
    }
    await batch.commit();
  }

  // Auto-upsert active valet dockets for reservations that are already arrived.
  for (const { row, docId } of rowsWithDocIds) {
    const nowIso = new Date().toISOString();

    const byExpectedSnap = await vehiclesRef
      .where('expectedArrivalId', '==', docId)
      .limit(1)
      .get();

    if (!byExpectedSnap.empty) {
      const existingDoc = byExpectedSnap.docs[0];
      const existing = existingDoc.data() || {};
      await existingDoc.ref.set(
        {
          ...existing,
          resNo: row.resNo,
          expectedArrivalId: docId,
          autoCreatedFromCsv: true,
          source: 'expected-arrivals-csv',
          expectedStatus: row.status,
          guestName: existing.guestName || row.surname || '',
          departureDate: existing.departureDate || row.depart || '',
          updatedAt: nowIso,
        },
        { merge: true }
      );

      await collectionRef.doc(docId).set(
        {
          mergedAt: nowIso,
          mergedVehicleTag: existing.tag || existingDoc.id,
          mergeState: 'merged',
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
        updatedAt: nowIso,
      },
      { merge: true }
    );
  }

  return { count: rows.length };
}
