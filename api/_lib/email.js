const https = require('https');

/**
 * Send an email via SendGrid's v3 mail/send API.
 * Requires SENDGRID_API_KEY environment variable.
 *
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} opts.subject
 * @param {string} opts.text - Plain-text body
 * @param {string} [opts.html] - HTML body (optional)
 * @param {string} [opts.from] - Sender address (defaults to no-reply@leassh.com)
 */
async function sendEmail({ to, subject, text, html, from = 'no-reply@leassh.com' }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    console.error('email: SENDGRID_API_KEY not set — skipping send');
    return;
  }

  const payload = JSON.stringify({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: from, name: 'Leassh' },
    subject,
    content: [
      { type: 'text/plain', value: text },
      ...(html ? [{ type: 'text/html', value: html }] : []),
    ],
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.sendgrid.com',
        path: '/v3/mail/send',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`email: sent "${subject}" to ${to}`);
          resolve();
        } else {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString();
            console.error(`email: SendGrid error ${res.statusCode}: ${body}`);
            // Resolve (don't reject) — a failed email must not break the API response
            resolve();
          });
        }
      }
    );
    req.on('error', (err) => {
      console.error('email: request error:', err.message);
      resolve(); // Same — don't surface email errors to callers
    });
    req.write(payload);
    req.end();
  });
}

module.exports = { sendEmail };
