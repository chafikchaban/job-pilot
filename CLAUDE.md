# CLAUDE.md — JobPilot

## Project Overview

JobPilot is a macOS desktop application for automated job search, application tracking, and cover letter generation. Built with Tauri (Rust backend) + React (TypeScript frontend). Runs locally, stores everything in SQLite, and scans job portals on a schedule.

## Tech Stack

- **Desktop framework:** Tauri v2 (Rust backend, webview frontend)
- **Frontend:** React 18+ with TypeScript, Vite, TailwindCSS
- **Backend logic:** Rust (Tauri commands, background tasks, cron via tokio-cron-scheduler)
- **Database:** SQLite via rusqlite (Rust-side) with SQL migrations
- **Scraping:** Playwright (Node.js sidecar) for LinkedIn and Stepstone.de
- **HTTP clients:** reqwest (Rust) for API-based job sources
- **Cover letters:** Anthropic Claude API (claude-sonnet-4-5-20250929)
- **Web search:** Brave Search API for augmented job discovery
- **Package manager:** pnpm for the frontend workspace
- **Testing:** Vitest (frontend), cargo test (Rust)

## Architecture

```
jobpilot/
├── src-tauri/           # Rust backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/    # Tauri IPC commands
│   │   ├── db/          # SQLite schema, migrations, queries
│   │   ├── sources/     # Job source adapters (API + scraping orchestration)
│   │   ├── matching/    # Relevance scoring engine
│   │   ├── scheduler/   # Cron job management
│   │   └── cover_letter/ # Claude API integration
│   ├── migrations/      # SQL migration files
│   └── Cargo.toml
├── src/                 # React frontend
│   ├── components/      # Reusable UI components
│   ├── pages/           # Route-level pages
│   │   ├── Dashboard.tsx
│   │   ├── Jobs.tsx
│   │   ├── Applications.tsx
│   │   ├── Resume.tsx
│   │   ├── CoverLetters.tsx
│   │   └── Settings.tsx
│   ├── hooks/           # Custom React hooks (useJobs, useResume, etc.)
│   ├── lib/             # Utilities, Tauri IPC wrappers, types
│   └── App.tsx
├── scripts/             # Playwright scraping scripts (Node.js sidecar)
├── .planning/           # GSD planning files
├── ROADMAP.md
├── CLAUDE.md            # This file
├── package.json
├── vite.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

## Database Schema (Core Tables)

```sql
-- Resume data
CREATE TABLE resume (
  id INTEGER PRIMARY KEY,
  raw_file BLOB,
  file_name TEXT,
  parsed_json TEXT,  -- structured: skills, experience, education, languages
  target_roles TEXT, -- JSON array of target role descriptions
  updated_at DATETIME
);

-- Job listings from all sources
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  company TEXT,
  location TEXT,
  remote_policy TEXT,        -- 'remote' | 'hybrid' | 'onsite'
  description TEXT,
  url TEXT NOT NULL,
  apply_url TEXT,
  source TEXT NOT NULL,      -- 'adzuna' | 'linkedin' | 'stepstone' | etc.
  language TEXT,             -- 'en' | 'de' | 'both'
  german_level_required TEXT, -- 'none' | 'B1' | 'B2' | 'C1' | 'native'
  posted_at DATETIME,
  fetched_at DATETIME,
  relevance_score REAL,
  dedup_hash TEXT UNIQUE,
  raw_json TEXT
);

-- Application tracking
CREATE TABLE applications (
  id INTEGER PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id),
  status TEXT DEFAULT 'interested', -- interested | applied | interview | offer | rejected | withdrawn
  applied_at DATETIME,
  notes TEXT,
  follow_up_date DATETIME,
  cover_letter_id INTEGER REFERENCES cover_letters(id),
  updated_at DATETIME
);

-- Generated cover letters
CREATE TABLE cover_letters (
  id INTEGER PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id),
  content TEXT,
  language TEXT,
  tone TEXT,
  generated_at DATETIME,
  edited_at DATETIME
);

-- User settings
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Scan history
CREATE TABLE scan_log (
  id INTEGER PRIMARY KEY,
  source TEXT,
  jobs_found INTEGER,
  jobs_new INTEGER,
  started_at DATETIME,
  completed_at DATETIME,
  error TEXT
);
```

## Job Source Adapter Interface

Every job source (API or scraper) implements this Rust trait:

```rust
#[async_trait]
pub trait JobSource: Send + Sync {
    fn name(&self) -> &str;
    fn source_type(&self) -> SourceType; // Api | Scraper | WebSearch
    async fn fetch_jobs(&self, query: &SearchQuery) -> Result<Vec<RawJobListing>>;
    fn requires_api_key(&self) -> bool;
}
```

The `SearchQuery` struct contains: keywords, location, remote_policy, date_range, language, and page/offset.

## Coding Conventions

- **TypeScript:** Strict mode, no `any`. Use Zod for runtime validation of IPC responses.
- **React:** Functional components only. Use `@tanstack/react-query` for async state from Tauri commands.
- **Rust:** Use `thiserror` for error types. All Tauri commands return `Result<T, String>`. Use `serde` for all IPC serialization.
- **Naming:** snake_case in Rust, camelCase in TypeScript. Database columns are snake_case.
- **File size:** Keep files under 300 lines. Split into modules early.
- **Commits:** Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).

## Key Design Decisions

1. **Rust for job fetching, not Node.js** — reqwest is faster and more reliable for concurrent HTTP. Playwright sidecar only for portals that truly need browser rendering.
2. **SQLite, not JSON files** — Need relational queries (joins between jobs and applications), deduplication, and efficient filtering.
3. **Plugin architecture for sources** — Each job portal is an isolated adapter. Easy to add/remove sources without touching core logic.
4. **Cover letters via Claude API** — The prompt includes: full resume JSON, job description, company context, user tone preferences, and target language.
5. **Cron runs in Rust** — tokio-cron-scheduler runs in the Tauri backend process, survives window minimize, sends notifications via tauri-plugin-notification.

## MCP Servers to Use

When running as a Claude Code project, these MCP servers enhance the workflow:

- **filesystem** — Read/write resume files, export data
- **brave-search** — Discover job postings beyond configured portals
- **sqlite** — Direct database inspection during development
- **playwright** — Browser automation for scraping LinkedIn and Stepstone

## Environment Variables / API Keys

Stored in SQLite `settings` table (not .env files — this is a desktop app):

- `ADZUNA_APP_ID` + `ADZUNA_APP_KEY`
- `RAPIDAPI_KEY` (for JSearch)
- `BRAVE_SEARCH_API_KEY`
- `ANTHROPIC_API_KEY` (for cover letter generation)

## User Profile Defaults

```json
{
  "target_roles": [
    "Senior Frontend Engineer",
    "Full-Stack TypeScript Developer",
    "React Native Developer"
  ],
  "preferred_remote_policy": "remote",
  "accept_hybrid": true,
  "regions": ["Germany", "EU"],
  "languages": ["en", "de"],
  "german_level": "B1",
  "min_experience_years": null,
  "excluded_companies": [],
  "excluded_keywords": []
}
```

## Common Tasks

```bash
# Development
pnpm tauri dev          # Run app in dev mode
pnpm test               # Run frontend tests
cd src-tauri && cargo test  # Run Rust tests

# Build
pnpm tauri build        # Build .dmg for macOS

# Database
# Migrations auto-run on app start via src-tauri/src/db/migrate.rs
```

## Important Notes

- LinkedIn scraping is fragile — always have a fallback. Rate limit to 1 request per 3 seconds minimum.
- Stepstone.de uses German locale — set Accept-Language header appropriately.
- Dedup hash = lowercase(title + company + location). Check before inserting.
- Cover letter generation costs API tokens — always confirm with user before generating.
- Scan scheduler should respect macOS sleep/wake cycles — re-check on wake.
- All user data stays local. No telemetry. No cloud sync.
