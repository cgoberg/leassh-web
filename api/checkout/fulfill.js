const supabase = require('../_lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { session_id } = req.query;
  if (!session_id) {
    return res.status(400).json({ error: 'Missing session_id' });
  }

  const { data, error } = await supabase
    .from('licenses')
    .select('license_key, tier, features, billing, email')
    .eq('stripe_session_id', session_id)
    .single();

  if (error || !data) {
    // Webhook may not have processed yet — return 202 so the client can retry
    return res.status(202).json({ pending: true });
  }

  res.json(data);
};
