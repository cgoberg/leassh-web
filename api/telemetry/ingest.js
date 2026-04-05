// POST /api/telemetry/ingest
// Receives anonymous or verbose telemetry from agents/servers
// Stores in Vercel function logs for analysis

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

    // Log for our analysis (viewable in Vercel function logs)
    console.log('TELEMETRY:', JSON.stringify({
      ts: new Date().toISOString(),
      version: data.leassh_version,
      binary: data.binary_type,
      os: data.os,
      os_version: data.os_version,
      arch: data.arch,
      registry_version: data.registry_version,
      telemetry_level: data.telemetry_level,
      failure_count: (data.failures || []).length,
      success_count: (data.successes || []).length,
      missing_tools: data.missing_tools || [],
      failures: (data.failures || []).map(f => ({
        cmd: f.command_id,
        err: f.error_type,
        n: f.count,
        // Only present for verbose level
        ...(f.command_output_truncated ? { output: f.command_output_truncated } : {}),
        ...(f.os_locale ? { locale: f.os_locale } : {}),
      })),
    }));

    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ error: 'Internal error' });
  }
};
