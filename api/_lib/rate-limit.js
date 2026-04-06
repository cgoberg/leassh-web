// Rate limiting utility for public API endpoints
// Uses IP-based tracking with a sliding window algorithm

const getClientIp = (req) => {
  return (
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.headers['x-real-ip'] ||
    req.connection.remoteAddress ||
    'unknown'
  );
};

// Rate limiting configuration (requests per window)
const LIMITS = {
  // License validation: 60 requests per minute per IP
  license: { window: 60000, max: 60 },
  // Checkout creation: 30 requests per minute per IP
  checkout: { window: 60000, max: 30 },
  // Account registration: 10 requests per minute per IP
  account: { window: 60000, max: 10 },
};

// In-memory cache for rate limiting (not suitable for high-scale distributed usage)
// In production, this should use Redis or Vercel KV
const requestCache = new Map();

const cleanupCache = () => {
  const now = Date.now();
  for (const [key, data] of requestCache.entries()) {
    if (now - data.windowStart > data.window * 2) {
      requestCache.delete(key);
    }
  }
};

// Cleanup cache periodically (every 5 minutes)
const cacheCleanupInterval = setInterval(cleanupCache, 5 * 60 * 1000);

const checkRateLimit = (req, endpoint) => {
  const ip = getClientIp(req);
  const key = `${endpoint}:${ip}`;
  const limit = LIMITS[endpoint];

  if (!limit) {
    throw new Error(`Rate limit not configured for endpoint: ${endpoint}`);
  }

  const now = Date.now();
  let data = requestCache.get(key);

  // Initialize or reset if window has passed
  if (!data || now - data.windowStart > limit.window) {
    data = { count: 0, windowStart: now };
  }

  // Increment request count
  data.count++;
  requestCache.set(key, data);

  const remaining = Math.max(0, limit.max - data.count);
  const resetAt = data.windowStart + limit.window;

  return {
    allowed: data.count <= limit.max,
    count: data.count,
    limit: limit.max,
    remaining,
    resetAt,
    retryAfter: Math.ceil((resetAt - now) / 1000),
  };
};

const setRateLimitHeaders = (res, rateLimit) => {
  res.setHeader('X-RateLimit-Limit', rateLimit.limit.toString());
  res.setHeader('X-RateLimit-Remaining', rateLimit.remaining.toString());
  res.setHeader('X-RateLimit-Reset', Math.floor(rateLimit.resetAt / 1000).toString());

  if (!rateLimit.allowed) {
    res.setHeader('Retry-After', rateLimit.retryAfter.toString());
  }
};

const enforceRateLimit = (req, res, endpoint) => {
  const rateLimit = checkRateLimit(req, endpoint);
  setRateLimitHeaders(res, rateLimit);

  if (!rateLimit.allowed) {
    return res.status(429).json({
      error: 'Too many requests',
      retryAfter: rateLimit.retryAfter,
      resetAt: new Date(rateLimit.resetAt).toISOString(),
    });
  }

  return null;
};

module.exports = {
  checkRateLimit,
  setRateLimitHeaders,
  enforceRateLimit,
  getClientIp,
};
