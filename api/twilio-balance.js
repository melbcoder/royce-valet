import { getAdminAuth, getAdminFirestore } from '../server/lib/firebaseAdmin.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization || ''
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' })
  }

  const idToken = authHeader.slice(7)

  let decoded
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken)
  } catch {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const userDoc = await getAdminFirestore().collection('users').doc(decoded.uid).get()
  if (!userDoc.exists) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const userData = userDoc.data() || {}
  if (userData.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN

  if (!accountSid || !authToken) {
    return res.status(500).json({ error: 'Twilio credentials not configured' })
  }

  try {
    const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Balance.json`,
      {
        method: 'GET',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          Accept: 'application/json',
        },
      }
    )

    const payload = await twilioRes.json().catch(() => ({}))
    if (!twilioRes.ok) {
      return res.status(502).json({
        error: payload?.message || 'Failed to fetch Twilio balance',
      })
    }

    return res.status(200).json({
      balance: payload?.balance ?? null,
      currency: payload?.currency ?? 'USD',
      fetchedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Twilio balance fetch failed:', error)
    return res.status(500).json({ error: 'Failed to fetch Twilio balance' })
  }
}