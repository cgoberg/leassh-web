---
id: LEA-FRONTEND-PUBLIC-SITE-TRUTH-GATE-20260815
title: 'Frontend: align leassh-web homepage and install copy with verified alpha platforms'
project: leassh
repository: leassh-web
bet: leassh
owner: venture-builder
labels:
- frontend
- customer-journey
- trust
- customer-harm
status: done
priority: high
created: '2026-08-15'
depends_on: []
source: 2026-08-15 live leassh.com still overclaims macOS; previous truth-gate targeted
  leassh-core web/site, not cgoberg/leassh-web
consequence: blocked_user_path
base_ref: origin/main
outcome: leassh-web index.html and install.html no longer claim current macOS support
  or a no-visible-app install; these files are the Vercel source for leassh.com
work_class: PRODUCT
outcome_class: PRODUCT_CHANGE_VERIFIED
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
  - deploy
  - spend
  - rotate-credentials
  - reactivate-supabase
  - touch-leassh-core
  - touch-leassh-web-dirty-root
  - merge-to-main
  max_spend_sek: 0
acceptance_probes:
- id: homepage-source-no-macos-current
  type: command
  argv:
  - python3
  - -c
  - 'from pathlib import Path

    text = Path(''index.html'').read_text(encoding=''utf-8'')

    assert ''Works on Windows, Mac, and Linux'' not in text

    assert ''Windows, macOS, Linux'' not in text

    assert ''Works on Windows, macOS, and Linux'' not in text

    '
  cwd: repo-root
  timeout_seconds: 30
  network_policy: none
- id: install-source-no-macos-installer
  type: command
  argv:
  - python3
  - -c
  - 'from pathlib import Path

    text = Path(''install.html'').read_text(encoding=''utf-8'')

    assert ''Install on macOS (Apple Silicon)'' not in text

    assert ''id="cmd-macos"'' not in text

    '
  cwd: repo-root
  timeout_seconds: 30
  network_policy: none
- id: install-source-no-invisible-app
  type: command
  argv:
  - python3
  - -c
  - 'from pathlib import Path

    text = Path(''install.html'').read_text(encoding=''utf-8'')

    assert ''no visible app'' not in text

    '
  cwd: repo-root
  timeout_seconds: 30
  network_policy: none
acceptance_coverage:
  ? Homepage source no longer claims current macOS support with 'Works on Windows,
    Mac, and Linux' or schema.org operatingSystem 'Windows, macOS, Linux'.
  : - homepage-source-no-macos-current
  Homepage source no longer says 'Works on Windows, macOS, and Linux' as current platform support.:
  - homepage-source-no-macos-current
  ? 'Install page source does not present macOS as an available install path: no ''Install
    on macOS (Apple Silicon)'' heading and no id="cmd-macos" curl installer.'
  : - install-source-no-macos-installer
  Install page source does not say 'no visible app'.:
  - install-source-no-invisible-app
evidence_required:
- artifact_commit
- probe_results
- builder_result
clarification_budget: 1
kill_condition: Copy cannot be made truthful without inventing a macOS binary or a
  hosted dashboard.
rollback: Revert the isolated Builder branch. Do not discard dirty files in /opt/leassh-web
  or /opt/leassh.
executor_id: venture-builder
builder_run_id: vb-leassh-e68ad5da86dc4af7
task_contract_hash: cd1eb24e80bc53bb643cf794c0c008c5172d21da2fec6b72f24914031b56cec6
claim_receipt_hash: 8d680ad6c435d5fee524c2eebd5f1ffb48fb266ff2e230df5389969ba1cbe36b
claim_receipt: tasks/receipts/claims/VX-LEA-FRONTEND-PUBLIC-SITE-TRUTH-GATE-20260815-cd1eb24e80bc-464d5e78745f.claim.json
execution_contract: tasks/contracts/VX-LEA-FRONTEND-PUBLIC-SITE-TRUTH-GATE-20260815-cd1eb24e80bc-464d5e78745f.yaml
updated: '2026-08-16T19:56:01Z'
completed_at: '2026-08-16T19:56:01Z'
artifact_commit: 945d8979100dc422d6e9bbc081d2f94767758c72
verification_receipt: tasks/receipts/verifications/VX-LEA-FRONTEND-PUBLIC-SITE-TRUTH-GATE-20260815-cd1eb24e80bc-945d8979100d.verification.json
builder_result_receipt: tasks/receipts/results/vb-leassh-e68ad5da86dc4af7-fea2172c808a.result.json
---
## Acceptance Criteria
- [x] Homepage source no longer claims current macOS support with 'Works on Windows, Mac, and Linux' or schema.org operatingSystem 'Windows, macOS, Linux'.
- [x] Homepage source no longer says 'Works on Windows, macOS, and Linux' as current platform support.
- [x] Install page source does not present macOS as an available install path: no 'Install on macOS (Apple Silicon)' heading and no id="cmd-macos" curl installer.
- [x] Install page source does not say 'no visible app'.

## Context
Live `https://leassh.com` is served from `cgoberg/leassh-web` via Vercel (`/opt/leassh-web`), not `/opt/leassh/web/site`.
Verified 2026-08-15: homepage still says "Works on Windows, Mac, and Linux"; install still has an Apple Silicon installer and "no visible app".
macOS remains unavailable until `LEA-QA-MACOS-AGENT-BINARY-MISSING-20260810` is done.
Do not edit the dirty live checkout. Work only in the isolated Builder checkout.
A live-URL confirmation task is blocked until this artifact reaches `origin/main` and Vercel.

## Evidence
- verified artifact 945d8979100dc422d6e9bbc081d2f94767758c72; receipt tasks/receipts/verifications/VX-LEA-FRONTEND-PUBLIC-SITE-TRUTH-GATE-20260815-cd1eb24e80bc-945d8979100d.verification.json
