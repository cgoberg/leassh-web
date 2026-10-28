-- Rollback for 2026-10-28 pricing/entitlement migration.
-- Drop only the new objects. Do not drop licenses/accounts (customer data).
-- Columns are left in place deliberately: dropping them would destroy data and
-- the deployed code tolerates them being present.

begin;
drop table if exists public.funnel_events;
drop table if exists public.license_events;
drop table if exists public.stripe_events;
commit;

-- To restore license rows changed by the forward migration, use the backup:
--   pg_dump "$SUPABASE_DB_URL" --data-only --table=public.licenses > licenses.backup.sql
--   psql "$SUPABASE_DB_URL" < licenses.backup.sql
