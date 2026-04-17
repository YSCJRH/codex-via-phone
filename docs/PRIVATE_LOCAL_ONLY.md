# Private-Local-Only Exclusions

[中文](PRIVATE_LOCAL_ONLY.zh-CN.md) | [English](PRIVATE_LOCAL_ONLY.md)

This document lists the content that should remain private to a local working copy and must not be included in a public repository snapshot.

## Keep in the public repository

The public repository should contain only the minimum reusable materials needed to understand and adapt the project:

- the override layer
- the helper scripts
- the desktop control tool source
- the documentation needed for deployment, security, contribution, and release review

The public repository is not the broader private workspace and must not absorb sibling private projects, parent-level assets, or maintainer-only materials.

## Keep out of the public repository

Do not publish:

- runtime state such as `.runtime/`, `tmp/`, logs, databases, and diagnostics exports
- the full upstream checkout in `vendor/`
- local dependency caches and scratch files such as `.npm-cache/`
- packaged binaries, local archives, and build leftovers
- certificates, private keys, and personal TLS material
- session JSONL files, approval traces, trusted-device evidence, and copied runtime screenshots
- personal hostnames, tailnet domains, private IPs, usernames, and machine-specific absolute paths
- `private-docs/` and maintainer-only release instructions
- sibling private projects, audit directories, experiments, and other assets copied from the parent workspace
- notes that only make sense for one private deployment rather than the reusable open-source project

## Replace with placeholders

When a document or example needs to refer to a local value, replace it with a placeholder such as:

- `https://mobile-codex.example.com`
- `<PRIVATE_HTTPS_ENTRYPOINT>`
- `<TAILNET_IP>`
- `<PATH_TO_MOBILE_CODEX_HELPER>`

## Historical diagnostics

Historical analysis notes are only safe to keep if they have been rewritten into a public-safe form:

- remove real hostnames and IPs
- remove timestamps tied to a private device or bridge window
- remove copied runtime evidence and session details
- keep only reusable methods, failure patterns, and deployment lessons

If a file still reads like a personal incident report, treat it as private-local-only until it is sanitized.

If a staging copy still contains `private-docs/`, runtime directories, or parent-workspace assets, treat that copy as unsafe to publish.
