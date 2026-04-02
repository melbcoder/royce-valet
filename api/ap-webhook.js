import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import Busboy from 'busboy';

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
  const parsedAmount = parseMoney(amountLabelValue);
  const lineItems = extractLineItems(normalized);

  return { invoiceNumber, invoiceDate, supplier, parsedAmount, lineItems };
}

function isTravelAgentInvoice(text = '') {
  return /Tax Invoice Number\s+[A-Z0-9./\-]+\s+for Creditor/i.test(text)
    || /Account name:.*Travel/i.test(text)
    || /\b(HTL|FLT|CAR|TRN|CRU)\s+R\.[A-Z0-9]+\s+B\.[A-Z0-9]+/i.test(text);
}

function extractInvoiceFields(text = '') {
  if (isTravelAgentInvoice(text)) return extractTravelAgentInvoice(text);
  return extractGenericInvoiceFields(text);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Optional: verify SendGrid shared secret
  const secret = req.headers['x-sendgrid-secret'];
  if (process.env.SENDGRID_WEBHOOK_SECRET && secret !== process.env.SENDGRID_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { db, getBucket } = getFirebaseAdminServices();
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
    const parsed = extractInvoiceFields(parseSourceText);
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
      ...parsed,
    });

    console.log('AP invoice saved:', docRef.id, '| from:', fromEmail);
    return res.status(200).json({ received: true, invoiceId: docRef.id });

  } catch (err) {
    console.error('AP webhook error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err?.message || 'Unknown error' });
  }
}
