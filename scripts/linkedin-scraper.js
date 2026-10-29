#!/usr/bin/env node
/**
 * LinkedIn Job Scraper — Playwright-based
 *
 * Protocol: Reads JSON from stdin, writes JSON array to stdout.
 * Input:  { keywords: string[], location?: string, page?: number, per_page?: number }
 * Output: RawJobListing[] (matches Rust struct)
 *
 * Rate limits: 1 request per 3 seconds minimum.
 */

import { chromium } from "playwright";

const SEARCH_DELAY_MS = 3000; // Initial page load delay
const DETAIL_DELAY_MS = 1500; // Delay between detail page visits (faster)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => process.stderr.write(`[linkedin] ${msg}\n`);

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

function detectRemotePolicy(title, location, badges) {
  const text = `${title} ${location} ${badges}`.toLowerCase();
  if (text.includes("remote")) return "remote";
  if (text.includes("hybrid")) return "hybrid";
  if (text.includes("on-site") || text.includes("onsite")) return "onsite";
  return null;
}

/** Extract clean text using innerText (preserves layout/line breaks, strips hidden elements) */
async function getCleanText(el) {
  if (!el) return null;
  const text = await el.evaluate((e) => e.innerText);
  return text ? text.trim() : null;
}

async function scrapeLinkedIn(input) {
  const keywords = (input.keywords || []).join(" ");
  const location = input.location || "";
  const page = input.page || 1;
  const perPage = input.per_page || 20;
  const start = (page - 1) * perPage;

  const searchParams = new URLSearchParams({
    keywords,
    location,
    start: String(start),
    sortBy: "DD",
  });

  const url = `https://www.linkedin.com/jobs/search/?${searchParams}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  const browserPage = await context.newPage();

  try {
    log(`Searching: ${url}`);
    await browserPage.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(SEARCH_DELAY_MS);

    // Wait for job cards to render
    await browserPage
      .waitForSelector(".jobs-search__results-list li", { timeout: 10000 })
      .catch(() => null);

    // Extract job data from DOM
    const cardEls = await browserPage.$$(".jobs-search__results-list li");
    log(`Found ${cardEls.length} job cards`);
    const jobs = [];

    for (const card of cardEls) {
      const title = await card
        .$(".base-search-card__title")
        .then((el) => (el ? el.textContent() : ""))
        .then((t) => t.trim());
      const company = await card
        .$(".base-search-card__subtitle a")
        .then((el) => (el ? el.textContent() : null))
        .then((t) => (t ? t.trim() : null));
      const loc = await card
        .$(".job-search-card__location")
        .then((el) => (el ? el.textContent() : null))
        .then((t) => (t ? t.trim() : null));
      const link = await card
        .$("a.base-card__full-link")
        .then((el) => (el ? el.getAttribute("href") : ""));
      const dateStr = await card
        .$("time")
        .then((el) => (el ? el.getAttribute("datetime") : null));

      // Try to get job metadata badges (Remote, Full-time, etc.)
      const badges = await card
        .$(".base-search-card__metadata")
        .then((el) => (el ? el.textContent() : ""))
        .then((t) => (t ? t.trim() : ""));

      if (title && link) {
        jobs.push({ title, company, location: loc, url: link, posted_at: dateStr, badges });
      }
    }

    const trimmedJobs = jobs.slice(0, perPage);

    // Visit detail pages for jobs (time-budgeted)
    const MAX_DETAILS = 15;
    const DETAIL_BUDGET_MS = 150_000; // 2.5 min budget (must finish well within 300s Rust timeout)
    const detailStart = Date.now();
    log(`Fetching details for up to ${Math.min(trimmedJobs.length, MAX_DETAILS)} jobs...`);

    for (let idx = 0; idx < Math.min(trimmedJobs.length, MAX_DETAILS); idx++) {
      if (Date.now() - detailStart > DETAIL_BUDGET_MS) {
        log(`Detail budget exhausted after ${idx} jobs`);
        break;
      }
      const j = trimmedJobs[idx];
      try {
        await sleep(DETAIL_DELAY_MS);
        log(`Detail ${idx + 1}/${Math.min(trimmedJobs.length, MAX_DETAILS)}: ${j.title.substring(0, 50)}`);
        await browserPage.goto(j.url, { waitUntil: "domcontentloaded", timeout: 8000 });
        await sleep(800);

        // Click "Show more" if present
        const showMore = await browserPage.$("button.show-more-less-html__button--more");
        if (showMore) {
          await showMore.click().catch(() => {});
          await sleep(500);
        }

        // Try multiple selectors for description — use innerText for clean formatting
        let description = null;
        const descSelectors = [
          ".show-more-less-html__markup",
          ".description__text",
          ".decorated-job-posting__details",
          ".jobs-description__content",
        ];
        for (const sel of descSelectors) {
          const el = await browserPage.$(sel);
          if (el) {
            description = await getCleanText(el);
            if (description && description.length > 50) {
              break;
            }
            description = null;
          }
        }

        // Extract job criteria (seniority, type, etc.) from detail page
        let jobType = null;
        let seniority = null;
        const criteriaEls = await browserPage.$$(".description__job-criteria-item");
        for (const criteria of criteriaEls) {
          const label = await criteria
            .$(".description__job-criteria-subheader")
            .then((el) => (el ? el.textContent() : ""))
            .then((t) => t.trim().toLowerCase());
          const value = await criteria
            .$(".description__job-criteria-text")
            .then((el) => (el ? el.textContent() : ""))
            .then((t) => t.trim());

          if (label.includes("employment type") || label.includes("beschäftigungsart")) {
            jobType = value;
          }
          if (label.includes("seniority") || label.includes("level") || label.includes("karrierestufe")) {
            seniority = value;
          }
        }

        // Also check the top-of-page criteria list
        if (!jobType || !seniority) {
          const topCriteria = await browserPage.$$(".job-details-jobs-unified-top-card__job-insight span");
          for (const span of topCriteria) {
            const text = await span.textContent().then((t) => t.trim().toLowerCase());
            if (!jobType && (text.includes("full-time") || text.includes("vollzeit"))) jobType = "Full-time";
            if (!jobType && (text.includes("contract") || text.includes("vertrag"))) jobType = "Contract";
            if (!jobType && (text.includes("part-time") || text.includes("teilzeit"))) jobType = "Part-time";
            if (!seniority && (text.includes("senior") || text.includes("mid") || text.includes("entry"))) {
              seniority = text;
            }
          }
        }

        // Extract apply URL
        let applyUrl = null;
        const applyBtn = await browserPage.$('a[href*="apply"], button[aria-label*="Apply"]');
        if (applyBtn) {
          applyUrl = await applyBtn.getAttribute("href");
        }

        // Append job type / seniority to description metadata
        const metaParts = [jobType, seniority].filter(Boolean);
        if (description && metaParts.length > 0) {
          description = `${metaParts.join(" | ")}\n\n${description}`;
        }

        j.description = description ? description.substring(0, 10000) : null;
        j.apply_url = applyUrl;
        j.jobType = jobType;
      } catch (err) {
        log(`Detail fetch failed for ${j.title.substring(0, 40)}: ${err.message || err}`);
      }
    }

    const withDesc = trimmedJobs.filter((j) => j.description).length;
    log(`Done: ${trimmedJobs.length} jobs, ${withDesc} with descriptions`);

    return trimmedJobs.map((j) => ({
      title: j.title,
      company: j.company,
      location: j.location,
      remote_policy: detectRemotePolicy(j.title, j.location || "", j.badges || ""),
      description: j.description || null,
      url: j.url,
      apply_url: j.apply_url || null,
      source: "linkedin",
      language: null,
      posted_at: j.posted_at,
      raw_json: null,
    }));
  } finally {
    await browser.close();
  }
}

async function main() {
  try {
    const input = await readStdin();
    const results = await scrapeLinkedIn(input);
    process.stdout.write(JSON.stringify(results));
  } catch (err) {
    process.stderr.write(String(err));
    process.exit(1);
  }
}

main();
