# Leassh Brand Style Guide

## Brand Name Casing

**Use `Leassh` everywhere in customer-facing prose, UI, and metadata.**

This is the canonical brand spelling: capital L, rest lowercase.

### Correct
- "Leassh — Local-first family monitoring"
- "Set up Leassh"
- "Leassh Pricing"
- "Leassh watches what your children do"
- "Powered by Leassh"
- `JSON-LD "name": "Leassh"`
- `<title>Leassh — ...</title>`
- `<meta property="og:title" content="Leassh ...">`

### Technical Exceptions (keep lowercase)
- **URLs**: `leassh.com`, `/setup`, `/api/license/validate`
- **Package/binary names**: `leassh`, `leassh-agent`, `leassh-server`
- **Command-line**: `leassh fleet.yaml`, `docker run leassh/leassh`
- **Environment variables**: `LEASSH_CODE`, `LEASSH_TOKEN`, `LEASSH_HOME`
- **Code identifiers**: `leassh_config`, `leassh_agent_version`
- **Email addresses**: `hello@leassh.com`, `support@leassh.com`
- **CSS class names**: `.leassh`, `.leassh-brand`
- **File/asset names**: `leassh-logo.png`, `leassh-logo.svg`

### Never Use
- ~~"leassh"~~ in prose, headings, title tags, or metadata (lowercase L)
- ~~"LEASSH"~~ in prose or UI (all-caps, except env vars)
- ~~"LeASSH"~~ or ~~"leASSH"~~ (mixed-case variants)

### Decision Record
- **Date**: 2026-07-16
- **Source**: CEO decision from LEA-CRITIC-BRAND-CASING-INCONSISTENT
- **Rationale**: Capitalized **Leassh** in all customer-facing surfaces builds trust, improves SEO entity recognition, and supports AEO citations. Current discovery surfaces already lean capitalized.
