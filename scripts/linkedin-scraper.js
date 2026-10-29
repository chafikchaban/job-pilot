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

const DELAY_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

function detectRemotePolicy(title, location) {
  const text = `${title} ${location}`.toLowerCase();
  if (text.includes("remote")) return "remote";
  if (text.includes("hybrid")) return "hybrid";
  return null;
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
    await browserPage.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(DELAY_MS);

    // Wait for job cards to render
    await browserPage
      .waitForSelector(".jobs-search__results-list li", { timeout: 10000 })
      .catch(() => null);

    // Extract job data from DOM
    const cardEls = await browserPage.$$(".jobs-search__results-list li");
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

      if (title && link) {
        jobs.push({ title, company, location: loc, url: link, posted_at: dateStr });
      }
    }

    return jobs.slice(0, perPage).map((j) => ({
      title: j.title,
      company: j.company,
      location: j.location,
      remote_policy: detectRemotePolicy(j.title, j.location || ""),
      description: null,
      url: j.url,
      apply_url: null,
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
