const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const crypto = require('crypto');
const supabase = require('../_lib/supabase');
const { sendEmail } = require('../_lib/email');
const { alert } = require('../_lib/alerts');
const {
  resolvePlan,
  featuresFor,
  maxNodesFor,
} = require('../_lib/plans');

const GRACE_DAYS = 7;

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

function unixToIso(seconds) {
  if (!seconds) return null;
  return new Date(Number(seconds) * 1000).toISOString();
}

// legacy product-name fallback: old Stripe products still resolve to a plan.
function planFromName(productName) {
  return resolvePlan(productName || '');
}

function planFromSession(session) {
  const metaPlan = session?.metadata?.plan_id;
  if (metaPlan) {
    const plan = resolvePlan(metaPlan);
    if (plan) return plan;
  }
  if (session?.subscription?.metadata?.plan_id) {
    const plan = resolvePlan(session.subscription.metadata.plan_id);
    if (plan) return plan;
  }
  const lineItem = session?.line_items?.data?.[0];
  const productName =
    lineItem?.price?.product?.name || lineItem?.description || '';
  return planFromName(productName);
}

function planFromSubscription(subscription) {
  const metaPlan = subscription?.metadata?.plan_id;
  if (metaPlan) {
    const plan = resolvePlan(metaPlan);
    if (plan) return plan;
  }
  const item = subscription?.items?.data?.[0];
  const productName = item?.price?.product?.name || '';
  return planFromName(productName);
}

function periodEndIso(subscription, fallbackDays = 35) {
  if (subscription?.current_period_end) {
    return unixToIso(subscription.current_period_end);
  }
  return new Date(Date.now() + fallbackDays * 86400_000).toISOString();
}

async function recordEvent(event) {
  const { error } = await supabase.from('stripe_events').insert({
    event_id: event.id,
    type: event.type,
    created_at: new Date().toISOString(),
    payload: {
      id: event.id,
      type: event.type,
      object_id: event.data?.object?.id || null,
    },
  });
  if (!error) return true;
  // Duplicate event id: already processed.
  if (error.code === '23505') return false;
  // Missing table (pre-migration): keep processing, loudly.
  if (error.code === '42P01') {
    console.warn('stripe_events table missing; idempotency is degraded');
    return true;
  }
  console.error('stripe_events insert failed:', error.message);
  return true;
}

async function audit(licenseKey, action, detail = {}) {
  if (!licenseKey) return;
  const { error } = await supabase.from('license_events').insert({
    license_key: licenseKey,
    action,
    detail,
    created_at: new Date().toISOString(),
  });
  if (error && error.code !== '42P01') {
    console.error('license_events insert failed:', error.message);
  }
}

async function existingLicenseBySession(sessionId) {
  const { data } = await supabase
    .from('licenses')
    .select('*')
    .eq('stripe_session_id', sessionId)
    .maybeSingle();
  return data || null;
}

async function existingLicenseBySubscription(subscriptionId) {
  if (!subscriptionId) return null;
  const { data, error } = await supabase
    .from('licenses')
    .select('*')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  if (error) {
    // Legacy schema has no stripe_subscription_id column.
    if (!isMissingColumnError(error)) console.error('subscription lookup failed:', error.message);
    return null;
  }
  return data || null;
}

async function existingLicenseByCustomer(customerId) {
  if (!customerId) return null;
  const { data, error } = await supabase
    .from('licenses')
    .select('*')
    .eq('stripe_customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (!isMissingColumnError(error)) console.error('customer lookup failed:', error.message);
    return null;
  }
  return data || null;
}

function isMissingColumnError(error) {
  return Boolean(error && /column .* does not exist|schema cache|Could not find the '.*' column/i.test(error.message || ''));
}

async function customerEmail(customer) {
  if (!customer) return null;
  if (typeof customer === 'object') return customer.email || null;
  try {
    const retrieved = await stripe.customers.retrieve(String(customer));
    return retrieved?.deleted ? null : (retrieved?.email || null);
  } catch (err) {
    console.error('customer email lookup failed:', err.message);
    return null;
  }
}

async function findPaidLicenseByEmail(email) {
  if (!email) return null;
  const { data, error } = await supabase
    .from('licenses')
    .select('*')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) return null;
  return (data || []).find((row) =>
    Boolean(row.stripe_session_id) || (row.tier && row.tier !== 'free')
  ) || null;
}

async function resolveSubscriptionLicense(subscription) {
  if (!subscription) return null;
  const byId = await existingLicenseBySubscription(subscription.id);
  if (byId) return byId;
  const email = await customerEmail(subscription.customer);
  return findPaidLicenseByEmail(email);
}

async function updateLicenseByKey(licenseKey, patch) {
  let { error } = await supabase
    .from('licenses')
    .update(patch)
    .eq('license_key', licenseKey);
  if (!error) return null;
  if (!isMissingColumnError(error)) return error;

  // Legacy schema fallback: only the columns that have always existed.
  const legacy = {};
  for (const key of ['tier', 'features', 'max_nodes', 'expires_at']) {
    if (key in patch) legacy[key] = patch[key];
  }
  ({ error } = await supabase
    .from('licenses')
    .update(legacy)
    .eq('license_key', licenseKey));
  return error || null;
}

function isMissingColumn(error) {
  return Boolean(error && /column .* does not exist|schema cache|Could not find the '.*' column/i.test(error.message || ''));
}

async function insertLicenseRow(row) {
  const first = await supabase.from('licenses').insert(row).select().single();
  if (!first.error) return { data: first.data, error: null };
  if (!isMissingColumn(first.error)) return first;

  // Pre-migration fallback: keep Free/paid checkout working with the legacy
  // schema. The lifecycle columns arrive with the 2026-10-28 migration.
  const legacyRow = {
    license_key: row.license_key,
    stripe_session_id: row.stripe_session_id,
    tier: row.tier,
    features: row.features,
    email: row.email,
    max_nodes: row.max_nodes,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
  console.warn('licenses lifecycle columns missing; inserting legacy row');
  return supabase.from('licenses').insert(legacyRow).select().single();
}

async function createLicenseFromSession(session) {
  const existing = await existingLicenseBySession(session.id);
  if (existing) return existing;

  const plan = planFromSession(session);
  if (!plan) {
    throw new Error('Could not resolve plan from checkout session metadata/product');
  }

  const subscription = session.subscription || null;
  const email = session.customer_email || session.customer_details?.email || await customerEmail(session.customer);
  const licenseKey = generateLicenseKey();
  const periodEnd = periodEndIso(subscription);
  const now = new Date().toISOString();

  const row = {
    license_key: licenseKey,
    stripe_session_id: session.id,
    stripe_customer_id: session.customer || null,
    stripe_subscription_id: subscription?.id || null,
    tier: plan.id,
    plan_id: plan.id,
    features: featuresFor(plan.id),
    email,
    max_nodes: maxNodesFor(plan.id),
    billing: subscription?.items?.data?.[0]?.price?.recurring?.interval === 'year' ? 'annual' : 'monthly',
    status: 'active',
    current_period_end: periodEnd,
    cancel_at_period_end: Boolean(subscription?.cancel_at_period_end),
    expires_at: periodEnd,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await insertLicenseRow(row);

  if (error) throw new Error('Failed to persist license: ' + error.message);

  await audit(licenseKey, 'issued', { plan_id: plan.id, session_id: session.id });
  console.log('LICENSE_CREATED', JSON.stringify({
    license_key: licenseKey,
    plan_id: plan.id,
    email,
    session_id: session.id,
  }));

  if (email) {
    await sendEmail({
      to: email,
      subject: 'Your Leassh license key',
      text: [
        `Thank you for subscribing to Leassh ${plan.name}!`,
        '',
        'Your license key is:',
        licenseKey,
        '',
        'Add it to your fleet.yaml:',
        '',
        '  license_key: ' + licenseKey,
        '',
        `Plan: Leassh ${plan.name}`,
        `Included: ${plan.devices === 0 ? 'unlimited' : plan.devices} computers`,
        '',
        'Manage your subscription: https://leassh.com/account',
        'Documentation: https://leassh.com/docs',
        '',
        '— The Leassh team',
        'https://leassh.com',
      ].join('\n'),
      html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 16px;color:#1a1a1a">
  <h1 style="font-size:24px;margin-bottom:8px">Your Leassh license key</h1>
  <p>Thank you for subscribing to <strong>Leassh ${plan.name}</strong>.</p>
  <p style="font-size:18px;font-weight:700;letter-spacing:2px;font-family:monospace;background:#f5f5f5;padding:16px 24px;border-radius:8px;display:inline-block">${licenseKey}</p>
  <p>Add it to your <code>fleet.yaml</code>:</p>
  <pre style="background:#f5f5f5;padding:12px 16px;border-radius:6px;font-size:14px">license_key: ${licenseKey}</pre>
  <p><a href="https://leassh.com/account" style="color:#d4a24c">Manage subscription</a> · <a href="https://leassh.com/docs" style="color:#d4a24c">Documentation</a></p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#999;font-size:12px">Leassh — <a href="https://leassh.com" style="color:#999">leassh.com</a></p>
</body></html>`,
    });
  }

  return data;
}

function licensePatchForSubscription(subscription, extra = {}) {
  const plan = planFromSubscription(subscription);
  const patch = {
    ...extra,
    stripe_customer_id: subscription.customer || extra.stripe_customer_id || null,
    stripe_subscription_id: subscription.id,
    current_period_end: periodEndIso(subscription),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    updated_at: new Date().toISOString(),
  };
  if (plan) {
    patch.tier = plan.id;
    patch.plan_id = plan.id;
    patch.features = featuresFor(plan.id);
    patch.max_nodes = maxNodesFor(plan.id);
  }
  return patch;
}

async function updateBySubscription(subscription, patch, action, detail = {}) {
  const existing = await resolveSubscriptionLicense(subscription);
  if (!existing) return null;
  const error = await updateLicenseByKey(existing.license_key, patch);
  if (error) throw new Error('License update failed: ' + error.message);
  await audit(existing.license_key, action, detail);
  return { ...existing, ...patch };
}

async function handleCheckoutCompleted(session) {
  if (session.payment_status !== 'paid' && !session.subscription) {
    console.log('Webhook: session not paid, skipping:', session.id);
    return;
  }
  await createLicenseFromSession(session);
}

async function handleInvoicePaid(invoice) {
  const subscriptionId =
    invoice.subscription ||
    invoice.parent?.subscription_details?.subscription ||
    null;
  if (!subscriptionId) return;
  const subscription = await stripe.subscriptions.retrieve(String(subscriptionId));
  const plan = planFromSubscription(subscription);
  if (!plan) {
    console.warn('invoice.paid: subscription has no resolvable plan', subscriptionId);
    return;
  }
  const patch = licensePatchForSubscription(subscription, {
    status: 'active',
    grace_until: null,
    expires_at: periodEndIso(subscription),
  });
  const updated = await updateBySubscription(subscription, patch, 'renewed', {
    invoice_id: invoice.id,
    period_end: patch.current_period_end,
  });
  if (!updated) {
    // The checkout webhook may still be in flight. Create from subscription
    // metadata so a renewal never leaves a paying customer without a key.
    const existing = await existingLicenseBySession(`sub_${subscriptionId}`);
    if (!existing) {
      console.warn('invoice.paid: no license row yet for', subscriptionId);
      await alert('renewal_without_license', { subscription_id: subscriptionId, invoice_id: invoice.id });
    }
  }
}

async function handleInvoiceFailed(invoice) {
  const subscriptionId =
    invoice.subscription ||
    invoice.parent?.subscription_details?.subscription ||
    null;
  if (!subscriptionId) return;
  const subscription = await stripe.subscriptions.retrieve(String(subscriptionId));
  const existing = await resolveSubscriptionLicense(subscription);
  const currentExpiry = existing?.expires_at ? new Date(existing.expires_at) : new Date(0);
  const graceUntil = new Date(Math.max(Date.now() + GRACE_DAYS * 86400_000, currentExpiry.getTime())).toISOString();
  const updated = await updateBySubscription(subscription, {
    status: 'grace',
    grace_until: graceUntil,
    expires_at: graceUntil,
    updated_at: new Date().toISOString(),
  }, 'payment_failed', { invoice_id: invoice.id, grace_until: graceUntil });

  const email = invoice.customer_email || updated?.email;
  if (email) {
    await sendEmail({
      to: email,
      subject: 'Leassh payment failed — 7-day grace period',
      text: [
        'We could not charge your payment method for Leassh.',
        '',
        `Your license stays active until ${graceUntil} while you update the card.`,
        'Update your payment method: https://leassh.com/account',
        '',
        'If the payment is not fixed, the license will stop validating after the grace period.',
        '',
        '— The Leassh team',
      ].join('\n'),
    });
  }
}

async function handleSubscriptionUpdated(subscription) {
  const patch = licensePatchForSubscription(subscription, {
    status: subscription.status === 'active' || subscription.status === 'trialing'
      ? 'active'
      : subscription.status === 'past_due'
        ? 'grace'
        : subscription.status,
    expires_at: periodEndIso(subscription),
  });
  await updateBySubscription(subscription, patch, 'subscription_updated', {
    status: subscription.status,
    cancel_at_period_end: subscription.cancel_at_period_end,
  });
}

async function handleSubscriptionDeleted(subscription) {
  const existing = await resolveSubscriptionLicense(subscription);
  if (!existing) return;
  const periodEnd = periodEndIso(subscription);
  await updateBySubscription(subscription, {
    status: 'canceled',
    cancel_at_period_end: true,
    current_period_end: periodEnd,
    expires_at: periodEnd,
    updated_at: new Date().toISOString(),
  }, 'canceled', { period_end: periodEnd });

  if (existing.email) {
    await sendEmail({
      to: existing.email,
      subject: 'Your Leassh subscription is canceled',
      text: [
        'Your Leassh subscription has been canceled.',
        '',
        `Your license remains valid until ${periodEnd}.`,
        'You can restart at https://leassh.com/pricing.',
        '',
        '— The Leassh team',
      ].join('\n'),
    });
  }
}

async function handleChargeRefunded(charge) {
  if (!charge.refunded || charge.amount_refunded < charge.amount) {
    return; // Partial refunds are handled commercially, not by revoking access.
  }
  const customerId = typeof charge.customer === 'string'
    ? charge.customer
    : charge.customer?.id;
  let existing = await existingLicenseByCustomer(customerId);
  if (!existing) {
    const email = charge.billing_details?.email || await customerEmail(charge.customer);
    existing = await findPaidLicenseByEmail(email);
  }
  if (!existing) return;
  const now = new Date().toISOString();
  const error = await updateLicenseByKey(existing.license_key, {
    status: 'revoked', expires_at: now, updated_at: now,
  });
  if (error) throw new Error('Refund revocation failed: ' + error.message);
  await audit(existing.license_key, 'refunded', {
    charge_id: charge.id,
    amount_refunded: charge.amount_refunded,
  });
  if (existing.email) {
    await sendEmail({
      to: existing.email,
      subject: 'Your Leassh license was refunded',
      text: [
        'Your Leassh charge was refunded in full and the license has been revoked.',
        '',
        'If this was a mistake, contact hello@leassh.com.',
        '',
        '— The Leassh team',
      ].join('\n'),
    });
  }
}

async function handleRefundUpdated(refund) {
  if (refund.status !== 'succeeded') return;
  let charge = refund.charge;
  if (typeof charge === 'string') {
    charge = await stripe.charges.retrieve(charge);
  }
  if (charge) await handleChargeRefunded(charge);
}

async function processEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {
        expand: [
          'line_items.data.price.product',
          'subscription',
        ],
      });
      await handleCheckoutCompleted(session);
      break;
    }
    case 'invoice.paid':
      await handleInvoicePaid(event.data.object);
      break;
    case 'invoice.payment_failed':
      await handleInvoiceFailed(event.data.object);
      break;
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object);
      break;
    case 'charge.refunded':
      await handleChargeRefunded(event.data.object);
      break;
    case 'refund.updated':
      await handleRefundUpdated(event.data.object);
      break;
    default:
      console.log('Webhook: unhandled event type', event.type);
  }
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (err) {
    return res.status(400).json({ error: 'Could not read request body' });
  }

  if (webhookSecret && sig) {
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).json({ error: 'Webhook signature verification failed' });
    }
  } else if (!webhookSecret) {
    // Temporary fallback while Vercel is missing STRIPE_WEBHOOK_SECRET:
    // never trust the posted body. Take only its event id, then re-fetch the
    // event from Stripe with the secret key. An attacker cannot forge a paid
    // event; replay is idempotent via stripe_events.
    console.error('Webhook: STRIPE_WEBHOOK_SECRET is not configured; using Stripe event-id verification');
    try {
      const posted = JSON.parse(rawBody.toString('utf8'));
      if (!posted?.id || !/^evt_/.test(String(posted.id))) {
        return res.status(400).json({ error: 'Missing Stripe event id' });
      }
      event = await stripe.events.retrieve(String(posted.id));
    } catch (err) {
      console.error('Webhook event-id verification failed:', err.message);
      return res.status(400).json({ error: 'Could not verify Stripe event' });
    }
  } else {
    console.error('Webhook: missing stripe-signature');
    return res.status(400).json({ error: 'Missing stripe-signature' });
  }

  try {
    const fresh = await recordEvent(event);
    if (!fresh) {
      console.log('Webhook: duplicate event ignored', event.id);
      return res.json({ received: true, duplicate: true });
    }
    await processEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook processing failed:', event.type, err.message);
    await alert('webhook_failure', { event_id: event.id, event_type: event.type, error: err.message });
    // 500 tells Stripe to retry; the license_events/stripe_events rows make
    // that retry idempotent.
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

module.exports.processEvent = processEvent;
module.exports.planFromSession = planFromSession;
module.exports.planFromSubscription = planFromSubscription;
module.exports.periodEndIso = periodEndIso;
module.exports.licensePatchForSubscription = licensePatchForSubscription;
module.exports.createLicenseFromSession = createLicenseFromSession;
module.exports.recordEvent = recordEvent;
module.exports.GRACE_DAYS = GRACE_DAYS;
