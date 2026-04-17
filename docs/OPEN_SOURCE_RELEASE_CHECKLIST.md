# Open Source Release Checklist

[中文](OPEN_SOURCE_RELEASE_CHECKLIST.zh-CN.md) | [English](OPEN_SOURCE_RELEASE_CHECKLIST.md)

Use this checklist before the first public push or before tagging a release from a sanitized copy of the repository.

## Repository boundary

- [ ] Confirm you are reviewing a freshly exported, sanitized staging copy rather than the live private working tree
- [ ] Confirm the release root is `mobileCodexHelper/` only
- [ ] Confirm no sibling private projects from the larger working directory were copied into the release tree
- [ ] Confirm the repository narrative stays focused on phone control for local Codex, not unrelated tools

## Private-local-only artifacts

- [ ] Remove `vendor/`, `node_modules/`, `dist/`, `build/`, `.runtime/`, `tmp/`, `__pycache__/`, `.npm-cache/`, and `private-docs/`
- [ ] Remove databases, logs, packaged binaries, archives, session exports, certificates, and private keys
- [ ] Remove diagnostics bundles, runtime screenshots, and approval evidence captured from a personal environment
- [ ] Review [PRIVATE_LOCAL_ONLY.md](PRIVATE_LOCAL_ONLY.md) and confirm nothing from that list remains

## Documentation and examples

- [ ] Replace personal hostnames, tailnet domains, private IPs, usernames, and absolute paths with placeholders
- [ ] Confirm examples use public-safe placeholders such as `mobile-codex.example.com` or `<PRIVATE_HTTPS_ENTRYPOINT>`
- [ ] Confirm screenshots and pasted logs do not expose machine-specific data
- [ ] Confirm deployment docs only show example config values, not personal runtime values
- [ ] Confirm `deploy/` guidance makes it clear which files are examples and which values must be customized locally
- [ ] Confirm the README remains user-facing and does not include maintainer-only release steps, deploy key details, or private ops notes

## Upstream attribution and legal surface

- [ ] Confirm `README`, `NOTICE`, and `LICENSE` all preserve upstream attribution
- [ ] Confirm the repository clearly states it is based on `siteboon/claudecodeui`
- [ ] Confirm acknowledgements thank upstream authors and contributors

## Validation

- [ ] Run `powershell -ExecutionPolicy Bypass -File scripts/check-open-source-tree.ps1` against the sanitized release tree
- [ ] If the override layer changed, run `scripts/smoke-test-override-flow.ps1`
- [ ] Run `python -m py_compile mobile_codex_control.py`
- [ ] If you added a "public-safe" analysis document, confirm it keeps reusable methods only and omits private incident records or runtime evidence
- [ ] Manually review the final file list and confirm the public repo still forms a complete documentation loop:
  - `README`
  - deployment guide
  - security policy
  - contributing guide
  - release checklist
  - notice and license
