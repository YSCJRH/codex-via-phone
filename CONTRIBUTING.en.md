# Contributing

[中文](CONTRIBUTING.md) | [English](CONTRIBUTING.en.md)

Thanks for helping improve this project. The repository is intentionally kept narrow: safe phone control for local Codex sessions, single-user self-hosting, and a clear security boundary.

## Read first

Before contributing, review:

- `README.en.md`
- `docs/DEPLOYMENT.md`
- `SECURITY.md`
- `docs/PRIVATE_LOCAL_ONLY.md`

## In-scope contributions

- bug fixes for phone viewing, session recovery, or message continuation
- trusted-device approval and mobile sync improvements
- deployment and self-check script improvements
- documentation improvements for safe self-hosted use

## Changes that are discouraged by default

- mixing unrelated tools from the broader private workspace into this repository
- making public exposure the default path
- loosening auth, trusted-device approval, or hardened-mode assumptions without a review
- committing upstream snapshots, runtime data, logs, databases, binaries, or personal deployment artifacts

## Privacy-safe issue and PR guidance

When sharing reproduction details:

- replace personal hostnames with placeholders
- replace private IPs and local absolute paths with placeholders
- do not paste approval tokens, device IDs, auth cookies, or session exports
- redact screenshots if they contain real hostnames, machine names, or runtime evidence

## Minimum checks before submitting

Please do at least the following:

1. confirm no real secrets, logs, databases, private domains, or personal paths are included
2. run `scripts/check-open-source-tree.ps1`
3. if you changed the override layer, run `scripts/smoke-test-override-flow.ps1`
4. if you changed the desktop tool, run `python -m py_compile mobile_codex_control.py`
5. if you changed docs, keep Chinese and English entry points aligned

## Pull request guidance

- keep each PR focused on one kind of change
- use clear titles such as:
  - `fix: repair mobile session resync`
  - `docs: clarify first-time trusted-device approval`
- if your change affects the trust boundary, explain the risk clearly in the PR

## Security issues

If you found an auth bypass, trusted-device bypass, secret leak, or similar issue, do not post the full details publicly first. Follow the guidance in `SECURITY.md`.
