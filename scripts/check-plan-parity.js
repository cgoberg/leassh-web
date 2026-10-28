#!/usr/bin/env node
// Parity check: the catalog is the only commercial truth. Fail when a
// surface drifts (prices, plan names, node counts, legacy tiers, or a dead
// checkout link).
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "data/plans.json"), "utf8"));
const plans = Object.fromEntries(catalog.plans.map((p) => [p.id, p]));
const errors = [];
const ok = [];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function has(rel, needle, label) {
  const text = read(rel);
  if (!text.includes(needle)) errors.push(`${rel}: missing ${label || needle}`);
  else ok.push(`${rel}: ${label || needle}`);
}

function lacks(rel, needle, label) {
  const text = read(rel);
  if (text.includes(needle)) errors.push(`${rel}: must not contain ${label || needle}`);
  else ok.push(`${rel}: no ${label || needle}`);
}

function assert(cond, message) {
  if (!cond) errors.push(message);
  else ok.push(message);
}

// --- pricing page -----------------------------------------------------------
for (const id of ["free", "family", "pro", "unlimited"]) {
  has("pricing.html", `data-plan="${id}"`, `card ${id}`);
}
for (const amount of ["$0", "$9.99", "$19.99", "$14.99", "$29.99"]) {
  has("pricing.html", amount, `price ${amount}`);
}
has("pricing.html", "Save 33%", "annual savings label");
has("pricing.html", "Start free", "Free CTA");
has("pricing.html", "Start 14-Day Free Trial", "paid CTA");
has("pricing.html", "Home Assistant integration", "HA comparison row");
has("pricing.html", "/platforms", "platforms FAQ link");
lacks("pricing.html", "Essential", "Essential");
lacks("pricing.html", "founder", "founder lock copy");

// --- other surfaces ---------------------------------------------------------
for (const id of ["free", "family", "pro"]) {
  has("index.html", `data-plan="${id}"`, `homepage preview ${id}`);
}
lacks("index.html", "Essential", "Essential");
lacks("fleet.html", "data-plan=\"essential\"", "legacy fleet card");
has("fleet.html", "/pricing", "fleet summary link");
lacks("success.html", "Leassh Local", "stale Leassh Local label");
has("success.html", "plan_name", "plan-name rendering");
for (const id of ["Free", "Family", "Pro", "Unlimited"]) {
  has("docs.html", id, `docs plan ${id}`);
}
lacks("docs.html", "Essential", "Essential");

// --- code surfaces ----------------------------------------------------------
for (const rel of [
  "api/checkout/create.js",
  "api/checkout/webhook.js",
  "api/account/upgrade.js",
  "api/_lib/license.js",
  "api/license/validate.js",
  "scripts/license-server.js",
]) {
  has(rel, "plans", "catalog import");
}
for (const rel of ["api/checkout/create.js", "api/account/upgrade.js"]) {
  lacks(rel, "unit_amount: 799", "hardcoded Essential price");
  lacks(rel, "unit_amount: 11988", "hardcoded Family price map");
  lacks(rel, "essential_monthly", "hardcoded Essential price id");
}
has("api/checkout/create.js", "metadata", "checkout metadata");
has("api/checkout/create.js", "trial_period_days", "trial");
has("api/checkout/webhook.js", "metadata.plan_id", "webhook plan metadata fallback");
has("api/checkout/webhook.js", "legacy", "legacy fallback");
has("api/_lib/license.js", "loadCatalog", "catalog-derived tiers");

// --- numeric parity ---------------------------------------------------------
assert(plans.free.devices === 2, "Free is 2 devices");
assert(plans.family.devices === 10, "Family is 10 devices");
assert(plans.pro.devices === 25, "Pro is 25 devices");
assert(plans.unlimited.devices === 0, "Unlimited is unlimited (0)");
assert(plans.family.prices.monthly === 1499, "Family monthly is $14.99");
assert(plans.family.prices.annual === 11988, "Family annual is $119.88");
assert(plans.family.prices.annual_monthly_equivalent === 999, "Family annual is $9.99/mo");
assert(plans.pro.prices.monthly === 2999, "Pro monthly is $29.99");
assert(plans.pro.prices.annual === 23988, "Pro annual is $239.88");
assert(plans.pro.prices.annual_monthly_equivalent === 1999, "Pro annual is $19.99/mo");
assert(plans.family.trial_days === 14 && plans.pro.trial_days === 14, "14-day trials on Family/Pro");
assert(plans.free.trial_days === 0 && plans.unlimited.trial_days === 0, "no trial on Free/Unlimited");
assert(plans.free.license_features.includes("home_assistant"), "Free includes HA");
assert(plans.free.license_features.includes("api"), "Free includes one API token");
assert(!plans.free.license_features.includes("vision"), "Free has no vision");
assert(!plans.family.license_features.includes("rules"), "Family has no rules");
assert(plans.pro.license_features.includes("rules"), "Pro includes rules");

if (errors.length) {
  console.error("✗ plan parity failed:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`✓ plan parity OK (${ok.length} assertions)`);
