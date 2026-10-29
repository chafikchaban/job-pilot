#!/usr/bin/env node
/**
 * LinkedIn Job Scraper — Playwright-based (with login support + multi-page)
 *
 * Protocol: Reads JSON from stdin, writes JSON array to stdout.
 * Input:  { keywords: string[], location?: string, page?: number, per_page?: number,
 *           storage_path?: string, max_pages?: number }
 * Output: RawJobListing[] (matches Rust struct)
 *
 * If storage_path points to a valid session file, uses authenticated scraping.
 * Otherwise falls back to public/guest mode.
 */

import { chromium } from "playwright";
import { existsSync, readdirSync } from "fs";

const SEARCH_DELAY_MS = 3000;
const PAGE_DELAY_MS = 2000;
const DETAIL_DELAY_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => process.stderr.write(`[linkedin] ${msg}\n`);

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

function detectRemotePolicy(title, location, badges, description) {
  const text = `${title} ${location} ${badges}`.toLowerCase();
  if (text.includes("100% remote") || text.includes("fully remote") || text.includes("remote-first")) return "remote";
  if (text.includes("remote")) return "remote";
  if (text.includes("hybrid")) return "hybrid";
  if (text.includes("on-site") || text.includes("onsite")) return "onsite";

  if (description) {
    const desc = description.toLowerCase();
    if (desc.includes("100% remote") || desc.includes("fully remote") || desc.includes("remote-first") || desc.includes("remote first")) return "remote";
    if (desc.includes("hybrid") || desc.includes("teilweise remote")) return "hybrid";
    if (/\d+\s*(days?|tage?)\s*(per week|pro woche|in.{0,10}(office|büro))/i.test(desc)) return "hybrid";
    if (/\d+\s*(days?|tage?)\s*(remote|homeoffice|home.office)/i.test(desc)) return "hybrid";
    if (desc.includes("remote möglich") || desc.includes("remote possible") || desc.includes("remote option")) return "hybrid";
    if (desc.includes("homeoffice möglich") || desc.includes("home office möglich")) return "hybrid";
    if (desc.includes("vor ort") || desc.includes("on-site only") || desc.includes("office-based") || desc.includes("präsenzpflicht")) return "onsite";
  }

  return null;
}

async function getCleanText(el) {
  if (!el) return null;
  const text = await el.evaluate((e) => e.innerText);
  return text ? text.trim() : null;
}

// --- Selector sets ---

const GUEST_SELECTORS = {
  jobList: ".jobs-search__results-list li",
  title: ".base-search-card__title",
  company: ".base-search-card__subtitle a",
  location: ".job-search-card__location",
  link: "a.base-card__full-link",
  date: "time",
  badges: ".base-search-card__metadata",
};

const LOGGED_IN_SELECTORS = {
  jobList: [
    ".scaffold-layout__list-container li.ember-view",
    ".jobs-search-results-list li",
    "li.jobs-search-results__list-item",
    ".scaffold-layout__list li",
  ],
  title: [
    ".job-card-list__title--link span",
    ".job-card-list__title",
    "a.job-card-container__link span",
    ".artdeco-entity-lockup__title a",
    "a[data-control-name='job_card_title']",
  ],
  company: [
    ".job-card-container__primary-description",
    ".artdeco-entity-lockup__subtitle span",
    ".job-card-container__company-name",
  ],
  location: [
    ".job-card-container__metadata-wrapper li",
    ".artdeco-entity-lockup__caption span",
    ".job-card-container__metadata-item",
  ],
  link: [
    "a.job-card-list__title--link",
    "a.job-card-container__link",
    "a.job-card-list__title",
  ],
  date: "time",
};

/**
 * Try multiple selectors and return the first matching element.
 */
async function $(parent, selectors) {
  if (typeof selectors === "string") {
    return parent.$(selectors);
  }
  for (const sel of selectors) {
    const el = await parent.$(sel).catch(() => null);
    if (el) return el;
  }
  return null;
}

/**
 * Try multiple selectors and return all matching elements.
 */
async function $$(parent, selectors) {
  if (typeof selectors === "string") {
    return parent.$$(selectors);
  }
  for (const sel of selectors) {
    const els = await parent.$$(sel).catch(() => []);
    if (els.length > 0) return els;
  }
  return [];
}

async function detectLoginStatus(page) {
  // Check for logged-in indicators
  const nav = await page
    .$(".global-nav, #global-nav, .scaffold-layout")
    .catch(() => null);
  if (nav) return true;

  // Check if we were redirected to login page
  const url = page.url();
  if (url.includes("/login") || url.includes("/authwall")) return false;

  // Check for guest-mode indicators
  const guestList = await page
    .$(".jobs-search__results-list")
    .catch(() => null);
  if (guestList) return false;

  return false;
}

async function scrapeSearchPage(browserPage, selectors, isLoggedIn) {
  const cards = await $$(browserPage, selectors.jobList);
  const jobs = [];

  for (const card of cards) {
    let title = "";
    let company = null;
    let loc = null;
    let link = "";
    let dateStr = null;
    let badges = "";

    const titleEl = await $(card, selectors.title);
    if (titleEl) title = (await titleEl.textContent()).then ? await (await titleEl.textContent()) : "";
    if (typeof title === "string") title = title.trim();

    const companyEl = await $(card, selectors.company);
    if (companyEl) {
      company = await companyEl.textContent().then((t) => (t ? t.trim() : null));
    }

    const locEl = await $(card, selectors.location);
    if (locEl) {
      loc = await locEl.textContent().then((t) => (t ? t.trim() : null));
    }

    const linkEl = await $(card, selectors.link);
    if (linkEl) {
      link = (await linkEl.getAttribute("href")) || "";
    }

    const dateEl = await $(card, selectors.date);
    if (dateEl) {
      dateStr = await dateEl.getAttribute("datetime");
    }

    if (!isLoggedIn && selectors.badges) {
      const badgeEl = await $(card, selectors.badges);
      if (badgeEl) {
        badges = await badgeEl.textContent().then((t) => (t ? t.trim() : ""));
      }
    }

    if (title && link) {
      // Normalize link
      if (link.startsWith("/")) {
        link = `https://www.linkedin.com${link}`;
      }
      // Strip tracking params
      try {
        const u = new URL(link);
        u.search = "";
        link = u.toString();
      } catch {}

      jobs.push({ title, company, location: loc, url: link, posted_at: dateStr, badges });
    }
  }

  return jobs;
}

async function scrapeLinkedIn(input) {
  const keywords = (input.keywords || []).join(" ");
  const location = input.location || "";
  const perPage = input.per_page || 25;
  const maxPages = input.max_pages || 3;
  const browserDataDir = input.browser_data_dir || null;

  // Check if persistent browser data dir exists and has content
  const hasSession =
    browserDataDir &&
    existsSync(browserDataDir) &&
    (() => {
      try {
        return readdirSync(browserDataDir).length > 0;
      } catch {
        return false;
      }
    })();

  let context;
  let browserInstance = null;

  if (hasSession) {
    log("Using persistent browser session...");
    context = await chromium.launchPersistentContext(browserDataDir, {
      headless: true,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      locale: "en-US",
    });
  } else {
    log("No browser session found — using guest/public mode");
    browserInstance = await chromium.launch({ headless: true });
    context = await browserInstance.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      locale: "en-US",
    });
  }

  const browserPage = context.pages()[0] || (await context.newPage());

  try {
    // --- Multi-page search ---
    let allJobs = [];
    let isLoggedIn = false;
    let selectors = GUEST_SELECTORS;

    for (let page = 1; page <= maxPages; page++) {
      const start = (page - 1) * perPage;
      const searchParams = new URLSearchParams({
        keywords,
        location,
        start: String(start),
        sortBy: "DD",
      });

      // Logged-in users use a different URL path
      const url = isLoggedIn || hasSession
        ? `https://www.linkedin.com/jobs/search/?${searchParams}`
        : `https://www.linkedin.com/jobs/search/?${searchParams}`;

      log(`Page ${page}/${maxPages}: ${url}`);
      await browserPage.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await sleep(SEARCH_DELAY_MS);

      // Detect login status on first page
      if (page === 1) {
        isLoggedIn = await detectLoginStatus(browserPage);
        selectors = isLoggedIn ? LOGGED_IN_SELECTORS : GUEST_SELECTORS;
        log(`Mode: ${isLoggedIn ? "LOGGED IN" : "GUEST (public)"}`);

        // If we expected a session but got redirected to login, warn and use guest
        if (hasSession && !isLoggedIn) {
          const currentUrl = browserPage.url();
          if (currentUrl.includes("/login") || currentUrl.includes("/authwall")) {
            log("Session expired — falling back to guest mode. Please re-login in Settings.");
            selectors = GUEST_SELECTORS;
            // Re-navigate without session
            await browserPage.goto(
              `https://www.linkedin.com/jobs/search/?${searchParams}`,
              { waitUntil: "domcontentloaded", timeout: 30000 }
            );
            await sleep(SEARCH_DELAY_MS);
          }
        }
      }

      // Wait for job cards
      const listSelector = typeof selectors.jobList === "string"
        ? selectors.jobList
        : selectors.jobList[0];
      await browserPage
        .waitForSelector(listSelector, { timeout: 10000 })
        .catch(() => null);

      // For logged-in mode, scroll to load lazy-loaded cards
      if (isLoggedIn) {
        for (let i = 0; i < 3; i++) {
          await browserPage.evaluate(() => {
            const list = document.querySelector('.scaffold-layout__list') ||
              document.querySelector('.jobs-search-results-list');
            if (list) list.scrollTop = list.scrollHeight;
            else window.scrollTo(0, document.body.scrollHeight);
          });
          await sleep(800);
        }
      } else {
        // Guest mode: scroll to load more cards
        for (let i = 0; i < 3; i++) {
          await browserPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await sleep(800);
        }
      }

      const pageJobs = await scrapeSearchPage(browserPage, selectors, isLoggedIn);
      log(`Page ${page}: found ${pageJobs.length} job cards`);

      if (pageJobs.length === 0) {
        log(`No results on page ${page}, stopping pagination`);
        break;
      }

      allJobs.push(...pageJobs);

      // Delay between pages
      if (page < maxPages) {
        await sleep(PAGE_DELAY_MS);
      }
    }

    // Deduplicate by URL
    const seen = new Set();
    const uniqueJobs = [];
    for (const j of allJobs) {
      if (!seen.has(j.url)) {
        seen.add(j.url);
        uniqueJobs.push(j);
      }
    }

    log(`Total unique jobs across all pages: ${uniqueJobs.length}`);

    // --- Visit detail pages ---
    const MAX_DETAILS = 15;
    const DETAIL_BUDGET_MS = 200_000; // ~3.3 min budget (well within 600s Rust timeout)
    const detailStart = Date.now();
    const detailCount = Math.min(uniqueJobs.length, MAX_DETAILS);
    log(`Fetching details for up to ${detailCount} jobs...`);

    for (let idx = 0; idx < detailCount; idx++) {
      if (Date.now() - detailStart > DETAIL_BUDGET_MS) {
        log(`Detail budget exhausted after ${idx} jobs`);
        break;
      }

      const j = uniqueJobs[idx];
      try {
        await sleep(DETAIL_DELAY_MS);
        log(`Detail ${idx + 1}/${detailCount}: ${j.title.substring(0, 50)}`);
        await browserPage.goto(j.url, { waitUntil: "domcontentloaded", timeout: 10000 });
        await sleep(1000);

        // Check if we're on a login wall
        if (browserPage.url().includes("/login") || browserPage.url().includes("/authwall")) {
          log("Hit login wall on detail page, skipping remaining details");
          break;
        }

        // Click "Show more" if present
        const showMore = await browserPage.$(
          "button.show-more-less-html__button--more, button[aria-label='Show more']"
        );
        if (showMore) {
          await showMore.click().catch(() => {});
          await sleep(500);
        }

        // Extract description — try multiple selectors
        let description = null;
        const descSelectors = [
          ".show-more-less-html__markup",
          ".description__text",
          ".jobs-description__content",
          ".decorated-job-posting__details",
          ".jobs-box__html-content",
        ];
        for (const sel of descSelectors) {
          const el = await browserPage.$(sel);
          if (el) {
            description = await getCleanText(el);
            if (description && description.length > 50) break;
            description = null;
          }
        }

        // Extract job criteria
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

        // Logged-in mode: try top card criteria
        if (isLoggedIn && (!jobType || !seniority)) {
          const topCriteria = await browserPage.$$(
            ".job-details-jobs-unified-top-card__job-insight span, .jobs-unified-top-card__job-insight span"
          );
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

        // Prepend metadata
        const metaParts = [jobType, seniority].filter(Boolean);
        if (description && metaParts.length > 0) {
          description = `${metaParts.join(" | ")}\n\n${description}`;
        }

        j.description = description ? description.substring(0, 10000) : null;
        j.apply_url = applyUrl;
      } catch (err) {
        log(`Detail fetch failed for ${j.title.substring(0, 40)}: ${err.message || err}`);
      }
    }

    const withDesc = uniqueJobs.filter((j) => j.description).length;
    log(`Done: ${uniqueJobs.length} jobs, ${withDesc} with descriptions`);

    return uniqueJobs.map((j) => ({
      title: j.title,
      company: j.company,
      location: j.location,
      remote_policy: detectRemotePolicy(j.title, j.location || "", j.badges || "", j.description || ""),
      description: j.description || null,
      url: j.url,
      apply_url: j.apply_url || null,
      source: "linkedin",
      language: null,
      posted_at: j.posted_at,
      raw_json: null,
    }));
  } finally {
    await context.close();
    if (browserInstance) await browserInstance.close();
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
