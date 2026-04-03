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
  // Log immediately so we can confirm the function is being hit
  console.log('AP webhook hit:', req.method, '| content-type:', req.headers?.['content-type']?.slice(0, 100));

  if (req.method === 'GET') {
    // Health check endpoint — useful for verifying the function is deployed
    return res.status(200).json({ ok: true, endpoint: 'ap-webhook', timestamp: new Date().toISOString() });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-sendgrid-secret'];
  if (process.env.SENDGRID_WEBHOOK_SECRET && secret !== process.env.SENDGRID_WEBHOOK_SECRET) {
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
        _diag: {
          error: 'multipart parse failed',
          message: parseErr?.message,
          contentType: req.headers?.['content-type']?.slice(0, 200) || null,
          bodyType: typeof req.body,
          bodyIsBuffer: Buffer.isBuffer(req.body),
          bodyIsNull: req.body === null || req.body === undefined,
          bodyLength: Buffer.isBuffer(req.body) ? req.body.length : (typeof req.body === 'string' ? req.body.length : null),
          bodyKeys: (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) ? Object.keys(req.body).slice(0, 20) : null,
        },
      });
      return res.status(200).json({ received: true, warning: 'Parse failed, saved placeholder' });
    }

    const fromEmail = fields.from || 'unknown';
    const subject   = fields.subject || '';
    const toEmail   = fields.to || '';

    // Diagnostics: log what SendGrid actually sent
    const fieldKeys = Object.keys(fields);
    const hasRawMime = typeof fields.email === 'string' && fields.email.length > 0;
    const attachmentFieldKeys = fieldKeys.filter(k => /^attachment\d+$/i.test(k));
    const diag = {
      fieldKeys: fieldKeys.slice(0, 30),
      fileCount: files.length,
      attachmentFieldKeys,
      hasRawMimeEmail: hasRawMime,
      rawMimeLength: hasRawMime ? fields.email.length : 0,
      contentType: req.headers?.['content-type']?.slice(0, 120) || null,
      bodyType: typeof req.body,
      bodyIsBuffer: Buffer.isBuffer(req.body),
      fileMeta: files.slice(0, 5).map(f => ({
        name: f.name,
        filename: f.info?.filename,
        mimeType: f.info?.mimeType,
        size: f.buffer?.length,
      })),
    };
    console.log('AP webhook diag:', JSON.stringify(diag));

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
      pdfSource,
      _diag: diag,
    });

    console.log('AP invoice saved:', docRef.id, '| from:', fromEmail, '| pdf:', !!pdf, '| source:', pdfSource);
    return res.status(200).json({ received: true, invoiceId: docRef.id, hasPdf: !!pdf, pdfSource });

  } catch (err) {
    console.error('AP webhook error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err?.message || 'Unknown error' });
  }
}
