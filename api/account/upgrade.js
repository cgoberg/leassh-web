const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { accounts } = require('../_lib/store');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { pairing_code, tier, billing } = req.body || {};

    if (!pairing_code) {
      return res.status(400).json({ error: 'Pairing code required' });
    }

    const prices = {
      essential_monthly: { name: 'Leassh Essential', amount: 799, interval: 'month' },
      essential_annual: { name: 'Leassh Essential (Annual)', amount: 5988, interval: 'year' },
      family_monthly: { name: 'Leassh Family', amount: 1499, interval: 'month' },
      family_annual: { name: 'Leassh Family (Annual)', amount: 11988, interval: 'year' },
      pro_monthly: { name: 'Leassh Pro', amount: 2999, interval: 'month' },
      pro_annual: { name: 'Leassh Pro (Annual)', amount: 23988, interval: 'year' },
    };

    const key = tier + '_' + billing;
    const config = prices[key];
    if (!config) {
      return res.status(400).json({ error: 'Invalid tier or billing period' });
    }

    const successUrl = 'https://leassh.com/success?session_id={CHECKOUT_SESSION_ID}&code=' + pairing_code;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: config.name },
          unit_amount: config.amount,
          recurring: { interval: config.interval },
        },
        quantity: 1,
      }],
      metadata: { pairing_code },
      success_url: successUrl,
      cancel_url: 'https://leassh.com/setup',
      subscription_data: { metadata: { pairing_code } },
    });

    console.log('UPGRADE_CHECKOUT', JSON.stringify({ pairing_code, tier, billing }));

    res.json({ checkout_url: session.url });
  } catch (err) {
    console.error('Upgrade error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
