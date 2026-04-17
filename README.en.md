# codex-via-phone

[中文](README.md) | [English](README.en.md)

`codex-via-phone` is a self-hosted helper layer that lets you view, continue, approve, and sync local Codex sessions from a phone while those sessions keep running on your Windows PC.

It is designed for one clear workflow:

- Codex runs locally on your own Windows machine
- you want to check projects, threads, and messages from a phone
- you want to send the next prompt from the phone and let the PC continue the local Codex session
- you want first-time device approval on the desktop before a new phone can log in

## What You Can Do

- View Codex projects and threads from a phone browser
- Continue an existing Codex session from the phone
- Approve the first login of a new mobile device from the desktop tool
- Monitor local service health, access mode, and device approvals from the Windows desktop control tool

## Access Modes

- `localhost`
  Default and recommended starting point. The app stays bound to `127.0.0.1`, and you verify everything locally first.
- `tailnet-private`
  Recommended remote mode. Tailscale Serve publishes a tailnet-only HTTPS route to local nginx, while the app itself stays localhost-only.
- `public-funnel`
  Dangerous mode. Tailscale Funnel publishes a public internet HTTPS entrypoint to local nginx. This must be enabled explicitly and is never the default.

## Recommended Architecture

```text
Phone browser
  -> Tailscale HTTPS entrypoint
  -> Local nginx
  -> Local claudecodeui with this repository's override layer
  -> Local Codex sessions on the PC
```

## Safe Default Model

- Keep the app bound to `127.0.0.1`
- Put nginx in front of the app
- Start in `localhost`
- Prefer `tailnet-private` over `public-funnel`
- Require desktop approval for every first-time device
- Keep hardened mode enabled by default

## Quick Start

1. Obtain upstream `siteboon/claudecodeui` `v1.25.2`
2. Place it at `vendor/claudecodeui-1.25.2`
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

8. Only if you explicitly want phone access, choose one access mode:

```powershell
# Recommended: tailnet-private HTTPS mode
powershell -ExecutionPolicy Bypass -File scripts/enable-mobile-codex-tailnet-private.ps1

# Dangerous: public-funnel public internet entrypoint
powershell -ExecutionPolicy Bypass -File scripts/publish-mobile-codex-public-funnel.ps1 -Yes
```

9. Log in from the phone for the first time and approve the device on the desktop.

## Documentation

- Deployment guide: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Security policy: [SECURITY.md](SECURITY.md)
- Contributing: [CONTRIBUTING.en.md](CONTRIBUTING.en.md)
- Private-local-only exclusions: [docs/PRIVATE_LOCAL_ONLY.md](docs/PRIVATE_LOCAL_ONLY.md)
- Open-source release checklist: [docs/OPEN_SOURCE_RELEASE_CHECKLIST.md](docs/OPEN_SOURCE_RELEASE_CHECKLIST.md)
- Assistant entrypoint for Codex and similar coding agents: [AGENTS.md](AGENTS.md)

If you plan to publish a fork, review `docs/PRIVATE_LOCAL_ONLY.md` and `docs/OPEN_SOURCE_RELEASE_CHECKLIST.md` before you assemble a staging snapshot.

## Acknowledgements

This project is built on top of [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui). It is a narrower helper layer focused on phone access, trusted-device approval, and safer access modes for local Codex workflows.
