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

  const existing = await collectionRef.get();
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

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = db.batch();
    for (const row of rows.slice(i, i + batchSize)) {
      const docId = `${row.resNo}-${row.guestNo || row.surname || i}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      batch.set(collectionRef.doc(docId), {
        ...row,
        sourceEmail,
        subject,
        filename,
        updatedAt: new Date().toISOString(),
      });
    }
    await batch.commit();
  }

  return { count: rows.length };
}
