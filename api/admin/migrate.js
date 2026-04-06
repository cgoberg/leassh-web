// ONE-TIME migration endpoint: creates missing Supabase tables.
// Protected by MIGRATION_SECRET env var. Remove this file after use.
//
// Usage: curl -X POST https://leassh.com/api/admin/migrate \
//   -H 'Content-Type: application/json' \
//   -d '{"secret":"<MIGRATION_SECRET>"}'

const supabase = require('../_lib/supabase');

const ACCOUNTS_DDL = `
CREATE TABLE IF NOT EXISTS public.accounts (
  account_id  UUID        PRIMARY KEY,
  email       TEXT        NOT NULL,
  pairing_code TEXT       NOT NULL UNIQUE,
  api_key     TEXT        NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_accounts_pairing_code ON public.accounts (pairing_code);
CREATE INDEX IF NOT EXISTS idx_accounts_email        ON public.accounts (email);
`;

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.MIGRATION_SECRET;
  if (!secret) return res.status(503).json({ error: 'MIGRATION_SECRET not configured' });

  const { secret: provided } = req.body || {};
  if (!provided || provided !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { error } = await supabase.rpc('run_sql', { query: ACCOUNTS_DDL });
    if (error) {
      // rpc may not exist — fall through to raw approach
      console.error('rpc run_sql error:', error.message);
      return res.status(500).json({ error: error.message, hint: 'Run the DDL manually in the Supabase SQL editor.' });
    }
    return res.json({ ok: true, message: 'accounts table created (or already exists)' });
  } catch (err) {
    console.error('migrate error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
