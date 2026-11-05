import { test, expect } from "@playwright/test";
import { assertEmulatorEnvironment, signUp, uniqueIdentity, navigateTo } from "./helpers/emulator.js";

assertEmulatorEnvironment();

const DEFAULT_CARDS = ["סה״כ רשומות", "סה״כ כיסאות", "כנראה יבואו", "מנות גלאט להזמין", "לשקול הזמנה"];

const cardLabels = (page) =>
  page.locator('[data-tour="guests-summary"] > div').evaluateAll((cards) =>
    cards.map((card) => card.querySelector("p")?.textContent?.trim())
  );

test("guest summary cards can be swapped, are capped at five, and persist after reload", async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, uniqueIdentity("guest-summary-cards"), { readyTimeout: 60_000 });
  await navigateTo(page, "guests");

  expect(await cardLabels(page)).toEqual(DEFAULT_CARDS);

  await page.getByRole("button", { name: "התאמת כרטיסי הסיכום" }).click();
  const editor = page.locator("#guest-summary-editor");
  // RSVP totals live in their own bar and are not offered as cards.
  await expect(editor.getByRole("button", { name: /אישרו הגעה|ממתינים|לא מגיעים/ })).toHaveCount(0);
  await expect(editor.getByRole("button", { name: "שותים אלכוהול" })).toBeDisabled();
  await editor.getByRole("button", { name: "כנראה יבואו" }).click();
  await expect(editor.getByRole("button", { name: "כנראה יבואו" })).toHaveAttribute("aria-pressed", "false");
  await editor.getByRole("button", { name: "שותים אלכוהול" }).click();
  await expect(editor.getByRole("button", { name: "שותים אלכוהול" })).toHaveAttribute("aria-pressed", "true");
  await editor.getByRole("button", { name: "סיום" }).click();
  await expect(editor).toHaveCount(0);

  const swapped = ["סה״כ רשומות", "סה״כ כיסאות", "מנות גלאט להזמין", "לשקול הזמנה", "שותים אלכוהול"];
  expect(await cardLabels(page)).toEqual(swapped);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // The preference is saved after a short debounce; wait for it before reloading.
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[aria-label="מצב סנכרון: מסונכרן"]')).toBeVisible({ timeout: 30_000 });
  await navigateTo(page, "guests");
  await expect.poll(() => cardLabels(page)).toEqual(swapped);

  await page.getByRole("button", { name: "התאמת כרטיסי הסיכום" }).click();
  await page.locator("#guest-summary-editor").getByRole("button", { name: "ברירת מחדל" }).click();
  expect(await cardLabels(page)).toEqual(DEFAULT_CARDS);
});
