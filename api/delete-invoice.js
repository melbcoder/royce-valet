import { getStorage } from 'firebase-admin/storage';
import { getAdminAuth, getAdminFirestore } from '../server/lib/firebaseAdmin.js';

function normalizeBucketName(raw = '') {
  const value = String(raw || '').trim();
  if (!value) return '';
  return value.replace(/^gs:\/\//i, '').replace(/\/+$/, '');
}

function getBucketName() {
  const configured = normalizeBucketName(process.env.FIREBASE_STORAGE_BUCKET);
  if (configured) return configured;
  return `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`;
}

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  const idToken = authHeader.slice(7);
  const invoiceId = typeof req.body?.id === 'string' ? req.body.id.trim() : '';

  if (!invoiceId || !/^[a-zA-Z0-9_-]+$/.test(invoiceId)) {
    return res.status(400).json({ error: 'Missing or invalid invoice id' });
  }

  try {
    const adminAuth = getAdminAuth();
    const adminDb = getAdminFirestore();

    const decoded = await adminAuth.verifyIdToken(idToken);
    const userDoc = await adminDb.collection('users').doc(decoded.uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userDoc.data() || {};
    const pages = Array.isArray(userData.pages) ? userData.pages : [];
    const hasAccess = userData.role === 'admin' || pages.includes('accounts-payable');
    if (!hasAccess) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const invoiceRef = adminDb.collection('ap_invoices').doc(invoiceId);
    const invoiceSnap = await invoiceRef.get();
    if (!invoiceSnap.exists) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = invoiceSnap.data() || {};
    const storagePath = typeof invoice.storagePath === 'string' ? invoice.storagePath.trim() : '';

    if (storagePath) {
      const bucket = getStorage().bucket(getBucketName());
      await bucket.file(storagePath).delete({ ignoreNotFound: true });
    }

    await invoiceRef.delete();

    return res.status(200).json({
      ok: true,
      deletedInvoiceId: invoiceId,
      deletedPdf: !!storagePath,
    });
  } catch (err) {
    console.error('delete-invoice error:', err);
    if (err.code === 'auth/id-token-expired' || err.code === 'auth/argument-error') {
      return res.status(401).json({ error: 'Session expired, please refresh the page' });
    }
    return res.status(500).json({ error: 'Internal server error', detail: err?.message || 'Unknown error' });
  }
}
