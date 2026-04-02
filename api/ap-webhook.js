import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import Busboy from 'busboy';
import { Readable } from 'node:stream';
import { simpleParser } from 'mailparser';

function normalizeBucketName(raw = '') {
  const value = String(raw || '').trim();
  if (!value) return '';
  return value.replace(/^gs:\/\//i, '').replace(/\/+$/, '');
}

function stripHtml(html = '') {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function loadPdfParser() {
  const candidates = ['pdf-parse', 'pdf-parse/lib/pdf-parse.js'];
  for (const name of candidates) {
    try {
      const mod = await import(name);
      const parser = mod?.default || mod;
      if (typeof parser === 'function') return parser;
    } catch {
      // Try the next candidate import path.
    }
  }
  throw new Error('PDF parser module failed to load. Ensure pdf-parse is installed.');
}

async function extractPdfText(buffer) {
  if (!buffer || !buffer.length) return '';
  const pdfParse = await loadPdfParser();
  const parsed = await pdfParse(buffer, { max: 8 });
  return (parsed?.text || '').trim();
}

function normalizeExtractionText(text = '') {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getMeaningfulLines(text = '') {
  return normalizeExtractionText(text)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function parseMoney(value) {
  if (!value) return null;
  const cleaned = String(value).replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchFirst(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function inferSupplierFromLines(lines = []) {
  const blocked = /^(invoice|bill|statement|date|due date|invoice date|invoice number|page|amount|total|balance|remit|ship to|bill to)\b/i;
  for (const line of lines.slice(0, 12)) {
    if (line.length < 3 || line.length > 80) continue;
    if (!/[A-Za-z]/.test(line)) continue;
    if (blocked.test(line)) continue;
    return line;
  }
  return null;
}

function extractLineItems(text = '') {
  const lineItems = [];
  const lines = getMeaningfulLines(text);
  const numericTail = /(.*?)\s+(\d+(?:\.\d+)?)\s+\$?([\d,]+(?:\.\d{1,2})?)\s+\$?([\d,]+(?:\.\d{1,2})?)$/;

  for (const line of lines) {
    const match = line.match(numericTail);
    if (!match) continue;

    const description = match[1].trim();
    if (!description || description.length < 2) continue;

    lineItems.push({
      description,
      quantity: Number.parseFloat(match[2]),
      unitPrice: parseMoney(match[3]),
      total: parseMoney(match[4]),
    });
  }

  return lineItems.slice(0, 50);
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
    if (projectId) return getStorage().bucket(`${projectId}.appspot.com`);

    throw new Error(
      'Missing FIREBASE_STORAGE_BUCKET. Set FIREBASE_STORAGE_BUCKET to your bucket (for example: your-project.appspot.com).'
    );
  };

  return { db, getBucket };
}

/** Parse multipart/form-data from the raw request */
function extractFilesFromParsedBody(body, existingFields = {}) {
  if (!body || typeof body !== 'object' || Buffer.isBuffer(body)) return [];

  const fields = { ...existingFields };
  const files = [];

  for (const [key, value] of Object.entries(body)) {
    if (!/^attachment\d+$/i.test(key)) {
      if (typeof value === 'string' && !(key in fields)) fields[key] = value;
      continue;
    }

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
        } catch {
          // ignore decode failure and fall back to binary
        }
      }
      if (!buffer) buffer = Buffer.from(value, 'binary');
    }

    if (buffer?.length) files.push({ name: key, buffer, info: {} });
  }

  let attachmentInfo = {};
  const rawInfo = fields['attachment-info'] || body['attachment-info'];
  if (typeof rawInfo === 'string') {
    try {
      attachmentInfo = JSON.parse(rawInfo);
    } catch {
      // attachment-info is optional and sometimes malformed
    }
  }

  for (const file of files) {
    const meta = attachmentInfo[file.name] || {};
    file.info = {
      filename: meta.filename || `${file.name}.bin`,
      mimeType: meta.type || meta.contentType || 'application/octet-stream',
    };
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
    && buf[0] === 0x25 // %
    && buf[1] === 0x50 // P
    && buf[2] === 0x44 // D
    && buf[3] === 0x46 // F
    && buf[4] === 0x2d; // -

  return mimeType.includes('pdf') || filename.endsWith('.pdf') || hasPdfSignature;
}

/**
 * Capture a diagnostic snapshot of the raw request body state.
 * Saved to every Firestore invoice doc under rawBodyDiag so we can
 * debug body-parsing failures without guessing.
 */
function captureRawBodyDiag(req) {
  const body = req.body;
  return {
    bodyTypeof: typeof body,
    bodyIsBuffer: Buffer.isBuffer(body),
    bodyIsNull: body === null,
    bodyIsUndefined: body === undefined,
    bodyBufferLength: Buffer.isBuffer(body) ? body.length : null,
    bodyStringLength: typeof body === 'string' ? body.length : null,
    bodyObjectKeys: (body && typeof body === 'object' && !Buffer.isBuffer(body))
      ? Object.keys(body).slice(0, 30) : null,
    rawBodyPropExists: 'rawBody' in req,
    rawBodyLength: (req.rawBody != null)
      ? (Buffer.isBuffer(req.rawBody) ? req.rawBody.length : String(req.rawBody).length) : null,
    readableEnded: req.readableEnded ?? null,
    destroyed: req.destroyed ?? null,
    hasOnFn: typeof req.on === 'function',
    hasPipeFn: typeof req.pipe === 'function',
    contentType: req.headers?.['content-type'] || null,
    contentLength: req.headers?.['content-length'] || null,
  };
}

/**
 * Read the entire raw request body as a Buffer.
 * Tries four strategies in order of reliability:
 *   1. req.rawBody  — some Vercel/custom middleware pre-buffers here
 *   2. req.body Buffer — Vercel Node.js runtime sometimes exposes raw bytes here
 *   3. req.body string — binary or base64 stringified body
 *   4. Live stream  — req.on('data') / req.on('end')
 */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    // Strategy 1: req.rawBody (set by some Vercel middleware / express raw-body)
    if (req.rawBody != null) {
      if (Buffer.isBuffer(req.rawBody) && req.rawBody.length > 0) return resolve(req.rawBody);
      if (typeof req.rawBody === 'string' && req.rawBody.length > 0)
        return resolve(Buffer.from(req.rawBody, 'binary'));
    }
    // Strategy 2: req.body as Buffer
    if (Buffer.isBuffer(req.body) && req.body.length > 0) return resolve(req.body);
    // Strategy 3: req.body as string
    if (typeof req.body === 'string' && req.body.length > 0)
      return resolve(Buffer.from(req.body, 'binary'));
    // Strategy 4: live stream
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

function parseMultipart(req) {
  return new Promise(async (resolve, reject) => {
    const contentType = req.headers?.['content-type'] || '';

    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      // Non-multipart: use whatever Vercel already parsed
      const body = typeof req.body === 'object' && req.body !== null && !Buffer.isBuffer(req.body)
        ? req.body : {};
      return resolve({
        fields: body,
        files: extractFilesFromParsedBody(body),
        parseMeta: {
          path: 'non-multipart',
          bodyKeysCount: Object.keys(body).length,
        },
      });
    }

    // ── Priority 1: Vercel may have already pre-parsed the multipart body into a
    //    plain object (it does this for payloads under its size threshold).  When
    //    that happens the raw stream is already consumed, so we must use the
    //    pre-parsed object directly rather than trying to re-read the stream.
    if (typeof req.body === 'object' && req.body !== null && !Buffer.isBuffer(req.body)) {
      const keys = Object.keys(req.body);
      // If any recognised SendGrid or form fields are present, trust this object.
      const hasSendGridFields = keys.some((k) =>
        ['from', 'to', 'subject', 'text', 'html', 'attachments', 'attachment1',
         'dkim', 'charsets', 'sender_ip', 'envelope'].includes(k)
      );
      if (hasSendGridFields || keys.length > 0) {
        return resolve({
          fields: req.body,
          files: extractFilesFromParsedBody(req.body),
          parseMeta: {
            path: 'preparsed-object',
            bodyKeysCount: keys.length,
            bodyKeysSample: keys.slice(0, 20),
          },
        });
      }
    }

    // ── Priority 2: Try to read raw bytes and feed them to Busboy
    let rawBuffer;
    try { rawBuffer = await readRawBody(req); } catch (err) { return reject(err); }

    if (!rawBuffer || rawBuffer.length === 0) {
      // Last-resort fallback: use whatever is in req.body
      const fallback = (typeof req.body === 'object' && req.body !== null && !Buffer.isBuffer(req.body))
        ? req.body : {};
      return resolve({
        fields: fallback,
        files: extractFilesFromParsedBody(fallback),
        parseMeta: {
          path: 'raw-empty-fallback-object',
          rawBufferLength: 0,
          fallbackKeysCount: Object.keys(fallback).length,
        },
      });
    }

    // Feed raw bytes into Busboy
    const fields = {};
    const files = [];
    const bb = Busboy({ headers: req.headers, limits: { fieldSize: 50 * 1024 * 1024 } });

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
      resolve({
        fields,
        files,
        parseMeta: {
          path: 'raw-buffer-busboy',
          rawBufferLength: rawBuffer.length,
          parsedFieldCount: Object.keys(fields).length,
          parsedFileCount: files.length,
        },
      });
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

/**
 * When SendGrid is configured with "POST the raw, full MIME message",
 * the entire email (headers + base64-encoded attachments) arrives in
 * a form field called `email`.  Parse it with mailparser to extract
 * the attachments and body text that Busboy cannot see.
 */
async function extractFromRawMime(fields, existingFiles) {
  const rawMime = fields.email;
  if (!rawMime || typeof rawMime !== 'string') return { files: existingFiles, fields };

  let parsed;
  try {
    parsed = await simpleParser(rawMime);
  } catch (err) {
    console.warn('AP webhook: MIME parse failed:', err?.message || err);
    return { files: existingFiles, fields };
  }

  // Merge text/html bodies if the parsed fields didn't already have them
  const mergedFields = { ...fields };
  if (!mergedFields.text && parsed.text) mergedFields.text = parsed.text;
  if (!mergedFields.html && parsed.html) mergedFields.html = parsed.html;
  if (!mergedFields.subject && parsed.subject) mergedFields.subject = parsed.subject;
  if (!mergedFields.from && parsed.from?.text) mergedFields.from = parsed.from.text;

  // Convert mailparser attachments to the { name, buffer, info } shape
  const mimeFiles = (parsed.attachments || []).map((att, i) => ({
    name: `attachment${i + 1}`,
    buffer: att.content, // Buffer
    info: {
      filename: att.filename || `attachment${i + 1}.bin`,
      mimeType: att.contentType || 'application/octet-stream',
    },
  }));

  return {
    files: [...existingFiles, ...mimeFiles],
    fields: mergedFields,
  };
}

/** Extract fields from travel-agent commission invoices (New World Travel, similar formats). */
function extractTravelAgentInvoice(text) {
  const normalized = normalizeExtractionText(text);

  // Invoice number: "Tax Invoice Number PG.0000000074"
  const invoiceNumber = matchFirst(normalized, [
    /Tax Invoice Number\s+([A-Z0-9][A-Z0-9./\-]+)/i,
    /Invoice Number\s+([A-Z0-9][A-Z0-9./\-]+)/i,
  ]);

  // Date from header e.g. "Wednesday 01 April 2026 09:57"
  const invoiceDate = matchFirst(normalized, [
    /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}\s+\w+\s+\d{4})/i,
    /invoice\s*date\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
  ]);

  // Supplier from EFT account name (the travel agency)
  const supplier = matchFirst(normalized, [
    /Account name:\s*(.+)/i,
  ]);

  // Totals row: "Total for THE ROYCE  271.80  302.00  30.20"  (Nett, Paid, Due/Commission)
  const totalsMatch = normalized.match(/Total(?:\s+for\s+[A-Z\s]+?)?\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)/i);
  const totalNett       = totalsMatch ? parseMoney(totalsMatch[1]) : null;
  const totalPaid       = totalsMatch ? parseMoney(totalsMatch[2]) : null;
  const totalCommission = totalsMatch ? parseMoney(totalsMatch[3]) : null;

  // Line items — each booking row: SEG DocNum BookNum Consultant ClientProfile ... TransDate BookDate DepDate Nett Paid Due
  const lineItems = [];
  const rowRe = /\b(HTL|FLT|CAR|TRN|CRU|INS|PKG|ACT)\b\s+(R\.[A-Z0-9]+)\s+(B\.[A-Z0-9]+)\s+(\S+)\s+(.+?)\s+(\S+)\s+(\d{2}[\/\-]\d{2}[\/\-]\d{2,4})\s+(\d{2}[\/\-]\d{2}[\/\-]\d{2,4})\s+(\d{2}[\/\-]\d{2}[\/\-]\d{2,4})\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)/gi;
  let m;
  while ((m = rowRe.exec(normalized)) !== null) {
    lineItems.push({
      type:            m[1].toUpperCase(),
      documentNumber:  m[2],
      bookingNumber:   m[3],
      consultant:      m[4],
      clientName:      m[5].trim(),
      reference:       m[6],
      transactionDate: m[7],
      bookingDate:     m[8],
      departureDate:   m[9],
      creditorNett:    parseMoney(m[10]),
      paid:            parseMoney(m[11]),
      commission:      parseMoney(m[12]),
    });
  }

  // Primary booking number from first line item or standalone pattern
  const bookingNumber = lineItems[0]?.bookingNumber
    || matchFirst(normalized, [/\b(B\.[A-Z0-9]+)/i]);

  // Client name(s)
  const clientNames = [...new Set(lineItems.map(i => i.clientName).filter(Boolean))];

  // Amount to display = commission due (what the hotel owes the agent)
  const parsedAmount = totalCommission ?? totalPaid ?? totalNett;

  return {
    invoiceNumber,
    invoiceDate,
    supplier,
    bookingNumber,
    clientNames,
    totalNett,
    totalPaid,
    totalCommission,
    parsedAmount,
    lineItems,
    invoiceType: 'travel-agent',
  };
}

/** Generic heuristic extraction for non-travel-agent invoices. */
function extractGenericInvoiceFields(text = '') {
  const normalized = normalizeExtractionText(text);
  const lines = getMeaningfulLines(normalized);

  const invoiceNumber = matchFirst(normalized, [
    /invoice\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]+)/i,
    /inv\s*(?:no\.?|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]+)/i,
    /reference\s*(?:no\.?|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]+)/i,
  ]);

  const invoiceDate = matchFirst(normalized, [
    /invoice\s*date\s*[:\-]?\s*(\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4})/i,
    /date\s*issued\s*[:\-]?\s*(\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4})/i,
    /issue\s*date\s*[:\-]?\s*(\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4})/i,
    /(?:^|\n)date\s*[:\-]?\s*(\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4})/i,
  ]);

  const supplier = matchFirst(normalized, [
    /supplier\s*[:\-]?\s*(.+)/i,
    /vendor\s*[:\-]?\s*(.+)/i,
    /from\s*[:\-]?\s*(.+)/i,
    /bill\s*from\s*[:\-]?\s*(.+)/i,
  ]) || inferSupplierFromLines(lines);

  const amountLabelValue = matchFirst(normalized, [
    /balance\s*due\s*[:\-]?\s*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /amount\s*due\s*[:\-]?\s*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /total\s*due\s*[:\-]?\s*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /invoice\s*total\s*[:\-]?\s*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /grand\s*total\s*[:\-]?\s*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /total\s*[:\-]?\s*\$?([\d,]+(?:\.\d{1,2})?)/i,
  ]);
  let parsedAmount = parseMoney(amountLabelValue);

  // Fallback for formats that don't label totals clearly.
  if (parsedAmount == null) {
    const tail = lines.slice(-30).join('\n');
    const moneyMatches = [...tail.matchAll(/\$?([\d,]+\.\d{2})/g)]
      .map((m) => parseMoney(m[1]))
      .filter((v) => v != null);
    if (moneyMatches.length) {
      parsedAmount = Math.max(...moneyMatches);
    }
  }

  const lineItems = extractLineItems(normalized);

  return { invoiceNumber, invoiceDate, supplier, parsedAmount, lineItems };
}

function isTravelAgentInvoice(text = '') {
  return /Tax Invoice Number\s+[A-Z0-9./\-]+\s+for Creditor/i.test(text)
    || /Account name:.*Travel/i.test(text)
    || /\b(HTL|FLT|CAR|TRN|CRU)\s+R\.[A-Z0-9]+\s+B\.[A-Z0-9]+/i.test(text);
}

function scoreParsedCandidate(parsed = {}) {
  let score = 0;
  if (parsed.invoiceNumber) score += 2;
  if (parsed.invoiceDate) score += 1;
  if (parsed.supplier) score += 1;
  if (parsed.parsedAmount != null) score += 2;
  if (Array.isArray(parsed.lineItems) && parsed.lineItems.length > 0) {
    score += Math.min(2, parsed.lineItems.length > 2 ? 2 : 1);
  }
  if (parsed.invoiceType === 'travel-agent' && parsed.totalCommission != null) score += 1;
  return score;
}

function mergeParsedCandidates(primary = {}, secondary = {}) {
  const merged = { ...primary };

  for (const key of Object.keys(secondary)) {
    const cur = merged[key];
    const next = secondary[key];
    const curEmpty = cur == null || cur === '' || (Array.isArray(cur) && cur.length === 0);
    if (curEmpty && next != null && next !== '') merged[key] = next;
  }

  if (Array.isArray(primary.lineItems) || Array.isArray(secondary.lineItems)) {
    const a = Array.isArray(primary.lineItems) ? primary.lineItems : [];
    const b = Array.isArray(secondary.lineItems) ? secondary.lineItems : [];
    merged.lineItems = a.length >= b.length ? a : b;
  }

  return merged;
}

function extractInvoiceFields(text = '') {
  const normalized = normalizeExtractionText(text);
  const generic = extractGenericInvoiceFields(normalized);

  if (!isTravelAgentInvoice(normalized)) {
    return generic;
  }

  const travel = extractTravelAgentInvoice(normalized);
  const travelScore = scoreParsedCandidate(travel);
  const genericScore = scoreParsedCandidate(generic);

  if (travelScore >= genericScore) {
    return mergeParsedCandidates(travel, generic);
  }
  return mergeParsedCandidates(generic, travel);
}

function extractInvoiceFieldsDetailed(text = '') {
  const normalized = normalizeExtractionText(text);
  const generic = extractGenericInvoiceFields(normalized);
  const travelDetected = isTravelAgentInvoice(normalized);

  if (!travelDetected) {
    return {
      parsed: generic,
      debug: {
        parserUsed: 'generic',
        travelDetected: false,
        genericScore: scoreParsedCandidate(generic),
        travelScore: null,
      },
    };
  }

  const travel = extractTravelAgentInvoice(normalized);
  const travelScore = scoreParsedCandidate(travel);
  const genericScore = scoreParsedCandidate(generic);
  const parserUsed = travelScore >= genericScore ? 'travel-agent' : 'generic';
  const parsed = parserUsed === 'travel-agent'
    ? mergeParsedCandidates(travel, generic)
    : mergeParsedCandidates(generic, travel);

  return {
    parsed,
    debug: {
      parserUsed,
      travelDetected: true,
      genericScore,
      travelScore,
    },
  };
}

// Tell Vercel NOT to consume/parse the request body before our handler runs.
// Without this, the raw multipart stream is drained before Busboy can read it.
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Optional: verify SendGrid shared secret
  const secret = req.headers['x-sendgrid-secret'];
  if (process.env.SENDGRID_WEBHOOK_SECRET && secret !== process.env.SENDGRID_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const rawBodyDiag = captureRawBodyDiag(req);
    const { db, getBucket } = getFirebaseAdminServices();
    let { fields, files, parseMeta } = await parseMultipart(req);

    // When SendGrid is in raw-MIME mode the PDF lives inside the `email`
    // field as a base64-encoded MIME part.  Extract it if Busboy found no files.
    if (files.length === 0 && fields.email) {
      const mimeResult = await extractFromRawMime(fields, files);
      files  = mimeResult.files;
      fields = mimeResult.fields;
      parseMeta = { ...parseMeta, mimeExtraction: true, mimeFilesFound: mimeResult.files.length };
    }

    // SendGrid Inbound Parse field names
    // https://docs.sendgrid.com/for-developers/parsing-email/setting-up-the-inbound-parse-webhook
    const fromEmail  = fields.from    || 'unknown';
    const subject    = fields.subject || '';
    const bodyText   = fields.text    || '';   // plain text body
    const bodyHtml   = fields.html    || '';   // html body (fallback)
    const toEmail    = fields.to      || '';
    const senderIp   = fields.sender_ip || '';
    const attachmentsDeclared = Number.parseInt(String(fields.attachments || 0), 10) || 0;
    const attachmentFieldKeys = Object.keys(fields).filter((k) => /^attachment\d+$/i.test(k));
    const contentType = req.headers?.['content-type'] || '';

    // attachments are named attachment1, attachment2, etc. by SendGrid
    const pdf = files.find((f) => isPdfFileCandidate(f));

    if (!pdf) {
      console.warn('AP webhook: no PDF in email from', fromEmail, '| subject:', subject);
      // Still save the email record so staff can see it arrived without an attachment
      const fallbackText = [bodyText, stripHtml(bodyHtml), subject].filter(Boolean).join('\n');
      const detailed = extractInvoiceFieldsDetailed(fallbackText);
      const parsed = detailed.parsed;
      const parsedFieldCount = [parsed.invoiceNumber, parsed.invoiceDate, parsed.supplier, parsed.parsedAmount]
        .filter(value => value !== null && value !== undefined && value !== '').length;
      await db.collection('ap_invoices').add({
        fromEmail, subject, toEmail, senderIp,
        pdfUrl: null,
        storagePath: null,
        receivedAt: new Date().toISOString(),
        status: 'pending',
        department: null,
        confirmedAmount: null,
        warning: 'No PDF attachment found',
        parseSource: 'email-only-no-pdf',
        parsePreview: fallbackText.slice(0, 2000),
        pdfTextLength: 0,
        parsedFieldCount,
        parseWarning: 'No PDF attachment found. Parsed from email body/subject only.',
        parseDebug: {
          ...detailed.debug,
          rawBodyDiag,
          multipartMeta: parseMeta,
          noPdfReason: 'No attachment matched PDF checks (mimeType contains pdf, filename .pdf, or %PDF signature).',
          contentType,
          attachmentsDeclared,
          attachmentFieldKeys,
          parsedFilesCount: files.length,
          parsedFileMeta: files.slice(0, 5).map((f) => ({
            name: f.name || null,
            filename: f.info?.filename || null,
            mimeType: f.info?.mimeType || null,
            size: f.buffer?.length || 0,
          })),
          sourceLengths: {
            bodyText: String(bodyText || '').length,
            bodyHtml: String(bodyHtml || '').length,
            subject: String(subject || '').length,
            combined: fallbackText.length,
          },
        },
        ...parsed,
      });
      return res.status(200).json({ received: true, warning: 'No PDF attachment' });
    }

    // Upload PDF to Firebase Storage
    const bucket      = getBucket();
    const timestamp   = Date.now();
    const fileName    = pdf.info?.filename || 'invoice.pdf';
    const safeName    = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `ap_invoices/${timestamp}_${safeName}`;
    const file        = bucket.file(storagePath);

    await file.save(pdf.buffer, { contentType: 'application/pdf', resumable: false });
    // PDFs are kept private; access is via the /api/pdf-link endpoint which enforces retention.
    const pdfUrl = null; // resolved on demand
    let pdfText = '';
    try {
      pdfText = await extractPdfText(pdf.buffer);
    } catch (parseErr) {
      console.warn('AP webhook: PDF text extraction failed:', parseErr?.message || parseErr);
    }

    const parseSourceText = [
      pdfText,
      bodyText,
      stripHtml(bodyHtml),
      subject,
    ].filter(Boolean).join('\n');
    const detailed = extractInvoiceFieldsDetailed(parseSourceText);
    const parsed = detailed.parsed;
    const parsedFieldCount = [parsed.invoiceNumber, parsed.invoiceDate, parsed.supplier, parsed.parsedAmount]
      .filter(value => value !== null && value !== undefined && value !== '').length;
    const parseWarning = pdfText
      ? (parsedFieldCount === 0 ? 'PDF text extracted, but no invoice fields matched current parser heuristics.' : null)
      : 'No extractable text found in PDF. This usually means the PDF is image-based/scanned and needs OCR.';

    const docRef = await db.collection('ap_invoices').add({
      fromEmail, subject, toEmail, senderIp,
      pdfUrl,
      storagePath,
      originalFilename: fileName,
      receivedAt: new Date().toISOString(),
      status: 'pending',
      department: null,
      confirmedAmount: null,
      parseSource: pdfText ? 'pdf+email' : 'email',
      parsePreview: parseSourceText.slice(0, 2000),
      pdfTextLength: pdfText.length,
      parsedFieldCount,
      parseWarning,
      parseDebug: {
        ...detailed.debug,
        rawBodyDiag,
        multipartMeta: parseMeta,
        parsedFilesCount: files.length,
        parsedFileMeta: files.slice(0, 5).map((f) => ({
          name: f.name || null,
          filename: f.info?.filename || null,
          mimeType: f.info?.mimeType || null,
          size: f.buffer?.length || 0,
        })),
        sourceLengths: {
          pdfText: pdfText.length,
          bodyText: String(bodyText || '').length,
          bodyHtml: String(bodyHtml || '').length,
          subject: String(subject || '').length,
          combined: parseSourceText.length,
        },
      },
      ...parsed,
    });

    console.log('AP invoice saved:', docRef.id, '| from:', fromEmail);
    return res.status(200).json({ received: true, invoiceId: docRef.id });

  } catch (err) {
    console.error('AP webhook error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err?.message || 'Unknown error' });
  }
}
