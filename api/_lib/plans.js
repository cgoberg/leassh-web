// Canonical plan catalog access for Vercel functions.
//
// data/plans.json is the single commercial source of truth. Pricing pages,
// checkout, webhook, license issuance and account surfaces all read this
// module; do not add a second price or tier table.

const fs = require("fs");
const path = require("path");

const CATALOG_PATH = path.join(__dirname, "..", "..", "data", "plans.json");

let cached = null;

function loadCatalog() {
  if (cached) return cached;
  const raw = fs.readFileSync(CATALOG_PATH, "utf8");
  const catalog = JSON.parse(raw);
  if (!catalog || !Array.isArray(catalog.plans)) {
    throw new Error("data/plans.json: missing plans[]");
  }
  cached = catalog;
  return catalog;
}

function plans() {
  return loadCatalog().plans;
}

function getPlan(planId) {
  if (!planId) return null;
  const normalized = String(planId).toLowerCase();
  const direct = plans().find((p) => p.id === normalized);
  if (direct) return direct;
  const legacy = loadCatalog().legacy_mapping?.[normalized];
  if (legacy && legacy.plan_id) {
    return plans().find((p) => p.id === legacy.plan_id) || null;
  }
  return null;
}

function isLegacyId(planId) {
  if (!planId) return false;
  return Boolean(loadCatalog().legacy_mapping?.[String(planId).toLowerCase()]);
}

function legacyAccepted(planId, now = new Date()) {
  const entry = loadCatalog().legacy_mapping?.[String(planId || "").toLowerCase()];
  if (!entry) return false;
  if (!entry.until) return true;
  return now <= new Date(`${entry.until}T23:59:59Z`);
}

// Resolve any of: plan id, legacy id, price id ("family_annual"), Stripe
// product name ("Leassh Family (Annual)"), or metadata.plan_id.
function resolvePlan(input, billingHint) {
  if (!input) return null;
  let value = String(input).trim();
  const lower = value.toLowerCase();

  if (lower.startsWith("leassh ")) {
    value = lower.slice("leassh ".length).replace(/\s*\(annual\)\s*/, "").trim();
    return getPlan(value);
  }

  if (lower.endsWith("_annual") || lower.endsWith("_monthly")) {
    return getPlan(lower.replace(/_(annual|monthly)$/, ""));
  }

  const direct = getPlan(lower);
  if (direct) return direct;

  if (billingHint) {
    const combined = getPlan(`${lower}_${billingHint}`);
    if (combined) return combined;
  }
  return null;
}

function billingFor(input, billingHint) {
  const lower = String(input || "").toLowerCase();
  if (lower.endsWith("_annual") || /annual|year/.test(String(billingHint || "").toLowerCase())) {
    return "annual";
  }
  return "monthly";
}

function priceCents(planId, billing) {
  const plan = getPlan(planId);
  if (!plan) return null;
  const amount = plan.prices?.[billing];
  return typeof amount === "number" ? amount : null;
}

function productName(plan, billing) {
  return billing === "annual" ? `Leassh ${plan.name} (Annual)` : `Leassh ${plan.name}`;
}

function checkoutConfig(planId, billing) {
  let plan = getPlan(planId);
  if (!plan) plan = resolvePlan(planId, billing);
  if (!plan || !plan.cta?.checkout) return null;
  const period = billing === "annual" ? "annual" : "monthly";
  const amount = priceCents(plan.id, period);
  if (amount === null) return null;
  return {
    plan,
    plan_id: plan.id,
    billing: period,
    amount,
    interval: period === "annual" ? "year" : "month",
    product_name: productName(plan, period),
    trial_days: plan.trial_days || 0,
    metadata: {
      plan_id: plan.id,
      license_tier: plan.license_tier,
      billing: period,
    },
  };
}

function tierFor(planId) {
  return getPlan(planId)?.license_tier || null;
}

function featuresFor(planId) {
  return getPlan(planId)?.license_features || [];
}

function maxNodesFor(planId) {
  const plan = getPlan(planId);
  if (!plan) return null;
  return plan.devices === 0 ? 0 : plan.devices;
}

function allPlanIds() {
  return plans().map((p) => p.id);
}

function publicCatalog() {
  const catalog = loadCatalog();
  return {
    version: catalog.version,
    effective_from: catalog.effective_from,
    currency: catalog.currency,
    billing: catalog.billing,
    plans: catalog.plans,
    comparison: catalog.comparison,
    faq: catalog.faq,
  };
}

module.exports = {
  CATALOG_PATH,
  loadCatalog,
  plans,
  getPlan,
  isLegacyId,
  legacyAccepted,
  resolvePlan,
  billingFor,
  priceCents,
  productName,
  checkoutConfig,
  tierFor,
  featuresFor,
  maxNodesFor,
  allPlanIds,
  publicCatalog,
};
