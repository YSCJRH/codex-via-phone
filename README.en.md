# mobileCodexHelper

[中文](README.md) | [English](README.en.md)

`mobileCodexHelper` turns the Codex sessions running on your Windows PC into a private web panel that you can safely view and continue from a phone browser.

It is designed for a simple usage model:

- Codex runs on your own Windows machine
- you want to check projects, threads, and messages from a phone
- you want to send the next prompt from the phone and let the local Codex session continue on the PC
- you want first-time device approval from the desktop before a new phone can log in

This is a single-user, self-hosted, private-network-first tool.  
If you want the security boundary, architecture, or release rules, use the documentation links below.

## What you can do with it

- View Codex projects and threads from a phone browser
- Continue an existing Codex session from the phone
- Approve the first login of a new mobile device from the desktop
- Monitor local service health, remote publish state, and device approvals from the Windows desktop control tool

## Quick start

### What you need

- Windows 10 or 11
- Python 3.11+
- Node.js 22 LTS
- Git
- nginx for Windows
- A working local Codex environment
- A private-network solution such as Tailscale is strongly recommended

### Setup steps

1. Obtain upstream `siteboon/claudecodeui` `v1.25.2`
2. Place the upstream source under `vendor/claudecodeui-1.25.2`
3. Apply this repository's override layer:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/apply-upstream-overrides.ps1
```

4. Install upstream dependencies:

```powershell
cd vendor/claudecodeui-1.25.2
npm install
cd ..\..
```

5. Start the local stack:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-mobile-codex-stack.ps1
```

6. Launch the desktop control tool:

```powershell
python mobile_codex_control.py
```

7. Open the local app in a desktop browser:

```text
http://127.0.0.1:3001
```

8. Complete first account registration
9. Configure a private remote entrypoint
10. Log in from the phone for the first time and approve the device on the desktop

## Documentation

- Deployment guide: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Security policy: [SECURITY.md](SECURITY.md)
- Contributing: [CONTRIBUTING.en.md](CONTRIBUTING.en.md)

## Acknowledgements

This project is built on top of [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui). It is not a full replacement for upstream, but a narrower helper layer focused on phone access, trusted-device approval, and safer remote entrypoints for local Codex workflows.

Thanks to the upstream authors and contributors for the original project and the UI/server foundation this helper depends on.
