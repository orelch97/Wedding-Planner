import { test, expect } from "@playwright/test";
import { assertEmulatorEnvironment, signUp, uniqueIdentity, navigateTo } from "./helpers/emulator.js";

assertEmulatorEnvironment();

const isPhone = (page) => (page.viewportSize()?.width ?? 1365) < 1024;

/** Budget rows render as a table on desktop and as cards on phones; scope to whichever is shown. */
function budgetRow(page, name) {
  return isPhone(page)
    ? page.locator("div.rounded-2xl.border.p-4").filter({ has: page.getByRole("spinbutton", { name: `שולם — ${name}`, exact: true }) })
    : page.locator("tbody tr").filter({ has: page.getByRole("spinbutton", { name: `שולם — ${name}`, exact: true }) });
}

test.describe("vendor and budget payment sync", () => {
  test("vendor 'שולם' is aligned, flows to the budget, and a different budget amount is flagged like the cost", async ({ page }) => {
    test.setTimeout(150_000);
    await signUp(page, uniqueIdentity("vendor-paid"), { readyTimeout: 60_000 });

    await navigateTo(page, "vendors");
    await page.getByRole("button", { name: "ספק חדש" }).click();
    const vendorName = `ספק תשלום ${Date.now()}`;
    await page.getByRole("textbox", { name: "שם הספק" }).fill(vendorName);

    const cost = page.getByRole("spinbutton", { name: "עלות בחוזה", exact: true });
    const paid = page.getByRole("spinbutton", { name: "שולם", exact: true });
    // The old label must be gone everywhere on the vendor card.
    await expect(page.getByText("מקדמה ששולמה")).toHaveCount(0);
    await cost.fill("8000");
    await paid.fill("1500");
    await paid.blur();
    await expect(page.locator('[data-tour="vendors-details"]')).toContainText("6,500");

    const costBox = await cost.boundingBox();
    const paidBox = await paid.boundingBox();
    expect(Math.abs(costBox.y - paidBox.y), "both amount inputs start on the same line").toBeLessThanOrEqual(1);
    expect(Math.abs(costBox.height - paidBox.height), "both amount inputs have the same height").toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await navigateTo(page, "finance");
    const row = budgetRow(page, vendorName);
    const budgetPaid = row.getByRole("spinbutton", { name: `שולם — ${vendorName}`, exact: true });
    const paidError = row.getByTestId("budget-paid-mismatch");
    await expect(budgetPaid).toHaveValue("1500");
    await expect(paidError).toHaveCount(0);

    // A different amount than the vendor card is flagged exactly like the cost mismatch.
    await budgetPaid.fill("2000");
    await budgetPaid.blur();
    await expect(paidError).toBeVisible();
    await expect(paidError).toContainText("הסכום ששולם לספק הוא");
    await expect(paidError).toContainText("1,500");
    await expect(paidError.getByRole("button", { name: "עדכון לפי הספק" })).toBeVisible();
    await expect(row).toHaveClass(/rose/);

    // The flag is derived from saved data, so it must survive a reload once the edit is stored.
    await expect.poll(() => page.evaluate(async (name) => {
      const store = await import("/src/lib/firebaseStore.js");
      const [wedding] = await store.listWeddings();
      const data = await store.cloudFetchAll(wedding.id, { scopes: ["all"], isOwner: true });
      return data.budget.find((item) => item.category === name)?.paid ?? null;
    }, vendorName), { timeout: 20_000, message: "the changed amount reaches the cloud" }).toBe(2000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('[aria-label="מצב סנכרון: מסונכרן"]')).toBeVisible({ timeout: 30_000 });
    await navigateTo(page, "finance");
    await expect(budgetPaid).toHaveValue("2000");
    await expect(paidError).toBeVisible();

    await paidError.getByRole("button", { name: "עדכון לפי הספק" }).click();
    await expect(budgetPaid).toHaveValue("1500");
    await expect(paidError).toHaveCount(0);
    await expect(row).not.toHaveClass(/rose/);

    // Typing the vendor's own amount back is not an error.
    await budgetPaid.fill("1000");
    await expect(paidError).toBeVisible();
    await budgetPaid.fill("1500");
    await expect(paidError).toHaveCount(0);

    // The existing cost check still behaves the same way.
    const budgetCost = row.getByRole("spinbutton", { name: `עלות — ${vendorName}`, exact: true });
    await budgetCost.fill("6000");
    await expect(row).toContainText("העלות בחוזה של הספק היא");
    await expect(paidError).toHaveCount(0);
    await row.getByRole("button", { name: "עדכון לפי הספק" }).first().click();
    await expect(budgetCost).toHaveValue("8000");
    await expect(row).not.toHaveClass(/rose/);

    // Changing the vendor card while the budget still matches keeps them in sync.
    await navigateTo(page, "vendors");
    await page.getByRole("spinbutton", { name: "שולם", exact: true }).fill("3000");
    await navigateTo(page, "finance");
    await expect(budgetPaid).toHaveValue("3000");
    await expect(paidError).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
