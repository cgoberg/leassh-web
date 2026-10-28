// Account status for /account, authenticated by pairing code.
const supabase = require('../_lib/supabase');
const { enforceRateLimit } = require('../_lib/rate-limit');
const { getPlan, isLegacyId } = require('../_lib/plans');

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
      .select('email, pairing_code')
      .eq('pairing_code', pairingCode)
      .maybeSingle();

    if (accountError) return res.status(500).json({ error: 'Account lookup failed' });
    if (!account) return res.status(404).json({ error: 'Pairing code not found' });

    const { data: license, error: licenseError } = await supabase
      .from('licenses')
      .select('*')
      .eq('email', account.email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (licenseError) return res.status(500).json({ error: 'License lookup failed' });
    if (!license) return res.status(404).json({ error: 'No license found for this account' });

    const planId = isLegacyId(license.tier) ? 'family' : (license.plan_id || license.tier);
    const plan = getPlan(planId);

    res.json({
      email: account.email,
      pairing_code: account.pairing_code,
      license_key: license.license_key,
      plan_id: planId,
      plan_name: plan?.name || planId,
      tier: license.tier,
      legacy_tier: isLegacyId(license.tier) ? license.tier : null,
      max_nodes: license.max_nodes,
      features: license.features || [],
      status: license.status || 'active',
      expires_at: license.expires_at || null,
      current_period_end: license.current_period_end || null,
      cancel_at_period_end: Boolean(license.cancel_at_period_end),
      has_billing_portal: Boolean(license.stripe_customer_id),
    });
  } catch (err) {
    console.error('Account status error:', err.message);
    res.status(500).json({ error: 'Account status failed' });
  }
};
