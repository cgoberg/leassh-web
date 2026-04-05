// In-memory store for pairing codes and rendezvous data.
// Lost on cold start — servers re-register every 60s so it self-heals.
// Account credentials are returned to the user at registration time
// and logged to console for audit trail.

const accounts = new Map();   // pairing_code -> { api_key, email, created_at }
const addresses = new Map();  // pairing_code -> { addresses: [...], updated_at }
const rateLimits = new Map(); // ip -> { count, reset_at }

const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 5;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimits.get(ip);

  if (!entry || now > entry.reset_at) {
    rateLimits.set(ip, { count: 1, reset_at: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) return false;

  entry.count++;
  return true;
}

module.exports = { accounts, addresses, rateLimits, checkRateLimit };
