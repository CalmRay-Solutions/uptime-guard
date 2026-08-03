# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

Use GitHub's [private vulnerability reporting](https://github.com/CalmRay-Solutions/uptime-guard/security/advisories/new)
(Security → Report a vulnerability), or email the maintainers. We'll acknowledge within a few days
and keep you updated on a fix.

## Scope

Uptime Guard is self-hosted — each deployment holds its own secrets and data. Things especially
worth reporting:

- Authentication bypass (password + TOTP), session token forgery or fixation.
- Ways to read another project's data, or private data leaking through a **public status page**
  (which should only ever expose service names, status, and uptime).
- Injection via monitor configuration, heartbeat tokens, or the public API.

## Hardening notes for operators

- Set a strong `PASSWORD`, a unique `TOTP_SECRET`, and a long random `SESSION_SECRET`.
- Rotate `SESSION_SECRET` (or use **Log out other devices** in Settings) if a token may be exposed.
- Keep `wrangler.toml` and `.dev.vars` out of version control (they're gitignored by default).
- Treat your Telegram bot token as a secret — rotate it via @BotFather if it leaks.
