# Open Source Release Checklist

[中文](OPEN_SOURCE_RELEASE_CHECKLIST.zh-CN.md) | [English](OPEN_SOURCE_RELEASE_CHECKLIST.md)

Use this checklist before the first public push or before tagging a release from a sanitized staging copy of the repository.

## Staging-Only Rule

- [ ] Confirm you are reviewing a freshly exported, sanitized staging copy rather than the live private working tree
- [ ] Confirm the release root is this repository only
- [ ] Confirm no sibling private projects from the larger working directory were copied into the release tree
- [ ] Confirm the repository narrative stays focused on phone access, approval, continuation, and sync for local Codex

## Blocked Directories And Files

- [ ] Remove `vendor/`, `node_modules/`, `dist/`, `build/`, `.runtime/`, `tmp/`, `__pycache__/`, `.npm-cache/`, `private-docs/`, `logs/`, `diagnostics/`, `screenshots/`, and `images/`
- [ ] Remove databases and sidecar files such as `*.db`, `*.db-wal`, `*.db-shm`, `*.sqlite`, and `*.sqlite3`
- [ ] Remove local env files such as `.env` and `.env.*`
- [ ] Remove logs, traces, and captures such as `*.log`, `*.jsonl`, `*.har`, and `*.pcap`
- [ ] Remove archives, binaries, certificates, and private keys
- [ ] Review [PRIVATE_LOCAL_ONLY.md](PRIVATE_LOCAL_ONLY.md) and confirm nothing from that list remains

## Images And Evidence

- [ ] Confirm no screenshots or runtime evidence from a personal environment remain in the tree
- [ ] Confirm image files are absent unless they are explicitly allowlisted public docs assets
- [ ] Current allowlisted public docs asset:
  - `docs/assets/mobile-codex-control-console.png`

## Sensitive Text Scan

- [ ] Confirm there are no real Windows user paths
- [ ] Confirm there are no real `*.ts.net` tailnet domains
- [ ] Confirm there are no real private IPs, request token values, session ID values, or approval evidence values
- [ ] Confirm examples use public-safe placeholders such as `mobile-codex.example.com` or `<PRIVATE_HTTPS_ENTRYPOINT>`

## Upstream Attribution And User-Facing Docs

- [ ] Confirm `README`, `NOTICE`, and `LICENSE` preserve upstream attribution
- [ ] Confirm the repository clearly states it is based on `siteboon/claudecodeui`
- [ ] Confirm the README remains user-facing and does not include maintainer-only release steps or private ops notes
- [ ] Confirm deployment, security, and architecture docs are in sync with the actual scripts and defaults

## Validation

- [ ] Run `powershell -ExecutionPolicy Bypass -File scripts/check-open-source-tree.ps1` against the sanitized staging tree
- [ ] Confirm the `Open Source Gate` workflow passes
- [ ] Run `python -m py_compile mobile_codex_control.py`
- [ ] If the override layer changed, run `scripts/smoke-test-override-flow.ps1`
- [ ] Manually review the final file list and confirm the public repo still forms a complete documentation loop
