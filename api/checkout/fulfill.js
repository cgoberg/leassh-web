const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const crypto = require('crypto');
const supabase = require('../_lib/supabase');

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

const tierMap = {
  'Leassh Essential':          { tier: 'essential', features: ['monitoring', 'daily_summaries', 'category_limits'] },
  'Leassh Essential (Annual)': { tier: 'essential', features: ['monitoring', 'daily_summaries', 'category_limits'] },
  'Leassh Family':             { tier: 'family',    features: ['monitoring', 'vision', 'enforcement', 'notifications', 'screen_time', 'daily_summaries', 'weekly_reports', 'content_safety'] },
  'Leassh Family (Annual)':    { tier: 'family',    features: ['monitoring', 'vision', 'enforcement', 'notifications', 'screen_time', 'daily_summaries', 'weekly_reports', 'content_safety'] },
  'Leassh Pro':                { tier: 'pro',       features: ['monitoring', 'vision', 'enforcement', 'notifications', 'screen_time', 'daily_summaries', 'weekly_reports', 'content_safety', 'rules', 'actuation', 'fleet', 'webhooks', 'mqtt', 'ssh', 'api', 'self_hosting', 'openclaw'] },
  'Leassh Pro (Annual)':       { tier: 'pro',       features: ['monitoring', 'vision', 'enforcement', 'notifications', 'screen_time', 'daily_summaries', 'weekly_reports', 'content_safety', 'rules', 'actuation', 'fleet', 'webhooks', 'mqtt', 'ssh', 'api', 'self_hosting', 'openclaw'] },
};

const maxNodesMap = {
  essential: 3,
  family: 10,
  pro: 0, // unlimited
};

function identifyTier(productName) {
  if (tierMap[productName]) return tierMap[productName];

  // Fallback: match by substring
  const lower = (productName || '').toLowerCase();
  if (lower.includes('pro'))       return tierMap['Leassh Pro'];
  if (lower.includes('family'))    return tierMap['Leassh Family'];
  if (lower.includes('essential')) return tierMap['Leassh Essential'];

  // Legacy fallback
  return { tier: 'unknown', features: [] };
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

    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['line_items.data.price.product'],
    });

    if (session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    // Extract product name from the line items
    const lineItem = session.line_items?.data?.[0];
    const productName = lineItem?.price?.product?.name
      || lineItem?.description
      || '';

    const { tier, features } = identifyTier(productName);
    const license_key = generateLicenseKey();
    const email = session.customer_email || session.customer_details?.email || null;
    const isAnnual = lineItem?.price?.recurring?.interval === 'year';
    const max_nodes = maxNodesMap[tier] ?? 5;

    // Calculate expiry: 1 year for annual, 35 days for monthly (grace period)
    const now = new Date();
    const expires_at = new Date(now.getTime() + (isAnnual ? 365 : 35) * 24 * 60 * 60 * 1000).toISOString();

    // Store license in Supabase
    const { error } = await supabase
      .from('licenses')
      .insert({
        license_key,
        stripe_session_id: session_id,
        tier,
        features,
        email,
        max_nodes,
        billing: isAnnual ? 'annual' : 'monthly',
        expires_at,
        created_at: now.toISOString(),
      });

    if (error) {
      console.error('Supabase license insert error:', error.message);
      // Don't fail the response — the key was generated, log it for manual recovery
    }

    console.log('LICENSE_CREATED: ' + license_key + ' | ' + tier + ' | ' + (isAnnual ? 'annual' : 'monthly') + ' | ' + email + ' | session: ' + session_id);

    res.json({
      license_key,
      tier,
      features,
      billing: isAnnual ? 'annual' : 'monthly',
      email,
    });
  } catch (err) {
    console.error('Fulfill error:', err.message);
    res.status(500).json({ error: 'Failed to fulfill license' });
  }
};
