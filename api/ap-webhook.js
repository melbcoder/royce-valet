import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import Busboy from 'busboy';

function getFirebaseAdminServices() {
  if (!getApps().length) {
    const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
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
        storageBucket,
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
        storageBucket,
      });
    }
  }

  const db = getFirestore();
  const bucket = getStorage().bucket();
  return { db, bucket };
}

/** Parse multipart/form-data from the raw request */
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers?.['content-type'] || '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
      resolve({ fields: body, files: [] });
      return;
    }

    if (typeof req.pipe !== 'function') {
      reject(new Error('Request stream is not available for multipart parsing'));
      return;
    }

    const fields = {};
    const files = [];
    const bb = Busboy({ headers: req.headers });

    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('file', (name, stream, info) => {
      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => files.push({ name, buffer: Buffer.concat(chunks), info }));
    });
    bb.on('close', () => resolve({ fields, files }));
    bb.on('finish', () => resolve({ fields, files }));
    bb.on('error', reject);
    req.pipe(bb);
  });
}

/** Very basic invoice field extractor — replace with Textract/Document AI for production */
function extractInvoiceFields(text = '') {
  const invoiceNumber = text.match(/invoice\s*#?\s*[:\-]?\s*([A-Z0-9\-]+)/i)?.[1] ?? null;
  const invoiceDate   = text.match(/(?:date|dated)\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i)?.[1] ?? null;
  const supplier      = text.match(/from\s*[:\-]?\s*(.+)/i)?.[1]?.trim() ?? null;
  const amountMatch   = text.match(/(?:total|amount due|amount)\s*[:\-]?\s*\$?([\d,]+\.?\d*)/i);
  const parsedAmount  = amountMatch ? parseFloat(amountMatch[1].replace(',', '')) : null;

  // Naive line-item extraction: rows with description + numbers
  const lineItems = [];
  const lineRe = /(.+?)\s+(\d+)\s+\$?([\d.]+)\s+\$?([\d.]+)/g;
  let m;
  while ((m = lineRe.exec(text)) !== null) {
    lineItems.push({
      description: m[1].trim(),
      quantity:    parseFloat(m[2]),
      unitPrice:   parseFloat(m[3]),
      total:       parseFloat(m[4]),
    });
  }

  return { invoiceNumber, invoiceDate, supplier, parsedAmount, lineItems };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Optional: verify SendGrid shared secret
  const secret = req.headers['x-sendgrid-secret'];
  if (process.env.SENDGRID_WEBHOOK_SECRET && secret !== process.env.SENDGRID_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { db, bucket } = getFirebaseAdminServices();
    const { fields, files } = await parseMultipart(req);

    // SendGrid Inbound Parse field names
    // https://docs.sendgrid.com/for-developers/parsing-email/setting-up-the-inbound-parse-webhook
    const fromEmail  = fields.from    || 'unknown';
    const subject    = fields.subject || '';
    const bodyText   = fields.text    || '';   // plain text body
    const bodyHtml   = fields.html    || '';   // html body (fallback)
    const toEmail    = fields.to      || '';
    const senderIp   = fields.sender_ip || '';

    // attachments are named attachment1, attachment2, etc. by SendGrid
    const pdf = files.find(f =>
      f.info?.mimeType === 'application/pdf' ||
      f.info?.filename?.toLowerCase().endsWith('.pdf')
    );

    if (!pdf) {
      console.warn('AP webhook: no PDF in email from', fromEmail, '| subject:', subject);
      // Still save the email record so staff can see it arrived without an attachment
      await db.collection('ap_invoices').add({
        fromEmail, subject, toEmail, senderIp,
        pdfUrl: null,
        storagePath: null,
        receivedAt: new Date().toISOString(),
        status: 'pending',
        department: null,
        confirmedAmount: null,
        warning: 'No PDF attachment found',
        ...extractInvoiceFields(bodyText || bodyHtml),
      });
      return res.status(200).json({ received: true, warning: 'No PDF attachment' });
    }

    // Upload PDF to Firebase Storage
    const timestamp   = Date.now();
    const safeName    = pdf.info.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `ap_invoices/${timestamp}_${safeName}`;
    const file        = bucket.file(storagePath);

    await file.save(pdf.buffer, { contentType: 'application/pdf', resumable: false });
    await file.makePublic();

    const pdfUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
    const parsed = extractInvoiceFields(bodyText || bodyHtml);

    const docRef = await db.collection('ap_invoices').add({
      fromEmail, subject, toEmail, senderIp,
      pdfUrl,
      storagePath,
      receivedAt: new Date().toISOString(),
      status: 'pending',
      department: null,
      confirmedAmount: null,
      ...parsed,
    });

    console.log('AP invoice saved:', docRef.id, '| from:', fromEmail);
    return res.status(200).json({ received: true, invoiceId: docRef.id });

  } catch (err) {
    console.error('AP webhook error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err?.message || 'Unknown error' });
  }
}
