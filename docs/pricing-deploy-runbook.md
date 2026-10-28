# Pricing / entitlement / HA Free — deploy and rollback runbook

Date: 2026-10-28  
Repos: `cgoberg/leassh`, `cgoberg/leassh-web`, `cgoberg/leassh-integration` (local checkout `leassh-hacs`), `cgoberg/leassh-addon`

## Preconditions

- GitHub push is authorized and authenticated.
- Vercel deploys `leassh-web` from `origin/main`.
- Supabase project is `lnciqwlrojbburfxrzcx`. Never use `znnlqscftbuforhkmbxs`.
- Stripe test mode is used first for lifecycle checks; production webhook endpoint is `/api/checkout/webhook`.
- Required Vercel env: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SENDGRID_API_KEY`, `LEASSH_ADMIN_SECRET`, optional `LEASSH_ALERT_EMAIL`.
- HA/PVE access is already held: HA API `http://192.168.1.115` port 80, PVE `.59` pool `leassh-t3`.

## 1. Backup before migration

```bash
export SUPABASE_URL=...        # project URL
export SUPABASE_DB_URL=...     # Postgres connection string (session pooler)
pg_dump "$SUPABASE_DB_URL" --schema=public --format=custom \
  --file="backup-leassh-$(date +%Y%m%dT%H%M%S).dump"
```

Also export the two tables used by checkout/account:

```bash
psql "$SUPABASE_DB_URL" -c "\copy (select * from licenses) to 'licenses-backup.csv' csv header"
psql "$SUPABASE_DB_URL" -c "\copy (select * from accounts) to 'accounts-backup.csv' csv header"
```

## 2. Migrate

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/2026-10-28-pricing-entitlements.sql
```

The migration adds `plan_id`, Stripe lifecycle columns, `stripe_events`,
`license_events`, and `funnel_events`. It maps legacy `essential`/`starter`
rows to Family. It is guarded and safe to re-run.

## 3. Deploy order

1. Core server (tag/release only if the binary needs to ship): `cargo test`, `cargo build --release`, then the normal release pipeline. The server accepts old and new license shapes; ship it first.
2. Web: merge to `main`; Vercel builds. Verify `https://leassh.com/api/health` is unrelated, then smoke:
   - `GET /pricing` 200
   - `POST /api/account/register` with a test email returns `license_key`, `pairing_code`, `api_key`
   - `POST /api/license/validate` with that key and `node_count: 1` returns `valid: true`, `tier: "free"`, `max_nodes: 2`
   - `node_count: 3` returns `valid: false` / `node_limit`
3. Stripe: point the test webhook to the preview, then production. Send test events for `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`.
4. HA integration/add-on: bump versions, publish, update the add-on store. Verify on HA `.115` with the Free license.

## 4. Live verification checklist

- [ ] `/pricing` shows Free 2, Family 10/$9.99 annual, Pro 25/$19.99 annual, Unlimited contact, "Save 33%", HA row on every plan.
- [ ] `/platforms` shows Windows/macOS/Linux supported, Android/iOS/ChromeOS not supported.
- [ ] `/setup` issues a Free license + pairing code + one `ha` token.
- [ ] `POST /api/license/validate` accepts Free 2 nodes and rejects 3.
- [ ] HA add-on starts with the Free license, `/api/health` says `tier=free`, `max_nodes=2`, HA pairs.
- [ ] Third node is rejected with `NODE_LIMIT_REACHED`.
- [ ] Family/Pro trial checkout: annual and monthly, cancel, failed payment, refund.
- [ ] `/account` loads by pairing code; Manage billing opens Stripe portal.
- [ ] `https://leassh.com/sitemap.xml` and `/blog-sitemap.xml` are valid and contain `/platforms`.

## 5. Rollback

Fast rollback (website only): revert the merge commit on `leassh-web` and push. Vercel redeploys the previous build. This does not touch licenses already issued.

Database rollback: run `supabase/rollback/2026-10-28-pricing-entitlements.sql` (drops new event tables only). Restore `licenses` from the `pg_dump` backup if the legacy mapping must be undone.

Stripe rollback: keep the previous webhook endpoint version; the handler is idempotent by event ID, so replaying events is safe. If the new handler is broken, point the webhook back to the previous deployment and replay missed events from the Stripe dashboard.

HA rollback: reinstall the previous HACS version and add-on version; the add-on working directory `/config/leassh` is additive and can stay.

## 6. Notes / residual risks

- Subscription licenses use online validation so refunds and cancellations can revoke access. Offline `LSH1.` tokens cannot be revoked before expiry; keep expiry short for paid offline tokens.
- `stripe_events`/`license_events`/`funnel_events` are new tables. Until the migration runs, the code logs a warning and continues; idempotency is degraded, not broken.
- The account page authenticates with the pairing code. Treat it as a secret; rotate by creating a new account if leaked.
