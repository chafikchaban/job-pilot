# CLAUDE.md — JobPilot

## Project Overview

JobPilot is a macOS desktop application for automated job search, application tracking, and cover letter generation. Built with Tauri v2 (Rust backend) + React (TypeScript frontend). Runs locally, stores everything in SQLite, and scans job portals manually or on a schedule.

Core flow: **Settings → Sources (concurrent) → Pre-filter → AI filter → Insert**, with live progress shown on the Scan page.

## Tech Stack

- **Desktop framework:** Tauri v2 (Rust backend, webview frontend)
- **Frontend:** React 19 + TypeScript, Vite, TailwindCSS v4, TanStack Query, react-router, Zod, Recharts
- **Backend logic:** Rust (Tauri commands, background tasks, cron via tokio-cron-scheduler)
- **Database:** SQLite via rusqlite; schema and migrations live in `src-tauri/src/db/migrate.rs` (idempotent, run on app start)
- **Scraping:** Playwright (Node.js sidecar in `scripts/`) for LinkedIn, Stepstone and user-defined boards
- **HTTP clients:** reqwest (Rust) for API-based job sources
- **AI:** Anthropic API. `claude-haiku-4-5` for batch job filtering (`filtering/ai_filter.rs`); `claude-sonnet-4-5` for cover letters and resume parsing
- **Web search:** Brave Search API
- **Package manager:** pnpm (frontend); npm in `scripts/`
- **Testing:** Vitest (frontend), cargo test (Rust)

## Architecture

```
├── src-tauri/src/
│   ├── lib.rs            # Tauri setup + command registration
│   ├── commands/         # IPC commands (jobs, applications, resume, cover_letters,
│   │                     #   scheduler, settings, web_search, export, matching)
│   ├── db/               # SQLite schema/migrations (migrate.rs) and queries
│   ├── sources/          # Job source adapters
│   │   ├── orchestrator.rs   # Runs enabled sources concurrently, emits scan-progress
│   │   ├── query_builder.rs  # Per-source queries (scrapers get full titles, APIs get concise terms)
│   │   └── adzuna, arbeitnow, brave_search, jsearch, linkedin, remotive, stepstone, the_muse
│   ├── filtering/        # prefilter.rs (Tier 1 rules) → ai_filter.rs (Tier 2 Claude)
│   │                     #   → pipeline.rs (chains both, produces ScoredJob + PipelineStats)
│   ├── matching/         # Rule-based scorer (fallback scoring; helpers reused by prefilter)
│   ├── cover_letter/     # Prompt + generator
│   ├── scheduler/        # Cron scans
│   └── mcp/              # Optional MCP server (disabled by default)
├── src/
│   ├── pages/            # Scan (home, "/"), Applications, Resume, CoverLetters, Settings
│   ├── components/       # Sidebar, JobDetailModal, settings/, analytics/
│   ├── hooks/            # useJobs, useResume, useSettings, ... (TanStack Query wrappers)
│   └── lib/              # types.ts (Zod schemas), tauri.ts, job-parser.ts
├── scripts/              # Playwright sidecars: linkedin-scraper, stepstone-scraper,
│                         #   linkedin-login, site-login (generic login helper)
├── ROADMAP.md
└── mcp-server-config.json
```

Note: `src/pages/Dashboard.tsx` still exists but is no longer routed — the Dashboard, Jobs and Scans pages were merged into `Scan.tsx`.

## Scan Pipeline

1. `scan_jobs` (`commands/jobs.rs`) creates a `scans` row, builds the `SourceOrchestrator` from `source_*_enabled` settings, and fetches all sources concurrently.
2. `enrich_remote_policy` infers remote/hybrid/onsite from the description when the source didn't provide it.
3. **Pre-filter** (rules): title blocklist, EU geography, tech relevance, excluded companies/keywords, dedup against existing hashes.
4. **AI filter** (if `ai_filter_enabled` and an API key exists): Claude scores batches 0–100 with a reason and extracts `parsed_info` (skills, seniority, remote_policy, etc.). All scores are returned and stored; the caller applies `ai_filter_threshold`. If the API fails, it falls back to rule-based scoring; if disabled, all pre-filter survivors pass.
5. Survivors are inserted via `db::jobs::insert_job_with_score` with the `scan_id`.

Progress is emitted as `scan-progress` Tauri events (`stage`, `message`, `detail`, `source`, `count`, `total`) and consumed by `Scan.tsx`.

## Database

Tables: `resume`, `jobs`, `applications`, `cover_letters`, `settings` (key/value), `scan_log`, `scans`. Read `db/migrate.rs` for the authoritative schema.

Notable `jobs` columns added by migration: `match_reason`, `ai_scored`, `parsed_info` (JSON), `scan_id`. Relevance scores are on a 0–100 scale. Dedup hash = lowercase(title + company + location).

Settings keys are lowercase snake_case (e.g. `adzuna_app_id`, `source_adzuna_enabled`). Defaults are seeded with `INSERT OR IGNORE` at the end of `run_migrations`.

## Job Source Interface

```rust
#[async_trait]
pub trait JobSource: Send + Sync {
    fn name(&self) -> &str;
    fn source_type(&self) -> SourceType; // Api | Scraper | WebSearch
    async fn fetch_jobs(&self, query: &SearchQuery) -> Result<Vec<RawJobListing>, Box<dyn Error + Send + Sync>>;
    fn requires_api_key(&self) -> bool;
}
```

To add a source: implement the trait in `sources/`, register it in `orchestrator.rs`, add a `source_<name>_enabled` default in `migrate.rs`, and add a per-source query in `query_builder.rs`.

## Scrapers and Logins

- Scrapers run as `node scripts/<name>.js`; input JSON on stdin, `RawJobListing[]` JSON on stdout, logs on stderr.
- Authenticated scraping uses a persistent Chromium profile per site at `~/Library/Application Support/com.jobpilot.app/<site>_browser`.
- Login is generic: `scraper_login(site, login_url)` runs `site-login.js`, which opens a visible browser for a manual sign-in (3 minute timeout). `linkedin_login*` commands delegate to it.
- User-defined boards are stored as JSON in the `custom_scraper_boards` setting. Page limits: `linkedin_max_pages`, `stepstone_max_pages`.

## Configuration / API Keys

Stored in the SQLite `settings` table and edited on the Settings page — not `.env` files. Keys: `adzuna_app_id`, `adzuna_app_key`, `rapidapi_key`, `brave_search_api_key`, `anthropic_api_key`. Free sources need no key: The Muse, Remotive, Arbeitnow.

Default profile: target roles Senior Frontend Engineer / Full-Stack TypeScript Developer / React Native Developer, remote preferred (hybrid accepted), regions Germany + EU, languages en/de, German level B1.

## Coding Conventions

- **TypeScript:** Strict mode, no `any`. Use Zod for runtime validation of IPC responses.
- **React:** Functional components only. Use `@tanstack/react-query` for async state from Tauri commands.
- **Rust:** All Tauri commands return `Result<T, String>`. Use `serde` for IPC serialization.
- **Naming:** snake_case in Rust and DB columns, camelCase in TypeScript.
- **Tauri IPC gotcha:** Rust command params are auto-converted to camelCase for JS (`job_id` → `jobId`). `invoke` calls MUST use camelCase.
- **File size:** Prefer files under 300 lines and split modules early (`Scan.tsx` and `Settings.tsx` are currently well over this).
- **Commits:** Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).

## Common Tasks

```bash
pnpm install && (cd scripts && npm install && npx playwright install chromium)
pnpm tauri dev                    # Run app in dev mode
pnpm build                        # Type-check + build frontend only
pnpm test                         # Frontend tests
cd src-tauri && cargo check       # Check Rust (add PATH=$HOME/.cargo/bin:$PATH if needed)
cd src-tauri && cargo test        # Rust tests
pnpm tauri build                  # Build .dmg
```

Rust currently emits dead-code warnings (MCP server, unused trait methods); these are expected.

## Important Notes

- LinkedIn scraping is fragile and may violate ToS — keep a fallback and rate limit (at least 3s between requests).
- Stepstone.de uses a German locale.
- Cover letter generation and AI filtering cost API tokens — confirm with the user before bulk generation.
- The MCP server is off by default (`mcp_server_enabled`); the default port in settings is 3333, while `mcp-server-config.json` lists 3100 — reconcile before relying on either.
- All user data stays local. No telemetry. No cloud sync.
- Never commit `*.db`, API keys, or browser profiles/session files.
