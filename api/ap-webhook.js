import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import Busboy from 'busboy';
import { Readable } from 'node:stream';

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
    if (projectId) return getStorage().bucket(`${projectId}.appspot.com`);

    throw new Error(
      'Missing FIREBASE_STORAGE_BUCKET. Set FIREBASE_STORAGE_BUCKET to your bucket (for example: your-project.appspot.com).'
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-sendgrid-secret'];
  if (process.env.SENDGRID_WEBHOOK_SECRET && secret !== process.env.SENDGRID_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { db, getBucket } = getFirebaseAdminServices();
    const { fields, files } = await parseMultipart(req);

    const fromEmail = fields.from || 'unknown';
    const subject   = fields.subject || '';
    const toEmail   = fields.to || '';

    // Find the first PDF attachment
    const pdf = files.find((f) => isPdfFileCandidate(f));

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

    const docRef = await db.collection('ap_invoices').add({
      fromEmail,
      subject,
      toEmail,
      storagePath,
      originalFilename,
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
      hasPdf: !!pdf,
    });

    console.log('AP invoice saved:', docRef.id, '| from:', fromEmail, '| pdf:', !!pdf);
    return res.status(200).json({ received: true, invoiceId: docRef.id, hasPdf: !!pdf });

  } catch (err) {
    console.error('AP webhook error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err?.message || 'Unknown error' });
  }
}
