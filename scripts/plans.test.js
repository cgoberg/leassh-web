const test = require("node:test");
const assert = require("node:assert/strict");

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.supabase.co";
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "test-service-key";

const plans = require("../api/_lib/plans");
const { createLicense, TIERS } = require("../api/_lib/license");
const { buildCheckoutParams } = require("../api/checkout/create");
const webhook = require("../api/checkout/webhook");

test("catalog has the four launch plans and no Essential", () => {
  assert.deepEqual(plans.allPlanIds(), ["free", "family", "pro", "unlimited"]);
  assert.equal(plans.getPlan("essential").id, "family");
  assert.equal(plans.isLegacyId("starter"), true);
});

test("prices are cents and annual is cheaper than 12x monthly", () => {
  assert.equal(plans.priceCents("family", "monthly"), 1499);
  assert.equal(plans.priceCents("family", "annual"), 11988);
  assert.equal(plans.priceCents("pro", "annual"), 23988);
  assert.ok(plans.priceCents("pro", "annual") < plans.priceCents("pro", "monthly") * 12);
});

test("checkout derives annual Family price, trial and metadata", () => {
  const { params, config } = buildCheckoutParams({ tier: "family_annual" });
  assert.equal(config.plan_id, "family");
  assert.equal(config.amount, 11988);
  assert.equal(config.interval, "year");
  assert.equal(params.subscription_data.trial_period_days, 14);
  assert.equal(params.metadata.plan_id, "family");
  assert.equal(params.subscription_data.metadata.plan_id, "family");
  assert.equal(params.line_items[0].price_data.product_data.name, "Leassh Family (Annual)");
});

test("checkout accepts plan_id + billing and monthly", () => {
  const { config } = buildCheckoutParams({ plan_id: "pro", billing: "monthly" });
  assert.equal(config.amount, 2999);
  assert.equal(config.interval, "month");
});

test("legacy essential checkout maps to Family for 90 days", () => {
  const { config } = buildCheckoutParams({ tier: "essential_annual" });
  assert.equal(config.plan_id, "family");
  assert.equal(config.amount, 11988);
});

test("free and unlimited are not checkout plans", () => {
  assert.throws(() => buildCheckoutParams({ plan_id: "free" }), /Invalid plan/);
  assert.throws(() => buildCheckoutParams({ plan_id: "unlimited" }), /Invalid plan/);
});

test("webhook resolves metadata first, then product name, then legacy", () => {
  const fromMeta = webhook.planFromSession({
    metadata: { plan_id: "pro" },
    line_items: { data: [{ price: { product: { name: "Leassh Family" } } }] },
  });
  assert.equal(fromMeta.id, "pro");

  const fromProduct = webhook.planFromSession({
    metadata: {},
    line_items: { data: [{ price: { product: { name: "Leassh Family (Annual)" } } }] },
  });
  assert.equal(fromProduct.id, "family");

  const legacy = webhook.planFromSession({
    metadata: {},
    line_items: { data: [{ description: "Leassh Essential" }] },
  });
  assert.equal(legacy.id, "family");
});

test("subscription update patch carries plan, nodes, period and cancel flag", () => {
  const patch = webhook.licensePatchForSubscription({
    id: "sub_1",
    customer: "cus_1",
    current_period_end: 1893456000,
    cancel_at_period_end: true,
    metadata: { plan_id: "pro" },
    items: { data: [] },
  });
  assert.equal(patch.tier, "pro");
  assert.equal(patch.max_nodes, 25);
  assert.equal(patch.cancel_at_period_end, true);
  assert.equal(patch.current_period_end, new Date(1893456000 * 1000).toISOString());
});

test("license tiers are catalog-derived; free is 2 nodes and no expiry", () => {
  assert.equal(TIERS.free.max_nodes, 2);
  assert.equal(TIERS.family.max_nodes, 10);
  assert.equal(TIERS.pro.max_nodes, 25);
  assert.equal(TIERS.unlimited.max_nodes, 0);
  const free = createLicense("a@example.com", "free", 0);
  assert.equal(free.expires_at, null);
  assert.equal(free.max_nodes, 2);
  assert.ok(free.features.includes("home_assistant"));
  assert.ok(!free.features.includes("vision"));
});

test("legacy license creation maps to Family but records the legacy id", () => {
  const legacy = createLicense("a@example.com", "essential", 30);
  assert.equal(legacy.tier, "family");
  assert.equal(legacy.legacy_tier, "essential");
  assert.equal(legacy.max_nodes, 10);
});

const { evaluateLicense } = require("../api/license/validate");

test("license validation enforces Free 2 nodes and returns plan metadata", () => {
  const base = {
    license_key: "LSH-AAAAA-BBBBB-CCCCC-DDDDD",
    tier: "free",
    plan_id: "free",
    max_nodes: 2,
    features: ["monitoring", "home_assistant"],
    status: "active",
    expires_at: null,
  };
  const ok = evaluateLicense(base, 2);
  assert.equal(ok.valid, true);
  assert.equal(ok.plan_id, "free");
  assert.equal(ok.max_nodes, 2);
  assert.equal(ok.plan_name, "Free");

  const over = evaluateLicense(base, 3);
  assert.equal(over.valid, false);
  assert.equal(over.status, "node_limit");
});

test("license validation handles revoked, expired and grace states", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  assert.equal(evaluateLicense({ tier: "family", status: "revoked" }, 1, now).status, "revoked");
  assert.equal(
    evaluateLicense({ tier: "family", status: "active", expires_at: "2026-10-27T12:00:00Z" }, 1, now).status,
    "expired",
  );
  assert.equal(
    evaluateLicense({ tier: "family", status: "grace", grace_until: "2026-10-30T12:00:00Z" }, 1, now).valid,
    true,
  );
  assert.equal(
    evaluateLicense({ tier: "family", status: "grace", grace_until: "2026-10-27T12:00:00Z" }, 1, now).status,
    "grace_expired",
  );
});

test("legacy license rows validate as Family until the 90-day cutoff", () => {
  const legacy = {
    tier: "essential",
    plan_id: "family",
    max_nodes: 10,
    features: ["monitoring"],
    status: "active",
  };
  const before = evaluateLicense(legacy, 10, new Date("2026-11-01T00:00:00Z"));
  assert.equal(before.valid, true);
  assert.equal(before.plan_id, "family");
  assert.equal(before.legacy_tier, "essential");

  const after = evaluateLicense(legacy, 10, new Date("2027-02-01T00:00:00Z"));
  assert.equal(after.valid, false);
  assert.equal(after.status, "legacy_expired");
});
