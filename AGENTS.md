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
- `tailnet-private` means Tailscale Serve HTTPS tailnet-only -> local nginx -> localhost app. It must not call Funnel.
- `public-funnel` means Tailscale Funnel HTTPS -> local nginx -> localhost app. It is a public internet entrypoint and requires explicit confirmation.
- Do not use deprecated scripts such as `enable-mobile-codex-remote.ps1` or `*tailnet-direct*.ps1` as part of the normal install path.
- Do not show personal hostnames, private IPs, request tokens, device IDs, Windows usernames, or absolute local paths by default.

## Current Install Workflow

Use this flow until a dedicated single-entry installer lands in the repository.

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
3. Apply the override layer:
   - `powershell -ExecutionPolicy Bypass -File scripts/apply-upstream-overrides.ps1`
4. Install upstream Node dependencies:
   - `cd vendor/claudecodeui-1.25.2`
   - `npm install`
5. Only if the user wants to package the desktop tool as an `.exe`, install Python packaging dependencies:
   - `pip install -r requirements.txt`
6. Run the local environment check:
   - `powershell -ExecutionPolicy Bypass -File scripts/check-mobile-codex-runtime.ps1`
7. Start the stack:
   - `powershell -ExecutionPolicy Bypass -File scripts/start-mobile-codex-stack.ps1`
8. Launch the desktop control tool:
   - `python mobile_codex_control.py`
   - or `scripts\launch-mobile-codex-control.cmd`
9. Open `http://127.0.0.1:3001` in a desktop browser and complete first registration.
10. Only if the user explicitly requests phone access beyond localhost:
   - recommended: `powershell -ExecutionPolicy Bypass -File scripts/enable-mobile-codex-tailnet-private.ps1`
   - dangerous: `powershell -ExecutionPolicy Bypass -File scripts/publish-mobile-codex-public-funnel.ps1 -Yes`
11. Require desktop approval for the first login of every new device.

## When The User Says "Help Me Install"

- Choose `localhost` unless the user explicitly asks for another mode.
- Do not enable `tailnet-private` or `public-funnel` silently.
- Do not enable autostart or persistent public exposure unless the user explicitly asks.
- Verify the desktop browser flow before testing phone access.

## Verification Checklist

- `scripts/check-mobile-codex-runtime.ps1` shows the upstream folder, Node, and nginx are available
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
- `Use AGENTS.md as the install contract, verify prerequisites, and help me enable tailnet-private without using Funnel.`
- `Read AGENTS.md first, then help me review whether this repository is still within the localhost / tailnet-private / public-funnel governance boundary.`
