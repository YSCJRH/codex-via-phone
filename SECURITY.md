# Security Policy

[中文](SECURITY.zh-CN.md) | [English](SECURITY.md)

## Who this is for

This file is mainly for:

- people who deploy this for their own long-term use
- people who plan to publish a fork safely

## Safe default model

The supported default model is:

- keep the app bound to `127.0.0.1`
- put a reverse proxy in front of the app
- prefer a private-network entrypoint
- require desktop approval for every first-time device
- keep hardened mode enabled unless you re-audit the trust boundary

This repository is designed for a single-user self-hosted workflow. If you turn it into public exposure, multi-user sharing, or approval-free login, you are outside the default security boundary.

## Not recommended

The following are intentionally outside the safe default model:

- exposing the Node app directly to the public internet
- loosening trusted-device approval without a security review
- publishing runtime data, diagnostics bundles, or approval traces
- shipping real secrets or private hostnames in docs, scripts, or config files

## Public-safe documentation rules

When publishing this repository or a fork, use placeholders instead of personal values.

Replace real values such as:

- private HTTPS entrypoints
- tailnet hostnames
- private IPs
- Windows usernames and local absolute paths
- device IDs, session IDs, approval tokens, and runtime screenshots

Prefer placeholders such as:

- `https://mobile-codex.example.com`
- `<PRIVATE_HTTPS_ENTRYPOINT>`
- `<TAILNET_IP>`
- `<PATH_TO_MOBILE_CODEX_HELPER>`

## Private-local-only artifacts

Never commit or publish:

- auth databases
- JWT secrets
- certificates, private keys, or local TLS material
- runtime logs and diagnostics exports
- session JSONL files and approval evidence
- maintainer-only release notes or one-off release materials
- sibling private projects and other parent-workspace assets
- packaged binaries built from your private environment

See [docs/PRIVATE_LOCAL_ONLY.md](docs/PRIVATE_LOCAL_ONLY.md).

## Release checks

Before a public push, review:

- `scripts/check-open-source-tree.ps1`
- `docs/OPEN_SOURCE_RELEASE_CHECKLIST.md`

If you are a maintainer, run those checks against a sanitized staging copy instead of treating a live private working tree as publish-ready.

If an older private build ever exposed query tokens, auth secrets, or device-bound material, rotate the real secrets before publishing.

## Reporting guidance

- For non-sensitive bugs, open a public GitHub issue.
- For security-sensitive findings, replace this section with your private reporting contact before publishing the repository broadly.
