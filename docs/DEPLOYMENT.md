# Deployment Guide

[中文](DEPLOYMENT.zh-CN.md) | [English](DEPLOYMENT.md)

This guide is written for first-time users. The goal is to get the stack running on a Windows PC, keep the safe default boundary, and only expand access when you explicitly choose to.

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

## Step 2: Apply the Override Layer

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/apply-upstream-overrides.ps1
```

If you want to validate the published override set before a real install, run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke-test-override-flow.ps1 -UpstreamZip <path-to-upstream-zip>
```

## Step 3: Install Node Dependencies

```powershell
cd vendor/claudecodeui-1.25.2
npm install
cd ..\..
```

## Step 4: Optional Python Packaging Dependency

If you only run the desktop tool directly, you usually do not need extra Python packages.

If you want to package the desktop tool as an `.exe`:

```powershell
pip install -r requirements.txt
```

## Step 5: Check the Local Environment

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-mobile-codex-runtime.ps1
```

Important checks:

- upstream folder exists
- Node is available
- nginx is available
- if you want remote phone access, Tailscale is available

## Step 6: Start the Local Stack

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-mobile-codex-stack.ps1
```

By default this keeps the app in `localhost` mode:

- app service on `127.0.0.1:3001`
- nginx proxy on `127.0.0.1:8080`

## Step 7: Launch the Desktop Control Tool

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

## Step 8: Complete First Registration

Open this in a desktop browser:

```text
http://127.0.0.1:3001
```

This is a single-user setup. The first account becomes the main account for the system.

## Step 9: Choose Access Mode

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
powershell -ExecutionPolicy Bypass -File scripts/enable-mobile-codex-tailnet-private.ps1
```

Expected result:

- the desktop tool shows mode `tailnet-private`
- Tailscale reports a tailnet-only HTTPS route
- Funnel stays disabled

### Option C: `public-funnel`

Dangerous mode. This creates a public internet entrypoint.

Only run this if you explicitly want public HTTPS exposure and understand the boundary expansion:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/publish-mobile-codex-public-funnel.ps1 -Yes
```

Expected result:

- the desktop tool shows mode `public-funnel`
- output clearly states `PUBLIC INTERNET ENTRYPOINT`
- the app itself still stays behind local nginx

## Step 10: First-Time Device Approval

When a new device logs in for the first time:

1. the phone shows that approval is required
2. the desktop tool shows a pending device request
3. you verify the device details
4. you approve it on the PC
5. the phone continues the login flow

Do not skip this. It is part of the default trust boundary.

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

## Fast Troubleshooting Order

1. run `scripts/check-mobile-codex-runtime.ps1`
2. confirm `http://127.0.0.1:3001` opens in the desktop browser
3. confirm the desktop tool shows both the app and nginx as healthy
4. only then test phone access
5. test wrapper apps and WebView shells last
