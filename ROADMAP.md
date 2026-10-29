# ROADMAP — JobPilot

> Tauri + React desktop app for automated job search, application tracking, and cover letter generation.
> Target market: EU/Germany, English + German (B1-friendly), remote-preferred roles.

---

## Milestone 1: Core Foundation

### Phase 1 — Project Scaffolding & Architecture

Set up Tauri + React + TypeScript monorepo. Configure Vite, TailwindCSS, and the Rust backend. Establish SQLite database schema (jobs, applications, resume, settings, cover_letters). Set up IPC bridge between frontend and Rust backend. Create the app shell with sidebar navigation.

**Requirements:** M1-R01, M1-R02, M1-R03

### Phase 2 — Resume Management

Build the resume import and storage system. Support PDF and DOCX upload, parse into structured data (experience, skills, education, languages, target roles). Store in SQLite. Provide a resume viewer/editor in the UI. Allow re-upload to update. Resume data feeds into all downstream matching and cover letter generation.

**Requirements:** M1-R04, M1-R05

### Phase 3 — Job Source Engine (API-Based)

Implement the job fetching layer with a plugin architecture. Start with API-based sources: Adzuna, The Muse, Remotive, Arbeitnow, JSearch (RapidAPI). Each source is a TypeScript adapter implementing a common `JobSource` interface. Normalize all results into a unified `JobListing` schema. Store fetched jobs in SQLite with deduplication by URL/title+company hash.

**Requirements:** M1-R06, M1-R07, M1-R08

### Phase 4 — Job Source Engine (Scraping-Based)

Add Playwright-based scraping adapters for LinkedIn job search and Stepstone.de. Handle pagination, rate limiting, and anti-bot detection gracefully. Implement retry logic and user-agent rotation. These adapters implement the same `JobSource` interface as Phase 3.

**Requirements:** M1-R06, M1-R09

### Phase 5 — Job Matching & Relevance Scoring

Build the matching engine that scores each job against the user's resume profile. Use keyword overlap (skills, technologies, role titles), language requirements (flag jobs requiring fluent German vs B1-friendly), location/remote policy matching, and experience level alignment. Rank and sort results by relevance score.

**Requirements:** M1-R10, M1-R11

### Phase 6 — Job Dashboard & Filters

Build the main job listings view. Display matched jobs in a sortable, filterable table/card layout. Filters: recency (date range), remote/hybrid/on-site, source platform, relevance score threshold, language requirement, location/region. Each job card shows: title, company, location, remote policy, relevance score, posted date, source, direct link to job posting, and apply link.

**Requirements:** M1-R12, M1-R13, M1-R14

---

## Milestone 2: Automation & Intelligence

### Phase 7 — Application Tracker

Build the application tracking system. Statuses: Interested → Applied → Interview → Offer → Rejected → Withdrawn. Track application date, notes, follow-up reminders. View all applications in a kanban board or table view. Link each application back to its job listing.

**Requirements:** M2-R01, M2-R02

### Phase 8 — Cover Letter Generator

Integrate Claude API (or local LLM) for cover letter generation. For each job listing, generate a tailored cover letter using: resume data, job description, company info, and user tone preferences. Support English and German output. Allow editing before saving. Store generated cover letters linked to applications.

**Requirements:** M2-R03, M2-R04, M2-R05

### Phase 9 — Scheduled Job Scanning (Cron)

Build the scheduling system. Use Rust-side background tasks (tokio cron) that run even when the app window is minimized. Settings UI for: scan frequency (hourly/daily/custom cron expression), active hours, which sources to scan, notification preferences. macOS system notifications when new matching jobs are found.

**Requirements:** M2-R06, M2-R07, M2-R08

### Phase 10 — Web Search Augmentation

Add a Brave Search / web search integration to discover job postings beyond the configured portals. Search queries auto-generated from resume profile + target roles. Results parsed and fed into the same normalization pipeline. User can add/remove search query templates.

**Requirements:** M2-R09, M2-R10

---

## Milestone 3: Polish & Power Features

### Phase 11 — Settings & Configuration UI

Centralized settings page: API keys management (Adzuna, RapidAPI, Brave Search, Claude API), job source enable/disable toggles, default filters, scan schedule, cover letter tone/style preferences, resume target roles and keywords, region/language preferences.

**Requirements:** M3-R01, M3-R02

### Phase 12 — Data Export & Analytics

Export applications to CSV/JSON. Basic analytics dashboard: applications over time, response rates by source, jobs discovered per scan. Optional: generate a weekly summary report.

**Requirements:** M3-R03, M3-R04

### Phase 13 — MCP Server Integration

Expose the app's capabilities as an MCP server so Claude Code or other tools can: query the job database, trigger scans, generate cover letters, and update application statuses programmatically.

**Requirements:** M3-R05, M3-R06

---

## Progress

| Phase | Status | Plans |
|-------|--------|-------|
| 01 — Scaffolding & Architecture | Complete | — |
| 02 — Resume Management | Complete | — |
| 03 — Job Source Engine (APIs) | Complete | — |
| 04 — Job Source Engine (Scraping) | Complete | — |
| 05 — Job Matching & Scoring | Complete | — |
| 06 — Job Dashboard & Filters | Complete | — |
| 07 — Application Tracker | Complete | — |
| 08 — Cover Letter Generator | Complete | — |
| 09 — Scheduled Scanning | Complete | — |
| 10 — Web Search Augmentation | Complete | — |
| 11 — Settings & Config UI | Complete | — |
| 12 — Data Export & Analytics | Complete | — |
| 13 — MCP Server Integration | Complete | — |

---

## Out of Scope (v1)

- Auto-applying to jobs (too risky, ToS violations)
- Multi-user / cloud sync
- Mobile app
- Browser extension
- Integration with ATS systems (Greenhouse, Lever, etc.)
- AI interview prep
