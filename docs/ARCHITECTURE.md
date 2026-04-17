# Architecture

[中文](ARCHITECTURE.zh-CN.md) | [English](ARCHITECTURE.md)

This document explains the boundary that the repository is trying to protect.

## One-Line Summary

Keep Codex local to your own Windows PC, put nginx in front of it, and let the phone connect through a named access mode instead of exposing the Node app directly.

## Supported Access Modes

- `localhost`
  Default mode. The app binds to `127.0.0.1`, and only the local machine can reach it directly.
- `tailnet-private`
  Private-network mode. Tailscale Serve publishes a tailnet-only HTTPS route to local nginx. Funnel must stay disabled.
- `public-funnel`
  Public mode. Tailscale Funnel publishes a public internet HTTPS route to local nginx. This is an explicit boundary expansion, not a default.

Legacy direct bindings are treated as migration state only. They are outside the default boundary and no longer part of the recommended public route.

## Boundary Configuration Source

`.runtime/mode-config.json` is the local boundary configuration source.

It stores:

- `requestedMode`
- `effectiveMode`
- `persistentRemotePublish`
- `allowedOrigins`
- confirmation metadata
- legacy boundary detection state

Normal installation and mode changes should go through `scripts/install-mobile-codex.ps1`, which is the controlled entrypoint that writes this file.

Read-only operational inspection should go through:

- `scripts/status-mobile-codex.ps1`
- `scripts/doctor-mobile-codex.ps1`
- `scripts/export-mobile-codex-support-bundle.ps1`

## Runtime Shape

```text
Phone browser
  -> named access mode (`tailnet-private` or `public-funnel`)
  -> local nginx
  -> local claudecodeui with this repository's overrides
  -> local Codex sessions
```

The browser side is expected to arrive through an explicit Origin allowlist. In normal operation that allowlist is assembled from `.runtime/mode-config.json`, the current published app-binding URLs, and any reviewed `MOBILE_CODEX_ALLOWED_ORIGINS` override.

## Why `localhost` Is the Default

Because the project controls local Codex sessions on your PC. That is a high-trust environment.

Starting from `localhost` gives you:

- a smaller default attack surface
- a predictable review path
- less chance of accidentally exposing the app before you verify the basics

## Why `tailnet-private` Is the Recommended Remote Mode

`tailnet-private` keeps the strongest default story for remote phone access:

- the app itself still stays localhost-only
- nginx remains the single local proxy layer
- the HTTPS route is limited to devices on the same tailnet
- Tailscale Funnel is not used

This is the preferred mode for long-term personal use.

## Why `public-funnel` Is Treated as Dangerous

`public-funnel` intentionally expands the boundary to the public internet.

That means:

- internet-origin traffic can reach the login flow
- configuration mistakes matter more
- accidental screenshots, logs, and support bundles become riskier

This is why the mode must be named explicitly, confirmed explicitly, and never enabled by default.

## Why nginx Stays in the Middle

nginx is the stable ingress layer for every supported mode:

- it keeps the Node app behind localhost
- it centralizes proxy behavior and headers
- it gives `tailnet-private` and `public-funnel` the same local target shape

The repository does not treat direct app exposure as the normal path anymore.

## Why First-Time Device Approval Matters

This is one of the strongest trust boundaries in the project.

Without it:

- anyone with the account password might log in from a new device immediately

With it:

- a new device must wait for desktop approval
- the owner can inspect the pending request
- only approved devices move into the trusted list

The polling side of that flow should stay cookie-backed. The phone should ask `/api/auth/device-approval` for status, while the request token itself stays in an `httpOnly` cookie instead of being exposed in the URL.

After approval, trust should move from "this browser says it has UUID X" to "this browser can prove possession of the approved device key for UUID X". That is why the login flow now includes a short-lived device-key challenge before the auth session is issued.

Once that session is issued, the normal browser path should stay cookie-first. The repository no longer needs to mirror the auth bearer token into localStorage for same-origin web access.

## Keep These Four Points in Mind

1. Default to `localhost`.
2. Prefer `tailnet-private` when you need remote phone access.
3. Treat `public-funnel` as an explicit public internet entrypoint.
4. Keep the phone focused on viewing, approval, and chat-based continuation of local Codex sessions.
