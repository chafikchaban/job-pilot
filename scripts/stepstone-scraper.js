#!/usr/bin/env node
/**
 * Stepstone.de Job Scraper — Playwright-based
 *
 * Protocol: Reads JSON from stdin, writes JSON array to stdout.
 * Input:  { keywords: string[], location?: string, page?: number, per_page?: number }
 * Output: RawJobListing[] (matches Rust struct)
 */

import { chromium } from "playwright";

const SEARCH_DELAY_MS = 3000;
const DETAIL_DELAY_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => process.stderr.write(`[stepstone] ${msg}\n`);

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

function detectRemotePolicy(title, location, description) {
  const text = `${title} ${location}`.toLowerCase();
  if (text.includes("100% remote") || text.includes("fully remote") || text.includes("full remote")) return "remote";
  if (text.includes("remote") || text.includes("homeoffice") || text.includes("home office")) return "remote";
  if (text.includes("hybrid") || text.includes("teilweise remote")) return "hybrid";

  // Check description for remote policy signals
  if (description) {
    const desc = description.toLowerCase();
    // Strong remote signals
    if (desc.includes("100% remote") || desc.includes("fully remote") || desc.includes("full remote")) return "remote";
    if (desc.includes("remote-first") || desc.includes("remote first")) return "remote";
    // Hybrid signals
    if (desc.includes("hybrid") || desc.includes("teilweise remote") || desc.includes("teilweise homeoffice")) return "hybrid";
    // Days-per-week patterns like "2-3 days in office", "3 Tage vor Ort"
    if (/\d+\s*(days?|tage?)\s*(per week|pro woche|in.{0,10}(office|büro))/i.test(desc)) return "hybrid";
    if (/\d+\s*(days?|tage?)\s*(remote|homeoffice|home.office)/i.test(desc)) return "hybrid";
    // Weaker remote signals (only if in a relevant context)
    if (desc.includes("remote möglich") || desc.includes("remote possible") || desc.includes("remote option")) return "hybrid";
    if (desc.includes("homeoffice möglich") || desc.includes("home office möglich") || desc.includes("homeoffice option")) return "hybrid";
    if (desc.includes("flexibles arbeiten") || desc.includes("mobiles arbeiten") || desc.includes("flexible arbeitsmodelle")) return "hybrid";
    // On-site signals
    if (desc.includes("vor ort") || desc.includes("on-site only") || desc.includes("office-based") || desc.includes("präsenzpflicht")) return "onsite";
  }

  return null;
}

/** Extract clean text using innerText (preserves layout/line breaks, strips hidden elements) */
async function getCleanText(el) {
  if (!el) return null;
  const text = await el.evaluate((e) => e.innerText);
  return text ? text.trim() : null;
}

/**
 * Strip HTML tags and decode entities, then normalize whitespace.
 * Used as fallback when innerText isn't suitable (e.g. raw innerHTML).
 */
function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Parse German relative dates like "vor 2 Tagen", "heute", "gestern" */
function parseGermanDate(text) {
  if (!text) return null;
  const lower = text.toLowerCase().trim();
  const now = new Date();

  if (lower.includes("heute") || lower.includes("today")) {
    return now.toISOString().split("T")[0];
  }
  if (lower.includes("gestern") || lower.includes("yesterday")) {
    now.setDate(now.getDate() - 1);
    return now.toISOString().split("T")[0];
  }

  // "vor X Tagen" / "X days ago"
  const dayMatch = lower.match(/vor\s+(\d+)\s+tag/i) || lower.match(/(\d+)\s+day/i);
  if (dayMatch) {
    now.setDate(now.getDate() - parseInt(dayMatch[1], 10));
    return now.toISOString().split("T")[0];
  }

  // "vor X Wochen" / "X weeks ago"
  const weekMatch = lower.match(/vor\s+(\d+)\s+woche/i) || lower.match(/(\d+)\s+week/i);
  if (weekMatch) {
    now.setDate(now.getDate() - parseInt(weekMatch[1], 10) * 7);
    return now.toISOString().split("T")[0];
  }

  return null;
}

async function scrapeStepstone(input) {
  const keywords = (input.keywords || []).join(" ");
  const location = input.location || "";
  const page = input.page || 1;
  const perPage = input.per_page || 20;

  const url = `https://www.stepstone.de/jobs/${encodeURIComponent(keywords)}${location ? `/in-${encodeURIComponent(location)}` : ""}?page=${page}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "de-DE",
    extraHTTPHeaders: {
      "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
    },
  });
  const browserPage = await context.newPage();

  try {
    log(`Searching: ${url}`);
    await browserPage.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(SEARCH_DELAY_MS);

    // Accept cookies if banner appears
    const cookieBtn =
      (await browserPage.$('[data-testid="uc-accept-all-button"]')) ||
      (await browserPage.$('button:has-text("Alles akzeptieren")'));
    if (cookieBtn) {
      await cookieBtn.click();
      await sleep(1000);
    }

    // Wait for job listings
    await browserPage
      .waitForSelector('[data-testid="job-item"]', { timeout: 10000 })
      .catch(() => null);

    // Extract job data from DOM
    const cardEls = await browserPage.$$('[data-testid="job-item"]');
    log(`Found ${cardEls.length} job cards`);
    const jobs = [];

    for (const card of cardEls) {
      const titleEl =
        (await card.$('[data-testid="job-item-title"]')) ||
        (await card.$("h2 a")) ||
        (await card.$("a[data-at*='title']"));
      const companyEl =
        (await card.$('[data-at="job-item-company-name"]')) ||
        (await card.$("[class*='company']"));
      const locationEl =
        (await card.$('[data-at="job-item-location"]')) ||
        (await card.$("[class*='location']"));

      const title = titleEl ? (await titleEl.textContent()).trim() : "";
      const company = companyEl ? (await companyEl.textContent()).trim() : null;
      const loc = locationEl ? (await locationEl.textContent()).trim() : null;

      // Try to get posting date from card — <time datetime="..."> has ISO date
      let postedAt = null;
      const timeEl = await card.$("time[datetime]");
      if (timeEl) {
        const dt = await timeEl.getAttribute("datetime");
        if (dt) {
          postedAt = dt.split("T")[0]; // Extract YYYY-MM-DD from ISO datetime
        }
      }
      if (!postedAt) {
        const dateEl = await card.$("time");
        if (dateEl) {
          const dateText = await dateEl.textContent().then((t) => t.trim());
          postedAt = parseGermanDate(dateText);
        }
      }

      // Find the link — title element is an <a> tag with href
      let href = "";
      if (titleEl) {
        const tag = await titleEl.evaluate((el) => el.tagName);
        if (tag === "A") {
          href = (await titleEl.getAttribute("href")) || "";
        }
      }
      if (!href) {
        const linkEl = await card.$("a[href*='/stellenangebote'], a[href*='/job/']");
        if (linkEl) {
          href = (await linkEl.getAttribute("href")) || "";
        }
      }

      if (title && href) {
        jobs.push({ title, company, location: loc, url: href, posted_at: postedAt });
      }
    }

    const trimmedJobs = jobs.slice(0, perPage);

    // Normalize URLs first
    for (const j of trimmedJobs) {
      j.url = j.url.startsWith("http") ? j.url : `https://www.stepstone.de${j.url}`;
    }

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

        // Accept cookies again if banner re-appears
        const cookieBtn2 =
          (await browserPage.$('[data-testid="uc-accept-all-button"]')) ||
          (await browserPage.$('button:has-text("Alles akzeptieren")'));
        if (cookieBtn2) {
          await cookieBtn2.click().catch(() => {});
          await sleep(500);
        }

        // Try to extract posted_at from detail page if not already found
        if (!j.posted_at) {
          // Look for date patterns in the detail page header area
          const headerText = await browserPage
            .$('[data-testid="job-ad-header"], [class*="job-ad-header"], [class*="listing-header"]')
            .then((el) => (el ? el.textContent() : ""))
            .then((t) => t.trim());
          j.posted_at = parseGermanDate(headerText);
        }

        // Try multiple selectors for description — use innerText for clean formatting
        let description = null;
        const descSelectors = [
          '[data-testid="job-ad-description"]',
          ".listing-content",
          '[class*="JobAdDescription"]',
          '[class*="job-ad-content"]',
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

        // Fallback: try to get the main content area but use innerHTML->stripHtml
        // to avoid capturing sidebar/navigation noise
        if (!description) {
          const fallbackEl =
            (await browserPage.$('[class*="job-ad"] [class*="description"]')) ||
            (await browserPage.$('[class*="job-ad"] [class*="content"]'));
          if (fallbackEl) {
            const html = await fallbackEl.evaluate((e) => e.innerHTML);
            if (html) {
              description = stripHtml(html);
              if (description.length <= 50) description = null;
            }
          }
        }

        // Extract structured metadata from detail page header
        let contractType = null;
        let remotePolicy = null;
        let salary = null;

        // Stepstone shows metadata as icon+text pairs in the header
        // Selectors: data-testid attributes, or li elements in the header area
        const metaSelectors = [
          '[data-testid="job-ad-detail"]',
          '[class*="job-ad-detail"] li',
          '[class*="listing-tag"]',
          '[data-testid="job-ad-header"] li',
          '[class*="at-listing__list-icons"] li',
          '[class*="at-listing__list-icons_work-type"]',
        ];
        const metaEls = [];
        for (const sel of metaSelectors) {
          const els = await browserPage.$$(sel);
          metaEls.push(...els);
        }

        // Also grab all text from the header area for broader matching
        let headerMeta = "";
        const headerEl = await browserPage.$('[data-testid="job-ad-header"], [class*="job-ad-header"], [class*="listing-header"]');
        if (headerEl) {
          headerMeta = await headerEl.textContent().then((t) => t.trim().toLowerCase());
        }

        for (const el of metaEls) {
          const text = await el.textContent().then((t) => t.trim().toLowerCase());
          // Contract type
          if (text.includes("vollzeit") || text.includes("full-time")) contractType = "Full-time";
          else if (text.includes("teilzeit") || text.includes("part-time")) contractType = "Part-time";
          else if (text.includes("freelance") || text.includes("freiberuf")) contractType = "Freelance";
          // Remote policy from structured metadata
          if (text.includes("homeoffice möglich") || text.includes("home office möglich") || text.includes("remote möglich")) remotePolicy = "hybrid";
          if (text.includes("homeoffice") || text.includes("home office") || text.includes("mobiles arbeiten") || text.includes("flexibles arbeiten")) {
            if (!remotePolicy) remotePolicy = "hybrid";
          }
          if (text.includes("100% remote") || text.includes("fully remote") || text.includes("remote-first")) remotePolicy = "remote";
          // Salary
          if (text.includes("€") || text.includes("eur") || text.includes("gehalt") || text.includes("salary")) {
            if (!salary) salary = await el.textContent().then((t) => t.trim());
          }
        }

        // Fallback: check header text for remote signals
        if (!remotePolicy && headerMeta) {
          if (headerMeta.includes("homeoffice möglich") || headerMeta.includes("home office möglich") || headerMeta.includes("remote möglich")) remotePolicy = "hybrid";
          else if (headerMeta.includes("homeoffice") || headerMeta.includes("home office") || headerMeta.includes("mobiles arbeiten")) remotePolicy = "hybrid";
          else if (headerMeta.includes("100% remote") || headerMeta.includes("fully remote")) remotePolicy = "remote";
        }

        // Prepend metadata to description for downstream extraction
        const metaParts = [];
        if (contractType) metaParts.push(contractType);
        if (remotePolicy) metaParts.push(`Remote: ${remotePolicy}`);
        if (salary) metaParts.push(`Salary: ${salary}`);
        if (description && metaParts.length > 0) {
          description = `${metaParts.join(" | ")}\n\n${description}`;
        }

        j.remote_policy_meta = remotePolicy;

        // Extract apply URL
        let applyUrl = null;
        const applyBtn = await browserPage.$('a[href*="apply"], a[data-testid*="apply"]');
        if (applyBtn) {
          applyUrl = await applyBtn.getAttribute("href");
        }

        j.description = description ? description.substring(0, 10000) : null;
        j.apply_url = applyUrl;
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
      remote_policy: j.remote_policy_meta || detectRemotePolicy(j.title, j.location || "", j.description || ""),
      description: j.description || null,
      url: j.url,
      apply_url: j.apply_url || null,
      source: "stepstone",
      language: "de",
      posted_at: j.posted_at || null,
      raw_json: null,
    }));
  } finally {
    await browser.close();
  }
}

async function main() {
  try {
    const input = await readStdin();
    const results = await scrapeStepstone(input);
    process.stdout.write(JSON.stringify(results));
  } catch (err) {
    process.stderr.write(String(err));
    process.exit(1);
  }
}

main();
