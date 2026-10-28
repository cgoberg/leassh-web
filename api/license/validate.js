// Vercel serverless function: POST /api/license/validate
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../_lib/supabase');
const { TIERS, setCorsHeaders } = require('../_lib/license');
const { enforceRateLimit } = require('../_lib/rate-limit');
const { getPlan, isLegacyId, legacyAccepted } = require('../_lib/plans');

async function refreshPaidExpiry(license) {
  if (!license || license.tier === 'free' || !license.email || !process.env.STRIPE_SECRET_KEY) {
    return license;
  }
  try {
    const customers = await stripe.customers.list({ email: license.email, limit: 1 });
    const customer = customers.data?.[0];
    if (!customer) return license;
    const subs = await stripe.subscriptions.list({ customer: customer.id, status: 'all', limit: 10 });
    const subscription = (subs.data || []).find((s) => ['active', 'trialing', 'past_due'].includes(s.status))
      || (subs.data || [])[0];
    if (!subscription?.current_period_end) return license;
    const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();
    if (!license.expires_at || new Date(periodEnd) > new Date(license.expires_at)) {
      const { error } = await supabase
        .from('licenses')
        .update({ expires_at: periodEnd })
        .eq('license_key', license.license_key);
      if (!error) return { ...license, expires_at: periodEnd };
    }
  } catch (err) {
    // Stripe is a renewal source of truth, not a validation dependency.
    console.error('license expiry refresh failed:', err.message);
  }
  return license;
}

function evaluateLicense(license, nodeCount, now = new Date()) {
  if (!license) return { valid: false, error: 'License not found' };
  if (license.status === 'revoked') {
    return { valid: false, error: 'License revoked', status: 'revoked' };
  }
  if (license.expires_at && new Date(license.expires_at) < now) {
    return { valid: false, error: 'License expired', status: 'expired' };
  }
  if (license.status === 'grace') {
    const graceUntil = license.grace_until ? new Date(license.grace_until) : null;
    if (!graceUntil || graceUntil < now) {
      return { valid: false, error: 'Payment grace period ended', status: 'grace_expired' };
    }
  }

  const legacy = isLegacyId(license.tier);
  if (legacy && !legacyAccepted(license.tier, now)) {
    return { valid: false, error: 'Legacy tier is no longer accepted', status: 'legacy_expired' };
  }
  const planId = legacy ? 'family' : (license.plan_id || license.tier);
  const plan = getPlan(planId);
  const maxNodes = license.max_nodes ?? (legacy ? 10 : plan?.devices ?? 0);

  if (maxNodes > 0 && nodeCount && nodeCount > maxNodes) {
    return {
      valid: false,
      error: 'Node count ' + nodeCount + ' exceeds max ' + maxNodes + ' for tier ' + planId,
      tier: planId,
      plan_id: planId,
      max_nodes: maxNodes,
      status: 'node_limit',
    };
  }

  return {
    valid: true,
    tier: planId,
    plan_id: planId,
    plan_name: plan?.name || planId,
    legacy_tier: legacy ? license.tier : null,
    max_nodes: maxNodes,
    features: license.features || plan?.license_features || [],
    expires_at: license.expires_at || null,
    status: license.status || 'active',
    cancel_at_period_end: Boolean(license.cancel_at_period_end),
    current_period_end: license.current_period_end || license.expires_at || null,
  };
}

module.exports = async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rateLimitError = enforceRateLimit(req, res, 'license');
  if (rateLimitError) {
    return rateLimitError;
  }

  try {
    const { license_key, node_count } = req.body || {};

    if (!license_key) {
      return res.status(200).json({ valid: false, error: 'Missing license_key' });
    }

    // Dev keys: always valid, unlimited. Never available in production
    // unless someone deliberately sets a dev- key.
    if (license_key.startsWith('dev-')) {
      return res.status(200).json({
        valid: true,
        tier: 'dev',
        plan_id: 'dev',
        plan_name: 'Development',
        max_nodes: 0,
        features: TIERS.unlimited.features,
        expires_at: null,
        status: 'active',
      });
    }

    // LSH-XXXXX-XXXXX-XXXXX-XXXXX (online) — offline LSH1 tokens are
    // validated inside the server, not here.
    const keyPattern = /^LSH-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/;
    if (!keyPattern.test(license_key)) {
      return res.status(200).json({ valid: false, error: 'Invalid key format' });
    }

    const { data: license, error } = await supabase
      .from('licenses')
      .select('*')
      .eq('license_key', license_key)
      .maybeSingle();

    if (error) {
      console.error('Supabase license lookup error:', error.message);
      return res.status(500).json({ valid: false, error: 'Validation failed' });
    }

    if (!license) {
      return res.status(200).json({ valid: false, error: 'License not found' });
    }

    // Revoked wins over everything; canceled stays valid until expiry.
    // Refresh paid expiry from Stripe so renewals work even if the webhook
    // is missing or delayed (the 72h server cache keeps this rare).
    const refreshed = await refreshPaidExpiry(license);
    return res.status(200).json(evaluateLicense(refreshed, node_count));
  } catch (err) {
    console.error('Validation error:', err.message);
    return res.status(500).json({ valid: false, error: err.message });
  }
};
module.exports.evaluateLicense = evaluateLicense;
