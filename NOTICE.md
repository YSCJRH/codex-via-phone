# Notice

[中文](NOTICE.zh-CN.md) | [English](NOTICE.md)

This repository is a focused helper layer, not a full replacement for upstream.

Its public scope is intentionally narrow:

- safe phone access to local Codex sessions
- trusted-device approval for first-time mobile logins
- deployment and hardening guidance for a single-user self-hosted setup

This repository is based on upstream `siteboon/claudecodeui`.

- upstream project: `siteboon/claudecodeui`
- tested upstream tag: `v1.25.2`
- upstream license: `GPL-3.0`

The intended flow is:

1. prepare the upstream checkout locally
2. apply this repository's override layer
3. follow the deployment and security guides in this repository

This repository should not be published together with private-local artifacts such as:

- personal databases
- runtime logs
- diagnostics bundles
- certificates or private keys
- packaged binaries
- full upstream source snapshots outside the minimum override set
- real hostnames, private IPs, approval traces, or device evidence

If you publish a fork, keep upstream attribution and license information intact, and sanitize any local deployment evidence before pushing.
