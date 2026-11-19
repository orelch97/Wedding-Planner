import { test, expect } from "@playwright/test";
import { assertEmulatorEnvironment, signUp, uniqueIdentity, navigateTo } from "./helpers/emulator.js";

assertEmulatorEnvironment();

const DEFAULT_CARDS = ["סה״כ רשומות", "סה״כ כיסאות", "סה״כ מתנות"];

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
  await editor.getByRole("button", { name: "כנראה יבואו" }).click();
  await editor.getByRole("button", { name: "שותים אלכוהול" }).click();
  await expect(editor.getByRole("button", { name: "שותים אלכוהול" })).toHaveAttribute("aria-pressed", "true");
  // Five selected: the rest are locked until one is removed.
  await expect(editor.getByRole("button", { name: "מנות גלאט" })).toBeDisabled();
  await editor.getByRole("button", { name: "סה״כ מתנות" }).click();
  await expect(editor.getByRole("button", { name: "מנות גלאט" })).toBeEnabled();
  await editor.getByRole("button", { name: "סיום" }).click();
  await expect(editor).toHaveCount(0);

  const swapped = ["סה״כ רשומות", "סה״כ כיסאות", "כנראה יבואו", "שותים אלכוהול"];
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

test("an untouched old five-card default is upgraded to the new default", async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, uniqueIdentity("guest-summary-legacy"), { readyTimeout: 60_000 });
  await navigateTo(page, "guests");
  // Wait for the hook to persist the default, then overwrite it with the old default.
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.endsWith("guestSummaryCards")))).toBe(true);
  await page.evaluate(() => {
    const legacy = JSON.stringify(["records", "seats", "probably", "glatt", "considering"]);
    for (const key of Object.keys(localStorage)) {
      if (key.endsWith("guestSummaryCards")) localStorage.setItem(key, legacy);
    }
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[aria-label="מצב סנכרון: מסונכרן"]')).toBeVisible({ timeout: 30_000 });
  await navigateTo(page, "guests");
  await expect.poll(() => cardLabels(page)).toEqual(DEFAULT_CARDS);
});
