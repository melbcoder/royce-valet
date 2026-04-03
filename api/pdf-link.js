import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

function normalizeBucketName(raw = '') {
  const value = String(raw || '').trim();
  if (!value) return '';
  return value.replace(/^gs:\/\//i, '').replace(/\/+$/, '');
}

function getAdminServices() {
  if (!getApps().length) {
    const storageBucket = normalizeBucketName(process.env.FIREBASE_STORAGE_BUCKET);
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (serviceAccountJson) {
      let parsed;
      try { parsed = JSON.parse(serviceAccountJson); } catch { throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON'); }
      initializeApp({ credential: cert(parsed), ...(storageBucket ? { storageBucket } : {}) });
    } else {
      const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
      const projectId  = process.env.FIREBASE_PROJECT_ID;
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      if (!projectId || !clientEmail || !privateKey) throw new Error('Missing Firebase Admin credentials.');
      initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), ...(storageBucket ? { storageBucket } : {}) });
    }
  }

  const db = getFirestore();
  const bucketName = normalizeBucketName(process.env.FIREBASE_STORAGE_BUCKET)
    || `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`;
  const bucket = getStorage().bucket(bucketName);
  return { db, bucket };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;
  if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).json({ error: 'Missing or invalid invoice id' });
  }

  try {
    const { db, bucket } = getAdminServices();

    // Fetch invoice and settings in parallel
    const [invoiceSnap, settingsSnap] = await Promise.all([
      db.collection('ap_invoices').doc(id).get(),
      db.collection('settings').doc('app').get(),
    ]);

    if (!invoiceSnap.exists) return res.status(404).json({ error: 'Invoice not found' });

    const invoice  = invoiceSnap.data();
    const settings = settingsSnap.exists ? settingsSnap.data() : {};

    if (!invoice.storagePath) return res.status(404).json({ error: 'No PDF on file for this invoice' });

    // Retention check
    const retentionDays = Number.isInteger(settings.pdfRetentionDays) ? settings.pdfRetentionDays : 90;
    const receivedAt    = invoice.receivedAt ? new Date(invoice.receivedAt) : null;
    if (receivedAt) {
      const expiresAt = new Date(receivedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
      if (Date.now() > expiresAt.getTime()) {
        return res.status(410).json({
          error: 'PDF no longer available',
          detail: `PDFs are retained for ${retentionDays} days. This one expired on ${expiresAt.toLocaleDateString()}.`,
        });
      }
    }

    // Generate a short-lived signed URL (15 minutes)
    const file = bucket.file(invoice.storagePath);
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000,
    });

    return res.redirect(302, signedUrl);

  } catch (err) {
    console.error('pdf-link error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err?.message || 'Unknown error' });
  }
}
