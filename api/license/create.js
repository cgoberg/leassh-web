// Vercel serverless function: POST /api/license/create (admin mint/revoke)
//
// Auth: Bearer LEASSH_ADMIN_SECRET. Every action is written to license_events.
// Actions:
//   { action: "mint", email, tier, duration_days? }
//   { action: "revoke", license_key, reason? }
const supabase = require("../_lib/supabase");
const { createLicense, setCorsHeaders } = require("../_lib/license");
const { alert } = require("../_lib/alerts");

async function audit(licenseKey, action, detail) {
  const { error } = await supabase.from("license_events").insert({
    license_key: licenseKey,
    action,
    detail,
    created_at: new Date().toISOString(),
  });
  if (error && error.code !== "42P01") {
    console.error("license_events insert failed:", error.message);
  }
}

module.exports = async (req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const adminSecret = process.env.LEASSH_ADMIN_SECRET;
  if (!adminSecret) {
    return res.status(500).json({ error: "Admin endpoint not configured" });
  }

  const authHeader = req.headers["authorization"] || "";
  if (authHeader !== `Bearer ${adminSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const body = req.body || {};
    const action = (body.action || "mint").toLowerCase();

    if (action === "revoke") {
      if (!body.license_key) {
        return res.status(400).json({ error: "Missing license_key" });
      }
      const now = new Date().toISOString();
      let { data, error } = await supabase
        .from("licenses")
        .update({ status: "revoked", expires_at: now, updated_at: now })
        .eq("license_key", body.license_key)
        .select("*")
        .maybeSingle();
      if (error && /column .* does not exist|schema cache|Could not find the '.*' column/i.test(error.message || "")) {
        ({ data, error } = await supabase
          .from("licenses")
          .update({ expires_at: now })
          .eq("license_key", body.license_key)
          .select("*")
          .maybeSingle());
      }
      if (error) {
        return res.status(500).json({ error: error.message });
      }
      if (!data) {
        return res.status(404).json({ error: "License not found" });
      }
      await audit(body.license_key, "admin_revoked", {
        reason: body.reason || null,
      });
      return res.status(200).json({ revoked: true, license: data });
    }

    if (action !== "mint") {
      return res.status(400).json({ error: "Unknown action; use mint or revoke" });
    }

    const { email, tier, duration_days } = body;
    if (!email || !tier) {
      return res.status(400).json({ error: "Missing email or tier" });
    }

    const license = createLicense(email, tier, duration_days);
    if (license.error) {
      return res.status(400).json({ error: license.error });
    }

    const now = new Date().toISOString();
    const row = {
      license_key: license.key,
      stripe_session_id: null,
      tier: license.tier,
      plan_id: license.tier,
      features: license.features,
      email,
      max_nodes: license.max_nodes,
      billing: "admin",
      status: "active",
      expires_at: license.expires_at,
      created_at: now,
      updated_at: now,
    };
    let { data, error } = await supabase.from("licenses").insert(row).select().single();
    if (error && /column .* does not exist|schema cache|Could not find the '.*' column/i.test(error.message || "")) {
      const legacy = {
        license_key: row.license_key,
        stripe_session_id: null,
        tier: row.tier,
        features: row.features,
        email: row.email,
        max_nodes: row.max_nodes,
        billing: row.billing,
        expires_at: row.expires_at,
        created_at: row.created_at,
      };
      ({ data, error } = await supabase.from("licenses").insert(legacy).select().single());
    }

    if (error) {
      await alert("license_issuance_failure", { stage: "admin_mint", error: error.message });
      return res.status(500).json({ error: "Failed to persist license: " + error.message });
    }

    await audit(license.key, "admin_minted", {
      tier: license.tier,
      legacy_tier: license.legacy_tier,
      duration_days: duration_days || null,
    });

    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
