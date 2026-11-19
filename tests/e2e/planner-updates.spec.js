import { test, expect } from "@playwright/test";
import { assertEmulatorEnvironment, signUp, uniqueIdentity, navigateTo } from "./helpers/emulator.js";

assertEmulatorEnvironment();

const noHorizontalOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function seed(page, datasets) {
  await page.evaluate(async (data) => {
    const store = await import("/src/lib/firebaseStore.js");
    const [wedding] = await store.listWeddings();
    await store.cloudSeed(wedding.id, data);
  }, datasets);
}

async function cloud(page, scope) {
  return page.evaluate(async (scopes) => {
    const store = await import("/src/lib/firebaseStore.js");
    const [wedding] = await store.listWeddings();
    return store.cloudFetchAll(wedding.id, { scopes: [scopes], isOwner: true });
  }, scope);
}

function isoDaysFromToday(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

test("checklist tasks get a deadline that is saved, flagged when late and editable", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, uniqueIdentity("task-deadline"), { readyTimeout: 60_000 });
  await navigateTo(page, "checklist");

  const entry = page.locator('[data-tour="checklist-add"]');
  await entry.locator("button[aria-expanded]").click();
  const form = entry.locator("form");
  await form.getByRole("textbox", { name: "שם המשימה החדשה" }).fill("לסגור צלם");
  const overdue = isoDaysFromToday(-3);
  await form.getByLabel("תאריך יעד למשימה החדשה").fill(overdue);
  await form.getByRole("button", { name: "הוספה", exact: true }).click();
  await expect(form.getByLabel("תאריך יעד למשימה החדשה")).toHaveValue("");

  const row = page.locator('[data-tour="checklist-items"] li').filter({ hasText: "לסגור צלם" });
  const due = row.getByLabel("תאריך יעד — לסגור צלם");
  await expect(due).toHaveValue(overdue);
  await expect(row.getByTestId("task-due-badge")).toHaveText("באיחור");
  expect(await noHorizontalOverflow(page)).toBe(true);

  await expect.poll(async () => (await cloud(page, "checklist")).checklist.find((t) => t.title === "לסגור צלם")?.dueDate, { timeout: 30_000 }).toBe(overdue);

  const soon = isoDaysFromToday(3);
  await due.fill(soon);
  await expect(row.getByTestId("task-due-badge")).toHaveText("בקרוב");
  await due.fill(isoDaysFromToday(60));
  await expect(row.getByTestId("task-due-badge")).toHaveCount(0);

  // A completed task is never "late".
  await due.fill(overdue);
  await expect(row.getByTestId("task-due-badge")).toHaveText("באיחור");
  await page.getByRole("button", { name: "הסתרת שהושלמו", exact: true }).click();
  await row.getByRole("checkbox", { name: 'סימון "לסגור צלם" כבוצע' }).check();
  await expect(row.getByTestId("task-due-badge")).toHaveCount(0);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[aria-label="מצב סנכרון: מסונכרן"]')).toBeVisible({ timeout: 30_000 });
  await navigateTo(page, "checklist");
  await page.getByRole("button", { name: "הסתרת שהושלמו", exact: true }).click();
  await expect(page.getByLabel("תאריך יעד — לסגור צלם")).toHaveValue(overdue);
});

test("dashboard shows confirmed guests out of invited instead of 'probably coming'", async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, uniqueIdentity("dash-confirmed"), { readyTimeout: 60_000 });
  await seed(page, {
    guests: [
      { id: 1, name: "מאשרים", phone: "050-100-0001", seats: 2, rsvp: "confirmed", attendingCount: 2, probablyComing: true },
      { id: 2, name: "ממתינים", phone: "050-100-0002", seats: 3, rsvp: "pending" },
      { id: 3, name: "לא מגיעים", phone: "050-100-0003", seats: 4, rsvp: "declined" },
    ],
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[aria-label="מצב סנכרון: מסונכרן"]')).toBeVisible({ timeout: 30_000 });
  await navigateTo(page, "overview");
  const summary = page.locator('[data-tour="overview-summary"]');
  await expect(summary).not.toContainText("כנראה יבואו");
  const card = summary.locator("> div").filter({ hasText: "אישרו הגעה" });
  await expect(card).toContainText("2");
  await expect(card).toContainText("מתוך 5 מוזמנים · 40%");
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test("budget payment method offers 'check' and saves it", async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, uniqueIdentity("pay-check"), { readyTimeout: 60_000 });
  await seed(page, { budget: [{ id: 51, category: "תזמורת", expected: 5000, actual: 5000, paid: 0, paymentMethod: "", notes: "" }] });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[aria-label="מצב סנכרון: מסונכרן"]')).toBeVisible({ timeout: 30_000 });
  await navigateTo(page, "finance");
  const method = page.locator('select[aria-label="אמצעי תשלום — תזמורת"]:visible');
  await expect(method.locator("option", { hasText: "צ׳ק" })).toHaveCount(1);
  await method.selectOption({ label: "צ׳ק" });
  await expect.poll(async () => (await cloud(page, "all")).budget.find((b) => b.id === 51)?.paymentMethod, { timeout: 30_000 }).toBe("Check");
});

test("guest filters sit in a closed panel; only 'missing mobile' stays on screen", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, uniqueIdentity("guest-filter-panel"), { readyTimeout: 60_000 });
  await seed(page, {
    guests: [
      { id: 11, name: "דנה", phone: "050-200-0001", category: "חברים", seats: 2, rsvp: "confirmed", attendingCount: 2, glatt: true },
      { id: 12, name: "יוסי", phone: "", category: "משפחה", seats: 1, rsvp: "pending" },
    ],
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[aria-label="מצב סנכרון: מסונכרן"]')).toBeVisible({ timeout: 30_000 });
  await navigateTo(page, "guests");

  const bar = page.locator('[data-tour="guests-filters"]');
  const toggle = bar.getByRole("button", { name: /^סינונים/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  for (const name of ["כנראה יבוא", "לשקול", "גלאט", "שותים", "לא משובץ"]) {
    await expect(bar.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await expect(bar.getByRole("combobox")).toHaveCount(0);
  await expect(bar.getByRole("button", { name: /חסר נייד \(1\)/ })).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);

  await toggle.click();
  const panel = page.locator("#guest-filters-panel");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "גלאט", exact: true }).click();
  await expect(panel.getByRole("button", { name: /הצגת 1 רשומות/ })).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
  await panel.getByRole("button", { name: /הצגת 1 רשומות/ }).click();
  await expect(panel).toHaveCount(0);
  await expect(toggle).toContainText("1");
  await expect(page.getByText("מציג 1 מתוך 2 רשומות")).toBeVisible();

  await bar.getByRole("button", { name: "נקה", exact: true }).click();
  await expect(page.getByText("מציג 2 מתוך 2 רשומות")).toBeVisible();
});

test("alcohol 'how much to order' is collapsed by default with the target visible", async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, uniqueIdentity("alcohol-collapse"), { readyTimeout: 60_000 });
  await navigateTo(page, "alcohol");
  const card = page.locator('[data-tour="alcohol-needed"]');
  const toggle = card.getByRole("button", { name: /כמה אלכוהול צריך להזמין/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toContainText("פתיחה");
  await expect(page.getByTestId("alcohol-needed-summary")).toContainText("ליטר");
  await expect(page.locator('[data-tour="alcohol-drinker-estimate"]')).toHaveCount(0);

  // The shopping list is the first full section on the screen.
  const listTop = await page.locator('[data-tour="alcohol-shopping-list"]').boundingBox();
  const neededBox = await card.boundingBox();
  expect(neededBox.height).toBeLessThan(140);
  expect(listTop.y).toBeGreaterThan(neededBox.y);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toContainText("סגירה");
  await expect(page.locator('[data-tour="alcohol-drinker-estimate"]')).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
});
