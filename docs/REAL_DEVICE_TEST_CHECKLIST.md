# Real Device Test Checklist

Use this checklist when you validate the mobile experience on actual phones and prepare public-safe README screenshots.

## Device Matrix

- iPhone Safari
- iOS PWA
- Narrow Android Chrome

## Required Test Scenarios

- Open the mobile home screen, enter a project, open a chat, and return to Projects
- Open the search sheet and more sheet, then verify layout and safe-area behavior
- Verify the mobile chat header, external sync notice, and provider/session empty states
- Verify permission cards, desktop approval cards, and desktop-review-only prompts
- In iOS PWA, verify cold start, return-to-last-session, and keyboard-safe composer behavior
- In iOS PWA, verify composer, approval overlays, and bottom navigation do not overlap when the keyboard is open
- In Android Chrome, verify home, chat, search, and more layouts remain stable on a narrow screen
- Verify long Chinese titles, mixed Chinese/English titles, and long project names clamp instead of overflowing

## Screenshot Sanitization

- Keep raw device screenshots outside the public repository
- Export only sanitized PNG assets into `docs/assets/readme/`
- Remove or replace real usernames, project names, absolute paths, private IPs, `*.ts.net` domains, request tokens, session IDs, device IDs, approval traces, and personal notifications
- Normalize the status bar if it exposes a personal carrier, exact time, location, or notification content
- Do not mix old UI screenshots with the current mobile redesign

## README Image Output

- Create one hero collage: `docs/assets/readme/mobile-hero-collage.png`
- Create three single screenshots:
  - `docs/assets/readme/mobile-home-real-device.png`
  - `docs/assets/readme/mobile-chat-real-device.png`
  - `docs/assets/readme/mobile-approval-real-device.png`
- Keep image references relative to the repository and suitable for GitHub README rendering
- Use the same image set in `README.md` and `README.en.md`

## Release Validation

- Run `powershell -ExecutionPolicy Bypass -File scripts/check-open-source-tree.ps1`
- Run `python -m py_compile mobile_codex_control.py`
- If the override layer changed, run `scripts/smoke-test-override-flow.ps1`
- Confirm the `Open Source Gate` workflow passes
- Manually inspect README rendering on the GitHub web page in both Chinese and English
