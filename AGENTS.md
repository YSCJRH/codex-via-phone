# AGENTS.md

This file is a public-safe assistant contract for Codex and similar coding agents.
Use it when a user asks to install, bootstrap, verify, or explain this repository.

## Project Intent

- This repository is a helper layer for phone access to local Codex sessions running on a Windows PC.
- It is designed for a single-user, self-hosted workflow.
- It builds on top of upstream `siteboon/claudecodeui` `v1.25.2`.

## Boundary Rules For Assistants

- Default to `localhost`.
- The only supported public mode names are:
  - `localhost`
  - `tailnet-private`
  - `public-funnel`
- The only recommended install entrypoint is `scripts/install-mobile-codex.ps1`.
- `tailnet-private` means Tailscale Serve HTTPS tailnet-only -> local nginx -> localhost app. It must not call Funnel.
- `public-funnel` means Tailscale Funnel HTTPS -> local nginx -> localhost app. It is a public internet entrypoint and requires explicit confirmation.
- Do not stitch together deprecated scripts such as `enable-mobile-codex-remote.ps1` or `*tailnet-direct*.ps1` for normal installation.
- Do not show personal hostnames, private IPs, request tokens, device IDs, Windows usernames, or absolute local paths by default.

## Current Install Workflow

1. Confirm prerequisites:
   - Windows 10 / 11
   - Python 3.11+
   - Node.js 22 LTS
   - Git
   - nginx for Windows
   - Tailscale if the user explicitly wants `tailnet-private` or `public-funnel`
2. Explain the upstream requirement:
   - the user must obtain upstream `siteboon/claudecodeui` `v1.25.2`
   - place it at `vendor/claudecodeui-1.25.2`
3. First run a dry-run plan:
   - `powershell -ExecutionPolicy Bypass -File scripts/install-mobile-codex.ps1 -Mode localhost -DryRun -EmitPlanJson`
4. Then run the real install:
   - `powershell -ExecutionPolicy Bypass -File scripts/install-mobile-codex.ps1 -Mode localhost -EmitRedactedStatus`
5. Read the current redacted status when needed:
   - `powershell -ExecutionPolicy Bypass -File scripts/status-mobile-codex.ps1 -EmitJson`
6. Run a read-only environment doctor when needed:
   - `powershell -ExecutionPolicy Bypass -File scripts/doctor-mobile-codex.ps1 -EmitJson`
7. Export a redacted support bundle when needed:
   - `powershell -ExecutionPolicy Bypass -File scripts/export-mobile-codex-support-bundle.ps1 -EmitJson`
8. Only if the user wants to package the desktop tool as an `.exe`, install Python packaging dependencies:
   - `pip install -r requirements.txt`
9. Launch the desktop control tool if needed:
   - `python mobile_codex_control.py`
   - or `scripts\launch-mobile-codex-control.cmd`
10. Open `http://127.0.0.1:3001` in a desktop browser and complete first registration.
11. Only if the user explicitly requests phone access beyond localhost:
   - recommended: `powershell -ExecutionPolicy Bypass -File scripts/install-mobile-codex.ps1 -Mode tailnet-private -EmitRedactedStatus`
   - dangerous: `powershell -ExecutionPolicy Bypass -File scripts/install-mobile-codex.ps1 -Mode public-funnel -Yes -EmitRedactedStatus`
12. Require desktop approval for the first login of every new device.

## When The User Says "Help Me Install"

- Choose `localhost` unless the user explicitly asks for another mode.
- First run `install-mobile-codex.ps1 -Mode localhost -DryRun -EmitPlanJson`.
- Then run `install-mobile-codex.ps1 -Mode localhost -EmitRedactedStatus`.
- Then run `status-mobile-codex.ps1 -EmitJson` for the final read-only status check.
- Do not enable `tailnet-private` or `public-funnel` silently.
- Do not enable autostart or persistent public exposure unless the user explicitly asks.
- Do not enable `public-funnel` without `-Yes`.
- Verify the desktop browser flow before testing phone access.

## Verification Checklist

- `scripts/check-mobile-codex-runtime.ps1` shows the upstream folder, Node, npm, nginx, and Python state
- `http://127.0.0.1:3001` opens on the PC
- the desktop control tool shows the app and nginx as healthy
- a first phone login produces a pending approval on the desktop
- after approval, the phone can view projects and continue messages

## Public-Safe Output Rules

- Do not include personal hostnames, private IPs, Windows usernames, secrets, approval tokens, session exports, or runtime evidence in user-facing output.
- Do not mix sibling projects or parent-workspace assets into installation instructions.
- If the task is about publishing or release hygiene, use:
  - `README.md` / `README.en.md`
  - `SECURITY.zh-CN.md` / `SECURITY.md`
  - `docs/PRIVATE_LOCAL_ONLY.zh-CN.md` / `docs/PRIVATE_LOCAL_ONLY.md`
  - `docs/OPEN_SOURCE_RELEASE_CHECKLIST.zh-CN.md` / `docs/OPEN_SOURCE_RELEASE_CHECKLIST.md`

## Useful References

- Chinese deployment guide: `docs/DEPLOYMENT.zh-CN.md`
- English deployment guide: `docs/DEPLOYMENT.md`
- Chinese architecture guide: `docs/ARCHITECTURE.zh-CN.md`
- English architecture guide: `docs/ARCHITECTURE.md`
- Chinese security policy: `SECURITY.zh-CN.md`
- English security policy: `SECURITY.md`

## Ready-To-Paste Prompts

- `Read AGENTS.md first, inspect this Windows machine, and install the project with the safe default localhost model.`
- `Use AGENTS.md as the install contract, run install-mobile-codex.ps1 in dry-run first, then help me enable tailnet-private without using Funnel.`
- `Read AGENTS.md first, then help me review whether this repository is still within the localhost / tailnet-private / public-funnel governance boundary.`
