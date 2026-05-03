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

function parseCsv(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];

  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const parsedRows = lines.map((line) => parseCsvLine(line));
  const headers = (parsedRows[0] || []).map((h, idx) => normalizeHeader(h) || `column_${idx}`);
  const rows = [];

  for (let i = 1; i < parsedRows.length; i += 1) {
    const cols = parsedRows[i];
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] || '';
    });
    const hasValue = Object.values(row).some((v) => String(v || '').trim() !== '');
    if (!hasValue) continue;
    rows.push(row);
  }

  return rows;
}

function firstValue(row, candidates) {
  for (const key of candidates) {
    const value = row[key];
    if (value != null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function toNumber(value) {
  if (value == null) return null;
  const cleaned = String(value).replace(/[^\d.-]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toDateOnly(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const medium = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (medium) {
    const day = medium[1].padStart(2, '0');
    const monthName = medium[2].slice(0, 3).toLowerCase();
    const year = medium[3];
    const monthMap = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const month = monthMap[monthName] || '';
    if (month) return `${year}-${month}-${day}`;
  }

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function getTodayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeRows(rows) {
  return rows.map((row, idx) => {
    const reservationId = firstValue(row, ['res_no', 'reservation_id', 'reservation', 'booking_id']);
    const surname = firstValue(row, ['surname', 'last_name', 'family_name']);
    const given = firstValue(row, ['given', 'first_name']);
    const guestName = [given, surname].filter(Boolean).join(' ').trim() || firstValue(row, ['guest_name', 'guest']);
    const roomNo = firstValue(row, ['room_no', 'room_number']);
    const roomType = firstValue(row, ['room_type', 'room']);
    const checkOutDate = toDateOnly(firstValue(row, ['depart_date_medium', 'depart_date', 'departure_date', 'check_out']));
    const balance = toNumber(firstValue(row, ['balance', 'outstanding_balance', 'amount_due']));

    return {
      rowNumber: idx + 2,
      reservationId,
      guestName,
      room: [roomNo, roomType].filter(Boolean).join(' - '),
      checkOutDate,
      currentBalance: balance,
      raw: row,
    };
  }).filter((row) => row.checkOutDate && row.currentBalance != null);
}

export async function ingestOpenFoliosCsvPayload({
  csv,
  reportDateInput,
  sourceLabel,
  actor,
  sourceEmail = 'reports@mail.concierge.xin',
  db,
}) {
  const csvText = typeof csv === 'string' ? csv : '';
  if (!csvText.trim()) {
    throw Object.assign(new Error('Missing csv payload'), { status: 400 });
  }

  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    throw Object.assign(new Error('CSV has no data rows'), { status: 400 });
  }

  const reportDate = toDateOnly(reportDateInput) || getTodayIso();
  const effectiveSourceLabel = String(sourceLabel || actor?.mode || 'automation').slice(0, 120);

  const normalized = normalizeRows(rows);
  const reportRows = normalized.filter((row) => row.checkOutDate === reportDate && row.currentBalance > 0);
  const filteredOutCount = normalized.length - reportRows.length;

  const reservations = reportRows.map((row) => ({
    reservationId: row.reservationId,
    guestName: row.guestName,
    room: row.room,
    checkOutDate: row.checkOutDate,
    currentBalance: row.currentBalance,
    rowNumber: row.rowNumber,
  }));

  const totalOutstandingBalance = Number(
    reportRows.reduce((sum, row) => sum + Number(row.currentBalance || 0), 0).toFixed(2)
  );

  const createdAtMs = Date.now();
  const docId = `${reportDate}-${createdAtMs}`;

  await db.collection('reports_open_folios').doc(docId).set({
    type: 'daily-open-folios',
    reportDate,
    sourceEmail,
    sourceLabel: effectiveSourceLabel,
    createdAtMs,
    importedAtMs: createdAtMs,
    actor: actor || { mode: 'system', username: 'system', role: 'system' },
    totalRows: rows.length,
    totalParsedRows: normalized.length,
    totalChecked: reservations.length,
    filteredOutCount,
    outstandingCount: reservations.length,
    totalOutstandingBalance,
    reservations,
    reviewChecked: false,
    reviewCheckedBy: '',
    reviewCheckedAt: null,
    reviewNotes: '',
    lineItemReviews: {},
  });

  return {
    reportId: docId,
    summary: {
      reportDate,
      totalRows: rows.length,
      totalParsedRows: normalized.length,
      totalChecked: reservations.length,
      filteredOutCount,
      outstandingCount: reservations.length,
      totalOutstandingBalance,
    },
  };
}
