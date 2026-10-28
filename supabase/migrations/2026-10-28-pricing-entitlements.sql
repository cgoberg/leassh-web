-- Leassh pricing / entitlement / HA Free migration — 2026-10-28
-- Run AFTER taking a backup. Safe to re-run (IF NOT EXISTS / guarded updates).
-- Project: lnciqwlrojbburfxrzcx (never the eu-north-1 project).

begin;

-- ---------------------------------------------------------------------------
-- 1. License lifecycle columns
-- ---------------------------------------------------------------------------
alter table public.licenses add column if not exists plan_id text;
alter table public.licenses add column if not exists stripe_customer_id text;
alter table public.licenses add column if not exists stripe_subscription_id text;
alter table public.licenses add column if not exists status text default 'active';
alter table public.licenses add column if not exists current_period_end timestamptz;
alter table public.licenses add column if not exists cancel_at_period_end boolean default false;
alter table public.licenses add column if not exists grace_until timestamptz;
alter table public.licenses add column if not exists updated_at timestamptz default now();

update public.licenses set plan_id = tier where plan_id is null;
update public.licenses set status = 'active' where status is null;

-- Node limits as they exist today. Legacy Essential/Starter map to Family.
update public.licenses
   set plan_id = 'family', tier = 'family', max_nodes = 10
 where tier in ('essential', 'starter');

-- ---------------------------------------------------------------------------
-- 2. Idempotency and audit
-- ---------------------------------------------------------------------------
create table if not exists public.stripe_events (
  event_id text primary key,
  type text not null,
  created_at timestamptz not null default now(),
  payload jsonb
);

create table if not exists public.license_events (
  id bigserial primary key,
  license_key text not null,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists license_events_key_idx on public.license_events (license_key, created_at desc);

create table if not exists public.funnel_events (
  id bigserial primary key,
  event text not null,
  path text,
  props jsonb,
  created_at timestamptz not null default now()
);
create index if not exists funnel_events_event_idx on public.funnel_events (event, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Lookup indexes
-- ---------------------------------------------------------------------------
create index if not exists licenses_key_idx on public.licenses (license_key);
create index if not exists licenses_email_idx on public.licenses (email, created_at desc);
create index if not exists licenses_subscription_idx on public.licenses (stripe_subscription_id);
create index if not exists licenses_customer_idx on public.licenses (stripe_customer_id);
create index if not exists accounts_pairing_idx on public.accounts (pairing_code);

commit;
