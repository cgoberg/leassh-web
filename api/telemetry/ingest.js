// POST /api/telemetry/ingest
// Receives anonymous or verbose telemetry from agents/servers
// Stores in Supabase + Vercel function logs

const supabase = require('../_lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const data = req.body;

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
