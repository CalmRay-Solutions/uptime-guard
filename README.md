<div align="center">

<img src="./docs/logo.svg" alt="Uptime Guard" width="96" height="96">

# Uptime Guard

### Uptime monitoring with **zero servers**. Runs 100% on Cloudflare. **Free.**

Monitor your websites, APIs, TCP ports, DNS, TLS certificates, domains and cron jobs -
no VPS, no container, no monthly bill. Just a Cloudflare Worker, a database, and a dashboard.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/CalmRay-Solutions/uptime-guard)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Runs free on Cloudflare](https://img.shields.io/badge/runs%20free%20on-Cloudflare-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![No server required](https://img.shields.io/badge/servers-0-brightgreen)](#why-uptime-guard)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

### [▶ Try the live demo](https://vigil-demo.calmray.team) &nbsp;·&nbsp; password `demo` &nbsp;·&nbsp; [see a public status page](https://vigil-demo.calmray.team/status/demo)

<img src="./docs/screenshots/overview.jpg" alt="Uptime Guard dashboard" width="820">

</div>

---

## Why Uptime Guard?

Every other uptime tool makes you choose: **pay per monitor** (UptimeRobot, Pingdom, Better Uptime)
or **host it on a server you then have to monitor too** (Uptime Kuma on a VPS). Uptime Guard is
neither. It runs entirely on **Cloudflare Workers + D1**, so there's **nothing to keep alive** and,
for a typical fleet, **nothing to pay**.

|  | Uptime Guard | SaaS monitors | Self-hosted (VPS) |
|---|:---:|:---:|:---:|
| Monthly cost | **$0** | $$ per monitor | VPS bill |
| Server to maintain | **None** | - | You run it |
| Who monitors the monitor? | Cloudflare's edge | vendor | 🤷 nobody |
| Your data | **Your Cloudflare account** | vendor's cloud | your box |
| Deploy time | **~2 min, one click** | signup | provision + install |
| Public status page | ✅ built-in | often paid | varies |

> **No server. No monthly bill. No babysitting.** Push it to Cloudflare and forget it's there -
> until it pings you on Telegram because something you care about went down.

## Runs on Cloudflare's free tier

The whole thing fits inside Cloudflare's **free** limits for a real-world fleet:

- **Workers**: 100k requests/day free - a per-minute cron is ~1,440/day.
- **D1**: 5 GB storage + 5M row-reads/day free - history is rolled up daily and pruned.
- **Static assets**: the dashboard is served free from the same Worker.

Dozens of monitors, checked every minute, with 90 days of history - comfortably **$0/month**.

## Features

| | |
|---|---|
| **6 monitor types** | HTTP(S), TCP port, DNS record, TLS certificate expiry, domain (registrar) expiry, and heartbeat (dead-man's switch) |
| **Alerts that escalate** | Telegram **+** desktop Web Push on down/recovery, with widening re-alerts (5m → 10m → 20m → 40m → hourly) and total downtime on recovery |
| **No false alarms** | A single failed check is re-confirmed in seconds before it ever pages you |
| **Real reliability data** | Per-service 24h / 7d / 30d / 90d uptime, incident history, and mean-time-to-recovery |
| **Public status pages** | Share a read-only page per project - no login, edge-cached, sanitized |
| **Installable PWA** | Add to your desktop/phone; push notifications work even when it's fully closed |
| **Locked down** | Password **+** TOTP login, rate-limiting, one-click session revocation |
| **Configure in-app** | Telegram bot/chat/thread and your authenticator are editable right in Settings |
| **Cloudflare-aware** | Detects CF-fronted hosts and shows a calm "CF Protected" state instead of false downs |

## Screenshots

<div align="center">

| Service detail - SLA windows & MTTR | Incident history |
|:--:|:--:|
| <img src="./docs/screenshots/service-detail.jpg" width="400"> | <img src="./docs/screenshots/incidents.jpg" width="400"> |
| **Public status page** - shareable, no login | |
| <img src="./docs/screenshots/status-page.jpg" width="400"> | |

</div>

## Deploy in ~2 minutes

### Option A - one click

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/CalmRay-Solutions/uptime-guard)

Cloudflare provisions the D1 database, builds the dashboard, and deploys the Worker. Then open the
URL, **create your password on the first-run screen, and you're monitoring.** No secrets to set, no
schema to run - the app initializes itself.

### Option B - from your terminal

```bash
git clone https://github.com/CalmRay-Solutions/uptime-guard.git
cd uptime-guard/worker && npm install && npx wrangler login

# Create the database and paste the printed id into wrangler.toml
npx wrangler d1 create uptime-guard

# Build the dashboard + deploy the Worker in one command
npx wrangler deploy
```

Open the printed URL - the first visit shows a **"create your account"** screen. Set a password,
create a project, and add your first monitor. Checks start within 60 seconds. The database schema
is created automatically, and the session secret is generated for you.

**Optional, all from the dashboard's Settings - never required:**
- **Two-factor auth** - scan a QR to add TOTP to your login.
- **Telegram alerts** - paste a bot token + chat id (or set `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`).
- **Web Push** - add VAPID keys for desktop notifications.

## Architecture

```
┌────────────────────────┐        every 60s        ┌──────────────────┐
│  Cloudflare Worker      │ ── scheduled() cron ──▶ │  runs due checks  │
│  • REST API (/api/*)    │                         │  http/tcp/dns/tls │
│  • serves the dashboard │ ◀── records results ──  │  domain/heartbeat │
│  • Telegram + Web Push  │                         └──────────────────┘
└───────────┬────────────┘
            │ binds
      ┌─────▼─────┐   ┌──────────────────────────────┐
      │  D1 (SQL) │   │  React + Vite dashboard (SPA) │
      │  projects │   │  served from the same Worker  │
      │  services │   │  password + TOTP auth         │
      │  checks   │   └──────────────────────────────┘
      │  incidents│
      │  rollups  │
      └───────────┘
```

- **`worker/`** - the Cloudflare Worker: REST API, a `scheduled()` cron (per-minute checks + a daily
  rollup/prune job), Telegram + Web Push, and it serves the built dashboard from the assets binding.
- **`dashboard/`** - a React + Vite SPA (hand-rolled CSS, embedded fonts, inline icons - no runtime
  CDN). Talks to the Worker over the REST API with a signed session token.

## Monitor types

- **HTTP(S)** - fetch a URL, assert the status range, optionally a body keyword or a JSON field.
- **TCP Port** - open a raw socket to `host:port`. SSH, Postgres, SMTP, game servers, anything.
- **DNS record** - resolve A/AAAA/CNAME/MX/TXT/NS over DNS-over-HTTPS, optionally asserting the value.
- **TLS certificate** - parse the served cert's expiry and warn before it lapses. CF-fronted hosts
  show a non-alerting **CF Protected** state.
- **Domain expiry** - registrar expiry via RDAP, warns before it lapses.
- **Heartbeat** - a dead-man's switch: your cron hits a unique `/ping/<token>` URL each run; a
  missing ping within the grace window flips it down.

## Security

Password **+** TOTP login with HMAC-signed sessions, login rate-limiting with a progressive delay
and hard lockout, and one-click **session revocation**. Public status pages expose only names,
status and uptime - never targets, IPs, or config. See [SECURITY.md](./SECURITY.md).

## Limitations & roadmap

- **Single owner** - one operator account, no multi-user/teams yet.
- **Runs on Cloudflare** - if Cloudflare itself has an outage, checks pause. A redundant external
  runner is the natural phase 2.
- **Telegram + Web Push** today - email / Slack / Discord and maintenance windows are on the roadmap.

PRs for any of these are very welcome - see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) © CalmRay · ⭐ the repo if this saved you a server.
