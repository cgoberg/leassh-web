// Vercel serverless function: POST /api/license/validate
const supabase = require('../_lib/supabase');
const { TIERS, setCorsHeaders } = require('../_lib/license');
const { enforceRateLimit } = require('../_lib/rate-limit');

module.exports = async (req, res) => {
  setCorsHeaders(res);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Enforce rate limiting
  const rateLimitError = enforceRateLimit(req, res, 'license');
  if (rateLimitError) {
    return rateLimitError;
  }

  try {
    const { license_key, node_count } = req.body || {};

    if (!license_key) {
      return res.status(200).json({ valid: false, error: 'Missing license_key' });
    }

    // Dev keys: always valid, dev tier with unlimited features
    if (license_key.startsWith('dev-')) {
      return res.status(200).json({
        valid: true,
        tier: 'dev',
        max_nodes: 0,
        features: TIERS.unlimited.features,
        expires_at: null,
      });
    }

    // Check key format: LSH-XXXXX-XXXXX-XXXXX-XXXXX
    const keyPattern = /^LSH-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/;
    if (!keyPattern.test(license_key)) {
      return res.status(200).json({ valid: false, error: 'Invalid key format' });
    }

    // Look up in Supabase
    const { data: license, error } = await supabase
      .from('licenses')
      .select('tier, features, max_nodes, expires_at')
      .eq('license_key', license_key)
      .maybeSingle();

    if (error) {
      console.error('Supabase license lookup error:', error.message);
      return res.status(500).json({ valid: false, error: 'Validation failed' });
    }

    if (!license) {
      return res.status(200).json({ valid: false, error: 'License not found' });
    }

    // Check expiry
    if (license.expires_at && new Date(license.expires_at) < new Date()) {
      return res.status(200).json({ valid: false, error: 'License expired' });
    }

    // Check node count
    const maxNodes = license.max_nodes || 0;
    if (maxNodes > 0 && node_count && node_count > maxNodes) {
      return res.status(200).json({
        valid: false,
        error: 'Node count ' + node_count + ' exceeds max ' + maxNodes + ' for tier ' + license.tier,
      });
    }

    return res.status(200).json({
      valid: true,
      tier: license.tier,
      max_nodes: license.max_nodes,
      features: license.features || TIERS[license.tier]?.features || [],
      expires_at: license.expires_at,
    });
  } catch (err) {
    console.error('Validation error:', err.message);
    return res.status(500).json({ valid: false, error: err.message });
  }
};
