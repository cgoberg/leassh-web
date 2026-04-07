const { sendEmail } = require('./_lib/email');
const { enforceRateLimit } = require('./_lib/rate-limit');

const CONTACT_EMAIL = 'hello@leassh.com';

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
  // Parse type from URL query parameter (?type=feedback or ?type=support)
  const messageType = req.query?.type || 'support';
  const isFeedback = messageType === 'feedback';

  // Set CORS headers based on message type
  if (isFeedback) {
    // Feedback is sent from the local plugin dashboard, not from leassh.com
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    // Support messages come from leassh.com
    res.setHeader('Access-Control-Allow-Origin', 'https://leassh.com');
  }
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

  // Different minimum message lengths for feedback vs support
  const minLength = isFeedback ? 5 : 10;
  if (!message || typeof message !== 'string' || message.trim().length < minLength) {
    return res.status(400).json({ error: `Message must be at least ${minLength} characters` });
  }

  const safeName = name.trim().slice(0, 100);
  const safeEmail = email.trim().slice(0, 254);
  const safeMessage = message.trim().slice(0, 5000);
  const safeContext = (typeof context === 'string' ? context.trim().slice(0, 200) : '') || (isFeedback ? 'family dashboard' : 'leassh.com');

  // Compose email content based on message type
  let subject, text, html;

  if (isFeedback) {
    subject = `Feedback: ${safeName}`;
    text = `New in-app feedback from ${safeContext}\n\nFrom: ${safeName} <${safeEmail}>\n\n---\n\n${safeMessage}\n\n---\nReply directly to this email to respond to ${safeName}.`;
    html = `<p><strong>New in-app feedback</strong> <span style="color:#888;font-size:13px">via ${escapeHtml(safeContext)}</span></p>
<p><strong>From:</strong> ${escapeHtml(safeName)} &lt;${escapeHtml(safeEmail)}&gt;</p>
<hr>
<p style="white-space:pre-wrap">${escapeHtml(safeMessage)}</p>
<hr>
<p><em>Reply directly to this email to respond to ${escapeHtml(safeName)}.</em></p>`;
  } else {
    subject = `Support: ${safeName}`;
    text = `New support message from leassh.com\n\nFrom: ${safeName} <${safeEmail}>\n\n---\n\n${safeMessage}\n\n---\nReply directly to this email to respond to ${safeName}.`;
    html = `<p><strong>New support message from leassh.com</strong></p>
<p><strong>From:</strong> ${escapeHtml(safeName)} &lt;${escapeHtml(safeEmail)}&gt;</p>
<hr>
<p style="white-space:pre-wrap">${escapeHtml(safeMessage)}</p>
<hr>
<p><em>Reply directly to this email to respond to ${escapeHtml(safeName)}.</em></p>`;
  }

  try {
    // Send the main email to support
    await sendEmail({
      to: CONTACT_EMAIL,
      subject,
      text,
      html,
      from: 'no-reply@leassh.com',
    });

    // Send confirmation email only for support messages (not feedback)
    if (!isFeedback) {
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
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(`contact (${messageType}): unexpected error:`, err);
    return res.status(500).json({ error: `Failed to send ${messageType === 'feedback' ? 'feedback' : 'message'}` });
  }
};