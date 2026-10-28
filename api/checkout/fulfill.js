const supabase = require('../_lib/supabase');
const { getPlan } = require('../_lib/plans');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { session_id } = req.query;
  if (!session_id) {
    return res.status(400).json({ error: 'Missing session_id' });
  }

  const { data, error } = await supabase
    .from('licenses')
    .select('*')
    .eq('stripe_session_id', session_id)
    .maybeSingle();

  if (error || !data) {
    // Webhook may not have processed yet — return 202 so the client can retry
    return res.status(202).json({ pending: true });
  }

  const planId = data.plan_id || data.tier;
  const plan = getPlan(planId);

  res.json({
    license_key: data.license_key,
    plan_id: planId,
    plan_name: plan?.name || planId,
    tier: planId,
    legacy_tier: data.tier !== planId ? data.tier : null,
    max_nodes: data.max_nodes,
    devices: plan?.devices ?? null,
    trial_days: plan?.trial_days ?? 0,
    features: data.features,
    billing: data.billing,
    email: data.email,
    status: data.status || 'active',
    expires_at: data.expires_at || null,
  });
};
