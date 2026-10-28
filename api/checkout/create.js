const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { enforceRateLimit } = require('../_lib/rate-limit');
const { checkoutConfig, billingFor } = require('../_lib/plans');
const { alert } = require('../_lib/alerts');

const SITE = 'https://leassh.com';

function buildCheckoutParams(body = {}) {
  const raw = body.plan_id || body.tier || body.plan;
  const billing = billingFor(raw, body.billing || body.billing_period);
  const config = checkoutConfig(raw, billing);

  if (!config) {
    const error = new Error(
      'Invalid plan. Choose Family or Pro (annual or monthly). Free starts at /setup; Unlimited is contact-only.',
    );
    error.status = 400;
    throw error;
  }

  const pairingCode = body.pairing_code || body.pairingCode || null;
  const metadata = {
    ...config.metadata,
    ...(pairingCode ? { pairing_code: pairingCode } : {}),
  };

  const params = {
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
    custom_text: {
      submit: {
        message:
          config.trial_days > 0
            ? `${config.trial_days}-day free trial, then ${formatPrice(config.amount, config.interval)}. Cancel before the trial ends to pay nothing. 30-day refund policy.`
            : `${formatPrice(config.amount, config.interval)}. 30-day refund policy.`,
      },
    },
  };

  if (config.trial_days > 0) {
    params.subscription_data.trial_period_days = config.trial_days;
  }

  return { params, config, pairingCode };
}

function formatPrice(cents, interval) {
  const amount = (cents / 100).toFixed(2).replace(/\.00$/, '');
  return `$${amount}/${interval === 'year' ? 'year' : 'month'}`;
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Enforce rate limiting
  const rateLimitError = enforceRateLimit(req, res, 'checkout');
  if (rateLimitError) {
    return rateLimitError;
  }

  try {
    const { params, config, pairingCode } = buildCheckoutParams(req.body || {});
    const session = await stripe.checkout.sessions.create(params);

    console.log('CHECKOUT_START', JSON.stringify({
      plan_id: config.plan_id,
      billing: config.billing,
      amount: config.amount,
      trial_days: config.trial_days,
      pairing_code: pairingCode || null,
      session_id: session.id,
    }));

    res.json({ url: session.url, session_id: session.id, plan_id: config.plan_id });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    console.error('Checkout create error:', err.message);
    await alert('checkout_5xx', { error: err.message });
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
}

module.exports = handler;
module.exports.buildCheckoutParams = buildCheckoutParams;
module.exports.formatPrice = formatPrice;
