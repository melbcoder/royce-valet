import Busboy from 'busboy';
import { Readable } from 'node:stream';
import { getAdminFirestore } from '../server/lib/firebaseAdmin.js';
import { ingestLowRateCsvPayload } from './low-rate-report-ingest.js';

export const config = { api: { bodyParser: false } };

function extractWebhookSecret(req) {
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

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    if (req.rawBody != null) {
      if (Buffer.isBuffer(req.rawBody) && req.rawBody.length > 0) return resolve(req.rawBody);
      if (typeof req.rawBody === 'string' && req.rawBody.length > 0) {
        return resolve(Buffer.from(req.rawBody, 'binary'));
      }
    }

    if (Buffer.isBuffer(req.body) && req.body.length > 0) return resolve(req.body);
    if (typeof req.body === 'string' && req.body.length > 0) {
      return resolve(Buffer.from(req.body, 'binary'));
    }

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

async function parseMultipart(req) {
  const rawBuffer = await readRawBody(req);
  const contentType = String(req.headers['content-type'] || '');
  const looksMultipart = /multipart\/form-data/i.test(contentType);

  if (!looksMultipart) {
    const fields = {};
    try {
      const parsed = JSON.parse(rawBuffer.toString('utf8') || '{}');
      if (parsed && typeof parsed === 'object') {
        Object.assign(fields, parsed);
      }
    } catch {
      const text = rawBuffer.toString('utf8').trim();
      if (text) {
        fields.raw = text;
      }
    }
    return { fields, files: [] };
  }

  return new Promise((resolve, reject) => {
    const fields = {};
    const files = [];

    let bb;
    try {
      bb = Busboy({ headers: req.headers });
    } catch (err) {
      reject(err);
      return;
    }

    bb.on('field', (name, value) => {
      fields[name] = value;
    });

    bb.on('file', (name, stream, info) => {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        files.push({
          name,
          buffer: Buffer.concat(chunks),
          info: {
            filename: info?.filename || `${name}.bin`,
            mimeType: info?.mimeType || 'application/octet-stream',
          },
        });
      });
    });

    bb.on('error', reject);
    bb.on('close', () => resolve({ fields, files }));
    bb.on('finish', () => resolve({ fields, files }));

    const r = new Readable({ read() {} });
    r.push(rawBuffer);
    r.push(null);
    r.pipe(bb);
  });
}

function extractFilesFromParsedBody(body) {
  if (!body || typeof body !== 'object' || Buffer.isBuffer(body)) return [];

  const files = [];
  let attachmentInfo = {};
  const rawInfo = body['attachment-info'];
  if (typeof rawInfo === 'string') {
    try {
      attachmentInfo = JSON.parse(rawInfo);
    } catch {
      attachmentInfo = {};
    }
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
        } catch {
          buffer = null;
        }
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

function extractCsvFromRawMime(rawMime) {
  if (!rawMime || typeof rawMime !== 'string') return [];

  const boundaryMatch = rawMime.match(/Content-Type:\s*multipart\/mixed;\s*boundary="?([^\s"]+)"?/i);
  if (!boundaryMatch) return [];

  const boundary = boundaryMatch[1];
  const parts = rawMime.split('--' + boundary);
  const csvFiles = [];

  for (const part of parts) {
    const dispMatch = part.match(/Content-Disposition:\s*attachment;\s*filename="?([^"\r\n]+)"?/i);
    const filename = dispMatch ? dispMatch[1].trim() : '';

    const ctMatch = part.match(/Content-Type:\s*([^\r\n]+)/i);
    const contentType = ctMatch ? ctMatch[1].toLowerCase() : '';

    const isCsv = filename.toLowerCase().endsWith('.csv') || contentType.includes('text/csv');
    if (!isCsv) continue;

    const encodingMatch = part.match(/Content-Transfer-Encoding:\s*(\S+)/i);
    const encoding = encodingMatch ? encodingMatch[1].toLowerCase() : '7bit';

    const bodyStart = part.match(/\r?\n\r?\n/);
    if (!bodyStart) continue;

    const bodyText = part.slice(bodyStart.index + bodyStart[0].length).trim();
    if (!bodyText) continue;

    let buffer;
    if (encoding === 'base64') {
      const cleaned = bodyText.replace(/[\r\n\s]/g, '');
      buffer = Buffer.from(cleaned, 'base64');
    } else {
      buffer = Buffer.from(bodyText, 'binary');
    }

    if (buffer.length > 0) {
      csvFiles.push({
        name: filename || 'report.csv',
        buffer,
        info: { filename: filename || 'report.csv', mimeType: 'text/csv' },
      });
    }
  }

  return csvFiles;
}

function isCsvFileCandidate(file) {
  if (!file) return false;
  const mimeType = String(file.info?.mimeType || '').toLowerCase();
  const filename = String(file.info?.filename || '').toLowerCase();
  return filename.endsWith('.csv') || mimeType.includes('text/csv') || mimeType.includes('application/csv');
}

function toDateOnly(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function previousDateIso() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  console.log('Reports webhook hit:', req.method);

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, endpoint: 'reports-webhook', timestamp: new Date().toISOString() });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = extractWebhookSecret(req);
  const expectedSecret = process.env.SENDGRID_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error('Reports webhook: SENDGRID_WEBHOOK_SECRET env var is not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  if (!secret || secret !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getAdminFirestore();
    const { fields, files: multipartFiles } = await parseMultipart(req);

    const fromEmail = String(fields.from || 'unknown');
    const subject = String(fields.subject || '');
    const toEmail = String(fields.to || '');
    const reportDate = toDateOnly(fields.report_date || fields.date) || previousDateIso();

    let files = Array.isArray(multipartFiles) ? [...multipartFiles] : [];
    files = [...files, ...extractFilesFromParsedBody(fields)];

    let csvFile = files.find((f) => isCsvFileCandidate(f));
    if (!csvFile && typeof fields.email === 'string' && fields.email.length > 0) {
      const rawMimeCsvs = extractCsvFromRawMime(fields.email);
      csvFile = rawMimeCsvs.find((f) => isCsvFileCandidate(f));
    }

    if (!csvFile) {
      await db.collection('reports_low_rate_webhook_log').add({
        receivedAt: new Date().toISOString(),
        fromEmail,
        toEmail,
        subject,
        status: 'no-csv-found',
      });
      return res.status(200).json({ received: true, warning: 'No CSV attachment found' });
    }

    const csvText = csvFile.buffer.toString('utf8');

    const result = await ingestLowRateCsvPayload({
      csv: csvText,
      reportDateInput: reportDate,
      sourceLabel: `sendgrid:${subject.slice(0, 80) || 'inbound-email'}`,
      sourceEmail: 'reports@mail.concierge.xin',
      actor: {
        mode: 'automation',
        uid: '',
        username: 'sendgrid-webhook',
        role: 'system',
      },
      db,
    });

    await db.collection('reports_low_rate_webhook_log').add({
      receivedAt: new Date().toISOString(),
      fromEmail,
      toEmail,
      subject,
      status: 'ingested',
      reportId: result.reportId,
      summary: result.summary,
    });

    return res.status(200).json({ received: true, reportId: result.reportId, summary: result.summary });
  } catch (err) {
    console.error('Reports webhook error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err?.message || 'Unknown error' });
  }
}
