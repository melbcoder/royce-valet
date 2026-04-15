import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import Busboy from 'busboy';
import { Readable } from 'node:stream';
import pdfParse from 'pdf-parse';

function normalizeBucketName(raw = '') {
  const value = String(raw || '').trim();
  if (!value) return '';
  return value.replace(/^gs:\/\//i, '').replace(/\/+$/, '');
}

function getFirebaseAdminServices() {
  if (!getApps().length) {
    const storageBucket = normalizeBucketName(process.env.FIREBASE_STORAGE_BUCKET);
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (serviceAccountJson) {
      let parsed;
      try {
        parsed = JSON.parse(serviceAccountJson);
      } catch {
        throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
      }
      initializeApp({
        credential: cert(parsed),
        ...(storageBucket ? { storageBucket } : {}),
      });
    } else {
      const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
      const projectId = process.env.FIREBASE_PROJECT_ID;
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

      if (!projectId || !clientEmail || !privateKey) {
        throw new Error(
          'Missing Firebase Admin credentials. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY.'
        );
      }
      initializeApp({
        credential: cert({ projectId, clientEmail, privateKey }),
        ...(storageBucket ? { storageBucket } : {}),
      });
    }
  }

  const db = getFirestore();

  const getBucket = () => {
    const configured = normalizeBucketName(process.env.FIREBASE_STORAGE_BUCKET);
    if (configured) return getStorage().bucket(configured);

    const app = getApps()[0];
    const projectId = app?.options?.projectId || process.env.FIREBASE_PROJECT_ID;
    if (projectId) return getStorage().bucket(`${projectId}.firebasestorage.app`);

    throw new Error(
      'Missing FIREBASE_STORAGE_BUCKET. Set FIREBASE_STORAGE_BUCKET to your bucket (e.g. your-project.firebasestorage.app).'
    );
  };

  return { db, getBucket };
}

/** Read the entire raw request body as a Buffer. */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    if (req.rawBody != null) {
      if (Buffer.isBuffer(req.rawBody) && req.rawBody.length > 0) return resolve(req.rawBody);
      if (typeof req.rawBody === 'string' && req.rawBody.length > 0)
        return resolve(Buffer.from(req.rawBody, 'binary'));
    }
    if (Buffer.isBuffer(req.body) && req.body.length > 0) return resolve(req.body);
    if (typeof req.body === 'string' && req.body.length > 0)
      return resolve(Buffer.from(req.body, 'binary'));
    if (typeof req.on === 'function' && !req.readableEnded && !req.destroyed) {
      const chunks = [];
      req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
      return;
    }
    resolve(Buffer.alloc(0));
  });
}

function extractFilesFromParsedBody(body) {
  if (!body || typeof body !== 'object' || Buffer.isBuffer(body)) return [];

  const files = [];
  let attachmentInfo = {};
  const rawInfo = body['attachment-info'];
  if (typeof rawInfo === 'string') {
    try { attachmentInfo = JSON.parse(rawInfo); } catch { /* ignore */ }
  }

  for (const [key, value] of Object.entries(body)) {
    if (!/^attachment\d+$/i.test(key)) continue;

    let buffer = null;
    if (Buffer.isBuffer(value)) {
      buffer = value;
    } else if (typeof value === 'string' && value.length > 0) {
      const trimmed = value.trim();
      const looksBase64 = /^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.length > 100;
      if (looksBase64) {
        try {
          const decoded = Buffer.from(trimmed, 'base64');
          if (decoded.length > 0) buffer = decoded;
        } catch { /* ignore */ }
      }
      if (!buffer) buffer = Buffer.from(value, 'binary');
    }

    if (buffer?.length) {
      const meta = attachmentInfo[key] || {};
      files.push({
        name: key,
        buffer,
        info: {
          filename: meta.filename || `${key}.bin`,
          mimeType: meta.type || meta.contentType || 'application/octet-stream',
        },
      });
    }
  }

  return files;
}

function isPdfFileCandidate(file) {
  if (!file) return false;
  const mimeType = String(file.info?.mimeType || '').toLowerCase();
  const filename = String(file.info?.filename || '').toLowerCase();
  const buf = file.buffer;
  const hasPdfSignature = Buffer.isBuffer(buf)
    && buf.length >= 5
    && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d;
  return mimeType.includes('pdf') || filename.endsWith('.pdf') || hasPdfSignature;
}

/**
 * Extract PDF attachments from a raw MIME email string.
 * SendGrid sends this in the `email` field when "POST the raw, full MIME message" is enabled.
 * In that mode, attachments are NOT posted as separate form fields — they're base64-encoded
 * inside the MIME body.
 */
function extractPdfsFromRawMime(rawMime) {
  const files = [];
  if (!rawMime || typeof rawMime !== 'string') return files;

  // Find the top-level MIME boundary
  const boundaryMatch = rawMime.match(/Content-Type:\s*multipart\/mixed;\s*boundary="?([^\s"]+)"?/i);
  if (!boundaryMatch) return files;

  const boundary = boundaryMatch[1];
  const parts = rawMime.split('--' + boundary);

  for (const part of parts) {
    // Look for PDF parts
    const ctMatch = part.match(/Content-Type:\s*(application\/pdf|application\/octet-stream)[^\r\n]*/i);
    if (!ctMatch) continue;

    const isPdf = /application\/pdf/i.test(ctMatch[1]);
    const dispMatch = part.match(/Content-Disposition:\s*attachment;\s*filename="?([^"\r\n]+)"?/i);
    const filename = dispMatch ? dispMatch[1].trim() : 'attachment.pdf';

    // If content-type is octet-stream, only include if filename ends with .pdf
    if (!isPdf && !filename.toLowerCase().endsWith('.pdf')) continue;

    const encodingMatch = part.match(/Content-Transfer-Encoding:\s*(\S+)/i);
    const encoding = encodingMatch ? encodingMatch[1].toLowerCase() : '7bit';

    // The body starts after the first blank line (double CRLF or double LF)
    const bodyStart = part.match(/\r?\n\r?\n/);
    if (!bodyStart) continue;

    const bodyText = part.slice(bodyStart.index + bodyStart[0].length).trim();
    if (!bodyText) continue;

    let buffer;
    if (encoding === 'base64') {
      // Strip whitespace and decode
      const cleaned = bodyText.replace(/[\r\n\s]/g, '');
      buffer = Buffer.from(cleaned, 'base64');
    } else {
      buffer = Buffer.from(bodyText, 'binary');
    }

    if (buffer.length > 0) {
      files.push({
        name: filename,
        buffer,
        info: { filename, mimeType: 'application/pdf' },
      });
    }
  }

  return files;
}

/**
 * Attempt to parse a commission invoice PDF in the standard travel-agent format.
 * Returns { parsed: true, invoiceType, supplier, invoiceNumber, invoiceDate, lineItems }
 * or { parsed: false } if the format doesn't match.
 */
async function parseCommissionInvoice(pdfBuffer) {
  try {
    const data = await pdfParse(pdfBuffer);
    const text = data.text || '';
    if (!text) return { parsed: false };

    const looksLikeCommissionInvoice = /for\s+Creditor|Creditor\s+Nett|Balance\s+Due|Commission/i.test(text);
    if (!looksLikeCommissionInvoice) return { parsed: false };

    const invoiceNumber = extractInvoiceNumber(text);
    const invoiceDate = extractInvoiceDate(text);
    const supplier = extractSupplierName(text);

    // Parse the tabular data — pdf-parse extracts each field on its own line,
    // so we collect multi-line blocks between "HTL" markers.
    // Each record is roughly: HTL, DocNum, ClientProfile, CreditorInvoice,
    // TransDate, BookDate, CreditorNett, Paid, Due, Consultant, BookingNum, Reference, DepDate
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    const lineItems = [];
    let idx = 0;
    while (idx < lines.length) {
      if (lines[idx] !== 'HTL') { idx++; continue; }

      // Collect lines for this record until the next HTL or a known boundary
      const block = [];
      let j = idx + 1;
      while (j < lines.length && lines[j] !== 'HTL'
        && !/^(SEG|Total for|Page \d|Head Office|Please pay)/i.test(lines[j])) {
        block.push(lines[j]);
        j++;
      }
      idx = j;

      const blockText = block.join(' ');

      const guestName = extractGuestName(blockText, '');

      // Booking confirmation: accept only known robust formats.
      // 1) 7 digits (e.g. 1234567)
      // 2) 13-char format: 5 digits + 2 letters + 6 digits (e.g. 12345AB123456)
      // Any other format is intentionally left blank for manual entry.
      const bookingNumber = extractBookingConfirmation(blockText);

      // Dates (dd/mm/yy) — typically TransDate, BookDate, DepDate; departure is last
      const dateMatches = [...blockText.matchAll(/\b(\d{2}\/\d{2}\/\d{2,4})\b/g)].map(m => m[1]);
      const departureDate = dateMatches.length >= 1
        ? parseDateDdMmYy(dateMatches[dateMatches.length - 1])
        : '';

      // Monetary values (numbers with exactly 2 decimal places)
      const moneyMatches = [...blockText.matchAll(/\b(\d[\d,]*\.\d{2})\b/g)].map(m =>
        parseFloat(m[1].replace(/,/g, ''))
      );
      // First 3 values are: Creditor Nett, Paid, Due (extra values may leak from totals row)
      let reservationTotal = 0;
      let totalCommission = 0;
      if (moneyMatches.length >= 3) {
        reservationTotal = moneyMatches[1]; // Paid
        totalCommission = moneyMatches[2];  // Due
      } else if (moneyMatches.length === 2) {
        reservationTotal = moneyMatches[0];
        totalCommission = moneyMatches[1];
      }

      const commissionPercent = reservationTotal > 0
        ? parseFloat(((totalCommission / reservationTotal) * 100).toFixed(2))
        : 0;

      if (guestName || bookingNumber || totalCommission > 0) {
        lineItems.push({
          guestName,
          bookingNumber,
          departureDate,
          reservationTotal,
          commissionPercent,
          totalCommission,
          status: 'pending',
        });
      }
    }

    // Fallback for PDFs that don't contain HTL markers: build at least one row from global labels/content.
    if (lineItems.length === 0) {
      const bookingNumbers = extractBookingConfirmations(text);
      const fallbackGuest = extractGuestName(text, bookingNumbers[0] || '');
      const fallbackDeparture = extractDepartureDate(text);
      const amountInfo = extractCommissionAmounts(text);

      if (bookingNumbers.length > 0) {
        for (const booking of bookingNumbers.slice(0, 20)) {
          lineItems.push({
            guestName: fallbackGuest,
            bookingNumber: booking,
            departureDate: fallbackDeparture,
            reservationTotal: amountInfo.reservationTotal,
            commissionPercent: amountInfo.commissionPercent,
            totalCommission: amountInfo.totalCommission,
            status: 'pending',
          });
        }
      } else if (fallbackGuest || amountInfo.totalCommission > 0 || invoiceNumber) {
        lineItems.push({
          guestName: fallbackGuest,
          bookingNumber: '',
          departureDate: fallbackDeparture,
          reservationTotal: amountInfo.reservationTotal,
          commissionPercent: amountInfo.commissionPercent,
          totalCommission: amountInfo.totalCommission,
          status: 'pending',
        });
      }
    }

    if (lineItems.length === 0) return { parsed: false };

    console.log(`Commission invoice parsed: ${invoiceNumber}, ${supplier}, ${lineItems.length} items`);

    return {
      parsed: true,
      invoiceType: 'commission',
      supplier,
      invoiceNumber,
      invoiceDate,
      lineItems,
      confirmedAmount: lineItems.reduce((sum, i) => sum + (i.totalCommission || 0), 0),
    };
  } catch (err) {
    console.error('Commission invoice parse error:', err?.message);
    return { parsed: false };
  }
}

/** Extract a plain email address from a From header like "Name <addr@example.com>" */
function extractEmailAddress(from) {
  if (!from) return '';
  const angleMatch = String(from).match(/<([^>]+)>/);
  if (angleMatch) return angleMatch[1].trim().toLowerCase();
  const emailMatch = String(from).match(/[\w.+\-]+@[\w.\-]+\.[a-z]{2,}/i);
  if (emailMatch) return emailMatch[0].trim().toLowerCase();
  return '';
}

function extractInvoiceNumber(text) {
  if (!text) return '';

  const explicitLabelPatterns = [
    /Tax\s+Invoice\s+Number\s+([A-Z0-9.\/-]{4,})\s+for\s+Creditor/i,
    /Tax\s+Invoice\s+Number\s*:\s*([A-Z0-9.\/-]{4,})/i,
    /Invoice\s*(?:Number|No\.?|#)\s*:?\s*([A-Z0-9.\/-]{4,})/i,
    /\b(INV-[A-Z0-9-]{3,})\b/i,
  ];

  for (const pattern of explicitLabelPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim().toUpperCase();
  }

  return '';
}

function extractInvoiceDate(text) {
  if (!text) return '';

  const longDateMatch = text.match(
    /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i
  );
  if (longDateMatch) {
    const months = { january:'01', february:'02', march:'03', april:'04', may:'05', june:'06',
      july:'07', august:'08', september:'09', october:'10', november:'11', december:'12' };
    const d = longDateMatch[1].padStart(2, '0');
    const m = months[longDateMatch[2].toLowerCase()];
    const y = longDateMatch[3];
    return `${y}-${m}-${d}`;
  }

  const dateLabel = extractLabeledTextValue(text, '(?:Invoice\s+Date|Date)');
  const parsedLabel = parseFlexibleDate(dateLabel);
  if (parsedLabel) return parsedLabel;

  const genericDate = text.match(/\b(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{2,4})\b/);
  if (genericDate?.[1]) return parseFlexibleDate(genericDate[1]);

  return '';
}

function extractSupplierName(text) {
  if (!text) return '';

  const accountNameMatch = text.match(/Account\s*name\s*:\s*(.+?)(?:\n|BSB|$)/i);
  if (accountNameMatch?.[1]) return accountNameMatch[1].trim();

  const supplierLabel = extractLabeledTextValue(text, '(?:Supplier|Vendor|Travel\s+Agent|Agency|Company)');
  if (supplierLabel && !/:\s*$/.test(supplierLabel)) return supplierLabel;

  const billToIdx = text.search(/Bill\s*To:/i);
  const headerText = billToIdx > 20 ? text.slice(0, billToIdx) : text.slice(0, 700);
  const companyMatch = headerText.match(/^([A-Za-z][A-Za-z\s,.'&]+(?:Travel|Inc|LLC|Ltd|Group|Agency|Tours|Hotel|Management)[^\n]*)/m);
  if (companyMatch?.[1]) return companyMatch[1].trim();

  const footerNameMatch = text.match(/^([A-Z][A-Za-z\s&]+(?:Pty|Ltd|Group|Management|Travel)[^\n]*)/m);
  if (footerNameMatch?.[1]) return footerNameMatch[1].trim();

  return '';
}

function looksLikeGuestName(candidate) {
  const value = String(candidate || '').trim();
  if (!value || value.length < 3 || value.length > 80) return false;
  if (/[:@$%#]/.test(value)) return false;
  if (/\b(invoice|number|date|balance|total|due|commission|booking|confirmation|reference|check-?in|check-?out|room|rate|tax)\b/i.test(value)) return false;
  if (/\d/.test(value)) return false;

  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  return words.every((w) => /^[A-Za-z'\-]+$/.test(w));
}

function extractGuestName(text, bookingHint = '') {
  if (!text) return '';

  const slashMatches = [...String(text).matchAll(/([A-Z]+\/(?:[A-Z]+\s+)+(?:MR|MRS|MS|MISS|DR|PROF|MX)S?)\b/gi)];
  if (slashMatches.length > 0) {
    return [...new Set(slashMatches.map((m) => formatGuestName(m[1])))]
      .filter(Boolean)
      .join(' & ');
  }

  const labelBased = [
    extractLabeledTextValue(text, 'Client\s+Name'),
    extractLabeledTextValue(text, 'Guest\s+Name'),
    extractLabeledTextValue(text, 'Passenger\s+Name'),
    extractLabeledTextValue(text, 'Traveller\s+Name'),
    extractLabeledTextValue(text, 'Traveler\s+Name'),
  ].find((v) => looksLikeGuestName(v));
  if (labelBased) return labelBased;

  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  if (bookingHint) {
    const idx = lines.findIndex((line) => normalizeBookingConfirmation(line).includes(bookingHint));
    if (idx >= 0) {
      for (let i = Math.max(0, idx - 4); i <= Math.min(lines.length - 1, idx + 2); i++) {
        if (i === idx) continue;
        if (looksLikeGuestName(lines[i])) return lines[i];
      }
    }
  }

  const firstLikely = lines.find((line) => looksLikeGuestName(line));
  return firstLikely || '';
}

function extractDepartureDate(text) {
  if (!text) return '';
  const labelDate = extractLabeledTextValue(text, '(?:Departure\s+Date|Check-?Out)');
  const parsed = parseFlexibleDate(labelDate);
  if (parsed) return parsed;

  const isoDates = [...String(text).matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((m) => m[1]);
  if (isoDates.length >= 2) return isoDates[1];
  if (isoDates.length === 1) return isoDates[0];

  const slashDates = [...String(text).matchAll(/\b(\d{2}\/\d{2}\/\d{2,4})\b/g)].map((m) => m[1]);
  if (slashDates.length > 0) return parseDateDdMmYy(slashDates[slashDates.length - 1]);

  return '';
}

function extractCommissionAmounts(text) {
  let reservationTotal = 0;
  let totalCommission = 0;
  let commissionPercent = 0;

  const commLineMatch = String(text).match(/(\d+(?:\.\d+)?)\s*%\s+\$\s*([\d,]+\.\d{2})\s+\$\s*([\d,]+\.\d{2})/);
  if (commLineMatch) {
    commissionPercent = parseFloat(commLineMatch[1]) || 0;
    reservationTotal = parseFloat(commLineMatch[2].replace(/,/g, '')) || 0;
    totalCommission = parseFloat(commLineMatch[3].replace(/,/g, '')) || 0;
    return { reservationTotal, totalCommission, commissionPercent };
  }

  const paidOrRevenue = String(text).match(/(?:Paid|Revenue|Reservation\s+Total)\s*[:$]?\s*\$?\s*([\d,]+\.\d{2})/i);
  if (paidOrRevenue?.[1]) reservationTotal = parseFloat(paidOrRevenue[1].replace(/,/g, '')) || 0;

  const dueOrBalance = String(text).match(/(?:Balance\s+Due|Amount\s+Due|Commission\s+Due|Total\s+Commission)\s*[:$]?\s*\$?\s*([\d,]+\.\d{2})/i);
  if (dueOrBalance?.[1]) totalCommission = parseFloat(dueOrBalance[1].replace(/,/g, '')) || 0;

  if (reservationTotal > 0 && totalCommission > 0) {
    commissionPercent = parseFloat(((totalCommission / reservationTotal) * 100).toFixed(2));
  }

  return { reservationTotal, totalCommission, commissionPercent };
}

function normalizeBookingConfirmation(candidate) {
  if (!candidate) return '';
  return String(candidate).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isValidBookingConfirmation(value) {
  if (!value) return false;
  return /^\d{7}$/.test(value) || /^\d{5}[A-Z]{2}\d{6}$/.test(value);
}

function extractBookingConfirmation(blockText) {
  if (!blockText) return '';

  const normalizedText = String(blockText);

  // First pass: prefer values that appear near booking/reference labels.
  const contextualPattern = /(?:booking|confirmation|conf(?:irmation)?|reference|ref)[^A-Z0-9]{0,12}(\d{7}|\d{5}\s*[A-Z]{2}\s*\d{6})/ig;
  for (const match of normalizedText.matchAll(contextualPattern)) {
    const candidate = normalizeBookingConfirmation(match[1]);
    if (isValidBookingConfirmation(candidate)) {
      return candidate;
    }
  }

  // Second pass: search globally in the record block for the two supported formats.
  const globalPattern = /(\b\d{7}\b|\b\d{5}\s*[A-Z]{2}\s*\d{6}\b)/ig;
  for (const match of normalizedText.matchAll(globalPattern)) {
    const candidate = normalizeBookingConfirmation(match[1]);
    if (isValidBookingConfirmation(candidate)) {
      return candidate;
    }
  }

  return '';
}

function extractBookingConfirmations(text) {
  if (!text) return [];
  const results = [];

  const contextualPattern = /(?:booking|confirmation|conf(?:irmation)?|reference|ref)[^A-Z0-9]{0,12}(\d{7}|\d{5}\s*[A-Z]{2}\s*\d{6})/ig;
  for (const match of String(text).matchAll(contextualPattern)) {
    const candidate = normalizeBookingConfirmation(match[1]);
    if (isValidBookingConfirmation(candidate) && !results.includes(candidate)) {
      results.push(candidate);
    }
  }

  const globalPattern = /(\b\d{7}\b|\b\d{5}\s*[A-Z]{2}\s*\d{6}\b)/ig;
  for (const match of String(text).matchAll(globalPattern)) {
    const candidate = normalizeBookingConfirmation(match[1]);
    if (isValidBookingConfirmation(candidate) && !results.includes(candidate)) {
      results.push(candidate);
    }
  }

  return results;
}

/** Convert "HARVEY/ANNIE MRS" → "Annie Harvey", "GRAVES/DEBRA JANE DR" → "Debra Jane Graves" */
function formatGuestName(raw) {
  if (!raw) return '';
  const withoutTitle = raw.replace(/\s+(MR|MRS|MS|MISS|DR|PROF|MX)S?\s*$/i, '').trim();
  const parts = withoutTitle.split('/');
  if (parts.length === 2) {
    const surname = parts[0].trim();
    const first = parts[1].trim();
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    const capAll = s => s.split(' ').map(cap).join(' ');
    return `${capAll(first)} ${cap(surname)}`;
  }
  return withoutTitle;
}

/** Convert "20/10/25" or "06/12/24" → "2025-10-20" (YYYY-MM-DD) */
function parseDateDdMmYy(str) {
  if (!str) return '';
  const parts = str.split('/');
  if (parts.length !== 3) return '';
  const dd = parts[0].padStart(2, '0');
  const mm = parts[1].padStart(2, '0');
  let yy = parts[2];
  if (yy.length === 2) {
    yy = parseInt(yy) > 50 ? '19' + yy : '20' + yy;
  }
  return `${yy}-${mm}-${dd}`;
}

/**
 * Parse various date string formats → YYYY-MM-DD.
 * Handles: ISO (2026-01-24), "Jan 26, 2026", "January 26 2026", dd/mm/yy.
 */
function parseFlexibleDate(str) {
  if (!str) return '';
  str = str.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const months = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
                   jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
  const longMatch = str.match(/(\w{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i);
  if (longMatch) {
    const m = months[longMatch[1].toLowerCase().slice(0, 3)];
    if (m) return `${longMatch[3]}-${m}-${longMatch[2].padStart(2, '0')}`;
  }
  // Fall through to dd/mm/yy handler
  return parseDateDdMmYy(str);
}

/**
 * Extract a labelled field value from invoice text.
 * First tries "Label: Value" on the same line; then tries the label alone on one
 * line with the value on the next non-blank line.
 */
function extractLabeledTextValue(text, labelPattern) {
  const sameLineRe = new RegExp(labelPattern + '\\s*:\\s*(.+?)(?:\\n|$)', 'i');
  const sameLineMatch = text.match(sameLineRe);
  if (sameLineMatch) {
    const val = sameLineMatch[1].trim();
    if (val) return val;
  }
  const lines = text.split('\n').map(l => l.trim());
  const labelRe = new RegExp('^' + labelPattern + '\\s*:?\\s*$', 'i');
  for (let i = 0; i < lines.length - 1; i++) {
    if (labelRe.test(lines[i])) {
      for (let k = i + 1; k < lines.length && k <= i + 3; k++) {
        if (lines[k]) return lines[k];
      }
    }
  }
  return '';
}

/**
 * Parse invoices in the Fora Travel-style format (label/value pairs, single booking per invoice).
 * Detects on: has "Confirmation Number:" label AND "Balance Due" total line.
 */
async function parseForaStyleInvoice(pdfBuffer) {
  try {
    const data = await pdfParse(pdfBuffer);
    const text = data.text || '';
    if (!text) return { parsed: false };

    // Detection heuristics
    if (!(/Confirmation\s+Number|Booking\s+Number|Client\s+Name|Guest\s+Name/i.test(text))) return { parsed: false };
    if (!(/Balance\s+Due|Amount\s+Due|Total\s+Commission|\d+(?:\.\d+)?\s*%\s+\$[\d,]+\.\d{2}/i.test(text))) return { parsed: false };

    const invoiceNumber = extractInvoiceNumber(text);
    const invoiceDate = extractInvoiceDate(text);
    const supplier = extractSupplierName(text);

    // Booking confirmation
    const bookingNumber = extractBookingConfirmation(text);

    const guestName = extractGuestName(text, bookingNumber);

    const departureDate = extractDepartureDate(text);

    const { reservationTotal, totalCommission, commissionPercent } = extractCommissionAmounts(text);

    const lineItems = [];
    if (guestName || bookingNumber || totalCommission > 0) {
      lineItems.push({
        guestName,
        bookingNumber,
        departureDate,
        reservationTotal,
        commissionPercent,
        totalCommission,
        status: 'pending',
      });
    }

    if (lineItems.length === 0) return { parsed: false };

    console.log(`Fora-style invoice parsed: ${invoiceNumber}, ${supplier}, ${lineItems.length} items`);

    return {
      parsed: true,
      invoiceType: 'commission',
      supplier,
      invoiceNumber,
      invoiceDate,
      lineItems,
      confirmedAmount: lineItems.reduce((sum, i) => sum + (i.totalCommission || 0), 0),
    };
  } catch (err) {
    console.error('Fora-style invoice parse error:', err?.message);
    return { parsed: false };
  }
}

function parseMultipart(req) {
  return new Promise(async (resolve, reject) => {
    const contentType = req.headers?.['content-type'] || '';

    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      const body = typeof req.body === 'object' && req.body !== null && !Buffer.isBuffer(req.body)
        ? req.body : {};
      return resolve({ fields: body, files: extractFilesFromParsedBody(body) });
    }

    // Vercel may have pre-parsed multipart into an object
    if (typeof req.body === 'object' && req.body !== null && !Buffer.isBuffer(req.body)) {
      const keys = Object.keys(req.body);
      const hasSendGridFields = keys.some((k) =>
        ['from', 'to', 'subject', 'text', 'html', 'attachments', 'attachment1',
         'dkim', 'charsets', 'sender_ip', 'envelope'].includes(k)
      );
      if (hasSendGridFields || keys.length > 0) {
        return resolve({ fields: req.body, files: extractFilesFromParsedBody(req.body) });
      }
    }

    // Read raw bytes and feed to Busboy
    let rawBuffer;
    try { rawBuffer = await readRawBody(req); } catch (err) { return reject(err); }

    if (!rawBuffer || rawBuffer.length === 0) {
      const fallback = (typeof req.body === 'object' && req.body !== null && !Buffer.isBuffer(req.body))
        ? req.body : {};
      return resolve({ fields: fallback, files: extractFilesFromParsedBody(fallback) });
    }

    const fields = {};
    const files = [];
    const bb = Busboy({ headers: req.headers });

    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('file', (name, stream, info) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => files.push({ name, buffer: Buffer.concat(chunks), info }));
    });

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve({ fields, files });
    };

    bb.on('close', done);
    bb.on('finish', done);
    bb.on('error', reject);

    const r = new Readable({ read() {} });
    r.push(rawBuffer);
    r.push(null);
    r.pipe(bb);
  });
}

export const config = { api: { bodyParser: false } };

function extractWebhookSecret(req) {
  // For SendGrid Inbound Parse, use a path secret via Vercel rewrite:
  // /api/ap-webhook/<secret> -> /api/ap-webhook?routeSecret=<secret>
  const routeSecret = typeof req.query?.routeSecret === 'string'
    ? req.query.routeSecret.trim()
    : '';
  if (routeSecret) return routeSecret;

  const headerSecret = typeof req.headers?.['x-sendgrid-webhook-secret'] === 'string'
    ? req.headers['x-sendgrid-webhook-secret'].trim()
    : '';
  if (headerSecret) return headerSecret;

  const altHeaderSecret = typeof req.headers?.['x-webhook-secret'] === 'string'
    ? req.headers['x-webhook-secret'].trim()
    : '';
  if (altHeaderSecret) return altHeaderSecret;

  const authHeader = typeof req.headers?.authorization === 'string'
    ? req.headers.authorization.trim()
    : '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return '';
}

export default async function handler(req, res) {
  // Minimal request metadata only. Do not log payload contents.
  console.log('AP webhook hit:', req.method);

  if (req.method === 'GET') {
    // Health check endpoint — useful for verifying the function is deployed
    return res.status(200).json({ ok: true, endpoint: 'ap-webhook', timestamp: new Date().toISOString() });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = extractWebhookSecret(req);
  const expectedSecret = process.env.SENDGRID_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error('AP webhook: SENDGRID_WEBHOOK_SECRET env var is not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  if (!secret || secret !== expectedSecret) {
    console.log('AP webhook: auth failed');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { db, getBucket } = getFirebaseAdminServices();

    let fields, files;
    try {
      const parsed = await parseMultipart(req);
      fields = parsed.fields;
      files = parsed.files;
    } catch (parseErr) {
      console.error('AP webhook: multipart parse failed:', parseErr?.message);
      // Still save a record so the user knows an email arrived
      await db.collection('ap_invoices').add({
        fromEmail: 'unknown (parse failed)',
        subject: '',
        toEmail: '',
        storagePath: null,
        originalFilename: null,
        receivedAt: new Date().toISOString(),
        status: 'pending',
        supplier: null,
        invoiceNumber: null,
        invoiceDate: null,
        department: null,
        confirmedAmount: null,
        paidDate: null,
        lineItems: [],
        notes: '',
        hasPdf: false,
        pdfSource: null,
      });
      return res.status(200).json({ received: true, warning: 'Parse failed, saved placeholder' });
    }

    const fromEmail = fields.from || 'unknown';
    const subject   = fields.subject || '';
    const toEmail   = fields.to || '';

    const hasRawMime = typeof fields.email === 'string' && fields.email.length > 0;

    // Strategy 1: Look for PDF in parsed attachment fields (SendGrid default/parsed mode)
    let pdf = files.find((f) => isPdfFileCandidate(f));
    let pdfSource = pdf ? 'parsed-attachment' : null;

    // Strategy 2: If no PDF found, try extracting from raw MIME email field
    // (SendGrid raw mode: "POST the raw, full MIME message" is ticked)
    if (!pdf && hasRawMime) {
      console.log('AP webhook: No parsed attachments found, trying raw MIME extraction...');
      const mimePdfs = extractPdfsFromRawMime(fields.email);
      if (mimePdfs.length > 0) {
        pdf = mimePdfs[0];
        pdfSource = 'raw-mime';
        console.log('AP webhook: Extracted PDF from raw MIME:', pdf.info?.filename, pdf.buffer?.length, 'bytes');
      }
    }

    let storagePath = null;
    let originalFilename = null;

    if (pdf) {
      const bucket    = getBucket();
      const timestamp = Date.now();
      const fileName  = pdf.info?.filename || 'invoice.pdf';
      const safeName  = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      storagePath     = `ap_invoices/${timestamp}_${safeName}`;
      originalFilename = fileName;

      const file = bucket.file(storagePath);
      await file.save(pdf.buffer, { contentType: 'application/pdf', resumable: false });
    }

    // Attempt to parse invoice data from the PDF — try formats in order
    let parsedInvoice = { parsed: false };
    if (pdf?.buffer) {
      try {
        parsedInvoice = await parseCommissionInvoice(pdf.buffer);
        if (!parsedInvoice.parsed) {
          parsedInvoice = await parseForaStyleInvoice(pdf.buffer);
        }
      } catch (parseErr) {
        console.error('AP webhook: PDF parse attempt failed:', parseErr?.message);
      }
    }

    // Auto-register travel agent or supplier if they don't already exist
    if (parsedInvoice.parsed && (parsedInvoice.supplier || '').trim()) {
      try {
        const agentName = parsedInvoice.supplier.trim();
        const senderEmail = extractEmailAddress(fromEmail);
        if (parsedInvoice.invoiceType === 'commission') {
          const snap = await db.collection('travel_agents').get();
          const exists = snap.docs.some(d => (d.data().name || '').toLowerCase() === agentName.toLowerCase());
          if (!exists) {
            await db.collection('travel_agents').add({
              name: agentName,
              email: senderEmail,
              iataCode: '',
              standardCommission: '',
              bankName: '',
              bankBSB: '',
              bankAccountNumber: '',
              bankSwift: '',
              autoCreated: true,
              createdAt: new Date().toISOString(),
            });
            console.log('AP webhook: auto-created travel agent:', agentName);
          }
        } else {
          const snap = await db.collection('ap_suppliers').get();
          const exists = snap.docs.some(d => (d.data().name || '').toLowerCase() === agentName.toLowerCase());
          if (!exists) {
            await db.collection('ap_suppliers').add({
              name: agentName,
              email: senderEmail,
              bankName: '',
              bankBSB: '',
              bankAccountNumber: '',
              bankSwift: '',
              autoCreated: true,
              createdAt: new Date().toISOString(),
            });
            console.log('AP webhook: auto-created supplier:', agentName);
          }
        }
      } catch (autoCreateErr) {
        console.error('AP webhook: auto-create agent/supplier failed:', autoCreateErr?.message);
      }
    }

    const docData = {
      fromEmail,
      subject,
      toEmail,
      storagePath,
      originalFilename,
      receivedAt: new Date().toISOString(),
      invoiceType: parsedInvoice.parsed ? parsedInvoice.invoiceType : null,
      supplier: parsedInvoice.parsed ? parsedInvoice.supplier : null,
      invoiceNumber: parsedInvoice.parsed ? parsedInvoice.invoiceNumber : null,
      invoiceDate: parsedInvoice.parsed ? parsedInvoice.invoiceDate : null,
      department: parsedInvoice.parsed && parsedInvoice.invoiceType === 'commission' ? 'Reservations' : null,
      confirmedAmount: parsedInvoice.parsed ? parsedInvoice.confirmedAmount : null,
      paidDate: null,
      lineItems: parsedInvoice.parsed ? parsedInvoice.lineItems : [],
      notes: '',
      hasPdf: !!pdf,
      pdfSource,
      autoParsed: parsedInvoice.parsed,
    };

    const docRef = await db.collection('ap_invoices').add(docData);

    console.log('AP invoice saved:', docRef.id, '| pdf:', !!pdf, '| source:', pdfSource, '| autoParsed:', parsedInvoice.parsed);
    return res.status(200).json({ received: true, invoiceId: docRef.id, hasPdf: !!pdf, pdfSource, autoParsed: parsedInvoice.parsed });

  } catch (err) {
    console.error('AP webhook error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err?.message || 'Unknown error' });
  }
}
