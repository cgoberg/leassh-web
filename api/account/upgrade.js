const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../_lib/supabase');
const { checkoutConfig, billingFor } = require('../_lib/plans');

const SITE = 'https://leassh.com';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { pairing_code, plan_id, tier, billing } = req.body || {};

    if (!pairing_code) {
      return res.status(400).json({ error: 'Pairing code required' });
    }

    const config = checkoutConfig(plan_id || tier, billingFor(plan_id || tier, billing));
    if (!config) {
      return res.status(400).json({ error: 'Invalid plan or billing period' });
    }

    // Pairing codes are account-level; attach the account email so the
    // success page and Stripe receipt agree.
    let email = null;
    try {
      const { data } = await supabase
        .from('accounts')
        .select('email')
        .eq('pairing_code', pairing_code)
        .maybeSingle();
      email = data?.email || null;
    } catch (err) {
      console.error('Upgrade account lookup failed:', err.message);
    }

    const metadata = {
      ...config.metadata,
      pairing_code,
    };

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
  } catch (err) {
    console.error('Upgrade error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
