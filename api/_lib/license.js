// Shared license logic for Vercel serverless functions.
//
// One tier table, derived from data/plans.json. There is deliberately no
// second price/feature map and no env-var license store: Supabase is the
// store (see api/license/*, api/account/register.js, api/checkout/webhook.js).

const crypto = require("crypto");
const { plans, getPlan, isLegacyId, legacyAccepted, loadCatalog } = require("./plans");

function buildTiers() {
  const table = {};
  for (const plan of plans()) {
    table[plan.id] = {
      name: plan.name,
      max_nodes: plan.devices === 0 ? 0 : plan.devices,
      features: [...plan.license_features],
      plan_id: plan.id,
    };
  }
  // Legacy ids are accepted for 90 days and map to Family entitlements.
  for (const [legacyId, mapping] of Object.entries(
    loadCatalog().legacy_mapping || {},
  )) {
    const plan = getPlan(mapping.plan_id);
    if (!plan) continue;
    table[legacyId] = {
      name: plan.name,
      max_nodes: plan.devices === 0 ? 0 : plan.devices,
      features: [...plan.license_features],
      plan_id: plan.id,
      legacy: true,
      legacy_until: mapping.until,
    };
  }
  return table;
}

const TIERS = buildTiers();

// ---------------------------------------------------------------------------
// Generate a new license key: LSH-XXXXX-XXXXX-XXXXX-XXXXX
// ---------------------------------------------------------------------------
function generateKey() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const segments = [];
  for (let s = 0; s < 4; s++) {
    let seg = "";
    for (let i = 0; i < 5; i++) {
      seg += chars[crypto.randomInt(chars.length)];
    }
    segments.push(seg);
  }
  return `LSH-${segments.join("-")}`;
}

// ---------------------------------------------------------------------------
// Create a new license object (does not persist; callers upsert Supabase).
// ---------------------------------------------------------------------------
function createLicense(email, tier, durationDays) {
  const tierDef = TIERS[tier];
  if (!tierDef) {
    return {
      error: `Unknown tier: ${tier}. Valid: ${Object.keys(TIERS).join(", ")}`,
    };
  }
  if (isLegacyId(tier) && !legacyAccepted(tier)) {
    return { error: `Legacy tier '${tier}' is no longer accepted` };
  }

  const now = new Date();
  // Free has no expiry. Paid licenses default to one year; subscription
  // webhooks set the real period end.
  const expires =
    tier === "free" || tierDef.max_nodes === 0 && durationDays === 0
      ? null
      : new Date(now.getTime() + (durationDays || 365) * 24 * 60 * 60 * 1000);

  return {
    key: generateKey(),
    email,
    tier: tierDef.plan_id,
    license_tier: tierDef.plan_id,
    legacy_tier: isLegacyId(tier) ? tier : null,
    max_nodes: tierDef.max_nodes,
    features: [...tierDef.features],
    created_at: now.toISOString(),
    expires_at: expires ? expires.toISOString() : null,
    status: "active",
  };
}

// ---------------------------------------------------------------------------
// CORS headers helper
// ---------------------------------------------------------------------------
function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

module.exports = {
  TIERS,
  generateKey,
  createLicense,
  setCorsHeaders,
};
