const crypto = require('crypto');
const supabase = require('../_lib/supabase');
const { enforceRateLimit } = require('../_lib/rate-limit');
const { sendEmail } = require('../_lib/email');
const { createLicense } = require('../_lib/license');
const { alert } = require('../_lib/alerts');

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
  res.setHeader('Access-Control-Allow-Origin', 'https://leassh.com');
  res.setHeader('Cache-Control', 'no-store');
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

    // Free is the entry tier: 2 nodes, local dashboard + HA, one ha token.
    // It is issued at registration and validated through the online license
    // path with the server's 72-hour cache — no offline token at launch.
    const license = createLicense(email, 'free', 0);
    if (license.error) {
      console.error('Free license creation failed:', license.error);
      return res.status(500).json({ error: 'Registration failed' });
    }

    const licenseRow = {
      license_key: license.key,
      stripe_session_id: null,
      tier: 'free',
      features: license.features,
      email,
      max_nodes: license.max_nodes,
      expires_at: null,
      created_at,
    };
    let { error: licenseError } = await supabase.from('licenses').insert({
      ...licenseRow,
      billing: 'free',
    });
    // Production schema may predate the billing/lifecycle migration. Retry
    // with the columns every Leassh licenses table has had since launch.
    if (licenseError && /column .* does not exist|schema cache|Could not find the '.*' column/i.test(licenseError.message || '')) {
      ({ error: licenseError } = await supabase.from('licenses').insert(licenseRow));
    }

    if (licenseError) {
      console.error('Supabase free license insert error:', licenseError.message);
      await alert('license_issuance_failure', { stage: 'free_registration', error: licenseError.message });
      return res.status(500).json({ error: 'Registration failed' });
    }

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
      plan_id: 'free',
      license_key: license.key,
    }));

    // Send welcome email with the pairing code and the Free license.
    // Fire-and-forget — don't block the response.
    sendEmail({
      to: email,
      subject: 'Your Leassh Free license and pairing code',
      text: [
        'Welcome to Leassh!',
        '',
        'Your Leassh Free license key is:',
        license.key,
        '',
        'Your pairing code is: ' + pairing_code,
        '',
        'Free includes 2 computers, the local dashboard, the Home Assistant integration, and one ha API token.',
        '',
        'Home Assistant setup:',
        '  server_url: http://<your-server>:8790',
        '  api_token: ' + api_key,
        '',
        'Use the pairing code in the Leassh agent installer to link your device to your account.',
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
  <h1 style="font-size:24px;margin-bottom:8px">Welcome to Leassh Free</h1>
  <p>Your Free plan includes <strong>2 computers</strong>, the local dashboard and the Home Assistant integration.</p>
  <p>Your license key:</p>
  <p style="font-size:18px;font-weight:700;letter-spacing:2px;font-family:monospace;background:#f5f5f5;padding:16px 24px;border-radius:8px;display:inline-block">${license.key}</p>
  <p>Your pairing code:</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:6px;font-family:monospace;background:#f5f5f5;padding:16px 24px;border-radius:8px;display:inline-block">${pairing_code}</p>
  <p>Home Assistant uses the <code>ha</code> API token from your setup page:</p>
  <pre style="background:#f5f5f5;padding:12px 16px;border-radius:6px;font-size:14px">server_url: http://&lt;your-server&gt;:8790
api_token: ${api_key}</pre>
  <p>Enter the pairing code in the Leassh agent installer to link your device.</p>
  <p style="color:#666;font-size:14px">If you did not create this account, you can safely ignore this email.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#999;font-size:12px">Leassh — <a href="https://leassh.com" style="color:#999">leassh.com</a></p>
</body>
</html>`,
    }).catch(() => {}); // already handled inside sendEmail, but belt-and-suspenders

    res.json({
      account_id,
      pairing_code,
      api_key,
      license_key: license.key,
      plan_id: 'free',
      plan_name: 'Free',
      tier: 'free',
      max_nodes: license.max_nodes,
      features: license.features,
      expires_at: null,
    });
  } catch (err) {
    console.error('Registration error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
};
