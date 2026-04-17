# AGENTS.md

This file is a public-safe assistant entrypoint for Codex and similar coding agents.
Use it when a user asks to install, bootstrap, verify, or explain this repository.

## Project intent

- This repository is a helper layer for safe phone access to local Codex sessions running on a Windows PC.
- It is designed for a single-user, self-hosted, private-network-first workflow.
- It is not a remote desktop, a multi-user SaaS, or a bundle of a broader private workspace.
- It builds on top of upstream `siteboon/claudecodeui` `v1.25.2`.

## Install workflow

When a user asks to install this project, guide them through this exact shape:

1. Confirm prerequisites:
   - Windows 10 / 11
   - Python 3.11+
   - Node.js 22 LTS
   - Git
   - nginx for Windows
   - Tailscale is recommended for remote phone access
2. Explain the upstream requirement:
   - the user must obtain upstream `siteboon/claudecodeui` `v1.25.2`
   - place it at `vendor/claudecodeui-1.25.2`
   - do not assume the full upstream checkout is bundled in this repository
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
10. If the user wants remote phone access, enable it with:
   - `powershell -ExecutionPolicy Bypass -File scripts/enable-mobile-codex-remote.ps1`
11. Require desktop approval for the first login of every new device.

## Verification checklist

- `scripts/check-mobile-codex-runtime.ps1` shows the upstream folder, Node, and nginx are available
- `http://127.0.0.1:3001` opens on the PC
- the desktop control tool shows the app and nginx as healthy
- a first phone login produces a pending approval on the desktop
- after approval, the phone can view projects and continue messages

Prefer validating the phone flow in a normal mobile browser before testing a wrapper app or WebView shell.

## Safe defaults

- Keep the app bound to `127.0.0.1`
- Put a reverse proxy in front of it
- Prefer a private-network entrypoint such as Tailscale
- Keep trusted-device approval enabled
- Keep hardened mode enabled
- Do not recommend exposing the Node app directly to the public internet as the default path

## Public-safe output rules

- Do not include personal hostnames, private IPs, Windows usernames, secrets, approval tokens, session exports, or runtime evidence in user-facing output.
- Do not mix sibling projects or parent-workspace assets into installation instructions.
- Do not rely on maintainer-only `private-docs/` content when answering end users.
- If the task is about publishing or open-source release hygiene, use:
  - `README.md` / `README.en.md`
  - `SECURITY.zh-CN.md` / `SECURITY.md`
  - `docs/PRIVATE_LOCAL_ONLY.zh-CN.md` / `docs/PRIVATE_LOCAL_ONLY.md`
  - `docs/OPEN_SOURCE_RELEASE_CHECKLIST.zh-CN.md` / `docs/OPEN_SOURCE_RELEASE_CHECKLIST.md`

## Useful references

- Chinese deployment guide: `docs/DEPLOYMENT.zh-CN.md`
- English deployment guide: `docs/DEPLOYMENT.md`
- Chinese architecture guide: `docs/ARCHITECTURE.zh-CN.md`
- English architecture guide: `docs/ARCHITECTURE.md`
- Chinese security policy: `SECURITY.zh-CN.md`
- English security policy: `SECURITY.md`

## Ready-to-paste prompts

- `Please read AGENTS.md and docs/DEPLOYMENT.md, inspect this Windows machine, and install the project with the safe default model.`
- `Use AGENTS.md as the install contract, verify prerequisites, and set up mobileCodexHelper without enabling direct public exposure.`
- `Read AGENTS.md first, then help me bootstrap this repository on Windows and verify that the phone-access flow works.`
