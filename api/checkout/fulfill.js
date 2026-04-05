const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const crypto = require('crypto');

function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segments = [];
  for (let s = 0; s < 4; s++) {
    let seg = '';
    const bytes = crypto.randomBytes(5);
    for (let i = 0; i < 5; i++) {
      seg += chars[bytes[i] % chars.length];
    }
    segments.push(seg);
  }
  return 'LSH-' + segments.join('-');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { session_id } = req.query;

    if (!session_id) {
      return res.status(400).json({ error: 'Missing session_id' });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    const key = generateLicenseKey();
    const tier = session.mode === 'subscription' ? 'cloud' : 'local';
    const email = session.customer_email || session.customer_details?.email || null;

    // Log the license creation for now — proper storage can be added later
    console.log(`LICENSE_CREATED: ${key} | ${tier} | ${email} | session: ${session_id}`);

    res.json({
      license_key: key,
      tier: tier,
      email: email,
    });
  } catch (err) {
    console.error('Fulfill error:', err.message);
    res.status(500).json({ error: 'Failed to fulfill license' });
  }
};
