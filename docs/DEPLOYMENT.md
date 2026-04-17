# Deployment Guide

[中文](DEPLOYMENT.zh-CN.md) | [English](DEPLOYMENT.md)

This guide is written for first-time users. The goal is to get the stack running on a Windows PC, keep the safe default boundary, and only expand access when you explicitly choose to.

## Recommended Installer Entry

Use `scripts/install-mobile-codex.ps1` as the single recommended install entrypoint.

The installer runs these phases in order:

1. `validate-upstream`
2. `apply-overrides`
3. `install-deps`
4. `doctor`
5. `configure-mode`
6. `start`
7. `verify`
8. `emit-redacted-status`

It also writes `.runtime/mode-config.json`, which is the boundary configuration source for the requested and effective access mode.
That file also carries the reviewed browser Origin allowlist for the current mode.

## Expected Result

After deployment, you should be able to:

- start the local Codex control stack on your PC
- open the local web panel at `http://127.0.0.1:3001`
- approve a new phone from the desktop tool on first login
- optionally enable either `tailnet-private` or `public-funnel`

## Supported Access Modes

- `localhost`
  Default mode. App binds to `127.0.0.1`, nginx stays local, and nothing is published remotely.
- `tailnet-private`
  Recommended remote mode. Tailscale Serve exposes a tailnet-only HTTPS route to local nginx.
- `public-funnel`
  Dangerous mode. Tailscale Funnel exposes a public internet HTTPS route to local nginx. This must be confirmed explicitly with `-Yes`.

Deprecated migration shims such as `enable-mobile-codex-remote.ps1` and `*tailnet-direct*.ps1` are not part of the supported install path.

## Requirements

- Windows 10 / 11
- Python 3.11+
- Node.js 22 LTS
- Git
- nginx for Windows
- Tailscale if you want `tailnet-private` or `public-funnel`

## Recommended Directory Layout

```text
codex-via-phone/
├── deploy/
├── docs/
├── scripts/
├── upstream-overrides/
├── vendor/
│   └── claudecodeui-1.25.2/
├── mobile_codex_control.py
└── requirements.txt
```

## Step 1: Prepare Upstream Source

Download upstream `siteboon/claudecodeui` `v1.25.2` and place it at:

```text
vendor/claudecodeui-1.25.2
```

## Step 2: Preview The Install Plan

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-mobile-codex.ps1 -Mode localhost -DryRun -EmitPlanJson
```

## Step 3: Run The Localhost Install

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-mobile-codex.ps1 -Mode localhost -EmitRedactedStatus
```

The installer applies overrides, runs `npm install`, checks the runtime, starts the local stack, verifies localhost mode, and emits a redacted status summary.

If you want to validate the published override set separately before a real install, run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke-test-override-flow.ps1 -UpstreamZip <path-to-upstream-zip>
```

## Step 4: Optional Python Packaging Dependency

If you only run the desktop tool directly, you usually do not need extra Python packages.

If you want to package the desktop tool as an `.exe`:

```powershell
pip install -r requirements.txt
```

## Step 5: Launch the Desktop Control Tool

```powershell
python mobile_codex_control.py
```

or:

```powershell
scripts\launch-mobile-codex-control.cmd
```

You should see:

- PC app service state
- nginx state
- Tailscale state
- current access mode
- pending device approvals
- trusted device whitelist

## Step 6: Complete First Registration

Open this in a desktop browser:

```text
http://127.0.0.1:3001
```

This is a single-user setup. The first account becomes the main account for the system.

## Step 7: Choose Access Mode

### Option A: `localhost`

Recommended first milestone:

- confirm login works
- confirm project list loads
- confirm sending a message works

### Option B: `tailnet-private`

Recommended remote mode.

Make sure:

- the PC is logged into Tailscale
- the phone is logged into the same tailnet
- nginx is healthy locally

Then run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-mobile-codex.ps1 -Mode tailnet-private -EmitRedactedStatus
```

Expected result:

- the desktop tool shows mode `tailnet-private`
- Tailscale reports a tailnet-only HTTPS route
- Funnel stays disabled

### Option C: `public-funnel`

Dangerous mode. This creates a public internet entrypoint.

Only run this if you explicitly want public HTTPS exposure and understand the boundary expansion:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-mobile-codex.ps1 -Mode public-funnel -Yes -EmitRedactedStatus
```

Expected result:

- the desktop tool shows mode `public-funnel`
- output clearly states `PUBLIC INTERNET ENTRYPOINT`
- the app itself still stays behind local nginx

## Step 8: First-Time Device Approval

When a new device logs in for the first time:

1. the phone shows that approval is required
2. the desktop tool shows a pending device request
3. you verify the device details
4. you approve it on the PC
5. the phone continues the login flow

The approval poll stays on `/api/auth/device-approval` and uses a short-lived `httpOnly` cookie. The phone should not receive or reuse a request token URL.

After a device is approved, later sign-ins from that same browser must complete a short-lived device-key challenge. If you are migrating from an older UUID-only approval record, expect one re-approval so the device key can be registered.

After sign-in succeeds, the browser should continue with the same-origin auth cookie. You do not need to copy or persist a bearer token in browser storage for the normal web path.

Do not skip this. It is part of the default trust boundary.

## Read-Only Inspection Scripts

Use these scripts when you want read-only inspection instead of a boundary change:

- `powershell -ExecutionPolicy Bypass -File scripts/status-mobile-codex.ps1 -EmitJson`
- `powershell -ExecutionPolicy Bypass -File scripts/doctor-mobile-codex.ps1 -EmitJson`
- `powershell -ExecutionPolicy Bypass -File scripts/export-mobile-codex-support-bundle.ps1 -EmitJson`
- `powershell -ExecutionPolicy Bypass -File scripts/export-mobile-codex-audit.ps1 -EmitJson`

## Optional Environment Variables

- `MOBILE_CODEX_UPSTREAM_DIR`
  Custom upstream `claudecodeui` directory
- `MOBILE_CODEX_NODE`
  Custom Node executable path
- `MOBILE_CODEX_NGINX`
  Custom nginx executable path
- `MOBILE_CODEX_TAILSCALE`
  Custom Tailscale executable path
- `MOBILE_CODEX_ASCII_ALIAS`
  Custom ASCII alias path for Windows path compatibility
- `MOBILE_CODEX_ALLOWED_ORIGINS`
  Comma-separated reviewed browser Origins to merge into the allowlist
- `MOBILE_CODEX_ALLOW_LEGACY_DIRECT`
  Deprecated migration escape hatch for non-loopback HOST binds. Do not use this for normal installs.

## Fast Troubleshooting Order

1. run `scripts/check-mobile-codex-runtime.ps1`
2. confirm `http://127.0.0.1:3001` opens in the desktop browser
3. confirm the desktop tool shows both the app and nginx as healthy
4. only then test phone access
5. test wrapper apps and WebView shells last
