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

function toDateOnly(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const medium = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})(?:\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)?$/i);
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

function toNumber(value) {
  if (value == null) return null;
  const cleaned = String(value).replace(/[^\d.-]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function getTodayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeType(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'NS' || raw === 'N/S' || raw === 'NO SHOW' || raw === 'NO-SHOW') return 'no-show';
  return 'cancellation';
}

function normalizeRows(rows) {
  return rows.map((row, idx) => {
    const reservationId = firstValue(row, ['res_no', 'reservation_id', 'reservation', 'booking_id']);
    const guestName = firstValue(row, ['guest_name', 'name', 'guest']);
    const typeRaw = firstValue(row, ['c_ns', 'status', 'can_ns']);
    const type = normalizeType(typeRaw);
    const roomNumber = firstValue(row, ['room_no', 'room_number']);
    const marketSource = firstValue(row, ['market_source', 'source']);
    const averageDailyBaseRate = toNumber(firstValue(row, ['average_daily_base_rate', 'adr', 'daily_rate']));
    const balance = toNumber(firstValue(row, ['balance']));
    const arriveDate = toDateOnly(firstValue(row, ['arrive', 'arrival', 'arrive_date']));
    const departDate = toDateOnly(firstValue(row, ['depart', 'departure', 'depart_date']));
    const eventDate = toDateOnly(firstValue(row, ['date_can_no_showed', 'date_cancelled', 'date_no_showed', 'cancelled_at']));
    const leadTimeDays = toNumber(firstValue(row, ['lead_time', 'lead_time_days']));
    const cancellationReason = firstValue(row, ['cancellation_reason', 'cancel_reason', 'reason']);
    const cancelledBy = firstValue(row, ['who_can_no_showed', 'who_cancelled', 'cancelled_by']);

    return {
      rowNumber: idx + 2,
      reservationId,
      guestName,
      type,
      typeRaw,
      roomNumber,
      marketSource,
      averageDailyBaseRate,
      balance,
      arriveDate,
      departDate,
      eventDate,
      leadTimeDays,
      cancellationReason,
      cancelledBy,
      raw: row,
    };
  }).filter((row) => row.reservationId || row.guestName || row.eventDate);
}

export async function ingestCancellationCsvPayload({
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

  const normalized = normalizeRows(rows);
  const reportDate = toDateOnly(reportDateInput)
    || normalized.map((row) => row.eventDate).find(Boolean)
    || getTodayIso();

  const effectiveSourceLabel = String(sourceLabel || actor?.mode || 'automation').slice(0, 120);
  const cancellations = normalized.filter((row) => row.type === 'cancellation').length;
  const noShows = normalized.filter((row) => row.type === 'no-show').length;
  const shortLeadTimeCount = normalized.filter((row) => row.leadTimeDays != null && row.leadTimeDays < 2).length;

  const reservations = normalized.map((row) => ({
    reservationId: row.reservationId,
    guestName: row.guestName,
    type: row.type,
    roomNumber: row.roomNumber,
    marketSource: row.marketSource,
    averageDailyBaseRate: row.averageDailyBaseRate,
    balance: row.balance,
    arriveDate: row.arriveDate,
    departDate: row.departDate,
    eventDate: row.eventDate,
    leadTimeDays: row.leadTimeDays,
    cancellationReason: row.cancellationReason,
    cancelledBy: row.cancelledBy,
    rowNumber: row.rowNumber,
  }));

  const createdAtMs = Date.now();
  const docId = `${reportDate}-${createdAtMs}`;

  await db.collection('reports_cancellations').doc(docId).set({
    type: 'daily-cancellations-no-shows',
    reportDate,
    sourceEmail,
    sourceLabel: effectiveSourceLabel,
    createdAtMs,
    importedAtMs: createdAtMs,
    actor: actor || { mode: 'system', username: 'system', role: 'system' },
    totalRows: rows.length,
    totalParsedRows: normalized.length,
    cancellations,
    noShows,
    shortLeadTimeCount,
    reservations,
  });

  return {
    reportId: docId,
    summary: {
      reportDate,
      totalRows: rows.length,
      totalParsedRows: normalized.length,
      cancellations,
      noShows,
      shortLeadTimeCount,
    },
  };
}
