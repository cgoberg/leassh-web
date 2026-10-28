// POST /api/telemetry/ingest
// Receives anonymous or verbose telemetry from agents/servers
// Stores in Supabase + Vercel function logs

const supabase = require('../_lib/supabase');
const { enforceRateLimit } = require('../_lib/rate-limit');

const FUNNEL_EVENTS = new Set([
  'pricing_view', 'plan_cta_click', 'checkout_start', 'trial_start',
  'checkout_complete', 'platforms_view', 'companion_click', 'account_view',
]);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const data = req.body || {};

    // First-party funnel events share this function to stay within the
    // Vercel Hobby 12-function limit. No PII, 204 ack for sendBeacon.
    if (data.kind === 'funnel') {
      const rateLimitError = enforceRateLimit(req, res, 'events');
      if (rateLimitError) return rateLimitError;
      if (!FUNNEL_EVENTS.has(String(data.event || ''))) {
        return res.status(400).json({ error: 'Unknown event' });
      }
      const props = data.props && typeof data.props === 'object' ? data.props : {};
      for (const key of ['email', 'license_key', 'pairing_code', 'api_key']) delete props[key];
      const { error } = await supabase.from('funnel_events').insert({
        event: data.event,
        path: String(data.path || '').slice(0, 200),
        props,
        created_at: new Date().toISOString(),
      });
      if (error && error.code !== '42P01') console.error('funnel_events insert failed:', error.message);
      return res.status(204).end();
    }

    // Validate required fields
    if (!data.leassh_version || !data.os || !data.binary_type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const row = {
      leassh_version: data.leassh_version,
      binary_type: data.binary_type,
      os: data.os,
      os_version: data.os_version || null,
      arch: data.arch || null,
      registry_version: data.registry_version || null,
      telemetry_level: data.telemetry_level || null,
      failure_count: (data.failures || []).length,
      success_count: (data.successes || []).length,
      missing_tools: data.missing_tools || [],
      failures: (data.failures || []).map(f => ({
        cmd: f.command_id,
        err: f.error_type,
        n: f.count,
        ...(f.command_output_truncated ? { output: f.command_output_truncated } : {}),
        ...(f.os_locale ? { locale: f.os_locale } : {}),
      })),
      received_at: new Date().toISOString(),
    };

    // Store in Supabase
    const { error } = await supabase
      .from('telemetry')
      .insert(row);

    if (error) {
      console.error('Supabase telemetry insert error:', error.message);
      // Don't fail — still log to Vercel
    }

    // Keep console.log for Vercel logs
    console.log('TELEMETRY:', JSON.stringify(row));

    res.json({ status: 'ok' });
  } catch (e) {
    console.error('Telemetry error:', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
};
