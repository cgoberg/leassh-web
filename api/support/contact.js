const { sendEmail } = require('../_lib/email');
const { enforceRateLimit } = require('../_lib/rate-limit');

const SUPPORT_EMAIL = 'hello@leassh.com';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://leassh.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rateLimitError = enforceRateLimit(req, res, 'account');
  if (rateLimitError) return rateLimitError;

  const { name, email, message } = req.body || {};

  if (!name || typeof name !== 'string' || name.trim().length < 1) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Valid email address is required' });
  }
  if (!message || typeof message !== 'string' || message.trim().length < 10) {
    return res.status(400).json({ error: 'Message must be at least 10 characters' });
  }

  const safeName = name.trim().slice(0, 100);
  const safeEmail = email.trim().slice(0, 254);
  const safeMessage = message.trim().slice(0, 5000);

  const text = `New support message from leassh.com\n\nFrom: ${safeName} <${safeEmail}>\n\n---\n\n${safeMessage}\n\n---\nReply directly to this email to respond to ${safeName}.`;
  const html = `<p><strong>New support message from leassh.com</strong></p>
<p><strong>From:</strong> ${escapeHtml(safeName)} &lt;${escapeHtml(safeEmail)}&gt;</p>
<hr>
<p style="white-space:pre-wrap">${escapeHtml(safeMessage)}</p>
<hr>
<p><em>Reply directly to this email to respond to ${escapeHtml(safeName)}.</em></p>`;

  try {
    await sendEmail({
      to: SUPPORT_EMAIL,
      subject: `Support: ${safeName}`,
      text,
      html,
      from: 'no-reply@leassh.com',
    });

    // Also send a confirmation to the user
    await sendEmail({
      to: safeEmail,
      subject: "We received your message — Leassh Support",
      text: `Hi ${safeName},\n\nThanks for reaching out. We received your message and will get back to you within 1-2 business days.\n\nYour message:\n---\n${safeMessage}\n---\n\nBest,\nCarl at Leassh`,
      html: `<p>Hi ${escapeHtml(safeName)},</p>
<p>Thanks for reaching out. We received your message and will get back to you within 1-2 business days.</p>
<p><strong>Your message:</strong></p>
<blockquote style="border-left:3px solid #d4a24c;padding-left:12px;color:#666">${escapeHtml(safeMessage)}</blockquote>
<p>Best,<br>Carl at Leassh</p>`,
      from: 'no-reply@leassh.com',
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('support/contact: unexpected error:', err);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
