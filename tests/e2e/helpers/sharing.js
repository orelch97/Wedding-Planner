import { expect } from "@playwright/test";
import { navigateTo, openNavigationMenu, signUp, uniqueIdentity } from "./emulator.js";

export const ALL_NAV_KEYS = ["overview", "checklist", "guests", "alcohol", "seating", "vendors", "finance"];

const SCOPE_KEYS = ["guests", "vendors", "finance", "checklist"];

const isFirebaseCloudHost = (hostname) =>
  (/\.googleapis\.com$/i.test(hostname) && hostname.toLowerCase() !== "fonts.googleapis.com") ||
  /(^|\.)firebaseio\.com$/i.test(hostname) ||
  /(^|\.)firebasestorage\.app$/i.test(hostname) ||
  /(^|\.)cloudfunctions\.net$/i.test(hostname) ||
  /(^|\.)run\.app$/i.test(hostname);

/** Same isolation guard the safety suite applies: no page may reach real Firebase. */
export async function blockCloudRequests(page) {
  const attempts = [];
  page.on("request", (request) => {
    if (isFirebaseCloudHost(new URL(request.url()).hostname)) attempts.push(request.url());
  });
  await page.route("**/*", async (route) => {
    const hostname = new URL(route.request().url()).hostname.toLowerCase();
    if (hostname === "fonts.googleapis.com" || isFirebaseCloudHost(hostname)) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  return attempts;
}

/** Owner creates an invite link for the given role and scopes ("all" or a list of screens). */
export async function createInviteLink(page, { role, scopes = ["all"] }) {
  await openNavigationMenu(page);
  await page.getByRole("button", { name: /שיתוף וחברים/ }).click();
  const dialog = page.getByRole("dialog", { name: "שיתוף החתונה" });
  await dialog.getByLabel("רמת הרשאה").selectOption(role);

  if (!scopes.includes("all")) {
    await dialog.getByRole("button", { name: "מסכים נבחרים" }).click();
    // Grant first, then revoke: the picker never allows an empty selection.
    for (const key of SCOPE_KEYS.filter((k) => scopes.includes(k))) {
      const box = dialog.locator(`#invite-scope-${key}`);
      if (!(await box.isChecked())) await box.check();
    }
    for (const key of SCOPE_KEYS.filter((k) => !scopes.includes(k))) {
      const box = dialog.locator(`#invite-scope-${key}`);
      if (await box.isChecked()) await box.uncheck();
    }
  }

  await dialog.getByRole("button", { name: "יצירת קישור" }).click();
  const linkField = dialog.getByLabel("קישור ההזמנה");
  await expect(linkField).toBeVisible();
  const link = await linkField.inputValue();
  await dialog.getByRole("button", { name: "סגירה" }).click();
  await expect(dialog).toBeHidden();
  return link;
}

/** Opens the invite link in a fresh browser context, signs up as a new user, and returns that session. */
export async function joinViaInvite(browser, projectUse, link, label) {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale } = projectUse;
  const context = await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale });
  const page = await context.newPage();
  const cloudAttempts = await blockCloudRequests(page);
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const badResponses = [];
  page.on("response", (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.request().method()} ${response.url().slice(0, 140)}`);
  });

  await page.goto(link);
  const identity = uniqueIdentity(label);
  await signUp(page, identity);
  // The toast fades after a few seconds, so look for it now rather than later.
  const inviteFailureToasts = await page.getByText("קבלת ההזמנה נכשלה").count();
  return { context, page, identity, cloudAttempts, consoleErrors, pageErrors, badResponses, inviteFailureToasts };
}

/** Labels of the navigation entries a member can see, read from the data-tour markers. */
export async function visibleNavKeys(page) {
  await openNavigationMenu(page);
  const found = [];
  for (const key of ALL_NAV_KEYS) {
    if ((await page.locator(`[data-tour="nav-${key}"]`).count()) > 0) found.push(key);
  }
  return found;
}

/**
 * What the current screen lets the user do: visible enabled buttons and editable fields.
 * `:disabled` (not `.disabled`) so controls inside a disabled <fieldset> count as locked.
 */
export async function probeScreen(page) {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[inert]");
    };
    const label = (el) => (el.getAttribute("aria-label") || el.textContent || el.placeholder || "").trim().replace(/\s+/g, " ").slice(0, 60);
    const locked = (el) => el.matches(":disabled") || el.readOnly === true;
    const buttons = [...main.querySelectorAll("button")].filter(visible).filter((b) => !locked(b)).map(label);
    const fields = [...main.querySelectorAll("input,select,textarea")]
      .filter(visible)
      .filter((f) => f.type !== "hidden" && f.type !== "file");
    return {
      buttons,
      editable: fields.filter((f) => !locked(f)).map(label),
      locked: fields.filter(locked).map(label),
    };
  });
}

/** Search and filter boxes change only the view, never the shared data. */
export const VIEW_ONLY_FIELDS = /חיפוש|כל הקטגוריות|כל הסטטוסים|סינון|מיון/;

export { navigateTo };
