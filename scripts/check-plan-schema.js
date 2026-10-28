#!/usr/bin/env node
// Validate data/plans.json against the commercial schema.
// No network, no dependencies: run in CI and in verify.sh.
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "plans.json");
const errors = [];

function fail(message) {
  errors.push(message);
}

function isNonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0;
}

function requireString(obj, key, where) {
  if (typeof obj?.[key] !== "string" || obj[key].trim() === "") {
    fail(`${where}.${key} must be a non-empty string`);
  }
}

let catalog;
try {
  catalog = JSON.parse(fs.readFileSync(FILE, "utf8"));
} catch (err) {
  console.error(`✗ cannot read ${FILE}: ${err.message}`);
  process.exit(1);
}

if (typeof catalog.version !== "string") fail("version must be a string");
if (!/^\d{4}-\d{2}-\d{2}$/.test(catalog.effective_from || "")) {
  fail("effective_from must be YYYY-MM-DD");
}
if (catalog.currency !== "usd") fail("currency must be usd for the launch catalog");

const plans = catalog.plans;
if (!Array.isArray(plans) || plans.length !== 4) {
  fail("plans[] must contain exactly the four launch plans");
}

const ids = new Set();
const tiers = new Set();
for (const [index, plan] of (plans || []).entries()) {
  const where = `plans[${index}]`;
  requireString(plan, "id", where);
  requireString(plan, "license_tier", where);
  requireString(plan, "name", where);
  if (ids.has(plan.id)) fail(`duplicate plan id ${plan.id}`);
  if (tiers.has(plan.license_tier)) fail(`duplicate license_tier ${plan.license_tier}`);
  ids.add(plan.id);
  tiers.add(plan.license_tier);

  if (!isNonNegativeInt(plan.devices)) fail(`${where}.devices must be an integer >= 0`);
  if (!isNonNegativeInt(plan.trial_days)) fail(`${where}.trial_days must be an integer >= 0`);

  for (const period of ["monthly", "annual", "annual_monthly_equivalent"]) {
    if (!(period in (plan.prices || {}))) fail(`${where}.prices.${period} missing`);
  }
  if (plan.prices?.monthly !== null && !isNonNegativeInt(plan.prices?.monthly)) {
    fail(`${where}.prices.monthly must be integer cents or null`);
  }
  if (plan.prices?.annual !== null && !isNonNegativeInt(plan.prices?.annual)) {
    fail(`${where}.prices.annual must be integer cents or null`);
  }
  if (plan.id !== "unlimited" && plan.id !== "free") {
    if (!isNonNegativeInt(plan.prices?.monthly) || plan.prices.monthly <= 0) {
      fail(`${where}.prices.monthly must be positive cents`);
    }
    if (!isNonNegativeInt(plan.prices?.annual) || plan.prices.annual <= 0) {
      fail(`${where}.prices.annual must be positive cents`);
    }
    if (plan.prices?.annual >= plan.prices?.monthly * 12) {
      fail(`${where}: annual price must be cheaper than 12x monthly`);
    }
  }

  if (!Array.isArray(plan.license_features) || plan.license_features.length === 0) {
    fail(`${where}.license_features must be a non-empty array`);
  }
  if (!plan.cta || typeof plan.cta.label !== "string" || typeof plan.cta.href !== "string") {
    fail(`${where}.cta needs label and href`);
  }
  if (typeof plan.cta?.checkout !== "boolean") fail(`${where}.cta.checkout must be boolean`);
  if (!Array.isArray(plan.legacy_ids)) fail(`${where}.legacy_ids must be an array`);

  const marketing = plan.marketing || {};
  for (const key of ["tagline", "description"]) {
    if (typeof marketing[key] !== "string" || !marketing[key].trim()) {
      fail(`${where}.marketing.${key} must be a non-empty string`);
    }
  }
  if (!Array.isArray(marketing.bullets) || marketing.bullets.length === 0) {
    fail(`${where}.marketing.bullets must be non-empty`);
  }
}

const expected = ["free", "family", "pro", "unlimited"];
for (const id of expected) {
  if (!ids.has(id)) fail(`missing required plan: ${id}`);
}
if (ids.has("essential") || ids.has("starter")) {
  fail("Essential/Starter must not be active plans; use legacy_ids/legacy_mapping");
}

for (const plan of plans || []) {
  for (const legacy of plan.legacy_ids || []) {
    if (!catalog.legacy_mapping?.[legacy]) {
      fail(`legacy id ${legacy} has no legacy_mapping entry`);
    }
  }
}
for (const [legacy, mapping] of Object.entries(catalog.legacy_mapping || {})) {
  if (!ids.has(mapping.plan_id)) fail(`legacy ${legacy} maps to unknown plan ${mapping.plan_id}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mapping.until || "")) {
    fail(`legacy ${legacy}.until must be YYYY-MM-DD`);
  }
}

// Comparison/FAQ must name all plans and include HA + phones coverage.
const groups = catalog.comparison?.groups || [];
if (groups.length !== 4) fail("comparison must have four groups");
for (const group of groups) {
  if (!group.name || !Array.isArray(group.rows)) fail("comparison group needs name/rows");
  for (const row of group.rows || []) {
    if (!row.label) fail("comparison row needs a label");
    for (const id of expected) {
      if (!(id in (row.values || {}))) fail(`comparison row '${row.label}' missing ${id}`);
    }
  }
}
const rows = groups.flatMap((g) => g.rows || []);
if (!rows.some((r) => /Home Assistant/i.test(r.label))) {
  fail("comparison must include a Home Assistant integration row");
}
if (!rows.some((r) => /Computers/i.test(r.label))) {
  fail("comparison must include a Computers row");
}

if (!Array.isArray(catalog.faq) || catalog.faq.length < 6) {
  fail("faq must have at least six entries");
}
for (const item of catalog.faq || []) {
  if (!item.q || !item.a) fail("each FAQ entry needs q and a");
}
const faqText = (catalog.faq || []).map((f) => `${f.q} ${f.a}`).join(" ").toLowerCase();
for (const topic of ["free", "trial", "switch", "computer", "phone", "payment", "refund", "unlimited"]) {
  if (!faqText.includes(topic)) fail(`FAQ missing topic: ${topic}`);
}

if (errors.length) {
  console.error("✗ plan schema check failed:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`✓ plan schema OK (${plans.length} plans, ${rows.length} comparison rows)`);
