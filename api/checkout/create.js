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
    // Accept tier parameter that is already the full price ID (e.g., "family_annual")
    // OR accept separate tier and billing fields from the pricing page
    let priceId = (req.body.tier || '').toLowerCase();
    const billing = req.body.billing;

    // If tier looks like a simple tier name (no underscore) and billing is provided, combine them
    // This handles both:
    // - Frontend sending "family_annual" directly (no change needed)
    // - Frontend sending "family" with billing="annual" separately
    if (priceId.includes('_')) {
      // Already a combined price ID like "family_annual" - keep as-is
      console.log('Price ID already combined:', priceId);
    } else if (billing) {
      // Simple tier name + billing period = combine them
      priceId = `${priceId}_${billing}`;
      console.log('Combined tier:', priceId);
    } else {
      console.log('Simple tier name, no billing param:', priceId);
    }

    // Debug log - output full request body for debugging
    console.log('Full request body:', JSON.stringify(req.body));
    console.log('Final priceId:', priceId);

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

    // Validate required parameters
    if (!priceId) return res.status(400).json({ error: 'Missing required parameter: tier' });

    const config = prices[priceId];
    if (!config) return res.status(400).json({
      error: `Invalid tier "${priceId}". Valid options: essential_monthly, essential_annual, family_monthly, family_annual, pro_monthly, pro_annual.`
    });

    const sessionParams = {
      mode: config.mode,
      line_items: [{ price_data: config.price_data, quantity: 1 }],
      success_url: 'https://leassh.com/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://leassh.com/#pricing',
    };

    // Add trial for Family and Pro tiers
    if (priceId === 'family_annual' || priceId === 'family_monthly' || priceId === 'pro_annual' || priceId === 'pro_monthly') {
      sessionParams.subscription_data = { trial_period_days: 14 };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout create error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
