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

## Runtime Shape

```text
Phone browser
  -> named access mode (`tailnet-private` or `public-funnel`)
  -> local nginx
  -> local claudecodeui with this repository's overrides
  -> local Codex sessions
```

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

## Keep These Four Points in Mind

1. Default to `localhost`.
2. Prefer `tailnet-private` when you need remote phone access.
3. Treat `public-funnel` as an explicit public internet entrypoint.
4. Keep the phone focused on viewing, approval, and chat-based continuation of local Codex sessions.
