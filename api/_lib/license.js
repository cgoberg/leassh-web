// Shared license logic for Vercel serverless functions
// Storage: LEASSH_LICENSES env var (JSON array) for MVP
// Dev keys (starting with "dev-") are always valid

const crypto = require("crypto");

// ---------------------------------------------------------------------------
// Tier definitions
// ---------------------------------------------------------------------------
const TIERS = {
  starter: {
    max_nodes: 5,
    features: ["monitoring", "dashboard"],
  },
  pro: {
    max_nodes: 25,
    features: [
      "monitoring",
      "dashboard",
      "vision",
      "enforcement",
      "notifications",
      "screen_time",
    ],
  },
  family: {
    max_nodes: 10,
    features: [
      "monitoring",
      "dashboard",
      "vision",
      "enforcement",
      "notifications",
      "screen_time",
    ],
  },
  unlimited: {
    max_nodes: 0, // 0 = unlimited
    features: [
      "monitoring",
      "dashboard",
      "vision",
      "enforcement",
      "notifications",
      "screen_time",
    ],
  },
};

// ---------------------------------------------------------------------------
// Load licenses from LEASSH_LICENSES env var
// ---------------------------------------------------------------------------
function loadLicenses() {
  const raw = process.env.LEASSH_LICENSES || "[]";
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Validate a license key
// Returns { valid, tier, max_nodes, features, expires_at, error }
// ---------------------------------------------------------------------------
function validateLicense(licenseKey, nodeCount) {
  if (!licenseKey) {
    return { valid: false, error: "Missing license_key" };
  }

  // Dev keys: always valid, dev tier with unlimited features
  if (licenseKey.startsWith("dev-")) {
    return {
      valid: true,
      tier: "dev",
      max_nodes: 0,
      features: TIERS.unlimited.features,
      expires_at: null,
    };
  }

  // Check key format: LSH-XXXXX-XXXXX-XXXXX-XXXXX
  const keyPattern = /^LSH-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/;
  if (!keyPattern.test(licenseKey)) {
    return { valid: false, error: "Invalid key format" };
  }

  // Look up in stored licenses
  const licenses = loadLicenses();
  const license = licenses.find((l) => l.key === licenseKey);

  if (!license) {
    return { valid: false, error: "License not found" };
  }

  // Check expiry
  if (license.expires_at && new Date(license.expires_at) < new Date()) {
    return { valid: false, error: "License expired" };
  }

  // Check node count
  const maxNodes = license.max_nodes || 0;
  if (maxNodes > 0 && nodeCount && nodeCount > maxNodes) {
    return {
      valid: false,
      error: `Node count ${nodeCount} exceeds max ${maxNodes} for tier ${license.tier}`,
    };
  }

  return {
    valid: true,
    tier: license.tier,
    max_nodes: license.max_nodes,
    features: license.features || TIERS[license.tier]?.features || [],
    expires_at: license.expires_at,
  };
}

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
// Create a new license object
// ---------------------------------------------------------------------------
function createLicense(email, tier, durationDays) {
  const tierDef = TIERS[tier];
  if (!tierDef) {
    return { error: `Unknown tier: ${tier}. Valid: ${Object.keys(TIERS).join(", ")}` };
  }

  const days = durationDays || 365;
  const now = new Date();
  const expires = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  return {
    key: generateKey(),
    email,
    tier,
    max_nodes: tierDef.max_nodes,
    features: tierDef.features,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
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
  loadLicenses,
  validateLicense,
  generateKey,
  createLicense,
  setCorsHeaders,
};
