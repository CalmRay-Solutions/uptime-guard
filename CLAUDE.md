# CLAUDE.md - Agent Guide for Uptime Guard

> **This file is the shared context for any AI agent working in this repo.**
> **KEEP IT CURRENT: whenever you change architecture, add/remove a feature, change
> commands, deploy targets, conventions, or the data model - update the relevant
> section and the "Current Status" block in the same change. Treat a stale entry
> here as a bug. Do not record secrets (tokens, account IDs, real database IDs).**

Last reviewed: 2026-08-12

---

## What this is

Uptime Guard is a self-hosted uptime / certificate / cron monitor that runs entirely
on Cloudflare's free tier - **no server, no container, no external database**. A single
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
  src/script.ts    Custom-script monitors: parser + runner for the step DSL
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
docs/              README assets: logo.svg, uptime-guard-walkthrough.gif, screenshots/
                   (renaming the GIF is how you bust GitHub's camo image cache)
```

## Commands

Run from repo root:

- `npm run build:dashboard` - build the SPA into the worker asset bundle
- `npm run dev` - build dashboard, then `wrangler dev` on the worker
- `npm run deploy` - `scripts/deploy-banner.mjs`: runs `npx wrangler@4 deploy` (wrangler 4 is
  required for D1 auto-provisioning), streams its output, then prints the deployed dashboard URL
  in a large ASCII banner. Extra args pass through: `npm run deploy -- -c worker/wrangler.prod.toml`

Deploy a specific target from `worker/`: `npx wrangler deploy -c wrangler.prod.toml`
(or `-c wrangler.demo.toml`). Set `CI=1` for non-interactive.

## Data model (D1, 8 tables)

`projects` (public flag + public_slug) · `services` · `checks` · `incidents`
(last_reminder_at, reminder_level) · `push_subs` · `settings` (key/value, holds
session_secret + telegram config + `default_project_seeded`) · `daily_stats` (SLA rollups) · `login_attempts`
(rate limiting). Defined in `worker/schema.sql`; applied on first request / cron via
`ensureSchema`.

## Deploy targets

- **Production:** https://vigil.calmray.team (CalmRay infra, `wrangler.prod.toml`)
- **Demo:** https://vigil-demo.calmray.team - read-only, DEMO_MODE, password `demo`,
  seeded mock data (`worker/scripts/seed-demo.mjs`), used for README screenshots/GIF
- **One-click button:** root `wrangler.toml` - D1 binding OMITS `database_id` on purpose
  so Wrangler auto-provisions the database at deploy time (needs wrangler >= 4.45)
- Public repo: `CalmRay-Solutions/uptime-guard`

## Conventions

- **No em-dashes** anywhere (docs or UI text). Use `-`. The user is strict about this.
- **No `Co-Authored-By: Claude` trailer** in commits - user authorship only.
- Plain CSS with OKLCH tokens; inline SVG icons; no CSS framework.
- Keep secrets out of git: `.dev.vars`, `wrangler.{prod,demo,test}.toml`, and
  `wrangler.autotest.toml` are gitignored. Scan before every commit.
- `scrollbar-gutter: stable` is set on `html` - do not add `overflow-y: scroll` on
  `html`/`body` (they already have `height:100%`; that combo breaks page scrolling).

## Versioning / releases

Semver pre-releases, tagged `vX.Y.Z-<stage>.N` and published as GitHub pre-releases.
Keep the version in root, `dashboard/` and `worker/` `package.json` in sync with the tag.

Plan:
1. **Beta** (current): `1.0.0-beta.N` - bump N for each release while features are still landing.
2. **Release candidate:** `1.0.0-rc.N` once features are frozen; bug fixes only.
3. **Stable:** `v1.0.0` (normal GitHub release, not pre-release).
4. **After 1.0:** patch `1.0.1` for fixes, minor `1.1.0` for new features, major `2.0.0` for breaking changes.

Do not go back to `0.x`.

## Gotchas / non-obvious behavior

- **CF-fronted TLS checks:** a Worker cannot raw-socket to Cloudflare edge IPs, so TLS
  checks against Cloudflare-proxied hosts fail the handshake. These are reported as
  `cf_protected` (not `down`) and shown with a Cloudflare glyph. See `checks.ts`/`tls.ts`.
- **Visibility-aware polling:** `usePoll` skips fetches while `document.hidden` is true
  (battery/quota saving). Automated/background browser tabs report hidden, so the
  dashboard can appear stuck on the loading skeleton during automation even though the
  API is healthy - real users are unaffected.
- **Service worker cache:** the SPA is a PWA; after a deploy, bump the SW cache version
  or hard-reload, or clients serve stale assets.
- **Flap prevention:** `performCheckConfirmed` does a short retry-burst before flipping
  status; escalating re-alerts back off (5/10/20/40/60 min). Re-alerts only fire when a
  check runs, so a down TLS/domain monitor is re-checked at least hourly (`runDueChecks`)
  even if its interval is daily - otherwise a renewed cert stays "down" for up to a day.
- **Script monitors are NOT JavaScript:** Workers disable `eval`/`new Function`, so custom
  scripts are a declarative line format (`script.ts`) the Worker interprets. Never try to
  execute user-supplied JS. Limits: 10 steps, 8000 chars, one shared timeout budget
  (default 30s, max 60s) across the whole run. Scripts are parsed in `buildScript` at save
  time so a syntax error is a 400, not a silently failing monitor.
- **Local API testing:** `wrangler dev` reads `.dev.vars` (the user's real password and
  Telegram token) and `--var` does NOT override it - use `--env-file <path>` with throwaway
  creds and blank Telegram vars, or a local down-check will alert the user's real chat.
  Also: killing the wrangler shell does not kill `workerd` on Windows, and the orphan keeps
  port 8788, so a "wrong password" against a fresh dev server usually means a stale instance
  is answering. Kill by matching `workerd.exe` / the config name before retrying.

## Current Status  *(update this block on every functional change)*

Shipped and live on prod + demo:
- Monitors: HTTP, TCP, DNS, heartbeat (push-ping), TLS cert expiry, domain expiry,
  custom script (multi-step declarative flows)
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

Most recent work: TLS/domain monitors no longer say up/down. Dashboard pills read
Valid / Expiring / Expired / Check failed (`labelOf`, `checkLabel` in `derive.ts`); an
expiring-but-valid cert is `warn`, not `down`, in the dashboard and public status page.
Heartbeats read On time / Missed / No pings yet. Telegram/push alerts use `alertHeadline`
("certificate expires in 9d (04 Oct 2026)", "missed its check-in", "checked in again");
browser toasts use `changePhrase`. The backend still stores `down` for expiring so incidents
and re-alerts keep working. Overview banner no longer counts paused monitors as up or
claims a Telegram alert was sent. Before that: a seventh monitor type, **custom script**. `worker/src/script.ts` parses a
line-based DSL (`GET <url>` starts a step; `header`, `body`, `expect status|time|body|json`,
`capture <name> = json|header|status|body`, `#` comments, `{{name}}` interpolation) and runs the
steps in order, sharing one timeout budget. Any failed assertion marks the monitor down with an
error naming the step: `step 2 (GET api.example.com/orders): orders.count = 0, expected > 0`. A step
without `expect status` defaults to 2xx. Wired through `buildScript` (validates at save time),
`checkScript`, `TYPES`/`typeMeta`, a textarea + directive cheatsheet in `AddServiceModal`, and a
read-only Script section on `ServiceDetail`. Before that: projects can be renamed and deleted from the dashboard (`ProjectModal`, opened by
the "Project" button in the Overview bar; `PATCH /api/projects/:id` now takes `name`, delete
cascades and asks for the name to be typed when the project still has monitors). Settings tabs wrap
instead of scrolling on mobile - the old row-scroller kept the desktop `width:100%` per button and
overflowed the screen. Before that: a fresh instance seeds one project, "My Project", from `ensureSchema`
(`seedDefaultProject`, guarded by the `default_project_seeded` settings row so deleting every
project does not bring it back). Before that: authenticator pairing became a required second step of the first-run wizard
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
