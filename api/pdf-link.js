import { getStorage } from 'firebase-admin/storage';
import { getAdminAuth, getAdminFirestore } from './lib/firebaseAdmin.js';

function normalizeBucketName(raw = '') {
  const value = String(raw || '').trim();
  if (!value) return '';
  return value.replace(/^gs:\/\//i, '').replace(/\/+$/, '');
}

function getBucket() {
  const bucketName = normalizeBucketName(process.env.FIREBASE_STORAGE_BUCKET)
    || `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`;
  return getStorage().bucket(bucketName);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  const idToken = authHeader.slice(7);

  const { id } = req.query;
  if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).json({ error: 'Missing or invalid invoice id' });
  }

  try {
    const adminAuth = getAdminAuth();
    const db = getAdminFirestore();
    const bucket = getBucket();

    const decoded = await adminAuth.verifyIdToken(idToken);
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    if (!userDoc.exists) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const userData = userDoc.data() || {};
    const pages = Array.isArray(userData.pages) ? userData.pages : [];
    const hasAccess = userData.role === 'admin' || pages.includes('accounts-payable');
    if (!hasAccess) {
      return res.status(403).json({ error: 'Forbidden' });
    }

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
    const expiresAt = Date.now() + 15 * 60 * 1000;
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: expiresAt,
    });

    return res.status(200).json({ signedUrl, expiresAt });

  } catch (err) {
    console.error('pdf-link error:', err);
    if (err.code === 'auth/id-token-expired' || err.code === 'auth/argument-error') {
      return res.status(401).json({ error: 'Session expired, please refresh the page' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}
