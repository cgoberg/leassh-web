const crypto = require('crypto');
const supabase = require('../_lib/supabase');
const { enforceRateLimit } = require('../_lib/rate-limit');
const { sendEmail } = require('../_lib/email');

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
      .insert({ pairing_code, api_key, email });

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

    // Send welcome email with pairing code (fire-and-forget — don't block the response)
    sendEmail({
      to: email,
      subject: 'Your Leassh pairing code',
      text: [
        'Welcome to Leassh!',
        '',
        'Your pairing code is: ' + pairing_code,
        '',
        'Use this code in the Leassh agent installer to link your device to your account.',
        'The installer will prompt you for it during setup.',
        '',
        'If you did not create this account, you can safely ignore this email.',
        '',
        '— The Leassh team',
        'https://leassh.com',
      ].join('\n'),
      html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 16px;color:#1a1a1a">
  <h1 style="font-size:24px;margin-bottom:8px">Welcome to Leassh</h1>
  <p>Your pairing code is:</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:6px;font-family:monospace;background:#f5f5f5;padding:16px 24px;border-radius:8px;display:inline-block">${pairing_code}</p>
  <p>Enter this code in the Leassh agent installer to link your device to your account.</p>
  <p style="color:#666;font-size:14px">If you did not create this account, you can safely ignore this email.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#999;font-size:12px">Leassh — <a href="https://leassh.com" style="color:#999">leassh.com</a></p>
</body>
</html>`,
    }).catch(() => {}); // already handled inside sendEmail, but belt-and-suspenders

    res.json({ account_id, pairing_code, api_key });
  } catch (err) {
    console.error('Registration error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
};
