const crypto = require('crypto');
const supabase = require('../_lib/supabase');
const { enforceRateLimit } = require('../_lib/rate-limit');

// Characters that are unambiguous when read aloud or typed
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generatePairingCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return code;
}

function generateApiKey() {
  return crypto.randomBytes(16).toString('hex');
}

function generateAccountId() {
  return crypto.randomUUID();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Enforce rate limiting
  const rateLimitError = enforceRateLimit(req, res, 'account');
  if (rateLimitError) {
    return rateLimitError;
  }

  try {
    const { email } = req.body || {};

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Valid email address required' });
    }

    const account_id = generateAccountId();
    const pairing_code = generatePairingCode();
    const api_key = generateApiKey();
    const created_at = new Date().toISOString();

    // Store in Supabase
    const { error } = await supabase
      .from('accounts')
      .insert({ account_id, pairing_code, api_key, email, created_at });

    if (error) {
      console.error('Supabase insert error:', error.message);
      return res.status(500).json({ error: 'Registration failed' });
    }

    // Audit trail in Vercel function logs
    console.log('ACCOUNT_CREATED', JSON.stringify({
      account_id,
      pairing_code,
      email,
      created_at,
    }));

    res.json({ account_id, pairing_code, api_key });
  } catch (err) {
    console.error('Registration error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
};
