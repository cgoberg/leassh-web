const { sendEmail } = require('../_lib/email');
const { enforceRateLimit } = require('../_lib/rate-limit');

const FEEDBACK_EMAIL = 'hello@leassh.com';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = async (req, res) => {
  // Open CORS — feedback is sent from the local plugin dashboard, not from leassh.com
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rateLimitError = enforceRateLimit(req, res, 'account');
  if (rateLimitError) return rateLimitError;

  const { name, email, message, context } = req.body || {};

  if (!name || typeof name !== 'string' || name.trim().length < 1) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Valid email address is required' });
  }
  if (!message || typeof message !== 'string' || message.trim().length < 5) {
    return res.status(400).json({ error: 'Message must be at least 5 characters' });
  }

  const safeName = name.trim().slice(0, 100);
  const safeEmail = email.trim().slice(0, 254);
  const safeMessage = message.trim().slice(0, 5000);
  const safeContext = (typeof context === 'string' ? context.trim().slice(0, 200) : '') || 'family dashboard';

  const text = `New in-app feedback from ${safeContext}\n\nFrom: ${safeName} <${safeEmail}>\n\n---\n\n${safeMessage}\n\n---\nReply directly to this email to respond to ${safeName}.`;
  const html = `<p><strong>New in-app feedback</strong> <span style="color:#888;font-size:13px">via ${escapeHtml(safeContext)}</span></p>
<p><strong>From:</strong> ${escapeHtml(safeName)} &lt;${escapeHtml(safeEmail)}&gt;</p>
<hr>
<p style="white-space:pre-wrap">${escapeHtml(safeMessage)}</p>
<hr>
<p><em>Reply directly to this email to respond to ${escapeHtml(safeName)}.</em></p>`;

  try {
    await sendEmail({
      to: FEEDBACK_EMAIL,
      subject: `Feedback: ${safeName}`,
      text,
      html,
      from: 'no-reply@leassh.com',
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('feedback/submit: unexpected error:', err);
    return res.status(500).json({ error: 'Failed to send feedback' });
  }
};
