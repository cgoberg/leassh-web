const fs = require("fs");
const path = require("path");

const page = fs.readFileSync(path.join(__dirname, "..", "pricing.html"), "utf8");

const forbiddenPaidClaims = [
  "Start 14-Day Free Trial",
  "startCheckout(",
  "/api/checkout/create",
  "your trial converts to a paid subscription",
  "founder's pricing period",
];

const requiredAlphaTruth = [
  "Free alpha",
  "registration is temporarily paused",
  "macOS agent",
  "Paid plans and checkout",
  "Planned paid range after alpha: $4.99–$19.99",
];

for (const claim of forbiddenPaidClaims) {
  if (page.toLowerCase().includes(claim.toLowerCase())) {
    throw new Error(`Pricing page restored an unavailable paid claim: ${claim}`);
  }
}

for (const fact of requiredAlphaTruth) {
  if (!page.toLowerCase().includes(fact.toLowerCase())) {
    throw new Error(`Pricing page lost a required alpha-state fact: ${fact}`);
  }
}

console.log("pricing truth guard: ok");
