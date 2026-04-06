const supabase = require('../_lib/supabase');

// Keep rate limiting in-memory (per-invocation, resets on cold start)
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Rate limit by IP
    const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(ip)) {
      return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
    }

    const code = (req.query.code || '').toUpperCase().trim();
    if (!code) {
      return res.status(400).json({ error: 'code query parameter required' });
    }

    // Look up in Supabase
    const { data, error } = await supabase
      .from('rendezvous')
      .select('addresses, updated_at')
      .eq('pairing_code', code)
      .maybeSingle();

    if (error) {
      console.error('Supabase lookup error:', error.message);
      return res.status(500).json({ error: 'Lookup failed' });
    }

    if (!data) {
      return res.status(404).json({ error: 'Pairing code not found. The server may not have registered yet.' });
    }

    res.json({
      addresses: data.addresses,
      updated_at: data.updated_at,
    });
  } catch (err) {
    console.error('Rendezvous lookup error:', err.message);
    res.status(500).json({ error: 'Lookup failed' });
  }
};
