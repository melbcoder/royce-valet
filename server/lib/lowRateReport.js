const ROYCE_STATUS_MAP = {
  A: 'arrived',
  C: 'confirmed',
  X: 'cancelled',
  NS: 'no-show',
  UC: 'unconfirmed',
  U: 'unconfirmed',
};

const NON_ACTIVE_STATUS_CODES = new Set(['X', 'NS']);

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

function findHeaderIndex(rows) {
  const required = ['res_no', 'arrive_date', 'room_no_rate'];
  for (let i = 0; i < rows.length; i += 1) {
    const normalized = rows[i].map((h) => normalizeHeader(h));
    const score = required.filter((key) => normalized.includes(key)).length;
    if (score >= 2) return i;
  }
  return 0;
}

function parseCsv(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];

  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const parsedRows = lines.map((line) => parseCsvLine(line));
  const headerIndex = findHeaderIndex(parsedRows);
  const headers = (parsedRows[headerIndex] || []).map((h, idx) => normalizeHeader(h) || `column_${idx}`);
  const rows = [];

  for (let i = headerIndex + 1; i < parsedRows.length; i += 1) {
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

function toIsoDate(value) {
  return String(value || '').slice(0, 10);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function minDate(dates = []) {
  const valid = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')));
  if (valid.length === 0) return '';
  return valid.reduce((a, b) => (a < b ? a : b));
}

function maxDate(dates = []) {
  const valid = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')));
  if (valid.length === 0) return '';
  return valid.reduce((a, b) => (a > b ? a : b));
}

function normalizeStatusCode(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeRoomKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRateCheckEligibleStatus(statusCode) {
  const code = normalizeStatusCode(statusCode);
  if (!code) return true;
  return !NON_ACTIVE_STATUS_CODES.has(code);
}

async function fetchRoyceCalendarRates({ startDate, endDate, currency = 'AUD' }) {
  if (!startDate || !endDate) return new Map();

  // Cap to 90 days from today so the calendar call stays bounded
  const calendarCutoff = addDays(new Date().toISOString().slice(0, 10), 90);
  const effectiveEnd = endDate > calendarCutoff ? calendarCutoff : endDate;
  if (startDate > effectiveEnd) return new Map();
  endDate = effectiveEnd;

  const apiUrl = String(process.env.ROYCE_SELFBOOK_API_URL || 'https://api.selfbook.com/api/v3').trim().replace(/\/+$/, '');
  const hotelId = String(process.env.ROYCE_SELFBOOK_HOTEL_ID || '38362').trim();
  const apiKey = String(process.env.ROYCE_SELFBOOK_API_KEY || 'khrWkjyXfxv8wtK-mxfqx9l_9XAaJ91x7PU').trim();

  if (!apiUrl || !hotelId || !apiKey) return new Map();

  const endpoint = `${apiUrl}/hotels/${hotelId}/calendar`;
  const out = new Map();

  let cursor = startDate;
  while (cursor <= endDate) {
    const chunkEnd = minDate([endDate, addDays(cursor, 60)]);

    const payload = {
      currency_code: currency,
      end_date: chunkEnd,
      language: 'en',
      membership_id: '',
      promo_code: '',
      group_code: '',
      rate_plan_code: '',
      start_date: cursor,
      ada_compliant_rooms: false,
      special_request: '',
      guests: [{ type: 'adult', count: 1 }],
      coupon_code: '',
      agency_id: '',
      properties: null,
      include_inclusive_fees: true,
    };

    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'API-Key': apiKey,
          Referer: 'https://roycehotel.com.au/',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(4000),
      });

      if (resp.ok) {
        const data = await resp.json().catch(() => ({}));
        const entries = Array.isArray(data?.data) ? data.data : [];
        entries.forEach((entry) => {
          const date = toIsoDate(entry?.date);
          const rate = toNumber(entry?.price ?? entry?.price_before_tax ?? entry?.price_after_tax);
          if (date && rate != null && rate > 0) {
            out.set(date, {
              rate,
              currency,
              source: 'roycehotel-selfbook-calendar',
            });
          }
        });
      }
    } catch {
      // Ignore transient lookup failures and continue with other chunks/fallbacks.
    }

    if (chunkEnd >= endDate) break;
    cursor = addDays(chunkEnd, 1);
  }

  return out;
}

function pickBestRoomRate(availabilityItem) {
  const rates = Array.isArray(availabilityItem?.rates) ? availabilityItem.rates : [];
  const bar = rates.find((r) => String(r?.id || '').toUpperCase() === 'BAR' || String(r?.external_id || '').toUpperCase() === 'BAR');
  if (bar) {
    const nightly = toNumber(bar?.nightly_before_tax ?? bar?.nightly_after_tax);
    if (nightly != null && nightly > 0) return nightly;
  }

  const nightlyCandidates = rates
    .map((r) => toNumber(r?.nightly_before_tax ?? r?.nightly_after_tax))
    .filter((n) => n != null && n > 0);
  if (nightlyCandidates.length > 0) {
    return Math.min(...nightlyCandidates);
  }

  const priceRangeMin = toNumber(availabilityItem?.price_range?.before_tax?.min ?? availabilityItem?.price_range?.after_tax?.min);
  if (priceRangeMin != null && priceRangeMin > 0) return priceRangeMin;

  return null;
}

async function fetchRoyceRoomRatesForDate({ date, currency = 'AUD' }) {
  if (!date) return new Map();

  const apiUrl = String(process.env.ROYCE_SELFBOOK_API_URL || 'https://api.selfbook.com/api/v3').trim().replace(/\/+$/, '');
  const hotelId = String(process.env.ROYCE_SELFBOOK_HOTEL_ID || '38362').trim();
  const apiKey = String(process.env.ROYCE_SELFBOOK_API_KEY || 'khrWkjyXfxv8wtK-mxfqx9l_9XAaJ91x7PU').trim();

  if (!apiUrl || !hotelId || !apiKey) return new Map();

  const endpoint = `${apiUrl}/hotels/${hotelId}/availability`;
  const payload = {
    currency_code: currency,
    end_date: addDays(date, 1),
    language: 'en',
    membership_id: '',
    promo_code: '',
    group_code: '',
    rate_plan_code: '',
    start_date: date,
    ada_compliant_rooms: false,
    special_request: '',
    guests: [{ type: 'adult', count: 1 }],
    coupon_code: '',
    agency_id: '',
    properties: null,
    include_inclusive_fees: true,
    property_id: null,
    ddn_flow: 'gated',
    include_flex_cancel_rates: true,
  };

  const out = new Map();

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'API-Key': apiKey,
        Referer: 'https://roycehotel.com.au/',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000),
    });

    if (!resp.ok) return out;

    const data = await resp.json().catch(() => ({}));
    const groups = Array.isArray(data?.data) ? data.data : [];
    groups.forEach((group) => {
      const availability = Array.isArray(group?.availability) ? group.availability : [];
      availability.forEach((item) => {
        const roomName = String(item?.room?.name || '').trim();
        const roomKey = normalizeRoomKey(roomName);
        if (!roomKey) return;
        const rate = pickBestRoomRate(item);
        if (rate == null || rate <= 0) return;
        out.set(roomKey, {
          rate,
          currency,
          source: 'roycehotel-selfbook-availability',
          roomName,
        });
      });
    });
  } catch {
    return out;
  }

  return out;
}

async function fetchRoyceRoomRatesByDate({ dates = [], currency = 'AUD' }) {
  const uniqueDates = Array.from(new Set((dates || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))))).sort();
  const out = new Map();
  if (uniqueDates.length === 0) return out;

  // Limit to dates within 90 days from today — far-future reservations get no-reference
  const cutoff = addDays(new Date().toISOString().slice(0, 10), 90);
  const datesToFetch = uniqueDates.filter((d) => d <= cutoff);

  let cursor = 0;
  const workerCount = Math.min(2, datesToFetch.length);

  async function worker() {
    while (cursor < datesToFetch.length) {
      const idx = cursor;
      cursor += 1;
      const date = datesToFetch[idx];
      const roomMap = await fetchRoyceRoomRatesForDate({ date, currency });
      if (roomMap.size > 0) {
        out.set(date, roomMap);
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return out;
}

function getPreviousDateIso() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function lookupReferenceRate(normalizedReservation, context = {}) {
  const roomRatesByDate = context?.roomRatesByDate instanceof Map ? context.roomRatesByDate : null;
  if (roomRatesByDate && normalizedReservation.checkInDate) {
    const roomRates = roomRatesByDate.get(normalizedReservation.checkInDate);
    if (roomRates instanceof Map && normalizedReservation.roomTypeKey) {
      const roomSpecific = roomRates.get(normalizedReservation.roomTypeKey);
      if (roomSpecific) return roomSpecific;
    }
  }

  const dailyRoyceRates = context?.dailyRoyceRates instanceof Map ? context.dailyRoyceRates : null;
  if (dailyRoyceRates && normalizedReservation.checkInDate && dailyRoyceRates.has(normalizedReservation.checkInDate)) {
    return dailyRoyceRates.get(normalizedReservation.checkInDate);
  }

  const inlineRate = toNumber(normalizedReservation.inlineReferenceRate);
  if (inlineRate != null) {
    return {
      rate: inlineRate,
      currency: normalizedReservation.inlineReferenceCurrency || normalizedReservation.bookedCurrency || 'AUD',
      source: 'csv-inline',
    };
  }

  const endpoint = String(process.env.LOW_RATE_REFERENCE_ENDPOINT || '').trim();
  if (!endpoint) {
    return null;
  }

  const url = new URL(endpoint);
  if (normalizedReservation.checkInDate) url.searchParams.set('checkInDate', normalizedReservation.checkInDate);
  if (normalizedReservation.roomType) url.searchParams.set('roomType', normalizedReservation.roomType);
  if (normalizedReservation.nights != null) url.searchParams.set('nights', String(normalizedReservation.nights));

  const resp = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!resp.ok) return null;

  const data = await resp.json().catch(() => null);
  if (!data || typeof data !== 'object') return null;

  const rate = toNumber(data.rate);
  if (rate == null) return null;

  return {
    rate,
    currency: String(data.currency || normalizedReservation.bookedCurrency || 'AUD').toUpperCase(),
    source: String(data.source || 'external-reference'),
    sourceUrl: String(data.sourceUrl || ''),
  };
}

function normalizeRows(rows) {
  return rows.map((row, idx) => {
    const statusCode = normalizeStatusCode(firstValue(row, ['b_c', 'bc', 'reservation_status', 'status']));
    const bookedRate = toNumber(firstValue(row, ['booked_rate', 'rate', 'nightly_rate', 'bookedrate', 'price', 'room_no_rate']));
    const reservationId = firstValue(row, ['reservation_id', 'reservation', 'confirmation', 'booking_id', 'booking', 'res_no']);
    const guestName = firstValue(row, ['guest_name', 'name', 'guest', 'guest_name_1']);
    const roomType = firstValue(row, ['room_type', 'room', 'category']);
    const checkInDate = toDateOnly(firstValue(row, ['check_in', 'arrival_date', 'arrive_date', 'arrival', 'stay_date', 'date']));
    const checkOutDate = toDateOnly(firstValue(row, ['check_out', 'departure_date', 'departure']));
    const bookedDate = toDateOnly(firstValue(row, ['booked_date', 'reservation_date', 'created_date', 'booking_date']));
    const bookedCurrency = firstValue(row, ['currency', 'booked_currency']) || 'AUD';
    const nightsRaw = toNumber(firstValue(row, ['nights', 'length_of_stay', 'no_of_nights']));
    const nights = Number.isInteger(nightsRaw) ? nightsRaw : null;

    return {
      rowNumber: idx + 2,
      statusCode,
      statusLabel: ROYCE_STATUS_MAP[statusCode] || '',
      isRateCheckEligible: isRateCheckEligibleStatus(statusCode),
      reservationId,
      guestName,
      roomType,
      roomTypeKey: normalizeRoomKey(roomType),
      bookedDate,
      checkInDate,
      checkOutDate,
      nights,
      bookedRate,
      bookedCurrency: String(bookedCurrency).toUpperCase(),
      inlineReferenceRate: firstValue(row, ['reference_rate', 'web_rate', 'market_rate']),
      inlineReferenceCurrency: firstValue(row, ['reference_currency', 'market_currency']),
      raw: row,
    };
  }).filter((row) => row.bookedRate != null && row.checkInDate);
}

export async function ingestLowRateCsvPayload({
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

  const reportDate = toDateOnly(reportDateInput) || getPreviousDateIso();
  const effectiveSourceLabel = String(sourceLabel || actor?.mode || 'automation').slice(0, 120);
  const tolerancePct = Number(process.env.LOW_RATE_ALERT_PCT || 5);

  const normalized = normalizeRows(rows);
  const reportRows = normalized.filter((row) => (!row.bookedDate || row.bookedDate === reportDate) && row.isRateCheckEligible);
  const filteredOutCount = normalized.length - reportRows.length;

  const startDate = minDate(reportRows.map((r) => r.checkInDate));
  const endDate = maxDate(reportRows.map((r) => r.checkInDate));
  const roomRatesByDate = await fetchRoyceRoomRatesByDate({
    dates: reportRows.map((r) => r.checkInDate),
    currency: 'AUD',
  });
  const dailyRoyceRates = await fetchRoyceCalendarRates({
    startDate,
    endDate,
    currency: 'AUD',
  });

  const results = [];

  let lowCount = 0;
  let okCount = 0;
  let missingReferenceCount = 0;

  for (const row of reportRows) {
    const ref = await lookupReferenceRate(row, { roomRatesByDate, dailyRoyceRates });
    const referenceRate = ref?.rate ?? null;
    const referenceCurrency = ref?.currency || row.bookedCurrency;

    let status = 'no-reference';
    let variance = null;
    let variancePct = null;

    if (referenceRate != null && referenceRate > 0) {
      variance = Number((row.bookedRate - referenceRate).toFixed(2));
      variancePct = Number(((variance / referenceRate) * 100).toFixed(2));
      const threshold = -Math.abs(tolerancePct);
      status = variancePct <= threshold ? 'low' : 'ok';
    }

    if (status === 'low') lowCount += 1;
    if (status === 'ok') okCount += 1;
    if (status === 'no-reference') missingReferenceCount += 1;

    results.push({
      statusCode: row.statusCode,
      statusLabel: row.statusLabel,
      reservationId: row.reservationId,
      guestName: row.guestName,
      roomType: row.roomType,
      bookedDate: row.bookedDate,
      checkInDate: row.checkInDate,
      checkOutDate: row.checkOutDate,
      nights: row.nights,
      bookedRate: row.bookedRate,
      bookedCurrency: row.bookedCurrency,
      referenceRate,
      referenceCurrency,
      referenceSource: ref?.source || '',
      referenceSourceUrl: ref?.sourceUrl || '',
      variance,
      variancePct,
      status,
      rowNumber: row.rowNumber,
    });
  }

  const createdAtMs = Date.now();
  const docId = `${reportDate}-${createdAtMs}`;

  await db.collection('reports_low_rate').doc(docId).set({
    type: 'daily-low-rate',
    reportDate,
    sourceEmail,
    sourceLabel: effectiveSourceLabel,
    createdAtMs,
    importedAtMs: createdAtMs,
    actor: actor || { mode: 'system', username: 'system', role: 'system' },
    totalRows: rows.length,
    totalParsedRows: normalized.length,
    totalChecked: results.length,
    filteredOutCount,
    tolerancePct,
    lowCount,
    okCount,
    missingReferenceCount,
    reviewChecked: false,
    reviewNotes: '',
    reviewCheckedBy: '',
    reservations: results,
  });

  return {
    reportId: docId,
    summary: {
      reportDate,
      totalChecked: results.length,
      lowCount,
      okCount,
      missingReferenceCount,
    },
  };
}
