# Security Policy

[中文](SECURITY.zh-CN.md) | [English](SECURITY.md)

## Default Security Boundary

The default boundary for this repository is:

- single-user
- self-hosted
- localhost-first
- nginx in front of the app
- desktop approval for every first-time device
- hardened mode left enabled by default

If you change that into public exposure, multi-user sharing, or approval-free login, you are outside the default security boundary.

## Supported Access Modes

- `localhost`
  Default mode. The app stays bound to `127.0.0.1`.
- `tailnet-private`
  Allowed remote mode. Tailscale Serve publishes a tailnet-only HTTPS route to local nginx. It must not call Funnel.
- `public-funnel`
  Dangerous mode. Tailscale Funnel publishes a public internet HTTPS route to local nginx. It must be enabled explicitly and must never be the default.

Legacy direct bindings are outside the default boundary and are kept only for migration detection.

## Boundary Changes Must Be Explicit

Boundary changes should be persisted in `.runtime/mode-config.json`.

Use `scripts/install-mobile-codex.ps1` as the normal boundary-changing entrypoint so that:

- mode selection is explicit
- public-funnel confirmation is explicit
- persistence intent is explicit
- browser Origin allowlists are explicit
- legacy direct state can be blocked instead of silently preserved

Device approval polling should stay on the cookie-backed `/api/auth/device-approval` path. Request tokens should not be exposed in URLs, default JSON, or screenshots.

Web access should stay behind explicit allowlists:

- the app should normally be reached through the local nginx proxy path
- browser Origins should come from `.runtime/mode-config.json` and reviewed `MOBILE_CODEX_ALLOWED_ORIGINS` overrides
- legacy direct bindings require explicit `MOBILE_CODEX_ALLOW_LEGACY_DIRECT=true` and are kept only for reviewed migration cases

Read-only inspection and support export should go through scripts that are redacted by default:

- `scripts/status-mobile-codex.ps1`
- `scripts/doctor-mobile-codex.ps1`
- `scripts/export-mobile-codex-support-bundle.ps1`
- `scripts/export-mobile-codex-audit.ps1` (compatibility wrapper, still redacted by default)

## Prohibited Defaults

The following must not become defaults in docs, scripts, or shipped config:

- exposing the Node app directly to the internet
- enabling `public-funnel` without explicit confirmation
- treating `tailnet-private` as if it were Funnel or a direct tailnet IP bind
- approval-free login for new devices
- query-token style approval polling or WebSocket auth
- publishing tokens, secrets, diagnostics evidence, or approval traces by default

## Public-Safe Output Rules

User-facing output, screenshots, support bundles, issue attachments, and example JSON should not include real:

- request tokens
- approval traces
- Windows usernames
- absolute local paths
- private hostnames
- private IPs
- device IDs

Use placeholders instead.

## Private-Local-Only Artifacts

Never commit or publish:

- auth databases
- JWT secrets
- certificates, private keys, or local TLS material
- runtime logs and diagnostics exports
- session JSONL files and approval evidence
- maintainer-only notes or one-off release materials
- sibling private projects and other parent-workspace assets
- binaries built from your private environment

See [docs/PRIVATE_LOCAL_ONLY.md](docs/PRIVATE_LOCAL_ONLY.md).

## Release Checks

Before a public push, review:

- `scripts/check-open-source-tree.ps1`
- `.github/workflows/open-source-gate.yml`
- `docs/OPEN_SOURCE_RELEASE_CHECKLIST.md`

Run those checks against a sanitized staging copy instead of treating a live private working tree as publish-ready.
