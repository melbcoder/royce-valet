import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import Busboy from 'busboy';

// Init Firebase Admin once
if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

const db = getFirestore();
const bucket = getStorage().bucket();

/** Parse multipart/form-data from the raw request */
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
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
    const { fields, files } = await parseMultipart(req);

    const fromEmail = fields.from || fields.sender || 'unknown';
    const subject   = fields.subject || '';
    const bodyText  = fields.text || fields.body || '';

    // Find PDF attachment
    const pdf = files.find(f => f.info.mimeType === 'application/pdf' || f.info.filename?.endsWith('.pdf'));
    if (!pdf) {
      console.warn('AP webhook: no PDF attachment found in email from', fromEmail);
      return res.status(200).json({ received: true, warning: 'No PDF attachment' });
    }

    // Upload PDF to Firebase Storage
    const timestamp = Date.now();
    const storagePath = `ap_invoices/${timestamp}_${pdf.info.filename}`;
    const file = bucket.file(storagePath);
    await file.save(pdf.buffer, { contentType: 'application/pdf', resumable: false });
    await file.makePublic();
    const pdfUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

    // Extract invoice fields from email body text (replace with OCR for PDF content)
    const parsed = extractInvoiceFields(bodyText);

    // Save to Firestore
    const docRef = await db.collection('ap_invoices').add({
      fromEmail,
      subject,
      pdfUrl,
      storagePath,
      receivedAt: new Date().toISOString(),
      status: 'pending',
      department: null,
      confirmedAmount: null,
      ...parsed,
    });

    console.log('AP invoice saved:', docRef.id);
    return res.status(200).json({ received: true, invoiceId: docRef.id });

  } catch (err) {
    console.error('AP webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
