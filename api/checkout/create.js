const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { tier } = req.body;

    const prices = {
      cloud: {
        mode: 'subscription',
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Leassh Cloud',
            description: 'Screen time, limits, AI analysis — up to 10 computers',
          },
          unit_amount: 1900,
          recurring: { interval: 'month' },
        },
      },
      local: {
        mode: 'payment',
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Leassh Local',
            description: 'Self-hosted, unlimited computers, full privacy',
          },
          unit_amount: 7900,
        },
      },
    };

    const config = prices[tier];
    if (!config) return res.status(400).json({ error: 'Invalid tier' });

    const session = await stripe.checkout.sessions.create({
      mode: config.mode,
      line_items: [{ price_data: config.price_data, quantity: 1 }],
      success_url: 'https://leassh.com/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://leassh.com/#pricing',
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout create error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
