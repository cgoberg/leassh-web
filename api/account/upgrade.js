// Account surface: checkout upgrade, status, and Stripe Customer Portal.
// One function keeps the Vercel Hobby deployment at 12 functions.
//
// POST { action?: "upgrade" | "status" | "portal", pairing_code, plan_id?, billing? }
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../_lib/supabase');
const { checkoutConfig, billingFor, getPlan, isLegacyId } = require('../_lib/plans');
const { enforceRateLimit } = require('../_lib/rate-limit');

const SITE = 'https://leassh.com';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function validPairingCode(value) {
  return /^[A-Z2-9]{6}$/.test(String(value || '').trim().toUpperCase());
}

async function accountFor(pairingCode) {
  const { data, error } = await supabase
    .from('accounts')
    .select('email, pairing_code')
    .eq('pairing_code', pairingCode)
    .maybeSingle();
  if (error) throw new Error('Account lookup failed');
  return data || null;
}

async function latestLicense(email) {
  const { data, error } = await supabase
    .from('licenses')
    .select('*')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) throw new Error('License lookup failed');
  const rows = data || [];
  return rows.find((row) => row.tier && row.tier !== 'free' && row.stripe_session_id)
    || rows.find((row) => row.tier && row.tier !== 'free')
    || rows[0]
    || null;
}

async function stripeCustomerForEmail(email, license) {
  if (license?.stripe_customer_id) {
    try {
      const customer = await stripe.customers.retrieve(license.stripe_customer_id);
      if (!customer?.deleted) return customer;
    } catch (err) {
      console.error('Stripe customer retrieve failed:', err.message);
    }
  }
  if (!email) return null;
  try {
    const listed = await stripe.customers.list({ email, limit: 1 });
    return listed.data?.[0] || null;
  } catch (err) {
    console.error('Stripe customer list failed:', err.message);
    return null;
  }
}

async function subscriptionForCustomer(customer) {
  if (!customer) return null;
  try {
    const listed = await stripe.subscriptions.list({ customer: customer.id, status: 'all', limit: 10 });
    return (listed.data || []).find((s) => ['active', 'trialing', 'past_due'].includes(s.status))
      || (listed.data || [])[0]
      || null;
  } catch (err) {
    console.error('Stripe subscription list failed:', err.message);
    return null;
  }
}

async function status(res, pairingCode) {
  const account = await accountFor(pairingCode);
  if (!account) return res.status(404).json({ error: 'Pairing code not found' });
  const license = await latestLicense(account.email);
  if (!license) return res.status(404).json({ error: 'No license found for this account' });

  const planId = isLegacyId(license.tier) ? 'family' : (license.plan_id || license.tier);
  const plan = getPlan(planId);
  const customer = await stripeCustomerForEmail(account.email, license);
  const subscription = await subscriptionForCustomer(customer);
  const currentPeriodEnd = subscription?.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : (license.current_period_end || license.expires_at || null);
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
    status: license.status || subscription?.status || 'active',
    expires_at: license.expires_at || null,
    current_period_end: currentPeriodEnd,
    cancel_at_period_end: subscription ? Boolean(subscription.cancel_at_period_end) : Boolean(license.cancel_at_period_end),
    has_billing_portal: Boolean(customer),
  });
}

async function portal(res, pairingCode) {
  const account = await accountFor(pairingCode);
  if (!account) return res.status(404).json({ error: 'Pairing code not found' });
  const license = await latestLicense(account.email);
  const customer = await stripeCustomerForEmail(account.email, license);
  if (!customer) {
    return res.status(404).json({
      error: 'No paid subscription found for this account. Free plans do not have a billing portal.',
    });
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: customer.id,
    return_url: `${SITE}/account`,
  });
  res.json({ url: session.url });
}

async function upgrade(res, body) {
  const { pairing_code, plan_id, tier, billing } = body;
  const config = checkoutConfig(plan_id || tier, billingFor(plan_id || tier, billing));
  if (!config) return res.status(400).json({ error: 'Invalid plan or billing period' });

  let email = null;
  try {
    const account = await accountFor(pairing_code);
    email = account?.email || null;
  } catch (err) {
    console.error('Upgrade account lookup failed:', err.message);
  }

  const metadata = { ...config.metadata, pairing_code };
  const sessionParams = {
    mode: 'subscription',
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: config.product_name },
        unit_amount: config.amount,
        recurring: { interval: config.interval },
      },
      quantity: 1,
    }],
    metadata,
    subscription_data: { metadata },
    success_url: `${SITE}/success?session_id={CHECKOUT_SESSION_ID}&plan=${config.plan_id}`,
    cancel_url: `${SITE}/pricing#pricing`,
    billing_address_collection: 'auto',
    tax_id_collection: { enabled: true },
  };
  if (email) sessionParams.customer_email = email;
  if (config.trial_days > 0) {
    sessionParams.subscription_data.trial_period_days = config.trial_days;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);
  console.log('UPGRADE_CHECKOUT', JSON.stringify({
    pairing_code,
    plan_id: config.plan_id,
    billing: config.billing,
    session_id: session.id,
  }));
  res.json({ checkout_url: session.url, plan_id: config.plan_id });
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rateLimitError = enforceRateLimit(req, res, 'account');
  if (rateLimitError) return rateLimitError;

  try {
    const body = req.body || {};
    const action = String(body.action || 'upgrade').toLowerCase();
    if (action === 'upgrade') {
      if (!body.pairing_code) return res.status(400).json({ error: 'Pairing code required' });
      return await upgrade(res, body);
    }

    const pairingCode = String(body.pairing_code || '').trim().toUpperCase();
    if (!validPairingCode(pairingCode)) {
      return res.status(400).json({ error: 'Valid pairing code required' });
    }
    if (action === 'status') return await status(res, pairingCode);
    if (action === 'portal') return await portal(res, pairingCode);
    return res.status(400).json({ error: 'Unknown action; use upgrade, status or portal' });
  } catch (err) {
    console.error('Account action error:', err.message);
    res.status(500).json({ error: 'Account action failed' });
  }
};

module.exports.validPairingCode = validPairingCode;
