import { test, expect } from "@playwright/test";
import { assertEmulatorEnvironment, signUp, uniqueIdentity, navigateTo } from "./helpers/emulator.js";
import { blockCloudRequests, createInviteLink, joinViaInvite } from "./helpers/sharing.js";

assertEmulatorEnvironment();
const attemptsByPage = new WeakMap();
test.beforeEach(async ({ page }) => { attemptsByPage.set(page, await blockCloudRequests(page)); });
test.afterEach(async ({ page }) => { expect(attemptsByPage.get(page)).toEqual([]); });
const taskRow = (page, title) => page.locator('[data-tour="checklist-items"] li').filter({ has: page.getByRole("checkbox", { name: `סימון "${title}" כבוצע`, exact: true }) });

async function openEntry(page) {
  const entry = page.locator('[data-tour="checklist-add"]');
  const toggle = entry.locator("button[aria-expanded]");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return entry.locator("form");
}

async function addTask(page, title, notes = "") {
  const form = await openEntry(page);
  await form.getByRole("textbox", { name: "שם המשימה החדשה" }).fill(title);
  await form.getByRole("textbox", { name: "הערות למשימה החדשה" }).fill(notes);
  await form.getByRole("button", { name: "הוספה", exact: true }).click();
  await expect(taskRow(page, title)).toBeVisible();
}

async function waitSaved(page, title, expected) {
  await expect.poll(async () => page.evaluate(async ({ title }) => {
    const store = await import("/src/lib/firebaseStore.js");
    const [wedding] = await store.listWeddings();
    const data = await store.cloudFetchAll(wedding.id, { scopes: ["checklist"] });
    const task = data.checklist.find((item) => item.title === title);
    return { task, options: data.settings.checklistOptions };
  }, { title }), { timeout: 30_000 }).toMatchObject(expected);
}

test("checklist editor manages options, notes, collapse, filters and persistence", async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page, uniqueIdentity("checklist-editor"), { readyTimeout: 60_000 });
  await navigateTo(page, "checklist");
  const entry = page.locator('[data-tour="checklist-add"]');
  const toggle = entry.locator("button[aria-expanded]");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("textbox", { name: "שם המשימה החדשה" })).toHaveCount(0);
  const longNotes = "פרטים חשובים על המשימה. ".repeat(50);
  await addTask(page, "ארגון הסעות", longNotes);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("textbox", { name: "שם המשימה החדשה" })).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "הערות למשימה החדשה" })).toHaveValue("");
  await addTask(page, "בדיקה נוספת");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await page.getByRole("button", { name: "ניהול קטגוריות ושיוך", exact: true }).click();
  const manager = page.getByRole("dialog", { name: "ניהול קטגוריות ושיוך" });
  await manager.getByRole("textbox", { name: "קטגוריה חדשה", exact: true }).fill("הסעות");
  await manager.getByRole("button", { name: "הוספה", exact: true }).click();
  await expect(manager.getByRole("textbox", { name: "שם הסעות", exact: true })).toHaveValue("הסעות");
  await manager.getByRole("textbox", { name: "קטגוריה חדשה", exact: true }).fill("הסעות");
  await manager.getByRole("button", { name: "הוספה", exact: true }).click();
  await expect(manager.getByRole("textbox", { name: "שם הסעות", exact: true })).toHaveCount(1);
  await manager.getByRole("textbox", { name: "קטגוריה חדשה", exact: true }).fill("");
  await manager.getByRole("button", { name: "שיוך", exact: true }).click();
  await manager.getByRole("textbox", { name: "שיוך חדש", exact: true }).fill("מפיק האירוע");
  await manager.getByRole("button", { name: "הוספה", exact: true }).click();
  await manager.getByRole("button", { name: "סגירה", exact: true }).click();

  const row = taskRow(page, "ארגון הסעות");
  await row.getByRole("combobox", { name: "קטגוריה — ארגון הסעות", exact: true }).selectOption("הסעות");
  const assignment = row.getByRole("combobox", { name: "שיוך — ארגון הסעות", exact: true });
  await assignment.selectOption({ label: "מפיק האירוע" });
  const customKey = await assignment.inputValue();
  await expect(row.getByRole("textbox", { name: "הערות — ארגון הסעות", exact: true })).toHaveValue(longNotes);

  const categoryFilter = page.getByRole("combobox", { name: "סינון לפי קטגוריה", exact: true });
  const assignmentFilter = page.getByRole("combobox", { name: "סינון לפי שיוך", exact: true });
  await categoryFilter.selectOption("הסעות");
  await assignmentFilter.selectOption(customKey);
  await expect(row).toBeVisible();
  await expect(taskRow(page, "בדיקה נוספת")).toHaveCount(0);
  await assignmentFilter.selectOption("bride");
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "ניקוי סינונים", exact: true }).click();
  await page.getByRole("textbox", { name: "חיפוש משימה", exact: true }).fill("פרטים חשובים");
  await expect(row).toBeVisible();
  await expect(taskRow(page, "בדיקה נוספת")).toHaveCount(0);
  await page.getByRole("button", { name: "ניקוי סינונים", exact: true }).click();

  await page.getByRole("button", { name: "ניהול קטגוריות ושיוך", exact: true }).click();
  await manager.getByRole("textbox", { name: "שם הסעות", exact: true }).fill("תחבורה");
  await manager.getByRole("button", { name: "שמירת הסעות", exact: true }).click();
  await manager.getByRole("button", { name: "שיוך", exact: true }).click();
  await manager.getByRole("textbox", { name: "שם מפיק האירוע", exact: true }).fill("מפיק");
  await manager.getByRole("button", { name: "שמירת מפיק האירוע", exact: true }).click();
  await manager.getByRole("button", { name: "סגירה", exact: true }).click();
  await waitSaved(page, "ארגון הסעות", { task: { category: "תחבורה", assignee: customKey, notes: longNotes }, options: { categories: expect.arrayContaining(["תחבורה"]), assignees: expect.arrayContaining([{ key: customKey, label: "מפיק" }]) } });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[aria-label="מצב סנכרון: מסונכרן"]')).toBeVisible({ timeout: 30_000 });
  await navigateTo(page, "checklist");
  await expect(row.getByRole("combobox", { name: "קטגוריה — ארגון הסעות", exact: true })).toHaveValue("תחבורה");
  await expect(row.getByRole("combobox", { name: "שיוך — ארגון הסעות", exact: true })).toHaveValue(customKey);
  await expect(row.getByRole("textbox", { name: "הערות — ארגון הסעות", exact: true })).toHaveValue(longNotes);

  await page.getByRole("button", { name: "ניהול קטגוריות ושיוך", exact: true }).click();
  await manager.getByRole("button", { name: "מחיקת תחבורה", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "ביטול", exact: true }).click();
  await expect(manager.getByRole("textbox", { name: "שם תחבורה", exact: true })).toBeVisible();
  await manager.getByRole("button", { name: "מחיקת תחבורה", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "מחיקה", exact: true }).click();
  await expect(manager.getByRole("textbox", { name: "שם תחבורה", exact: true })).toHaveCount(0);
  await manager.getByRole("button", { name: "שיוך", exact: true }).click();
  await manager.getByRole("button", { name: "מחיקת מפיק", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "מחיקה", exact: true }).click();
  await manager.getByRole("button", { name: "סגירה", exact: true }).click();
  await expect(row).toBeVisible();
  await expect(row.getByRole("combobox", { name: "שיוך — ארגון הסעות", exact: true })).not.toHaveValue(customKey);
  await expect(row.getByRole("textbox", { name: "הערות — ארגון הסעות", exact: true })).toHaveValue(longNotes);
  await row.getByRole("checkbox").check();
  await page.getByRole("button", { name: "הסתרת שהושלמו", exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "ניקוי סינונים", exact: true }).click();
  await expect(row.getByRole("checkbox")).toBeChecked();
});

test("checklist sharing keeps viewer notes readable and denies edits outside permissions", async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);
  await signUp(page, uniqueIdentity("checklist-owner"), { readyTimeout: 60_000 });
  await navigateTo(page, "checklist");
  const note = "הערה מלאה לצופה. ".repeat(30);
  await addTask(page, "משימה משותפת", note);
  await page.getByRole("button", { name: "ניהול קטגוריות ושיוך", exact: true }).click();
  const manager = page.getByRole("dialog", { name: "ניהול קטגוריות ושיוך" });
  await manager.getByRole("textbox", { name: "קטגוריה חדשה", exact: true }).fill("משותף");
  await manager.getByRole("button", { name: "הוספה", exact: true }).click();
  await manager.getByRole("button", { name: "סגירה", exact: true }).click();
  await taskRow(page, "משימה משותפת").getByRole("combobox", { name: "קטגוריה — משימה משותפת", exact: true }).selectOption("משותף");
  await waitSaved(page, "משימה משותפת", { task: { category: "משותף", notes: note }, options: { categories: expect.arrayContaining(["משותף"]) } });

  const viewerLink = await createInviteLink(page, { role: "viewer", scopes: ["checklist"] });
  const viewer = await joinViaInvite(browser, testInfo.project.use, viewerLink, "checklist-viewer");
  try {
    const view = viewer.page;
    await navigateTo(view, "checklist");
    await expect(view.locator('[data-tour="checklist-add"]')).toHaveCount(0);
    await expect(view.getByRole("button", { name: "ניהול קטגוריות ושיוך", exact: true })).toHaveCount(0);
    const row = taskRow(view, "משימה משותפת");
    await expect(row.getByRole("checkbox")).toBeDisabled();
    await expect(row.getByRole("combobox", { name: "קטגוריה — משימה משותפת", exact: true })).toBeDisabled();
    await row.locator("summary").click();
    await expect(row.locator("details p")).toHaveText(note);
    const rejected = await view.evaluate(async () => {
      const store = await import("/src/lib/firebaseStore.js");
      const [wedding] = await store.listWeddings();
      try { await store.saveWeddingSettings(wedding.id, { checklistOptions: { categories: ["forbidden"], assignees: [{ key: "both", label: "Both" }] } }); }
      catch (error) { return error.code; }
      return "unexpected success";
    });
    expect(rejected).toBe("permission-denied");
    expect(viewer.cloudAttempts).toEqual([]);
    expect(viewer.pageErrors).toEqual([]);
  } finally { await viewer.context.close(); }

  const editorLink = await createInviteLink(page, { role: "editor", scopes: ["checklist"] });
  const editor = await joinViaInvite(browser, testInfo.project.use, editorLink, "checklist-shared-editor");
  try {
    await navigateTo(editor.page, "checklist");
    await taskRow(editor.page, "משימה משותפת").getByRole("textbox", { name: "הערות — משימה משותפת", exact: true }).fill("הערות שעודכנו על ידי שותף");
    await waitSaved(editor.page, "משימה משותפת", { task: { notes: "הערות שעודכנו על ידי שותף" } });
    expect(editor.cloudAttempts).toEqual([]);
    expect(editor.pageErrors).toEqual([]);
  } finally { await editor.context.close(); }
});