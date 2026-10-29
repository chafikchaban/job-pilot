#!/usr/bin/env node
/**
 * LinkedIn Login Helper — Playwright-based
 *
 * Opens a visible Chromium browser with a persistent profile so the user can
 * log in to LinkedIn manually. The browser data directory is reused across
 * sessions, keeping cookies, localStorage, and browser fingerprint intact.
 *
 * Protocol: Reads JSON from stdin, writes JSON to stdout.
 * Input:  { browserDataDir: string }
 * Output: { success: true } or process exits with code 1 on error
 */

import { chromium } from "playwright";

const LOGIN_TIMEOUT_MS = 180_000; // 3 minutes to complete login
const POLL_INTERVAL_MS = 1000;
const log = (msg) => process.stderr.write(`[linkedin-login] ${msg}\n`);

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

async function waitForLogin(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const url = page.url();
    // Successful login redirects to /feed, /jobs, /mynetwork, or similar
    if (
      url.includes("/feed") ||
      url.includes("/jobs") ||
      url.includes("/mynetwork") ||
      url.includes("/in/")
    ) {
      return true;
    }

    // Also check for the global nav (only present when logged in)
    const nav = await page.$(".global-nav, #global-nav").catch(() => null);
    if (nav) return true;

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

async function main() {
  const input = await readStdin();
  const browserDataDir = input.browserDataDir;

  if (!browserDataDir) {
    throw new Error("browserDataDir is required");
  }

  log("Opening LinkedIn login page...");

  const context = await chromium.launchPersistentContext(browserDataDir, {
    headless: false,
    args: ["--start-maximized"],
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-US",
    viewport: null, // Use full window size
  });

  const page = context.pages()[0] || (await context.newPage());

  try {
    await page.goto("https://www.linkedin.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    log("Waiting for user to log in (you have 3 minutes)...");

    const loggedIn = await waitForLogin(page, LOGIN_TIMEOUT_MS);

    if (!loggedIn) {
      throw new Error(
        "Login timed out. Please try again and complete login within 3 minutes."
      );
    }

    log("Login detected! Session persisted in browser data directory.");

    // Wait a moment for all cookies to settle
    await new Promise((r) => setTimeout(r, 2000));

    process.stdout.write(JSON.stringify({ success: true }));
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  process.stderr.write(`[linkedin-login] ERROR: ${err.message || err}\n`);
  process.exit(1);
});
