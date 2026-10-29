#!/usr/bin/env node
/**
 * Stepstone.de Job Scraper — Playwright-based
 *
 * Protocol: Reads JSON from stdin, writes JSON array to stdout.
 * Input:  { keywords: string[], location?: string, page?: number, per_page?: number }
 * Output: RawJobListing[] (matches Rust struct)
 */

import { chromium } from "playwright";

const DELAY_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

function detectRemotePolicy(title, location) {
  const text = `${title} ${location}`.toLowerCase();
  if (text.includes("remote") || text.includes("homeoffice")) return "remote";
  if (text.includes("hybrid") || text.includes("teilweise remote")) return "hybrid";
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
    await browserPage.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(DELAY_MS);

    // Accept cookies if banner appears
    const cookieBtn = await browserPage.$('[data-testid="uc-accept-all-button"]');
    if (cookieBtn) {
      await cookieBtn.click();
      await sleep(1000);
    }

    // Wait for job listings
    await browserPage
      .waitForSelector('[data-testid="job-item"], article[class*="job"]', { timeout: 10000 })
      .catch(() => null);

    // Extract job data from DOM
    const cardEls = await browserPage.$$('[data-testid="job-item"], article[class*="job"]');
    const jobs = [];

    for (const card of cardEls) {
      const titleEl =
        (await card.$('[data-testid="job-item-title"]')) ||
        (await card.$("h2 a")) ||
        (await card.$("a[data-at*='title']"));
      const companyEl =
        (await card.$('[data-testid="job-item-company"]')) ||
        (await card.$("[class*='company']"));
      const locationEl =
        (await card.$('[data-testid="job-item-location"]')) ||
        (await card.$("[class*='location']"));

      const title = titleEl ? (await titleEl.textContent()).trim() : "";
      const company = companyEl ? (await companyEl.textContent()).trim() : null;
      const loc = locationEl ? (await locationEl.textContent()).trim() : null;

      // Find the link
      let href = "";
      const linkEl = await card.$("a[href*='/stellenangebote']");
      if (linkEl) {
        href = (await linkEl.getAttribute("href")) || "";
      } else if (titleEl) {
        const tag = await titleEl.evaluate((el) => el.tagName);
        if (tag === "A") {
          href = (await titleEl.getAttribute("href")) || "";
        } else {
          const parentLink = await titleEl.$("xpath=ancestor::a");
          if (parentLink) {
            href = (await parentLink.getAttribute("href")) || "";
          }
        }
      }

      if (title && href) {
        jobs.push({ title, company, location: loc, url: href });
      }
    }

    return jobs.slice(0, perPage).map((j) => ({
      title: j.title,
      company: j.company,
      location: j.location,
      remote_policy: detectRemotePolicy(j.title, j.location || ""),
      description: null,
      url: j.url.startsWith("http") ? j.url : `https://www.stepstone.de${j.url}`,
      apply_url: null,
      source: "stepstone",
      language: "de",
      posted_at: null,
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
