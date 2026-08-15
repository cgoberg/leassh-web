---
id: LEA-FRONTEND-PUBLIC-SITE-LIVE-URL-20260815
title: 'Frontend: verify live leassh.com homepage and install match the source-truth
  gate'
project: leassh
repository: leassh-web
bet: leassh
owner: unassigned
labels:
- frontend
- customer-journey
- trust
- customer-harm
status: blocked
priority: high
created: '2026-08-15'
depends_on:
- LEA-FRONTEND-PUBLIC-SITE-TRUTH-GATE-20260815
blocked_reason: waiting for the leassh-web source-truth artifact to reach origin/main
  and Vercel; branch-only Builder pushes do not update leassh.com
source: 2026-08-15 live fetch of https://leassh.com/ and /install still contains the
  macOS and no-visible-app overclaims
consequence: blocked_user_path
base_ref: origin/main
outcome: https://leassh.com/ and https://leassh.com/install no longer overclaim macOS
  or a no-visible-app install
work_class: PRODUCT
outcome_class: DEPLOYED
verification_required: true
verifier: venture-probe-runner
authority:
  allowed_repos:
  - leassh-web
  allowed_actions:
  - edit
  - test
  - commit
  - push
  forbidden_actions:
  - spend
  - rotate-credentials
  - reactivate-supabase
  - touch-leassh-core
  - touch-leassh-web-dirty-root
  max_spend_sek: 0
acceptance_probes:
- id: homepage-live
  type: http_get
  url: https://leassh.com/
  expected_status: 200
  forbids:
  - Works on Windows, Mac, and Linux
  - Windows, macOS, Linux
  - Works on Windows, macOS, and Linux
  timeout_seconds: 30
- id: install-live
  type: http_get
  url: https://leassh.com/install
  expected_status: 200
  forbids:
  - Install on macOS (Apple Silicon)
  - id="cmd-macos"
  - no visible app
  timeout_seconds: 30
acceptance_coverage:
  ? Live https://leassh.com/ no longer claims current macOS support with 'Works on
    Windows, Mac, and Linux' or schema.org operatingSystem 'Windows, macOS, Linux'.
  : - homepage-live
  Live https://leassh.com/install does not present macOS as an available install path and does not say 'no visible app'.:
  - install-live
evidence_required:
- artifact_commit
- probe_results
- builder_result
clarification_budget: 0
kill_condition: Live URLs cannot be made truthful without a Vercel deploy of the source-truth
  artifact.
rollback: Do not revert unrelated Vercel production history. Leave dirty /opt/leassh-web
  files alone.
---
## Acceptance Criteria
- [ ] Live https://leassh.com/ no longer claims current macOS support with 'Works on Windows, Mac, and Linux' or schema.org operatingSystem 'Windows, macOS, Linux'.
- [ ] Live https://leassh.com/install does not present macOS as an available install path and does not say 'no visible app'.

## Context
Blocked until the source-truth artifact is on `origin/main` and Vercel has deployed it.
Do not close this from an isolated branch. Customer-visible truth is the live HTML.

## Evidence
- Pending
