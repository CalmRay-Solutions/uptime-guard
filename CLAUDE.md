# CLAUDE.md — Agent Guide for Uptime Guard

> **This file is the shared context for any AI agent working in this repo.**
> **KEEP IT CURRENT: whenever you change architecture, add/remove a feature, change
> commands, deploy targets, conventions, or the data model — update the relevant
> section and the "Current Status" block in the same change. Treat a stale entry
> here as a bug. Do not record secrets (tokens, account IDs, real database IDs).**

Last reviewed: 2026-08-04

---

## What this is

Uptime Guard is a self-hosted uptime / certificate / cron monitor that runs entirely
on Cloudflare's free tier — **no server, no container, no external database**. A single
Worker serves both the API and the React dashboard; a cron trigger runs the checks; D1
(SQLite) stores everything.

Marketing angle (see README): "fully Cloudflare-hostable without any server," one-click Deploy button.

**Stack:** Cloudflare Workers (`fetch` + `scheduled`), D1, Wrangler 4, React 18 + Vite,
plain CSS (no Tailwind), TypeScript throughout. Auth is zero-dependency Web Crypto
(PBKDF2 password hash, HMAC session tokens, TOTP, Web Push VAPID).

## Repo layout

```
worker/            Cloudflare Worker (API + cron + static asset serving)
  src/index.ts     Main entry: routing, auth, cron scheduler, settings, public status
  src/checks.ts    Check execution + retry-burst confirmation; status up|down|cf_protected
  src/tls.ts       Raw-socket TLS handshake (cert expiry)
  src/session.ts   HMAC session token create/verify (returns epoch for revocation)
  src/totp.ts      TOTP + base32 secret generation
  src/push.ts      Web Push (RFC 8291/8292)
  schema.sql       Full schema, CREATE ... IF NOT EXISTS (bundled + auto-applied)
  migrations/      Numbered historical migrations (schema.sql is the source of truth)
  wrangler.toml    Committed template (worker-dir manual deploy)
  wrangler.prod.toml / wrangler.demo.toml   gitignored, real infra IDs
dashboard/         React SPA (built into worker asset bundle)
  src/App.tsx      Routing (pushState/popstate), auth gate, setup gate, poll wiring
  src/components/  Overview, ServiceDetail, Settings, LoginGate, SetupGate, PublicStatus, ...
  src/lib/         api.ts, derive.ts, usePoll.ts, useStatusAlerts.ts, push.ts, sound.ts
wrangler.toml      ROOT config for the "Deploy to Cloudflare" button (auto-provisions D1)
docs/              README assets: logo.svg, uptime-guard-demo.gif, screenshots/
```

## Commands

Run from repo root:

- `npm run build:dashboard` — build the SPA into the worker asset bundle
- `npm run dev` — build dashboard, then `wrangler dev` on the worker
- `npm run deploy` — `scripts/deploy-banner.mjs`: runs `npx wrangler@4 deploy` (wrangler 4 is
  required for D1 auto-provisioning), streams its output, then prints the deployed dashboard URL
  in a large ASCII banner. Extra args pass through: `npm run deploy -- -c worker/wrangler.prod.toml`

Deploy a specific target from `worker/`: `npx wrangler deploy -c wrangler.prod.toml`
(or `-c wrangler.demo.toml`). Set `CI=1` for non-interactive.

## Data model (D1, 8 tables)

`projects` (public flag + public_slug) · `services` · `checks` · `incidents`
(last_reminder_at, reminder_level) · `push_subs` · `settings` (key/value, holds
session_secret + telegram config) · `daily_stats` (SLA rollups) · `login_attempts`
(rate limiting). Defined in `worker/schema.sql`; applied on first request / cron via
`ensureSchema`.

## Deploy targets

- **Production:** https://vigil.calmray.team (CalmRay infra, `wrangler.prod.toml`)
- **Demo:** https://vigil-demo.calmray.team — read-only, DEMO_MODE, password `demo`,
  seeded mock data (`worker/scripts/seed-demo.mjs`), used for README screenshots/GIF
- **One-click button:** root `wrangler.toml` — D1 binding OMITS `database_id` on purpose
  so Wrangler auto-provisions the database at deploy time (needs wrangler >= 4.45)
- Public repo: `CalmRay-Solutions/uptime-guard`

## Conventions

- **No em-dashes** anywhere (docs or UI text). Use `-`. The user is strict about this.
- **No `Co-Authored-By: Claude` trailer** in commits — user authorship only.
- Plain CSS with OKLCH tokens; inline SVG icons; no CSS framework.
- Keep secrets out of git: `.dev.vars`, `wrangler.{prod,demo,test}.toml`, and
  `wrangler.autotest.toml` are gitignored. Scan before every commit.
- `scrollbar-gutter: stable` is set on `html` — do not add `overflow-y: scroll` on
  `html`/`body` (they already have `height:100%`; that combo breaks page scrolling).

## Gotchas / non-obvious behavior

- **CF-fronted TLS checks:** a Worker cannot raw-socket to Cloudflare edge IPs, so TLS
  checks against Cloudflare-proxied hosts fail the handshake. These are reported as
  `cf_protected` (not `down`) and shown with a Cloudflare glyph. See `checks.ts`/`tls.ts`.
- **Visibility-aware polling:** `usePoll` skips fetches while `document.hidden` is true
  (battery/quota saving). Automated/background browser tabs report hidden, so the
  dashboard can appear stuck on the loading skeleton during automation even though the
  API is healthy — real users are unaffected.
- **Service worker cache:** the SPA is a PWA; after a deploy, bump the SW cache version
  or hard-reload, or clients serve stale assets.
- **Flap prevention:** `performCheckConfirmed` does a short retry-burst before flipping
  status; escalating re-alerts back off (5/10/20/40/60 min).

## Current Status  *(update this block on every functional change)*

Shipped and live on prod + demo:
- Monitors: HTTP, TCP, DNS, heartbeat (push-ping), TLS cert expiry, domain expiry
- Retry-burst flap prevention + escalating Telegram re-alerts; configurable retention
- Incident history + real SLA windows (24h/7d/30d/90d) + MTTR via daily rollups
- Public status page (`/status/:slug`), edge-cached, per-project public toggle
- Auth: password (PBKDF2) + TOTP, login rate-limiting + progressive delay,
  session revocation; zero-secret first-run setup wizard (`/api/setup`, `/api/meta`).
  TOTP is **mandatory** in that wizard: two steps (password, then authenticator), and
  `/api/setup` refuses to create the account without a verified 6-digit code.
  `/api/setup/totp-new` mints the candidate secret unauthenticated, gated on
  `setupRequired`. Recovery from a lost device = delete the `totp_secret` settings row.
- Settings UI: notifications, Telegram (bot token / chat / thread), security/TOTP,
  data retention, appearance
- PWA + Web Push desktop notifications; client-side path routing; IP masking in UI;
  pagination; layout-shift fixes
- One-click Deploy button with verified D1 auto-provisioning
- README marketed for GitHub stars; animated demo GIF in hero

Most recent work: authenticator pairing is now a required second step of the first-run wizard
(`SetupGate` is a 2-step form; `/api/setup` takes `totp_secret` + `totp_code`). Released as
`v1.0.0-beta.1` (GitHub pre-release). Before that: `npm run deploy` prints the dashboard URL in a big banner at the end of the
deploy log (one-click button flow included; README documents setting the deploy command to
`npm run deploy`). Before that: login/setup screens opt out of the reserved scrollbar gutter
(`html:has(.login){scrollbar-gutter:auto}`) - it showed as a dark strip right of the
`.aside` panel; deployed to prod + demo. Before that: demo GIF re-recorded at uniform
frame size + `scrollbar-gutter: stable` fix (commit `5a32a06` / `b4aa2c1`); em-dashes
removed from dashboard UI.

Known open items / ideas (not committed): set GitHub social-preview image (UI-only),
rotate any Telegram bot token that was shared in chat.
