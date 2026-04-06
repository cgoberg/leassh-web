const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { enforceRateLimit } = require('../_lib/rate-limit');

module.exports = async (req, res) => {
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
    const { tier, billing } = req.body;

    const prices = {
      essential_monthly: {
        mode: 'subscription',
        price_data: {
          currency: 'usd',
          product_data: { name: 'Leassh Essential' },
          unit_amount: 799,
          recurring: { interval: 'month' },
        },
      },
      essential_annual: {
        mode: 'subscription',
        price_data: {
          currency: 'usd',
          product_data: { name: 'Leassh Essential (Annual)' },
          unit_amount: 5988,
          recurring: { interval: 'year' },
        },
      },
      family_monthly: {
        mode: 'subscription',
        price_data: {
          currency: 'usd',
          product_data: { name: 'Leassh Family' },
          unit_amount: 1499,
          recurring: { interval: 'month' },
        },
      },
      family_annual: {
        mode: 'subscription',
        price_data: {
          currency: 'usd',
          product_data: { name: 'Leassh Family (Annual)' },
          unit_amount: 11988,
          recurring: { interval: 'year' },
        },
      },
      pro_monthly: {
        mode: 'subscription',
        price_data: {
          currency: 'usd',
          product_data: { name: 'Leassh Pro' },
          unit_amount: 2999,
          recurring: { interval: 'month' },
        },
      },
      pro_annual: {
        mode: 'subscription',
        price_data: {
          currency: 'usd',
          product_data: { name: 'Leassh Pro (Annual)' },
          unit_amount: 23988,
          recurring: { interval: 'year' },
        },
      },
    };

    const key = `${tier}_${billing}`;
    const config = prices[key];
    if (!config) return res.status(400).json({ error: 'Invalid tier or billing period' });

    const sessionParams = {
      mode: config.mode,
      line_items: [{ price_data: config.price_data, quantity: 1 }],
      success_url: 'https://leassh.com/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://leassh.com/#pricing',
    };

    // Add trial for Family and Pro tiers
    if (tier === 'family' || tier === 'pro') {
      sessionParams.subscription_data = { trial_period_days: 14 };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout create error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
