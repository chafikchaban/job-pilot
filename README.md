# JobPilot

A desktop app (Tauri v2 + React + TypeScript) that automates job search for the EU/German market: it pulls listings from many sources, filters them with rules and Claude, tracks your applications, and drafts cover letters.

## Features

- **Multi-source scanning** — The Muse, Remotive, Arbeitnow (no key needed), Adzuna, JSearch (RapidAPI), Brave Search, plus Playwright scrapers for LinkedIn, Stepstone and custom job boards.
- **Two-tier filtering** — fast rule-based pre-filter (title blocklist, geography, tech relevance, dedup), then optional Claude scoring (0–100 with a short reason and extracted details such as skills, seniority and remote policy).
- **Live scan page** — progress per stage, scan history, and the jobs found in each scan.
- **Resume management** — import PDF/DOCX, parsed into skills, experience and target roles that drive matching.
- **Application tracker** — Interested → Applied → Interview → Offer → Rejected / Withdrawn.
- **Cover letters** — tailored English or German letters generated with Claude.
- **Scheduled scans, web search augmentation, CSV/JSON export, analytics, and an optional MCP server.**

## Requirements

- [Rust](https://rustup.rs) (stable) and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- Node.js 20+ and [pnpm](https://pnpm.io)
- macOS is the primary target (the data path and notifications assume it)

## Setup

```sh
pnpm install

# Scraper dependencies (LinkedIn / Stepstone / custom boards)
cd scripts
npm install
npx playwright install chromium
cd ..

pnpm tauri dev
```

The first run compiles the Rust backend and can take a few minutes.

## Configuration

Everything is configured in the in-app **Settings** page and stored locally in SQLite. Nothing is read from environment variables.

| Setting | Used for |
|---|---|
| Anthropic API key | AI filtering and cover letters |
| Adzuna app id + key | Adzuna source |
| RapidAPI key | JSearch source |
| Brave Search API key | Web search source |

Sources that need a login (LinkedIn, Stepstone, custom boards) open a visible Chromium window so you can sign in yourself. The browser profile stays on your machine.

The database lives at `~/Library/Application Support/com.jobpilot.app/jobpilot.db`.

## Project layout

```
src/                  React frontend (pages, hooks, components)
src-tauri/src/
  commands/           Tauri IPC commands
  sources/            Job sources + orchestrator + per-source query builder
  filtering/          prefilter -> AI filter -> pipeline
  matching/           Rule-based scoring
  cover_letter/       Prompt + generator
  scheduler/          Background scans
  mcp/                Optional MCP server
  db/                 SQLite schema, migrations, queries
scripts/              Playwright scrapers and login helpers (Node)
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm tauri dev` | Run the app in development |
| `pnpm build` | Type-check and build the frontend |
| `pnpm test` | Run frontend tests (Vitest) |
| `cargo check` (in `src-tauri/`) | Check the Rust backend |

## Notes

- Scraping LinkedIn and other sites may violate their terms of service. Use it for personal use at your own risk, and keep request volume low.
- The app never applies to jobs on your behalf.
