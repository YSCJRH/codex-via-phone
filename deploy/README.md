# Deploy Templates

The `deploy/` directory is part of the public-safe surface of this project. It should contain reusable reverse-proxy templates only, not personalized deployment records.

## Files in this directory

- `nginx-mobile-codex.conf`
  - local Windows nginx config used by the helper scripts
  - intended as a generic local template, not as a record of anyone's private deployment
- `nginx-mobile-codex.conf.example`
  - example for a public-edge nginx setup
- `Caddyfile.example`
  - optional example for users who prefer Caddy

## Public-safe configuration rules

When publishing the repository or sharing snippets:

- keep real domains, private IPs, certificate paths, and usernames out of committed config
- publish example values only
- adapt live values locally after cloning
- keep personalized copies of these templates outside the public release tree
- do not copy maintainer-only deployment notes or one-off ops files into this directory

## Recommended deployment posture

- keep the app bound to `127.0.0.1`
- put a reverse proxy in front of it
- prefer a private-network HTTPS entrypoint
- do not commit personalized copies of proxy configs, certificates, or local runtime outputs
