const { addresses, checkRateLimit } = require('../_lib/store');

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

    const entry = addresses.get(code);
    if (!entry) {
      return res.status(404).json({ error: 'Pairing code not found. The server may not have registered yet.' });
    }

    res.json({
      addresses: entry.addresses,
      updated_at: entry.updated_at,
    });
  } catch (err) {
    console.error('Rendezvous lookup error:', err.message);
    res.status(500).json({ error: 'Lookup failed' });
  }
};
