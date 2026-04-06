const supabase = require('../_lib/supabase');

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

    // Validate api_key against stored account in Supabase
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

    // Upsert into rendezvous table
    const { error: upsertErr } = await supabase
      .from('rendezvous')
      .upsert(
        {
          pairing_code,
          addresses: addrs,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'pairing_code' }
      );

    if (upsertErr) {
      console.error('Supabase upsert error:', upsertErr.message);
      return res.status(500).json({ error: 'Registration failed' });
    }

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
