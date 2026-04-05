// Vercel serverless function: POST /api/license/validate
const { validateLicense, setCorsHeaders } = require("../_lib/license");

module.exports = async (req, res) => {
  setCorsHeaders(res);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { license_key, node_count } = req.body || {};
    const result = validateLicense(license_key, node_count);

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
