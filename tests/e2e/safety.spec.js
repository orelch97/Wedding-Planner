import { test, expect } from "@playwright/test";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { assertEmulatorEnvironment, expectAppHealthy, uniqueIdentity, signUp, signIn, navigateTo, openNavigationMenu, expectGuestPresent, openAddGuestForm } from "./helpers/emulator.js";

assertEmulatorEnvironment();

const blockedCloudRequests = new WeakMap();
const isFirebaseCloudHost = (hostname) =>
  (/\.googleapis\.com$/i.test(hostname) && hostname.toLowerCase() !== "fonts.googleapis.com") ||
  /(^|\.)firebaseio\.com$/i.test(hostname) ||
  /(^|\.)firebasestorage\.app$/i.test(hostname) ||
  /(^|\.)cloudfunctions\.net$/i.test(hostname) ||
  /(^|\.)run\.app$/i.test(hostname);

test.beforeEach(async ({ page }) => {
  const attempts = [];
  blockedCloudRequests.set(page, attempts);
  page.on("request", (request) => {
    if (isFirebaseCloudHost(new URL(request.url()).hostname)) attempts.push(request.url());
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname.toLowerCase() === "fonts.googleapis.com") {
      await route.abort("blockedbyclient");
      return;
    }
    if (isFirebaseCloudHost(url.hostname)) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
});

test.afterEach(async ({ page }) => {
  expect(blockedCloudRequests.get(page), "E2E must not attempt Firebase cloud traffic").toEqual([]);
});

test.describe("emulator isolation and account lifecycle", () => {
  test("tour preferences track completion, dismissal and manual replay per screen", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await signUp(page, uniqueIdentity("tour-progress"), { readyTimeout: 60_000 });
    const invitation = page.locator('[data-tour="invitation"]');
    const help = page.locator('[data-tour="help"]');
    const tour = page.getByRole("dialog");
    const indicator = help.locator('span[aria-hidden="true"]');
    await expect(invitation).toBeVisible();
    await expect(indicator).toBeVisible();
    const animation = await help.evaluate((button) => {
      const style = getComputedStyle(button);
      return { name: style.animationName, count: style.animationIterationCount };
    });
    expect(animation).toEqual({ name: "pulse", count: "3" });
    await help.evaluate(async (button) => {
      await Promise.all(button.getAnimations().map((animation) => animation.finished));
    });
    expect(await help.evaluate((button) => button.getAnimations().length)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("tour-unseen.png"), animations: "disabled" });

    await invitation.getByRole("button", { name: "התחלת הסיור", exact: true }).click();
    await expect(tour).toBeVisible();
    const dialogFits = await tour.evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect();
      return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
    });
    expect(dialogFits).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("tour-dialog.png"), animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(tour).toHaveCount(0);
    await expect(invitation).toBeVisible();

    await help.click();
    for (let step = 0; step < 15; step++) {
      const finish = tour.getByRole("button", { name: "סיום", exact: true });
      if (await finish.count()) {
        await finish.click();
        break;
      }
      await tour.getByRole("button", { name: "הבא", exact: true }).click();
    }
    await expect(tour).toHaveCount(0);
    await expect(invitation).toHaveCount(0);
    await expect(indicator).toHaveCount(0);
    await expect(help).toBeFocused();
    await page.reload();
    await expectAppHealthy(page);
    await expect(invitation).toHaveCount(0);
    await help.click();
    await expect(tour).toBeVisible();
    await tour.getByRole("button", { name: "סגירת ההדרכה", exact: true }).click();
    await expect(invitation).toHaveCount(0);

    await navigateTo(page, "guests");
    await expect(invitation).toBeVisible();
    await expect(indicator).toBeVisible();
    await help.click();
    await tour.getByRole("button", { name: "דילוג על ההדרכה", exact: true }).click();
    await expect(invitation).toBeVisible();
    await invitation.getByRole("button", { name: "לא עכשיו", exact: true }).click();
    await expect(invitation).toHaveCount(0);
    await expect(indicator).toHaveCount(0);
    await page.reload();
    await expectAppHealthy(page);
    await navigateTo(page, "guests");
    await expect(invitation).toHaveCount(0);
    await help.click();
    await expect(tour).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(invitation).toHaveCount(0);

    await navigateTo(page, "checklist");
    await expect(invitation).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await help.evaluate((button) => getComputedStyle(button).animationName)).toBe("none");
    await help.focus();
    await page.keyboard.press("Enter");
    await expect(tour).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(help).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectAppHealthy(page);
  });

  test("tour preferences survive sign-out without leaking to another user", async ({ page }) => {
    test.setTimeout(180_000);
    const first = uniqueIdentity("tour-first");
    const second = uniqueIdentity("tour-second");
    const invitation = page.locator('[data-tour="invitation"]');
    async function logout() {
      const desktopLogout = page.getByRole("button", { name: "יציאה", exact: true });
      if (await desktopLogout.isVisible()) await desktopLogout.click();
      else {
        await page.getByRole("button", { name: "פעולות נוספות" }).click();
        await page.getByRole("menuitem", { name: "יציאה מהחשבון" }).click();
      }
      await expect(page.getByLabel("מייל", { exact: true })).toBeVisible();
    }
    await page.goto("/");
    const authHelp = page.getByRole("button", { name: "הדרכה: איך פותחים חשבון", exact: true });
    await authHelp.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await authHelp.click();
    const authTour = page.getByRole("dialog");
    for (let step = 0; step < 20; step++) {
      const finish = authTour.getByRole("button", { name: "סיום", exact: true });
      if (await finish.count()) {
        await finish.click();
        break;
      }
      await authTour.getByRole("button", { name: "הבא", exact: true }).click();
    }
    await expect(authTour).toHaveCount(0);
    await signUp(page, first, { readyTimeout: 60_000 });
    await invitation.getByRole("button", { name: "לא עכשיו", exact: true }).click();
    await expect(invitation).toHaveCount(0);
    await logout();
    await signUp(page, second, { readyTimeout: 60_000 });
    await expect(invitation).toBeVisible();
    await logout();
    await signIn(page, first);
    await expect(page.locator('[aria-label="מצב סנכרון: מסונכרן"]')).toBeVisible({ timeout: 30_000 });
    await expect(invitation).toHaveCount(0);
    await navigateTo(page, "guests");
    await expect(invitation).toBeVisible();
    await expectAppHealthy(page);
  });

  test("shared controls keep actions and filters visible across screens", async ({ page }) => {
    test.setTimeout(120_000);
    await signUp(page, uniqueIdentity("controls"), { readyTimeout: 60_000 });
    for (const key of ["overview", "checklist", "guests", "alcohol", "seating", "vendors", "finance"]) {
      await navigateTo(page, key);
      await expectAppHealthy(page);
      const escaping = await page.getByRole("main").evaluate((main) => [...main.querySelectorAll("button,select")].filter((element) => {
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height || element.closest("[inert]")) return false;
        for (let parent = element.parentElement; parent && parent !== main; parent = parent.parentElement) {
          if (/auto|scroll/.test(getComputedStyle(parent).overflowX)) return false;
        }
        return rect.left < -1 || rect.right > innerWidth + 1;
      }).map((element) => element.getAttribute("aria-label") || element.textContent));
      expect(escaping, `${key} controls must fit`).toEqual([]);
    }
    await navigateTo(page, "guests");
    const exportButton = page.getByRole("button", { name: "ייצוא", exact: true });
    const exportColor = await exportButton.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(exportColor).not.toBe("rgb(255, 255, 255)");
    const filters = page.locator('[data-tour="guests-filters"]');
    const status = filters.getByRole("combobox", { name: "סינון לפי אישור הגעה", exact: true });
    await status.selectOption("confirmed");
    await expect(status).toHaveClass(/filter-select-active/);
    await filters.getByRole("button", { name: "כנראה יבוא", exact: true }).click();
    await expect(filters.getByRole("button", { name: "כנראה יבוא", exact: true })).toHaveAttribute("aria-pressed", "true");
    await filters.getByRole("button", { name: "נקה", exact: true }).click();
    await expect(status).toHaveValue("all");
    await page.getByRole("button", { name: "קטגוריות", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "ניהול קטגוריות מוזמנים" })).toBeVisible();
    await page.getByRole("dialog", { name: "ניהול קטגוריות מוזמנים" }).getByRole("button", { name: "סגירה", exact: true }).click();
  });

  test("shared controls style admin refresh without breaking admin access", async ({ page }) => {
    test.setTimeout(120_000);
    const { initializeApp, getApps } = await import("firebase-admin/app");
    const { getAuth } = await import("firebase-admin/auth");
    const app = getApps().find((candidate) => candidate.name === "controls-admin") || initializeApp({ projectId: "demo-wedding-planner-e2e" }, "controls-admin");
    const auth = getAuth(app);
    const identity = { email: "orelch97@gmail.com", password: "E2E-only-Password-938!" };
    const user = await auth.getUserByEmail(identity.email).catch((error) => {
      if (error.code !== "auth/user-not-found") throw error;
      return auth.createUser({ ...identity, emailVerified: true }).catch((createError) => {
        if (createError.code === "auth/email-already-exists") return auth.getUserByEmail(identity.email);
        throw createError;
      });
    });
    if (!user.emailVerified) await auth.updateUser(user.uid, { emailVerified: true });
    await signIn(page, identity);
    await navigateTo(page, "admin");
    await expect(page.locator('[data-tour="admin-stats"]')).toBeVisible();
    const refresh = page.getByRole("button", { name: "רענון", exact: true });
    await expect(refresh).toBeEnabled({ timeout: 30_000 });
    expect(await refresh.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(201, 168, 106)");
    await refresh.click();
    await expect(refresh).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByRole("alert")).toHaveCount(0);
    await openNavigationMenu(page);
    await page.getByRole("button", { name: /שיתוף וחברים/ }).click();
    const sharing = page.getByRole("dialog", { name: "שיתוף החתונה" });
    await sharing.getByRole("button", { name: "מסכים נבחרים", exact: true }).click();
    await expect(sharing.getByRole("button", { name: "מסכים נבחרים", exact: true })).toHaveAttribute("aria-pressed", "true");
    const dialogOverflow = await sharing.evaluate((dialog) => {
      const frame = dialog.getBoundingClientRect();
      return [...dialog.querySelectorAll("button,input,select")].some((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < frame.left - 1 || rect.right > frame.right + 1);
      });
    });
    expect(dialogOverflow).toBe(false);
    await sharing.getByRole("button", { name: "כל המערכת", exact: true }).click();
    await sharing.getByRole("button", { name: "סגירה", exact: true }).click();
  });

  test("rejects non-local or non-demo configuration before browser actions", async () => {
    expect(process.env.VITE_USE_FIREBASE_EMULATORS).toBe("true");
    expect(process.env.VITE_FIREBASE_ENV).toBe("test");
    expect(process.env.VITE_FIREBASE_PROJECT_ID).toBe("demo-wedding-planner-e2e");
  });

  test("creates a synthetic account and renders its isolated wedding workspace", async ({ page }) => {
    const identity = uniqueIdentity("signup");
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await signUp(page, identity);
    await expectAppHealthy(page);
    expect(pageErrors).toEqual([]);
  });

  test("sign-in form reports invalid synthetic credentials without crashing", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("מייל", { exact: true }).fill("missing-user@example.test");
    await page.getByLabel(/^סיסמה|^password/i).fill("wrong-password");
    await page.locator('[data-tour="auth-submit"]').click();
    await expect(page.locator("body")).toContainText(/שגיאה|נכשל|לא נמצא|invalid|failed|incorrect/i, { timeout: 15_000 });
    await expect(page.getByRole("main")).toBeHidden();
  });

  test("warms Passkey options before tap so the platform prompt opens immediately", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.credentials, "get", {
        configurable: true,
        value: async () => {
          window.__passkeyPromptAt = performance.now();
          return null;
        },
      });
    });
    const optionsReady = page.waitForResponse(
      (response) => response.url().includes("passkeyLoginOptions") && response.status() === 200,
      { timeout: 30_000 }
    );
    await page.goto("http://localhost:4173/");
    await optionsReady;

    const tapAt = await page.evaluate(() => performance.now());
    await page.getByRole("button", { name: "כניסה מהירה עם Passkey" }).click();
    await expect(page.locator("body")).toContainText("הפעולה בוטלה או שפג הזמן. נסו שוב.");
    const promptAt = await page.evaluate(() => window.__passkeyPromptAt);
    expect(promptAt - tapAt).toBeLessThan(500);
  });

  test("sends a Hebrew reset action and completes password reset in the app", async ({ page, request }) => {
    test.setTimeout(120_000);
    const identity = uniqueIdentity("reset");
    await signUp(page, identity);

    const desktopLogout = page.getByRole("button", { name: "יציאה", exact: true });
    if (await desktopLogout.isVisible()) {
      await desktopLogout.click();
    } else {
      await page.getByRole("button", { name: "פעולות נוספות" }).click();
      await page.getByRole("menuitem", { name: "יציאה מהחשבון" }).click();
    }
    await page.getByLabel("מייל", { exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "שכחתי סיסמה", exact: true }).click();
    await page.getByLabel("מייל", { exact: true }).fill(identity.email);
    const resetRequestPromise = page.waitForRequest((outgoingRequest) =>
      outgoingRequest.url().includes("accounts:sendOobCode")
    );
    await page.locator('[data-tour="auth-submit"]').click();
    const resetRequest = await resetRequestPromise;
    expect((await resetRequest.allHeaders())["x-firebase-locale"]).toBe("he");
    await expect(page.locator("body")).toContainText("אם הכתובת רשומה במערכת, נשלח אליה קישור לאיפוס הסיסמה.");

    const codesResponse = await request.get(
      "http://127.0.0.1:9099/emulator/v1/projects/demo-wedding-planner-e2e/oobCodes"
    );
    expect(codesResponse.ok()).toBe(true);
    const { oobCodes = [] } = await codesResponse.json();
    const resetAction = [...oobCodes].reverse().find(
      (code) => code.email === identity.email && code.requestType === "PASSWORD_RESET"
    );
    expect(resetAction?.oobCode).toBeTruthy();
    expect(resetAction?.oobLink).toContain("continueUrl=http%3A%2F%2F127.0.0.1%3A4173");

    await page.goto("http://127.0.0.1:4173/?mode=resetPassword&oobCode=invalid-code&lang=he");
    await expect(page.getByRole("alert")).toContainText("קישור האיפוס אינו תקף או שכבר השתמשתם בו");
    await page.getByRole("button", { name: "חזרה למסך ההתחברות" }).click();

    await page.goto(`http://127.0.0.1:4173/?mode=resetPassword&oobCode=${encodeURIComponent(resetAction.oobCode)}&lang=he`);
    await expect(page.getByRole("heading", { name: "קביעת סיסמה חדשה" })).toBeVisible();
    await expect(page.locator("body")).toContainText(identity.email);
    const password = page.getByLabel("סיסמה חדשה");
    const confirmation = page.getByLabel("אימות סיסמה");
    await password.fill("short");
    await confirmation.fill("short");
    await page.getByRole("button", { name: "עדכון הסיסמה" }).click();
    await expect(page.getByRole("alert")).toContainText("הסיסמה חייבת להכיל לפחות 8 תווים");

    const newPassword = "QA-Reset-Password-2026!";
    await password.fill(newPassword);
    await confirmation.fill(`${newPassword}-mismatch`);
    await page.getByRole("button", { name: "עדכון הסיסמה" }).click();
    await expect(page.getByRole("alert")).toContainText("שתי הסיסמאות אינן זהות");

    await confirmation.fill(newPassword);
    await page.getByRole("button", { name: "עדכון הסיסמה" }).click();
    await expect(page.getByRole("heading", { name: "הסיסמה עודכנה" })).toBeVisible();
    await page.getByRole("button", { name: "למסך ההתחברות" }).click();
    await page.getByLabel("מייל", { exact: true }).fill(identity.email);
    await page.getByLabel(/^סיסמה|^password/i).fill(newPassword);
    await page.locator('[data-tour="auth-submit"]').click();
    await expect(page.getByRole("main")).toBeVisible({ timeout: 30_000 });
  });

  test("creates a synthetic guest and exports the isolated list", async ({ page }) => {
    await signUp(page, uniqueIdentity("guest"));
    await navigateTo(page, "guests");

    const guestName = `E2E guest ${Date.now()}`;
    // Collapsed until asked for, so its fields are not reachable yet.
    await expect(page.locator('[data-tour="guests-add"]').getByRole("button", { name: "הוספת מוזמן חדש" })).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("textbox", { name: "שם האורח או המשפחה" })).toHaveCount(0);
    await openAddGuestForm(page);
    await page.getByRole("textbox", { name: "שם האורח או המשפחה" }).fill(guestName);
    await page.getByRole("button", { name: /הוסף לרשימה/ }).click();
    await expectGuestPresent(page, guestName);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /ייצוא/ }).click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/i);
  });

  test("backup complete JSON and Excel round trips preserve planning data", async ({ page }) => {
    test.setTimeout(180_000);
    await signUp(page, uniqueIdentity("backup-complete"), { readyTimeout: 60_000 });
    const vendorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const payload = {
      app: "wedding-planner", version: 3,
      guests: [{ id: 71, name: "Backup guest", phone: "0501234567", category: "Backup category", seats: 3, drinkers: 2, rsvp: "confirmed", attendingCount: 2, probablyComing: true, considering: true, glatt: true, gift: 123.5, mention: "Guest notes" }],
      tables: [{ id: 81, name: "Backup table", type: "knight", guestIds: [71] }],
      vendors: [{ id: vendorId, name: "Backup vendor", type: "DJ", phone: "0521234567", email: "vendor@example.test", contractCost: 1234.5, deposit: 234.5, notes: "Vendor notes", tasks: [{ id: 1, title: "Vendor task", status: "inprogress" }] }],
      budget: [{ id: 91, category: "Backup budget", expected: 1234.5, actual: 234.5, vendorId, paymentMethod: "Credit Card", notes: "Budget notes" }],
      checklist: [{ id: 101, title: "Backup task", category: "Custom category", assignee: "custom", notes: "Checklist notes", done: true }],
      vendorAttachments: [],
      settings: {
        budgetGoal: 98765, categories: ["Backup category"], partnerA: "Backup A", partnerB: "Backup B", weddingDate: "2027-06-01", countdownBackgroundUrl: "https://example.test/background.jpg",
        financeLabels: { income: "Custom income", expense: "Custom expense" },
        checklistOptions: { categories: ["Custom category"], assignees: [{ key: "custom", label: "Custom assignee" }] },
        alcohol: { source: "percent", percent: 65, headcount: "240", peoplePerBottle: 4, drinks: [{ id: "drink-1", label: "Wine", packKind: "bottle", packUnits: 1, unitLiters: 0.75, qty: 3, price: 19.95 }] },
      },
    };
    const input = page.locator('input[type="file"]').first();
    async function restore(file) {
      await input.setInputFiles(file);
      const safety = page.waitForEvent("download");
      await page.getByRole("alertdialog", { name: "שחזור גיבוי יחליף את כל הנתונים" }).getByRole("button", { name: "שחזר נתונים" }).click();
      expect((await safety).suggestedFilename()).toContain("before-restore");
      await expect(page.getByText("הגיבוי שוחזר בהצלחה", { exact: true })).toBeVisible();
      await expect.poll(async () => page.evaluate(async () => {
        const store = await import("/src/lib/firebaseStore.js");
        const [wedding] = await store.listWeddings();
        const data = await store.cloudFetchAll(wedding.id, { scopes: ["all"] });
        return { guests: data.guests, tables: data.tables, vendors: data.vendors, budget: data.budget, checklist: data.checklist, settings: data.settings };
      }), { timeout: 45_000 }).toMatchObject({ guests: payload.guests, tables: payload.tables, vendors: payload.vendors, budget: payload.budget, checklist: payload.checklist, settings: { alcohol: payload.settings.alcohol, budgetGoal: payload.settings.budgetGoal, categories: payload.settings.categories, checklistOptions: { assignees: expect.arrayContaining(payload.settings.checklistOptions.assignees) } } });
    }
    await restore({ name: "complete.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(payload)) });
    for (const format of ["json", "xlsx"]) {
      await page.getByRole("button", { name: "פעולות נוספות" }).click();
      const downloaded = page.waitForEvent("download");
      if (format === "json") {
        await page.getByRole("menuitem", { name: /^קובץ גיבוי \(JSON\)/ }).click();
        await page.getByRole("alertdialog", { name: "להצפין את קובץ הגיבוי?" }).getByRole("button", { name: "הורד ללא הצפנה" }).click();
      } else await page.getByRole("menuitem", { name: /ייצוא לאקסל/ }).click();
      const file = await downloaded;
      const filePath = await file.path();
      const { readWorkbookBackup } = await import("../../src/lib/excelExport.js");
      const bytes = await readFile(filePath);
      const exported = format === "json" ? JSON.parse(bytes.toString("utf8")) : await readWorkbookBackup({ arrayBuffer: async () => bytes });
      for (const key of ["guests", "tables", "vendors", "budget", "checklist"]) expect(exported[key]).toMatchObject(payload[key]);
      expect(exported.settings).toMatchObject({ ...payload.settings, checklistOptions: { assignees: expect.arrayContaining(payload.settings.checklistOptions.assignees), categories: expect.arrayContaining(payload.settings.checklistOptions.categories) } });
      await restore({ name: file.suggestedFilename(), mimeType: format === "json" ? "application/json" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: bytes });
      await page.reload();
      await expectAppHealthy(page);
      await expect(page.locator('[aria-label="מצב סנכרון: מסונכרן"]')).toBeVisible({ timeout: 30_000 });
    }
    await input.setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "wedding-planner", guests: [null] })) });
    await expect(page.getByText("קובץ הגיבוי אינו תקין. ודא שזהו קובץ שיוצא מהמערכת.", { exact: true })).toBeVisible();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await page.evaluate(() => {
      const original = URL.createObjectURL;
      URL.createObjectURL = (...args) => {
        URL.createObjectURL = original;
        throw new Error(`Simulated safety download failure (${args.length})`);
      };
    });
    await input.setInputFiles({ name: "complete.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...payload, guests: [] })) });
    await page.getByRole("alertdialog", { name: "שחזור גיבוי יחליף את כל הנתונים" }).getByRole("button", { name: "שחזר נתונים" }).click();
    await expect(page.getByText("לא ניתן ליצור גיבוי בטיחות. השחזור בוטל ולא שונו נתונים.", { exact: true })).toBeVisible();
    await page.reload();
    await expectAppHealthy(page);
    await navigateTo(page, "guests");
    await expectGuestPresent(page, "Backup guest");
  });

  test("downloads guest and workbook exports, then restores an encrypted backup", async ({ page }) => {
    test.setTimeout(120_000);
    await signUp(page, uniqueIdentity("backup"));
    await navigateTo(page, "guests");

    const guestName = `E2E backup guest ${Date.now()}`;
    await openAddGuestForm(page);
    await page.getByRole("textbox", { name: "שם האורח או המשפחה" }).fill(guestName);
    await page.getByRole("button", { name: /הוסף לרשימה/ }).click();
    await expectGuestPresent(page, guestName);

    const templateDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "תבנית", exact: true }).click();
    const template = await templateDownload;
    expect(template.suggestedFilename()).toMatch(/\.csv$/i);
    expect((await stat(await template.path())).size).toBeGreaterThan(0);

    await page.getByRole("button", { name: "פעולות נוספות" }).click();
    const workbookDownload = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: /ייצוא לאקסל/ }).click();
    const workbookFile = await workbookDownload;
    expect(workbookFile.suggestedFilename()).toMatch(/\.xlsx$/i);
    const workbookPath = await workbookFile.path();
    expect((await stat(workbookPath)).size).toBeGreaterThan(0);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toContain("מוזמנים");
    expect(workbook.getWorksheet("מוזמנים").getCell(2, 2).value).toBe(guestName);

    await page.getByRole("button", { name: "פעולות נוספות" }).click();
    await page.getByRole("menuitem", { name: /^קובץ גיבוי \(JSON\)/ }).click();
    const backupChoice = page.getByRole("alertdialog", { name: "להצפין את קובץ הגיבוי?" });
    const plainBackupDownload = page.waitForEvent("download");
    await backupChoice.getByRole("button", { name: "הורד ללא הצפנה" }).click();
    const plainBackup = await plainBackupDownload;
    await expect(backupChoice).toBeHidden();
    const plainBackupPath = await plainBackup.path();
    const plainPayload = JSON.parse(await readFile(plainBackupPath, "utf8"));
    expect(plainBackup.suggestedFilename()).toMatch(/\.json$/i);
    expect(plainPayload.app).toBe("wedding-planner");
    expect(plainPayload.guests.some((guest) => guest.name === guestName)).toBe(true);

    await page.getByRole("button", { name: "פעולות נוספות" }).click();
    await page.getByRole("menuitem", { name: /^קובץ גיבוי \(JSON\)/ }).click();
    await expect(backupChoice).toBeVisible();
    await backupChoice
      .getByRole("button", { name: "הצפן בסיסמה" }).click();
    const encryptionDialog = page.getByRole("dialog", { name: "סיסמת הצפנה" });
    const passphrase = "QA-only-restore-passphrase-2026";
    await encryptionDialog.getByRole("textbox").fill(passphrase);
    const encryptedDownload = page.waitForEvent("download");
    await encryptionDialog.getByRole("button", { name: "הצפן והורד" }).click();
    const encryptedFile = await encryptedDownload;
    const encryptedPath = await encryptedFile.path();
    const encryptedPayload = JSON.parse(await readFile(encryptedPath, "utf8"));
    expect(encryptedFile.suggestedFilename()).toMatch(/encrypted.*\.json$/i);
    expect(encryptedPayload.data).toBeTruthy();
    expect(JSON.stringify(encryptedPayload)).not.toContain(guestName);

    const guestNameLabel = (page.viewportSize()?.width ?? 1365) < 500 ? "שם האורח" : "שם";
    const guestNameField = page.getByRole("textbox", { name: guestNameLabel, exact: true });
    const changedGuestName = `${guestName} changed`;
    await guestNameField.fill(changedGuestName);
    await guestNameField.blur();
    const changedGuestAction = (page.viewportSize()?.width ?? 1365) < 500
      ? page.getByRole("button", { name: `פתיחת פרטי ${changedGuestName}` })
      : page.getByRole("button", { name: `מחיקת ${changedGuestName}` });
    await expect(changedGuestAction).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(page.locator('[aria-label="מצב סנכרון: מסונכרן"]')).toBeVisible();
    await page.reload();
    await page.getByRole("main").waitFor({ state: "visible", timeout: 30_000 });
    await page.locator('[aria-label="מצב סנכרון: מסונכרן"]').waitFor({ state: "visible", timeout: 30_000 });
    await navigateTo(page, "guests");
    await expectGuestPresent(page, changedGuestName);

    const backupInput = page.locator('input[type="file"]').first();
    await backupInput.setInputFiles(encryptedPath);
    const decryptDialog = page.getByRole("dialog", { name: "קובץ גיבוי מוצפן" });
    await decryptDialog.getByRole("textbox").fill("wrong-passphrase");
    await decryptDialog.getByRole("button", { name: "פענח" }).click();
    await expect(page.getByText("הסיסמה שגויה או שהקובץ פגום.")).toBeVisible();
    await expectGuestPresent(page, changedGuestName);

    await backupInput.setInputFiles(encryptedPath);
    await page.getByRole("dialog", { name: "קובץ גיבוי מוצפן" })
      .getByRole("textbox").fill(passphrase);
    await page.getByRole("dialog", { name: "קובץ גיבוי מוצפן" })
      .getByRole("button", { name: "פענח" }).click();
    const restoreConfirmation = page.getByRole("alertdialog", { name: "שחזור גיבוי יחליף את כל הנתונים" });
    await restoreConfirmation.getByRole("button", { name: "ביטול" }).click();
    await expectGuestPresent(page, changedGuestName);

    await backupInput.setInputFiles(encryptedPath);
    await page.getByRole("dialog", { name: "קובץ גיבוי מוצפן" })
      .getByRole("textbox").fill(passphrase);
    await page.getByRole("dialog", { name: "קובץ גיבוי מוצפן" })
      .getByRole("button", { name: "פענח" }).click();
    const restoreDownload = page.waitForEvent("download");
    await page.getByRole("alertdialog", { name: "שחזור גיבוי יחליף את כל הנתונים" })
      .getByRole("button", { name: "שחזר נתונים" }).click();
    const beforeRestore = await restoreDownload;
    expect(beforeRestore.suggestedFilename()).toMatch(/before-restore.*\.json$/i);
    await expectGuestPresent(page, guestName);
  });

  test("creates and completes a checklist item in the isolated wedding", async ({ page }) => {
    await signUp(page, uniqueIdentity("checklist"));
    await navigateTo(page, "checklist");
    const taskTitle = `E2E task ${Date.now()}`;
    await page.locator('[data-tour="checklist-add"]').getByRole("button", { name: "הוספה", exact: true }).click();
    await page.getByRole("textbox", { name: "שם המשימה החדשה" }).fill(taskTitle);
    await page.locator('[data-tour="checklist-add"] form').getByRole("button", { name: "הוספה" }).click();
    const task = page.getByRole("checkbox", { name: `סימון "${taskTitle}" כבוצע` });
    await expect(task).toBeVisible();
    const search = page.getByRole("textbox", { name: "חיפוש משימה" });
    await search.fill("no matching task");
    await expect(task).toBeHidden();
    await search.fill("");
    await page.getByRole("combobox", { name: "סינון לפי שיוך" }).selectOption("bride");
    await expect(task).toBeHidden();
    await page.getByRole("combobox", { name: "סינון לפי שיוך" }).selectOption("both");
    await expect(task).toBeVisible();
    await task.check();
    await expect(task).toBeChecked();
    await page.getByRole("button", { name: /שהושלמו/ }).click();
    await expect(task).toBeHidden();
    await page.getByRole("button", { name: /שהושלמו/ }).click();
    await expect(task).toBeVisible();

    await page.getByRole("button", { name: `שינוי שם המשימה "${taskTitle}"` }).click();
    const renamedTitle = `${taskTitle} renamed`;
    const titleField = page.getByRole("textbox", { name: "שם המשימה", exact: true });
    await titleField.fill(renamedTitle);
    await titleField.press("Enter");
    const renamedTask = page.getByRole("checkbox", { name: `סימון "${renamedTitle}" כבוצע` });
    await expect(renamedTask).toBeVisible();

    const deleteTask = page.getByRole("button", { name: `מחיקת המשימה "${renamedTitle}"` });
    await deleteTask.click();
    const deleteDialog = page.getByRole("alertdialog", { name: "מחיקת משימה" });
    await deleteDialog.getByRole("button", { name: "ביטול" }).click();
    await expect(renamedTask).toBeVisible();
    await deleteTask.click();
    await page.getByRole("alertdialog", { name: "מחיקת משימה" })
      .getByRole("button", { name: "מחיקה" }).click();
    await expect(renamedTask).toBeHidden();

    const loadTemplate = page.getByRole("button", { name: "טעינת הרשימה המומלצת" });
    await loadTemplate.click();
    const templateDialog = page.getByRole("alertdialog", { name: "טעינת הרשימה המומלצת" });
    await templateDialog.getByRole("button", { name: "ביטול" }).click();
    await expect(loadTemplate).toBeVisible();
    await loadTemplate.click();
    await page.getByRole("alertdialog", { name: "טעינת הרשימה המומלצת" })
      .getByRole("button", { name: "הוספה" }).click();
    await expect(page.getByRole("main")).toContainText("0 מתוך 45 משימות הושלמו");
  });

  test("calculates alcohol estimates and transfers cost to the budget", async ({ page }) => {
    test.setTimeout(120_000);
    await signUp(page, uniqueIdentity("alcohol"));
    await navigateTo(page, "guests");
    await openAddGuestForm(page);
    await page.getByRole("textbox", { name: "שם האורח או המשפחה" }).fill(`E2E drinkers ${Date.now()}`);
    await page.getByRole("spinbutton", { name: "מספר כיסאות" }).fill("8");
    await page.getByRole("button", { name: /הוסף לרשימה/ }).click();
    await navigateTo(page, "alcohol");

    // The guest list has 8 seats, but the headcount is the couple's own estimate, not the RSVPs.
    await expect(page.locator('[data-tour="alcohol-result"]')).toContainText("0 אנשים");
    await page.getByRole("spinbutton", { name: "מספר האורחים המשוער באירוע" }).fill("8");
    await page.getByRole("spinbutton", { name: "אחוז האורחים ששותים אלכוהול" }).fill("50");
    await expect(page.locator('[data-tour="alcohol-result"]')).toContainText("4 אנשים");
    await page.getByRole("button", { name: /שותים הרבה/ }).click();
    await expect(page.getByRole("spinbutton", { name: "כמה אנשים לבקבוק אחד" })).toHaveValue("4");

    // The list starts empty — nothing is pre-seeded for the couple.
    await expect(page.locator('[data-tour="alcohol-shopping-list"]')).toContainText("הרשימה עדיין ריקה");

    const addDrink = page.locator('[data-tour="alcohol-add-drink"]');
    // The form is collapsed until asked for, and its fields are out of the tab order meanwhile.
    const addToggle = addDrink.getByRole("button", { name: "הוספת משקה חדש" });
    await expect(addToggle).toHaveAttribute("aria-expanded", "false");
    await expect(addDrink.getByRole("textbox", { name: "שם המשקה" })).toHaveCount(0);
    await addToggle.click();
    await expect(addToggle).toHaveAttribute("aria-expanded", "true");
    await addDrink.getByRole("textbox", { name: "שם המשקה" }).fill("QA Vodka");
    await addDrink.getByRole("spinbutton", { name: "ליטר לבקבוק" }).fill("1");
    await addDrink.getByRole("button", { name: "הוספה" }).click();
    // The form stays open after adding; closing it is the user's call.
    await expect(addToggle).toHaveAttribute("aria-expanded", "true");
    await expect(addDrink.getByRole("textbox", { name: "שם המשקה" })).toHaveValue("");
    await addToggle.click();
    await expect(addToggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("spinbutton", { name: "כמות QA Vodka" })).toHaveValue("1");

    // Every field lives in the row itself and is editable in place.
    await page.getByRole("textbox", { name: "שם המשקה QA Vodka" }).fill("QA Grey");
    await page.getByRole("spinbutton", { name: "מחיר לבקבוק של QA Grey" }).fill("90");
    await page.getByRole("spinbutton", { name: "כמות QA Grey" }).fill("5");
    await expect(page.locator('[data-tour="alcohol-totals"]')).toContainText("5 מתוך 1 ליטר");

    // A tray is counted in units, so it swaps the liters field for "units per pack".
    await page.locator('[data-tour="alcohol-shopping-list"]').getByRole("button", { name: "אקסל" }).click();
    await expect(page.getByRole("spinbutton", { name: "יחידות במגש של אקסל" })).toHaveValue("24");
    await expect(page.getByRole("spinbutton", { name: "ליטר למגש של אקסל" })).toHaveCount(0);
    // Counting it toward the liters target is the user's call, on any pack kind.
    await page.getByRole("button", { name: "אקסל לא מחושב באלכוהול" }).click();
    await expect(page.getByRole("spinbutton", { name: "ליטר למגש של אקסל" })).toBeVisible();
    await page.getByRole("button", { name: "מחיקת אקסל מהרשימה" }).click();
    await expect(page.getByRole("textbox", { name: "שם המשקה אקסל" })).toHaveCount(0);

    const transfer = page.locator('[data-tour="alcohol-budget-transfer"]');
    await expect(transfer).not.toContainText(/0\s*₪/);
    await transfer.getByRole("button", { name: "העבר לסעיף תקציב" }).click();
    await page.waitForTimeout(1000);
    await expect(page.locator('[aria-label="מצב סנכרון: מסונכרן"]')).toBeVisible({ timeout: 20_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("main").waitFor({ state: "visible", timeout: 30_000 });
    await page.locator('[aria-label="מצב סנכרון: מסונכרן"]').waitFor({ state: "visible", timeout: 30_000 });
    await navigateTo(page, "finance");
    await expect(page.getByRole("button", { name: /עריכת אלכוהול/ })).toBeVisible();
    await expect(page.locator('[data-tour="finance-add-item"]')).toContainText("עלות");
  });

  test("flags guests that share a mobile number (digits only) and stays silent otherwise", async ({ page }) => {
    test.setTimeout(120_000);
    await signUp(page, uniqueIdentity("dupes"));
    await navigateTo(page, "guests");

    const flags = page.locator("[data-duplicate-phone]:visible");
    const chip = page.getByRole("button", { name: /נייד כפול/ });
    const guest = (name) => page.locator(`input[value="${name}"]:visible`).first();
    const add = async (name, phone) => {
      await openAddGuestForm(page);
      await page.getByRole("textbox", { name: "שם האורח או המשפחה" }).fill(name);
      await page.getByRole("textbox", { name: "מספר נייד" }).fill(phone);
      await page.getByRole("button", { name: /הוסף לרשימה/ }).click();
      await expect(guest(name)).toBeVisible();
    };

    // Valid, empty and hyphen-only records must never raise an alert, however many there are.
    await add("אורח א", "050-1111111");
    await add("אורח ב", "052-2222222");
    await add("ללא טלפון 1", "");
    await add("ללא טלפון 2", "");
    await add("מקף בלבד 1", "-");
    await add("מקף בלבד 2", "-");
    await add("מספר חלקי", "050-12");
    await expect(flags).toHaveCount(0);
    await expect(chip).toHaveCount(0);

    // The first holder of a number is not a duplicate until a second one appears.
    await add("כפול ראשון", "050-1234567");
    await expect(flags).toHaveCount(0);

    // Same digits, hyphen only: both records are flagged and name each other.
    await add("כפול שני", "0501234567");
    await expect(flags).toHaveCount(2);
    await expect(chip).toContainText("(2)");
    const labels = await flags.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
    expect(labels.filter((label) => label.includes("כפול שני"))).toHaveLength(1);
    expect(labels.filter((label) => label.includes("כפול ראשון"))).toHaveLength(1);

    // Spaces count as separators too.
    await add("כפול שלישי", "050 123 4567");
    await expect(flags).toHaveCount(3);
    await expect(chip).toContainText("(3)");

    // The filter shows exactly the flagged records and nothing else.
    await chip.click();
    await expect(guest("כפול ראשון")).toBeVisible();
    await expect(guest("כפול שלישי")).toBeVisible();
    await expect(page.locator('input[value="אורח א"]:visible')).toHaveCount(0);
    await chip.click();
    await expect(guest("אורח א")).toBeVisible();

    // Resolving the duplicates removes every alert, including the filter chip.
    await page.getByRole("button", { name: "מחיקת כפול שלישי" }).click();
    await expect(flags).toHaveCount(2);
    await page.getByRole("button", { name: "מחיקת כפול שני" }).click();
    await expect(flags).toHaveCount(0);
    await expect(chip).toHaveCount(0);
  });

  test("creates a guest and table, then assigns the guest to the table", async ({ page }) => {
    await signUp(page, uniqueIdentity("seating"));
    await navigateTo(page, "guests");
    const guestName = `E2E seated guest ${Date.now()}`;
    await openAddGuestForm(page);
    await page.getByRole("textbox", { name: "שם האורח או המשפחה" }).fill(guestName);
    await page.getByRole("button", { name: /הוסף לרשימה/ }).click();
    await expectGuestPresent(page, guestName);

    await navigateTo(page, "seating");
    const tableName = `E2E table ${Date.now()}`;
    await page.getByRole("textbox", { name: "שם השולחן החדש" }).fill(tableName);
    await page.locator('[data-tour="seating-add-table"]').getByRole("button").click();
    await page.getByRole("button", { name: "שבץ מוזמן" }).click();
    const picker = page.getByRole("dialog", { name: new RegExp(tableName) });
    await picker.getByRole("button").filter({ hasText: guestName }).click();
    await expect(page.locator('[data-tour="seating-table-cards"]')).toContainText(guestName);
  });

  test("adds an isolated budget line", async ({ page }) => {
    test.setTimeout(120_000);
    await signUp(page, uniqueIdentity("budget"));
    await navigateTo(page, "finance");
    const lineName = `E2E budget ${Date.now()}`;
    const form = page.locator('[data-tour="finance-add-item"]');
    const toggle = form.getByRole("button", { name: "הוספת סעיף", exact: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(form.getByRole("textbox", { name: "שם הסעיף" })).toHaveCount(0);
    await toggle.click();
    await form.getByRole("textbox", { name: "שם הסעיף" }).fill(lineName);
    await form.getByRole("spinbutton", { name: "עלות", exact: true }).fill("1250");
    await form.getByRole("button", { name: "הוסף" }).click();
    await expect(page.getByRole("button", { name: new RegExp(`עריכת ${lineName}`) })).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(form.getByRole("textbox", { name: "שם הסעיף" })).toHaveValue("");
    await expect(form.getByRole("textbox", { name: "שם הסעיף" })).toBeFocused();
    await form.getByRole("textbox", { name: "שם הסעיף" }).fill(`${lineName} second`);
    await form.getByRole("button", { name: "הוסף" }).click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(form.getByRole("textbox", { name: "שם הסעיף" })).toHaveCount(0);
    const payment = page.getByRole("combobox", { name: `אמצעי תשלום — ${lineName}`, exact: true });
    for (const method of ["Bit", "Credit Card", "Cash", "Other"]) {
      await payment.selectOption(method);
      await expect(payment).toHaveValue(method);
    }
    const longNote = "הערה ארוכה לתקציב: תשלום מקדמה והשלמה אחרי האירוע. ".repeat(30);
    const notes = page.getByRole("textbox", { name: `הערות — ${lineName}`, exact: true });
    await notes.fill(longNote);
    await expect(notes).toHaveAttribute("rows", "5");
    await notes.press("Tab");
    await expect(notes).toHaveAttribute("rows", "2");
    await expect(notes).toHaveAttribute("title", longNote);
    await expect.poll(async () => page.evaluate(async (category) => {
      const store = await import("/src/lib/firebaseStore.js");
      const [wedding] = await store.listWeddings();
      const data = await store.cloudFetchAll(wedding.id, { isOwner: true });
      const item = data.budget.find((row) => row.category === category);
      return { paymentMethod: item?.paymentMethod, notes: item?.notes };
    }, lineName), { timeout: 30_000 }).toEqual({ paymentMethod: "Other", notes: longNote });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('[aria-label="מצב סנכרון: מסונכרן"]')).toBeVisible({ timeout: 30_000 });
    await navigateTo(page, "finance");
    await expect(payment).toHaveValue("Other");
    await expect(notes).toHaveValue(longNote);
  });

  test("creates and edits a synthetic vendor", async ({ page }) => {
    test.setTimeout(120_000);
    await signUp(page, uniqueIdentity("vendor"));
    const memberships = await page.evaluate(async () => {
      const store = await import("/src/lib/firebaseStore.js");
      return store.listWeddings();
    });
    expect(memberships[0]).toMatchObject({ role: "owner", scopes: ["all"] });
    await navigateTo(page, "vendors");
    await page.getByRole("button", { name: "ספק חדש" }).click();
    const vendorName = `E2E vendor ${Date.now()}`;
    const nameField = page.getByRole("textbox", { name: "שם הספק" });
    await nameField.fill(vendorName);
    await expect(nameField).toHaveValue(vendorName);
    await expect(page.getByRole("button", { name: vendorName })).toBeVisible();

    const attachmentName = "vendor-attachment.txt";
    await page.locator('input[type="file"]').last().setInputFiles(
      path.join(process.cwd(), "tests/e2e/fixtures/vendor-attachment.txt")
    );
    await expect(page.getByText(attachmentName, { exact: true })).toBeVisible();
    const attachmentDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: `הורדת ${attachmentName}` }).click();
    const downloadedAttachment = await attachmentDownload;
    expect(downloadedAttachment.suggestedFilename()).toBe(attachmentName);
    expect(await readFile(await downloadedAttachment.path(), "utf8")).toContain("Synthetic QA vendor attachment");

    await page.getByRole("button", { name: `מחיקת ${attachmentName}` }).click();
    const deleteFileDialog = page.getByRole("alertdialog").filter({ hasText: attachmentName });
    await deleteFileDialog.getByRole("button", { name: "ביטול" }).click();
    await expect(page.getByText(attachmentName, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: `מחיקת ${attachmentName}` }).click();
    await page.getByRole("alertdialog").filter({ hasText: attachmentName })
      .getByRole("button", { name: "מחיקה" }).click();
    const deletedFiles = page.locator('[aria-label="קבצים שנמחקו"]');
    await page.getByRole("button", { name: /שחזור קבצים שנמחקו/ }).click();
    await expect(deletedFiles).toContainText(attachmentName);
    await deletedFiles.getByRole("button", { name: "שחזור" }).click();
    await expect(page.getByText(attachmentName, { exact: true })).toBeVisible();

    const taskTitle = `E2E vendor task ${Date.now()}`;
    await page.getByPlaceholder("משימה חדשה...").fill(taskTitle);
    await page.getByRole("button", { name: "הוספת משימה" }).click();
    const status = page.getByRole("combobox", { name: `סטטוס המשימה ${taskTitle}` });
    await expect(status).toHaveValue("todo");
    await status.selectOption("inprogress");
    await expect(status).toHaveValue("inprogress");
    await status.selectOption("done");
    await expect(status).toHaveValue("done");
    await page.getByRole("button", { name: `מחיקת המשימה ${taskTitle}` }).click();
    await expect(status).toHaveCount(0);

    await page.waitForTimeout(1000);
    await expect(page.locator('[aria-label="מצב סנכרון: מסונכרן"]')).toBeVisible({ timeout: 20_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("main").waitFor({ state: "visible", timeout: 30_000 });
    await page.locator('[aria-label="מצב סנכרון: מסונכרן"]').waitFor({ state: "visible", timeout: 30_000 });
    await navigateTo(page, "vendors");
    await expect(page.getByRole("button", { name: vendorName })).toBeVisible();
    await navigateTo(page, "finance");
    await expect(page.getByRole("main")).toContainText(vendorName);
  });

  test("opens the owner sharing and members dialog", async ({ page }) => {
    await signUp(page, uniqueIdentity("sharing"));
    const shareButton = page.getByRole("button", { name: /שיתוף וחברים/ });
    await openNavigationMenu(page);
    await shareButton.click();
    await expect(page.getByRole("dialog", { name: "שיתוף החתונה" })).toBeVisible();
  });

  test("navigates every exposed planning screen without a render error", async ({ page }) => {
    await signUp(page, uniqueIdentity("screens"));
    for (const key of ["overview", "checklist", "guests", "alcohol", "seating", "vendors", "finance"]) {
      await navigateTo(page, key);
      await expect(page.locator("main h2:visible").first()).toBeVisible();
      await expectAppHealthy(page);
    }
  });

  test("keeps the authenticated planning shell within a mobile viewport", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1365) >= 500, "Mobile layout assertion runs in the Pixel 7 project.");
    await signUp(page, uniqueIdentity("mobile"));
    for (const key of ["overview", "checklist", "guests", "alcohol", "seating", "vendors", "finance"]) {
      await navigateTo(page, key);
      await expect(page.locator("main h2:visible").first()).toBeVisible();
      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }));
      expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
      await expect(page.getByRole("main")).toBeVisible();
    }
  });

  test("signs in to an emulator account, then registers a second account and saves onboarding settings", async ({ page }) => {
    test.setTimeout(120_000);
    const firstIdentity = uniqueIdentity("account-roundtrip");
    const secondIdentity = uniqueIdentity("onboarding");

    await test.step("Register the first synthetic account in the isolated emulator", async () => {
      await signUp(page, firstIdentity);
      await expectAppHealthy(page);
    });

    await test.step("Sign out and sign back in with the existing emulator account", async () => {
      const desktopLogout = page.getByRole("button", { name: "יציאה", exact: true });
      if (await desktopLogout.isVisible()) {
        await desktopLogout.click();
      } else {
        await page.getByRole("button", { name: "פעולות נוספות" }).click();
        await page.getByRole("menuitem", { name: "יציאה מהחשבון" }).click();
      }
      await expect(page.getByLabel("מייל", { exact: true })).toBeVisible();
      await signIn(page, firstIdentity);
      await expect(page.locator('[aria-label="מצב סנכרון: מסונכרן"]')).toBeVisible({ timeout: 30_000 });
    });

    await test.step("Register a second synthetic account with its wedding date", async () => {
      const desktopLogout = page.getByRole("button", { name: "יציאה", exact: true });
      if (await desktopLogout.isVisible()) {
        await desktopLogout.click();
      } else {
        await page.getByRole("button", { name: "פעולות נוספות" }).click();
        await page.getByRole("menuitem", { name: "יציאה מהחשבון" }).click();
      }
      await expect(page.getByLabel("מייל", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByLabel(/^סיסמה|^password/i)).toBeVisible();
      await expect(page.locator('[data-tour="auth-submit"]')).toHaveText("התחברות");
      await signUp(page, secondIdentity, { weddingDate: "2027-05-26" });
      await expect(page.locator('[aria-label="מצב סנכרון: מסונכרן"]')).toBeVisible({ timeout: 30_000 });
    });

    await test.step("Save partner names, wedding date, and budget goal", async () => {
      await openNavigationMenu(page);
      await page.getByRole("button", { name: "הגדרות החתונה" }).click();
      const settings = page.getByRole("dialog", { name: "הגדרות החתונה" });
      // The dialog moves focus to its first field one frame after opening; typing before that lands in the wrong field.
      await expect(settings.getByRole("textbox", { name: "שם בן/בת זוג א׳" })).toBeFocused();
      await settings.getByRole("textbox", { name: "שם בן/בת זוג א׳" }).fill("QA Partner A");
      await settings.getByRole("textbox", { name: "שם בן/בת זוג ב׳" }).fill("QA Partner B");
      await settings.locator("#wedding-date").fill("2028-06-15");
      await settings.locator("#budget-goal").fill("320000");
      await settings.getByRole("button", { name: "שמירה" }).click();
      await expect(settings).toBeHidden();
    });

    await test.step("Reload and verify settings persisted in the emulator-backed wedding", async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("main").waitFor({ state: "visible", timeout: 30_000 });
      await page.locator('[aria-label="מצב סנכרון: מסונכרן"]').waitFor({ state: "visible", timeout: 30_000 });
      await openNavigationMenu(page);
      await page.getByRole("button", { name: "הגדרות החתונה" }).click();
      const settings = page.getByRole("dialog", { name: "הגדרות החתונה" });
      await expect(settings.getByRole("textbox", { name: "שם בן/בת זוג א׳" })).toHaveValue("QA Partner A");
      await expect(settings.getByRole("textbox", { name: "שם בן/בת זוג ב׳" })).toHaveValue("QA Partner B");
      await expect(settings.locator("#wedding-date")).toHaveValue("2028-06-15");
      await expect(settings.locator("#budget-goal")).toHaveValue("320000");
      await settings.getByRole("button", { name: "ביטול" }).click();
    });
  });

  test("imports full guest records, toggles and persists every optional column, exports, undoes deletion, and verifies empty state", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1365) < 500, "Guest-table controls are available in the desktop table project.");
    test.setTimeout(180_000);
    await signUp(page, uniqueIdentity("guest-full-record"));
    await navigateTo(page, "guests");
    const guestTable = page.locator("table");

    const csvGuest = `E2E CSV Guest ${Date.now()}`;
    const xlsxGuest = `E2E XLSX Guest ${Date.now()}`;
    const csv = [
      "שם,נייד,קטגוריה,אזכור,כיסאות,מקור,גלאט,שותים,כנראה יבוא,לשקול,אישור הגעה,כמה אישרו,מתנה",
      `${csvGuest},0501234567,Family E2E,"Aunt, cousin",3,CSV source,כן,2,כן,כן,אישרו הגעה,2,2500`,
    ].join("\n");

    await test.step("Import a CSV guest with contact, seating, dietary, RSVP, source, and gift data", async () => {
      await page.locator('[data-tour="guests-management"] input[type="file"]').setInputFiles({
        name: "e2e-full-guests.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(`\uFEFF${csv}`, "utf8"),
      });
      await guestTable.scrollIntoViewIfNeeded();
      await expect(guestTable.locator('tbody input[placeholder="שם"]')).toHaveValue(csvGuest);
      await expect(guestTable.locator('tbody input[placeholder="נייד"]')).toHaveValue("0501234567");
      await expect(guestTable.getByRole("checkbox", { name: `${csvGuest} — שותים אלכוהול` })).toBeChecked();
    });

    await test.step("Import an XLSX guest and verify the row renders", async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Guests");
      worksheet.addRow(["שם", "נייד", "קטגוריה", "אזכור", "כיסאות", "מקור", "גלאט", "שותים", "כנראה יבוא", "לשקול", "אישור הגעה", "כמה אישרו", "מתנה"]);
      worksheet.addRow([xlsxGuest, "0527654321", "Friends E2E", "College", 2, "XLSX source", "", 1, "", "", "ממתין", "", 700]);
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      await page.locator('[data-tour="guests-management"] input[type="file"]').setInputFiles({
        name: "e2e-full-guests.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer,
      });
      const guestNameInputs = guestTable.locator('tbody input[placeholder="שם"]');
      await expect(guestNameInputs).toHaveCount(2, { timeout: 30_000 });
      await expect(guestNameInputs.nth(0)).toHaveValue(csvGuest, { timeout: 30_000 });
      await expect(guestNameInputs.nth(1)).toHaveValue(xlsxGuest, { timeout: 30_000 });
    });

    await test.step("Toggle every optional column and verify corresponding headers appear", async () => {
      const columnsButton = page.getByRole("button", { name: /עמודות/ });
      await columnsButton.click();
      const chooser = page.getByRole("group", { name: "בחירת עמודות בטבלת המוזמנים" });
      const defaults = [
        ["קטגוריה", true], ["אזכור / הערות", false], ["כיסאות", true], ["מקור", false],
        ["גלאט", true], ["שותים", true], ["כנראה יבוא", false], ["לשקול", false],
        ["אישור הגעה", true], ["מתנה", true],
      ];
      for (const [label, checked] of defaults) {
        await expect(chooser.getByRole("checkbox", { name: label })).toHaveJSProperty("checked", checked);
        if (!checked) await chooser.getByRole("checkbox", { name: label }).check();
      }
      await expect(guestTable.getByRole("columnheader", { name: "אזכור / הערות", exact: true })).toBeVisible();
      await expect(guestTable.getByRole("columnheader", { name: "מקור", exact: true })).toBeVisible();
      await expect(guestTable.getByRole("columnheader", { name: "כנראה יבוא", exact: true })).toBeVisible();
      await expect(guestTable.getByRole("columnheader", { name: "לשקול", exact: true })).toBeVisible();
      const mentionInputs = guestTable.locator('tbody input[placeholder="אזכור"]');
      await expect(mentionInputs).toHaveCount(2);
      await expect(mentionInputs.nth(0)).toHaveValue("Aunt, cousin");
      await expect(mentionInputs.nth(1)).toHaveValue("College");
      await expect(guestTable.getByText("CSV source", { exact: true })).toBeVisible();
      await expect(guestTable.getByText("XLSX source", { exact: true })).toBeVisible();
      await expect(guestTable.getByRole("button", { name: "מסומן ככנראה יבוא" })).toBeVisible();
      await expect(guestTable.getByRole("button", { name: "מסומן לשקילה" })).toBeVisible();
      await chooser.getByRole("checkbox", { name: "קטגוריה" }).uncheck();
      await expect(guestTable.getByRole("columnheader", { name: "קטגוריה", exact: true })).toBeHidden();
      await chooser.getByRole("checkbox", { name: "קטגוריה" }).check();
      await chooser.getByRole("button", { name: "ברירת מחדל" }).click();
      await expect(chooser.getByRole("checkbox", { name: "שותים" })).toBeChecked();
      await page.keyboard.press("Escape");
      await expect(columnsButton).toHaveAttribute("aria-expanded", "false");
    });

    await test.step("Save a custom layout, reload, and verify it remains selected", async () => {
      const columnsButton = page.getByRole("button", { name: /עמודות/ });
      await columnsButton.click();
      const chooser = page.getByRole("group", { name: "בחירת עמודות בטבלת המוזמנים" });
      await chooser.getByRole("checkbox", { name: "מקור" }).check();
      await chooser.getByRole("checkbox", { name: "אזכור / הערות" }).check();
      await chooser.getByRole("checkbox", { name: "קטגוריה" }).uncheck();
      await expect.poll(() => page.evaluate(() => {
        const key = Object.keys(localStorage).find((item) => item.endsWith(":guestTableColumns"));
        return key ? JSON.parse(localStorage.getItem(key)) : null;
      }), { timeout: 5_000 }).toMatchObject({ category: false, mention: true, source: true });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("main").waitFor({ state: "visible", timeout: 30_000 });
      await page.locator('[aria-label="מצב סנכרון: מסונכרן"]').waitFor({ state: "visible", timeout: 30_000 });
      await navigateTo(page, "guests");
      await page.getByRole("button", { name: /עמודות/ }).click();
      const persistedChooser = page.getByRole("group", { name: "בחירת עמודות בטבלת המוזמנים" });
      await expect(persistedChooser.getByRole("checkbox", { name: "מקור" })).toBeChecked();
      await expect(persistedChooser.getByRole("checkbox", { name: "אזכור / הערות" })).toBeChecked();
      await expect(persistedChooser.getByRole("checkbox", { name: "קטגוריה" })).not.toBeChecked();
      await persistedChooser.getByRole("button", { name: "ברירת מחדל" }).click();
    });

    await test.step("Export the imported records and verify the downloaded CSV data", async () => {
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "ייצוא", exact: true }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/\.csv$/i);
      const exported = await readFile(await download.path(), "utf8");
      expect(exported).toContain(csvGuest);
      expect(exported).toContain("Aunt, cousin");
      expect(exported).toContain("CSV source");
      expect(exported).toContain(xlsxGuest);
      expect(exported).toContain("XLSX source");
    });

    await test.step("Undo a guest deletion, then delete both imported records and verify the empty state survives reload", async () => {
      await guestTable.getByRole("button", { name: `מחיקת ${csvGuest}` }).click();
      const undo = page.getByRole("button", { name: "בטל מחיקה" });
      await expect(undo).toBeVisible();
      await undo.click();
      const guestNameInputs = guestTable.locator('tbody input[placeholder="שם"]');
      await expect(guestNameInputs).toHaveCount(2);
      await expect(guestNameInputs.nth(0)).toHaveValue(csvGuest);
      await expect(guestNameInputs.nth(1)).toHaveValue(xlsxGuest);

      await guestTable.getByRole("button", { name: `מחיקת ${csvGuest}` }).click();
      await guestTable.getByRole("button", { name: `מחיקת ${xlsxGuest}` }).click();
      await page.waitForTimeout(2500);
      await expect(page.locator('[aria-label="מצב סנכרון: מסונכרן"]')).toBeVisible({ timeout: 20_000 });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("main").waitFor({ state: "visible", timeout: 30_000 });
      await page.locator('[aria-label="מצב סנכרון: מסונכרן"]').waitFor({ state: "visible", timeout: 30_000 });
      await navigateTo(page, "guests");
      await expect(page.getByRole("heading", { name: "רשימת המוזמנים עדיין ריקה" })).toBeVisible();
    });
  });
});
