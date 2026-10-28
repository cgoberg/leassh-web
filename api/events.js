const supabase = require('../_lib/supabase');
const { enforceRateLimit } = require('../_lib/rate-limit');

const ALLOWED = new Set([
  'pricing_view',
  'plan_cta_click',
  'checkout_start',
  'trial_start',
  'checkout_complete',
  'platforms_view',
  'companion_click',
  'account_view',
]);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rateLimitError = enforceRateLimit(req, res, 'events');
  if (rateLimitError) return rateLimitError;

  try {
    let body = req.body;
    if (Buffer.isBuffer(body)) {
      try { body = JSON.parse(body.toString('utf8')); } catch { body = {}; }
    }
    const event = String(body?.event || '');
    if (!ALLOWED.has(event)) {
      return res.status(400).json({ error: 'Unknown event' });
    }
    const props = body?.props && typeof body.props === 'object' ? body.props : {};
    // No PII in funnel events: drop obvious fields.
    for (const key of ['email', 'license_key', 'pairing_code', 'api_key']) delete props[key];

    const { error } = await supabase.from('funnel_events').insert({
      event,
      path: String(body?.path || '').slice(0, 200),
      props,
      created_at: new Date().toISOString(),
    });
    if (error && error.code !== '42P01') {
      console.error('funnel_events insert failed:', error.message);
    }
    // Beacons do not read the body; 204 is the cheapest ack.
    res.status(204).end();
  } catch (err) {
    console.error('funnel event error:', err.message);
    res.status(204).end();
  }
};
