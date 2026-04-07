const supabase = require('./_lib/supabase');

// Rate limiting for lookup (in-memory, resets on cold start)
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

async function handleLookup(req, res) {
  const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
  }

  const code = (req.query.code || '').toUpperCase().trim();
  if (!code) {
    return res.status(400).json({ error: 'code query parameter required' });
  }

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

  res.json({ addresses: data.addresses, updated_at: data.updated_at });
}

async function handleRegister(req, res) {
  const { pairing_code, api_key, addresses: addrs } = req.body || {};

  if (!pairing_code || !api_key) {
    return res.status(400).json({ error: 'pairing_code and api_key required' });
  }

  if (!Array.isArray(addrs) || addrs.length === 0) {
    return res.status(400).json({ error: 'addresses array required' });
  }

  const { data: account, error: lookupErr } = await supabase
    .from('accounts')
    .select('api_key')
    .eq('pairing_code', pairing_code)
    .maybeSingle();

  if (lookupErr) {
    console.error('Supabase account lookup error:', lookupErr.message);
    return res.status(500).json({ error: 'Registration failed' });
  }

  if (account && account.api_key !== api_key) {
    return res.status(403).json({ error: 'Invalid api_key for this pairing code' });
  }

  const { error: upsertErr } = await supabase
    .from('rendezvous')
    .upsert(
      { pairing_code, addresses: addrs, updated_at: new Date().toISOString() },
      { onConflict: 'pairing_code' }
    );

  if (upsertErr) {
    console.error('Supabase upsert error:', upsertErr.message);
    return res.status(500).json({ error: 'Registration failed' });
  }

  console.log('RENDEZVOUS_REGISTER', JSON.stringify({ pairing_code, addresses: addrs }));
  res.json({ status: 'ok' });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') return await handleLookup(req, res);
    if (req.method === 'POST') return await handleRegister(req, res);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Rendezvous error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};
