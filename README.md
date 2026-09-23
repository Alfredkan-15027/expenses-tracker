# Expenses Tracker

A private, single-user expense tracker for iPhone — installable as a web app (PWA), designed in the
iOS 27 Liquid Glass style, with analysis tuned for a 24-year-old founder living in Kuala Lumpur.

**Privacy:** there is no server, no account and no analytics. All records live in the browser storage
(IndexedDB) of the device you use. Opening this site on another device shows an empty app.

## Features

- **3-second logging** — big keypad, tap a category to save; quick picks for repeated items; undo
- **Today's allowance** — (expected income − savings target − spent − upcoming fixed costs) ÷ days left
- **Fixed items** — rent, phone plan, subscriptions, salary logged automatically each month
- **Personal vs business** — founder spending is tracked but kept out of the living-cost evaluation
- **Monthly analysis** — KL 24yo founder benchmark (EPF Belanjawanku), per-category reasonable ranges,
  savings rate, needs/wants balance, month-over-month changes, 6-month trend, personal runway
- **Investments** — RM 1.75M / 10-year plan: required yearly contribution at 8–10%, projection band, holdings,
  money in/out, market value updates, money-weighted annual return (XIRR)
- **Safety** — 6-digit passcode (salted PBKDF2 hash) with Face ID via a device passkey (WebAuthn) and adjustable auto-lock;
  scheduled backups (daily / weekly / monthly) to iCloud via the share sheet, or to the app-private Google Drive
  folder encrypted with AES-256-GCM (key derived from a 140-bit recovery key only the user holds); CSV export; strict CSP
  (the only outside connection is the opt-in Google Drive backup)

## Project layout

```
index.html, manifest.webmanifest, sw.js   App shell, install metadata, offline cache
src/core/      Pure logic (money, dates, analysis, benchmarks, recurring, backup) — unit tested
src/data/      IndexedDB, in-memory store, passcode, demo data
src/ui/        Screens, sheets, charts, overlays
styles/        Design layer (tokens, base, components, screens)      ← Codex may edit
assets/icons/  Glyph sprite + app icons                                ← Codex may edit
scripts/       Dev server, Codex scope guard, security audit
tests/         Node test runner tests
docs/          iPhone guide, deployment notes, Codex proposals
```

## Develop

Requires Node 20+ (no npm packages needed).

```bash
npm run dev              # http://localhost:5173  (demo data: /?demo=1)
npm test                 # unit tests
npm run check:security   # privacy & security audit
npm run check:codex      # verify only the design layer changed
```

## Guides

- [docs/IPHONE_SETUP.md](docs/IPHONE_SETUP.md) — install on iPhone, daily reminder, backups
- [docs/DEPLOY.md](docs/DEPLOY.md) — how the site is hosted and how to publish updates
- [CODEX_DESIGN.md](CODEX_DESIGN.md) / [AGENTS.md](AGENTS.md) — design hand-off and edit boundary for Codex
