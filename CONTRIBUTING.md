# Contributing to Uptime Guard

Thanks for your interest! Contributions of all sizes are welcome.

## Development setup

```bash
git clone https://github.com/CalmRay-Solutions/uptime-guard.git
cd uptime-guard
cp worker/.dev.vars.example worker/.dev.vars    # fill in local values

# Worker (API + cron), local D1
cd worker && npm install
npm run db:init            # local D1 schema
npm run dev                # wrangler dev on http://localhost:8787

# Dashboard (in another terminal, for hot-reload)
cd ../dashboard && npm install
npm run dev
```

> The committed `worker/wrangler.toml` is a deployable template. For your own deploys, either use
> the **Deploy to Cloudflare** button or set `database_id` after `wrangler d1 create`.

## Before you open a PR

- **Type-check both packages:** `npx tsc --noEmit` in `worker/` and `dashboard/`.
- **Build the dashboard:** `npm run build` in `dashboard/`.
- Keep the style of the surrounding code — the dashboard uses plain CSS (no Tailwind) and inline
  SVG icons; the Worker is dependency-light and uses the Web Crypto / `cloudflare:sockets` APIs.
- One focused change per PR where possible, with a clear description of the user-visible effect.

## Good first issues

- Additional alert channels (email, Slack, Discord, generic webhook).
- New monitor types or assertions.
- Unit tests for the check dispatch, TLS DER parser (`worker/src/tls.ts`), and TOTP.
- Accessibility and mobile polish.

## Reporting bugs

Open an issue with steps to reproduce, what you expected, and what happened. Screenshots or the
relevant `wrangler tail` output help a lot.

## Security

Please do **not** file security issues publicly — see [SECURITY.md](./SECURITY.md).
