const { accounts, addresses } = require('../_lib/store');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { pairing_code, api_key, addresses: addrs } = req.body || {};

    if (!pairing_code || !api_key) {
      return res.status(400).json({ error: 'pairing_code and api_key required' });
    }

    if (!Array.isArray(addrs) || addrs.length === 0) {
      return res.status(400).json({ error: 'addresses array required' });
    }

    // Validate api_key against stored account
    const account = accounts.get(pairing_code);
    if (account && account.api_key !== api_key) {
      return res.status(403).json({ error: 'Invalid api_key for this pairing code' });
    }

    // If account not in memory (cold start), trust the api_key and re-create
    if (!account) {
      accounts.set(pairing_code, {
        api_key,
        email: null,
        account_id: null,
        created_at: new Date().toISOString(),
        restored: true,
      });
    }

    // Store/update addresses
    addresses.set(pairing_code, {
      addresses: addrs,
      updated_at: new Date().toISOString(),
    });

    console.log('RENDEZVOUS_REGISTER', JSON.stringify({
      pairing_code,
      addresses: addrs,
    }));

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Rendezvous register error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
};
