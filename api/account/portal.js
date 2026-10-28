// Stripe Customer Portal session, authenticated by pairing code.
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../_lib/supabase');
const { enforceRateLimit } = require('../_lib/rate-limit');

const SITE = 'https://leassh.com';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rateLimitError = enforceRateLimit(req, res, 'account');
  if (rateLimitError) return rateLimitError;

  try {
    const pairingCode = String((req.body || {}).pairing_code || '').trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(pairingCode)) {
      return res.status(400).json({ error: 'Valid pairing code required' });
    }

    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('email')
      .eq('pairing_code', pairingCode)
      .maybeSingle();

    if (accountError) {
      console.error('Portal account lookup failed:', accountError.message);
      return res.status(500).json({ error: 'Account lookup failed' });
    }
    if (!account) {
      return res.status(404).json({ error: 'Pairing code not found' });
    }

    const { data: license, error: licenseError } = await supabase
      .from('licenses')
      .select('*')
      .eq('email', account.email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (licenseError) {
      console.error('Portal license lookup failed:', licenseError.message);
      return res.status(500).json({ error: 'License lookup failed' });
    }
    if (!license?.stripe_customer_id) {
      return res.status(404).json({
        error: 'No paid subscription found for this account. Free plans do not have a billing portal.',
      });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: license.stripe_customer_id,
      return_url: `${SITE}/account`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Portal error:', err.message);
    res.status(500).json({ error: 'Failed to open billing portal' });
  }
};
