// Vercel serverless function: POST /api/license/create (admin)
const { createLicense, loadLicenses, setCorsHeaders } = require("../_lib/license");

module.exports = async (req, res) => {
  setCorsHeaders(res);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Admin auth check
  const adminSecret = process.env.LEASSH_ADMIN_SECRET;
  if (!adminSecret) {
    return res.status(500).json({ error: "Admin endpoint not configured" });
  }

  const authHeader = req.headers["authorization"] || "";
  if (authHeader !== `Bearer ${adminSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { email, tier, duration_days } = req.body || {};

    if (!email || !tier) {
      return res.status(400).json({ error: "Missing email or tier" });
    }

    const license = createLicense(email, tier, duration_days);

    if (license.error) {
      return res.status(400).json({ error: license.error });
    }

    // NOTE: In this MVP, the created license is returned but NOT persisted
    // to the LEASSH_LICENSES env var (Vercel env vars are immutable at runtime).
    // To persist: add the returned key to your LEASSH_LICENSES env var in Vercel dashboard,
    // or migrate to Vercel KV / an external database.
    return res.status(201).json({
      ...license,
      _note: "Add this license to your LEASSH_LICENSES env var to make it active.",
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
