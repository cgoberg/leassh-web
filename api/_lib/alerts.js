// Structured alerting for failures that must not be silent.
//
// Vercel captures console.error, and if LEASSH_ALERT_EMAIL + SendGrid are
// configured the same event is emailed. Keep this module dependency-light so
// a failing alert path can never take down checkout or the webhook.
const { sendEmail } = require("./email");

async function alert(kind, detail = {}) {
  const payload = {
    kind,
    at: new Date().toISOString(),
    ...detail,
  };
  console.error("ALERT", JSON.stringify(payload));

  const to = process.env.LEASSH_ALERT_EMAIL;
  if (!to) return;
  try {
    await sendEmail({
      to,
      subject: `[Leassh alert] ${kind}`,
      text: JSON.stringify(payload, null, 2),
    });
  } catch (err) {
    console.error("alert email failed:", err.message);
  }
}

module.exports = { alert };
