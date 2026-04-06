const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const crypto = require('crypto');
const supabase = require('../_lib/supabase');
const { sendEmail } = require('../_lib/email');

function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segments = [];
  for (let s = 0; s < 4; s++) {
    let seg = '';
    const bytes = crypto.randomBytes(5);
    for (let i = 0; i < 5; i++) {
      seg += chars[bytes[i] % chars.length];
    }
    segments.push(seg);
  }
  return 'LSH-' + segments.join('-');
}

const tierMap = {
  'Leassh Essential':          { tier: 'essential', features: ['monitoring', 'daily_summaries', 'category_limits'] },
  'Leassh Essential (Annual)': { tier: 'essential', features: ['monitoring', 'daily_summaries', 'category_limits'] },
  'Leassh Family':             { tier: 'family',    features: ['monitoring', 'vision', 'enforcement', 'notifications', 'screen_time', 'daily_summaries', 'weekly_reports', 'content_safety'] },
  'Leassh Family (Annual)':    { tier: 'family',    features: ['monitoring', 'vision', 'enforcement', 'notifications', 'screen_time', 'daily_summaries', 'weekly_reports', 'content_safety'] },
  'Leassh Pro':                { tier: 'pro',       features: ['monitoring', 'vision', 'enforcement', 'notifications', 'screen_time', 'daily_summaries', 'weekly_reports', 'content_safety', 'rules', 'actuation', 'fleet', 'webhooks', 'mqtt', 'ssh', 'api', 'self_hosting', 'openclaw'] },
  'Leassh Pro (Annual)':       { tier: 'pro',       features: ['monitoring', 'vision', 'enforcement', 'notifications', 'screen_time', 'daily_summaries', 'weekly_reports', 'content_safety', 'rules', 'actuation', 'fleet', 'webhooks', 'mqtt', 'ssh', 'api', 'self_hosting', 'openclaw'] },
};

const maxNodesMap = {
  essential: 3,
  family: 10,
  pro: 0, // unlimited
};

function identifyTier(productName) {
  if (tierMap[productName]) return tierMap[productName];

  const lower = (productName || '').toLowerCase();
  if (lower.includes('pro'))       return tierMap['Leassh Pro'];
  if (lower.includes('family'))    return tierMap['Leassh Family'];
  if (lower.includes('essential')) return tierMap['Leassh Essential'];

  return { tier: 'unknown', features: [] };
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function createLicense(session) {
  const lineItem = session.line_items?.data?.[0];
  const productName = lineItem?.price?.product?.name
    || lineItem?.description
    || '';

  const { tier, features } = identifyTier(productName);
  const license_key = generateLicenseKey();
  const email = session.customer_email || session.customer_details?.email || null;
  const isAnnual = lineItem?.price?.recurring?.interval === 'year';
  const max_nodes = maxNodesMap[tier] ?? 5;

  const now = new Date();
  const expires_at = new Date(now.getTime() + (isAnnual ? 365 : 35) * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('licenses')
    .upsert(
      {
        license_key,
        stripe_session_id: session.id,
        tier,
        features,
        email,
        max_nodes,
        billing: isAnnual ? 'annual' : 'monthly',
        expires_at,
        created_at: now.toISOString(),
      },
      { onConflict: 'stripe_session_id', ignoreDuplicates: true }
    );

  if (error) {
    console.error('Supabase license upsert error:', error.message);
    throw new Error('Failed to persist license: ' + error.message);
  }

  console.log('LICENSE_CREATED: ' + license_key + ' | ' + tier + ' | ' + (isAnnual ? 'annual' : 'monthly') + ' | ' + email + ' | session: ' + session.id);

  if (email) {
    const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
    const billingLabel = isAnnual ? 'annual' : 'monthly';
    sendEmail({
      to: email,
      subject: 'Your Leassh license key',
      text: [
        'Thank you for subscribing to Leassh ' + tierLabel + '!',
        '',
        'Your license key is:',
        license_key,
        '',
        'To activate, add this to your fleet.yaml:',
        '',
        '  license_key: ' + license_key,
        '',
        'Documentation: https://leassh.com/docs',
        'Manage your subscription: https://leassh.com/account',
        '',
        'Plan: Leassh ' + tierLabel + ' (' + billingLabel + ')',
        '',
        '— The Leassh team',
        'https://leassh.com',
      ].join('\n'),
      html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 16px;color:#1a1a1a">
  <h1 style="font-size:24px;margin-bottom:8px">Your Leassh license key</h1>
  <p>Thank you for subscribing to <strong>Leassh ${tierLabel}</strong> (${billingLabel})!</p>
  <p>Your license key is:</p>
  <p style="font-size:18px;font-weight:700;letter-spacing:2px;font-family:monospace;background:#f5f5f5;padding:16px 24px;border-radius:8px;display:inline-block">${license_key}</p>
  <p>Add it to your <code>fleet.yaml</code> to activate:</p>
  <pre style="background:#f5f5f5;padding:12px 16px;border-radius:6px;font-size:14px">license_key: ${license_key}</pre>
  <p>
    <a href="https://leassh.com/docs" style="color:#d4a24c">Documentation</a> &nbsp;·&nbsp;
    <a href="https://leassh.com/account" style="color:#d4a24c">Manage subscription</a>
  </p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#999;font-size:12px">Leassh — <a href="https://leassh.com" style="color:#999">leassh.com</a></p>
</body>
</html>`,
    }).catch(() => {});
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    console.error('Webhook: missing stripe-signature or STRIPE_WEBHOOK_SECRET');
    return res.status(400).json({ error: 'Missing signature or webhook secret' });
  }

  let event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  if (event.type === 'checkout.session.completed') {
    try {
      const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {
        expand: ['line_items.data.price.product'],
      });

      if (session.payment_status !== 'paid' && !session.subscription) {
        // Subscriptions with trials may not be "paid" immediately — allow them through
        console.log('Webhook: session not paid, skipping:', session.id);
        return res.json({ received: true });
      }

      await createLicense(session);
    } catch (err) {
      console.error('Webhook license creation failed:', err.message);
      return res.status(500).json({ error: 'License creation failed' });
    }
  }

  res.json({ received: true });
};
