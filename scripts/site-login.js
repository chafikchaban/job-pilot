#!/usr/bin/env node
/**
 * Generic Site Login Helper — Playwright-based
 *
 * Opens a visible Chromium browser with a persistent profile so the user can
 * log in to any website manually. The browser data directory is reused across
 * sessions, keeping cookies, localStorage, and browser fingerprint intact.
 *
 * Protocol: Reads JSON from stdin, writes JSON to stdout.
 * Input:  { browserDataDir: string, loginUrl: string, siteName: string, successIndicators?: string[] }
 * Output: { success: true } or process exits with code 1 on error
 */

import { chromium } from "playwright";

const LOGIN_TIMEOUT_MS = 180_000; // 3 minutes to complete login
const POLL_INTERVAL_MS = 1000;
const log = (msg) => process.stderr.write(`[site-login] ${msg}\n`);

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

async function waitForNavigation(page, loginUrl, timeoutMs) {
  const start = Date.now();
  const loginHostname = new URL(loginUrl).hostname;

  while (Date.now() - start < timeoutMs) {
    const currentUrl = page.url();

    // Consider logged in if the user navigated away from the login page
    // but stayed on the same domain
    try {
      const currentHostname = new URL(currentUrl).hostname;
      if (
        currentHostname.includes(loginHostname.replace("www.", "")) &&
        currentUrl !== loginUrl &&
        !currentUrl.includes("/login") &&
        !currentUrl.includes("/signin") &&
        !currentUrl.includes("/sign-in") &&
        !currentUrl.includes("/auth")
      ) {
        return true;
      }
    } catch {
      // URL parsing failed, continue waiting
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

async function main() {
  const input = await readStdin();
  const { browserDataDir, loginUrl, siteName } = input;

  if (!browserDataDir) throw new Error("browserDataDir is required");
  if (!loginUrl) throw new Error("loginUrl is required");

  log(`Opening ${siteName || "site"} login page: ${loginUrl}`);

  const context = await chromium.launchPersistentContext(browserDataDir, {
    headless: false,
    args: ["--start-maximized"],
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-US",
    viewport: null,
  });

  const page = context.pages()[0] || (await context.newPage());

  try {
    await page.goto(loginUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    log(`Waiting for user to log in to ${siteName || "site"} (3 minutes)...`);

    const loggedIn = await waitForNavigation(page, loginUrl, LOGIN_TIMEOUT_MS);

    if (!loggedIn) {
      throw new Error(
        "Login timed out. Please try again and complete login within 3 minutes."
      );
    }

    log("Login detected! Session persisted in browser data directory.");

    // Wait for cookies to settle
    await new Promise((r) => setTimeout(r, 2000));

    process.stdout.write(JSON.stringify({ success: true }));
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  process.stderr.write(`[site-login] ERROR: ${err.message || err}\n`);
  process.exit(1);
});
