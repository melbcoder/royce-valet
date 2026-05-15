/**
 * room-status-webhook.js
 *
 * SendGrid Inbound Parse webhook that receives an email with a
 * "Room No Status Verification Report" CSV attachment every ~15 minutes
 * and upserts the Firestore `roomStatus` collection.
 *
 * Authentication: path secret via Vercel rewrite
 *   POST /api/room-status-webhook/<ROOM_STATUS_WEBHOOK_SECRET>
 *
 * Environment variables required:
 *   ROOM_STATUS_WEBHOOK_SECRET   – shared secret in the webhook URL
 *   FIREBASE_SERVICE_ACCOUNT     – Firebase Admin credentials (JSON string)
 *   FIREBASE_STORAGE_BUCKET      – (optional) storage bucket name
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import Busboy from 'busboy';
import { Readable } from 'node:stream';
import { ingestRoomStatusCsvPayload, isRoomStatusCsv } from '../server/lib/roomStatusReport.js';

// ─── Firebase Admin bootstrap ────────────────────────────────────────────────

function normalizeBucketName(raw = '') {
  const value = String(raw || '').trim();
  if (!value) return '';
  return value.replace(/^gs:\/\//i, '').replace(/\/+$/, '');
}

function getAdminDb() {
  if (!getApps().length) {
    const storageBucket = normalizeBucketName(process.env.FIREBASE_STORAGE_BUCKET);
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (serviceAccountJson) {
      let parsed;
      try { parsed = JSON.parse(serviceAccountJson); } catch {
        throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
      }
      initializeApp({ credential: cert(parsed), ...(storageBucket ? { storageBucket } : {}) });
    } else {
      const privateKey   = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
      const projectId    = process.env.FIREBASE_PROJECT_ID;
      const clientEmail  = process.env.FIREBASE_CLIENT_EMAIL;
      if (!projectId || !clientEmail || !privateKey) {
        throw new Error('Missing Firebase Admin credentials.');
      }
      initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), ...(storageBucket ? { storageBucket } : {}) });
    }
  }
  return getFirestore();
}

// ─── Request body helpers ─────────────────────────────────────────────────────

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

function isCsvCandidate(file) {
  if (!file) return false;
  const mimeType = String(file.info?.mimeType || file.info?.mimetype || '').toLowerCase();
  const filename = String(file.info?.filename || file.name || '').toLowerCase();
  return filename.endsWith('.csv') || mimeType.includes('text/csv') || mimeType.includes('application/csv');
}

/** Extract CSV files from a raw MIME email string (SendGrid raw mode). */
function extractCsvsFromRawMime(rawMime) {
  const files = [];
  if (!rawMime || typeof rawMime !== 'string') return files;

  const boundaryMatch = rawMime.match(/Content-Type:\s*multipart\/mixed;\s*boundary="?([^\s"]+)"?/i);
  if (!boundaryMatch) return files;

  const boundary = boundaryMatch[1];
  for (const part of rawMime.split('--' + boundary)) {
    const ctMatch   = part.match(/Content-Type:\s*([^\r\n]+)/i);
    const contentType = String(ctMatch?.[1] || '').toLowerCase();
    const dispMatch = part.match(/Content-Disposition:\s*attachment;\s*filename="?([^"\r\n]+)"?/i);
    const filename  = dispMatch ? dispMatch[1].trim() : 'report.csv';

    const isCsv = filename.toLowerCase().endsWith('.csv')
      || contentType.includes('text/csv')
      || contentType.includes('application/csv');
    if (!isCsv) continue;

    const encodingMatch = part.match(/Content-Transfer-Encoding:\s*(\S+)/i);
    const encoding      = encodingMatch ? encodingMatch[1].toLowerCase() : '7bit';
    const bodyStart     = part.match(/\r?\n\r?\n/);
    if (!bodyStart) continue;

    const bodyText = part.slice(bodyStart.index + bodyStart[0].length).trim();
    if (!bodyText) continue;

    const buffer = encoding === 'base64'
      ? Buffer.from(bodyText.replace(/[\r\n\s]/g, ''), 'base64')
      : Buffer.from(bodyText, 'binary');

    if (buffer.length > 0) {
      files.push({ name: filename, buffer, info: { filename, mimeType: 'text/csv' } });
    }
  }

  return files;
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
      files.push({ name: key, buffer, info: { filename: meta.filename || `${key}.bin`, mimeType: meta.type || 'application/octet-stream' } });
    }
  }

  return files;
}

function parseMultipart(req) {
  return new Promise(async (resolve, reject) => {
    const contentType = req.headers?.['content-type'] || '';

    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      const parsedBody = typeof req.body === 'object' && req.body !== null && !Buffer.isBuffer(req.body)
        ? req.body : null;
      if (parsedBody) {
        return resolve({ fields: parsedBody, files: extractFilesFromParsedBody(parsedBody) });
      }
      let rawBuffer;
      try { rawBuffer = await readRawBody(req); } catch (err) { return reject(err); }
      const rawText = rawBuffer.toString('utf8').trim();
      if (!rawText) return resolve({ fields: {}, files: [] });
      if (contentType.toLowerCase().includes('application/json')) {
        try {
          const body = JSON.parse(rawText);
          const fields = typeof body === 'object' && body !== null ? body : {};
          return resolve({ fields, files: extractFilesFromParsedBody(fields) });
        } catch { return resolve({ fields: {}, files: [] }); }
      }
      if (contentType.toLowerCase().includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(rawText);
        const fields = Object.fromEntries(params.entries());
        return resolve({ fields, files: extractFilesFromParsedBody(fields) });
      }
      return resolve({ fields: {}, files: [] });
    }

    if (typeof req.body === 'object' && req.body !== null && !Buffer.isBuffer(req.body)) {
      const keys = Object.keys(req.body);
      if (keys.length > 0) {
        return resolve({ fields: req.body, files: extractFilesFromParsedBody(req.body) });
      }
    }

    let rawBuffer;
    try { rawBuffer = await readRawBody(req); } catch (err) { return reject(err); }

    if (!rawBuffer || rawBuffer.length === 0) {
      return resolve({ fields: {}, files: [] });
    }

    const fields = {};
    const files  = [];
    const bb     = Busboy({ headers: req.headers });

    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('file',  (name, stream, info) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end',  () => files.push({ name, buffer: Buffer.concat(chunks), info }));
    });

    let settled = false;
    const done  = () => { if (settled) return; settled = true; resolve({ fields, files }); };
    bb.on('close', done);
    bb.on('finish', done);
    bb.on('error', reject);

    const r = new Readable({ read() {} });
    r.push(rawBuffer);
    r.push(null);
    r.pipe(bb);
  });
}

// ─── Vercel config ────────────────────────────────────────────────────────────

export const config = { api: { bodyParser: false } };

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  console.log('Room-status webhook hit:', req.method);

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, endpoint: 'room-status-webhook', timestamp: new Date().toISOString() });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Authentication ──────────────────────────────────────────────────────────
  const expectedSecret = process.env.ROOM_STATUS_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error('room-status-webhook: ROOM_STATUS_WEBHOOK_SECRET is not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Accept secret via: query param (Vercel rewrite), header, or Bearer token
  const routeSecret  = typeof req.query?.routeSecret  === 'string' ? req.query.routeSecret.trim()  : '';
  const headerSecret = typeof req.headers?.['x-webhook-secret'] === 'string' ? req.headers['x-webhook-secret'].trim() : '';
  const authHeader   = typeof req.headers?.authorization === 'string' ? req.headers.authorization.trim() : '';
  const bearerSecret = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';

  const incomingSecret = routeSecret || headerSecret || bearerSecret;
  if (!incomingSecret || incomingSecret !== expectedSecret) {
    console.log('room-status-webhook: auth failed');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── Parse multipart body ───────────────────────────────────────────────────
  let fields, files;
  try {
    const parsed = await parseMultipart(req);
    fields = parsed.fields;
    files  = parsed.files;
  } catch (parseErr) {
    console.error('room-status-webhook: multipart parse failed:', parseErr?.message);
    return res.status(200).json({ received: true, warning: 'Parse failed' });
  }

  const fromEmail = String(fields.from    || '').slice(0, 200);
  const subject   = String(fields.subject || '').slice(0, 200);
  const toEmail   = String(fields.to      || '').slice(0, 200);

  // ── Find CSV attachment ───────────────────────────────────────────────────
  let csvFile = files.find((f) => isCsvCandidate(f));

  if (!csvFile && typeof fields.email === 'string' && fields.email.length > 0) {
    const mimeCsvs = extractCsvsFromRawMime(fields.email);
    if (mimeCsvs.length > 0) csvFile = mimeCsvs[0];
  }

  const db = getAdminDb();

  if (!csvFile) {
    await db.collection('room_status_webhook_log').add({
      receivedAt: new Date().toISOString(),
      fromEmail, toEmail, subject,
      status: 'no-csv-found',
    });
    return res.status(200).json({ received: true, warning: 'No CSV attachment found' });
  }

  const csvText = csvFile.buffer.toString('utf8');

  if (!isRoomStatusCsv(csvText)) {
    await db.collection('room_status_webhook_log').add({
      receivedAt: new Date().toISOString(),
      fromEmail, toEmail, subject,
      status: 'wrong-csv-format',
      filename: csvFile.info?.filename || csvFile.name || '',
    });
    return res.status(200).json({ received: true, warning: 'CSV does not appear to be a Room Status report' });
  }

  // ── Ingest ────────────────────────────────────────────────────────────────
  try {
    const result = await ingestRoomStatusCsvPayload({ csv: csvText, db });

    await db.collection('room_status_webhook_log').add({
      receivedAt: new Date().toISOString(),
      fromEmail, toEmail, subject,
      status: 'ingested',
      roomCount: result.count,
      filename: csvFile.info?.filename || csvFile.name || '',
    });

    console.log(`room-status-webhook: ingested ${result.count} rooms`);
    return res.status(200).json({ received: true, roomCount: result.count });
  } catch (err) {
    console.error('room-status-webhook: ingest failed:', err?.message);
    await db.collection('room_status_webhook_log').add({
      receivedAt: new Date().toISOString(),
      fromEmail, toEmail, subject,
      status: 'error',
      error: String(err?.message || '').slice(0, 500),
    });
    return res.status(500).json({ error: 'Ingest failed' });
  }
}
