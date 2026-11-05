import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { assertEmulatorEnvironment, signUp, uniqueIdentity, navigateTo } from "./helpers/emulator.js";

assertEmulatorEnvironment();

const WIDTHS = [320, 360, 393];
const SCREENS = ["overview", "checklist", "guests", "alcohol", "seating", "vendors", "finance"];
const MIN_TARGET = 40;

const longName = "משפחת בן-דוד אלמוג-רוזנברג והילדים המקסימים שלהם";

async function seedRealisticWedding(page) {
  await page.evaluate(async (longGuestName) => {
    const store = await import("/src/lib/firebaseStore.js");
    const [wedding] = await store.listWeddings();
    const guests = Array.from({ length: 24 }, (_, i) => ({
      id: 1000 + i,
      name: i === 0 ? longGuestName : `אורח בדיקה ${i + 1}`,
      phone: i === 2 || i === 3 ? "050-111-2222" : `05${i % 9}-${String(1000000 + i * 7919).slice(0, 7)}`,
      category: i % 3 === 0 ? "משפחה" : i % 3 === 1 ? "חברים" : "עבודה",
      seats: (i % 4) + 1,
      mention: i === 1 ? "הערה ארוכה מאוד שנכתבה כדי לבדוק גלישת טקסט בכרטיס המוזמן במסך צר של טלפון נייד" : "",
      rsvp: ["confirmed", "pending", "maybe", "declined"][i % 4],
      attendingCount: i % 4 === 0 ? (i % 4) + 1 : null,
      glatt: i % 5 === 0,
      drinkers: i % 2,
      gift: i % 3 === 0 ? 1200 : 0,
    }));
    await store.cloudSeed(wedding.id, {
      guests,
      tables: [
        { id: 1, name: "שולחן משפחה קרובה עם שם ארוך במיוחד", type: "knight", guestIds: [1000, 1004, 1001] },
        { id: 2, name: "חברים", type: "standard", guestIds: [1008] },
      ],
      vendors: [
        { name: "אולמי הגן הקסום והמרהיב ביותר באזור", type: "אולם / גן אירועים", phone: "03-5551234", email: "venue@example.test", contractCost: 95000, deposit: 20000, notes: "סיכום פגישה", tasks: [{ id: 1, title: "לחתום על חוזה", status: "todo" }] },
        { name: "DJ", type: "תקליטן", phone: "", email: "", contractCost: 9000, deposit: 2000, notes: "", tasks: [] },
      ],
      budget: [
        { id: 1, category: "צלם וידאו ומגנטים לאורחים עם שם סעיף ארוך", expected: 14000, actual: 15000, paid: 3000, paymentMethod: "Bit", notes: "הערה" },
        { id: 2, category: "שמלה", expected: 8000, actual: 0, paid: 0, paymentMethod: "", notes: "" },
      ],
      checklist: [
        { id: 1, title: "להזמין צלם", category: "ספקים", assignee: "both", notes: "", done: false, position: 0 },
        { id: 2, title: "לבחור שמלה ולתאם מדידות עם המעצבת בתל אביב", category: "לבוש", assignee: "bride", notes: "הערה", done: false, position: 1 },
      ],
    });
  }, longName);
  await page.reload();
  await expect(page.locator('[aria-label="מצב סנכרון: מסונכרן"]')).toBeVisible({ timeout: 30_000 });
}

/** Measures layout problems on whatever is currently on screen. */
async function auditViewport(page, label) {
  return page.evaluate((args) => {
    const { label: where, minTarget } = args;
    const vw = window.innerWidth;
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none" && !el.closest("[inert],[aria-hidden='true']");
    };
    const name = (el) => (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.tagName).trim().replace(/\s+/g, " ").slice(0, 50);

    const overflow = document.documentElement.scrollWidth > vw + 1;
    const offscreen = [...document.querySelectorAll("main *, [role='dialog'] *, [role='alertdialog'] *")]
      .filter((el) => visible(el) && el.children.length === 0)
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (el.closest(".overflow-auto,.overflow-x-auto,.overflow-x-scroll,.overflow-hidden,.truncate,.line-clamp-2")) return false;
        return r.right > vw + 1 || r.left < -1;
      })
      .map(name)
      .slice(0, 10);

    const smallTargets = [...document.querySelectorAll("button, a[href], [role='button'], input[type='checkbox'], select")]
      .filter(visible)
      .map((el) => {
        const hit = el.matches("input[type='checkbox']") && el.closest("label") ? el.closest("label") : el;
        const r = hit.getBoundingClientRect();
        return { name: name(el), w: Math.round(r.width), h: Math.round(r.height) };
      })
      .filter((t) => t.w < minTarget || t.h < minTarget);

    return { where, vw, overflow, offscreen, smallTargets };
  }, { label, minTarget: MIN_TARGET });
}

test.describe("mobile UI/UX audit", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile", "Mobile audit runs in the touch-device project.");
  });

  test("every screen and key dialog fits narrow phones without horizontal overflow", async ({ page }) => {
    test.setTimeout(300_000);
    await signUp(page, uniqueIdentity("mobile-audit"), { readyTimeout: 60_000 });
    await seedRealisticWedding(page);
    const findings = [];

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 740 });
      for (const screen of SCREENS) {
        await navigateTo(page, screen);
        await page.waitForTimeout(400);
        findings.push(await auditViewport(page, `${screen}@${width}`));
      }

      await navigateTo(page, "guests");
      await page.getByRole("button", { name: `פתיחת פרטי ${longName}` }).click();
      findings.push(await auditViewport(page, `guests-card-open@${width}`));
      await page.getByRole("button", { name: `סגירת פרטי ${longName}` }).click();

      await page.getByRole("checkbox", { name: "בחירת אורח בדיקה 2", exact: true }).check();
      findings.push(await auditViewport(page, `guests-bulk-bar@${width}`));
      await page.getByRole("checkbox", { name: "בחירת אורח בדיקה 2", exact: true }).uncheck();

      await page.getByRole("button", { name: "ניהול קטגוריות", exact: true }).click();
      findings.push(await auditViewport(page, `category-manager@${width}`));
      await page.getByRole("dialog", { name: "ניהול קטגוריות מוזמנים" }).getByRole("button", { name: "סגירה" }).click();

      await navigateTo(page, "seating");
      await page.getByRole("button", { name: "שבץ מוזמן" }).first().click();
      const picker = page.getByRole("dialog", { name: /שיבוץ ל/ });
      await expect(picker).toBeVisible();
      const pickerBox = await picker.locator("> div").last().boundingBox();
      findings.push({ ...(await auditViewport(page, `seating-picker@${width}`)), dialogFits: pickerBox ? pickerBox.x >= 0 && pickerBox.x + pickerBox.width <= width + 1 : false });
      await picker.getByRole("button", { name: "סגירת חלון השיבוץ" }).click();

      await page.getByRole("button", { name: "פתיחת הסיור המודרך" }).click();
      const tour = page.getByRole("dialog").filter({ has: page.locator("#guided-tour-title") });
      await expect(tour).toBeVisible();
      // The card is parked off-screen until its first placement ~340ms later.
      await expect.poll(async () => (await tour.boundingBox())?.y ?? -1, { timeout: 5_000 }).toBeGreaterThanOrEqual(0);
      const tourBox = await tour.boundingBox();
      findings.push({ ...(await auditViewport(page, `tour@${width}`)), dialogFits: tourBox ? tourBox.x >= 0 && tourBox.x + tourBox.width <= width + 1 && tourBox.y + tourBox.height <= 741 : false });
      await tour.getByRole("button", { name: "סגירת ההדרכה" }).click();
    }

    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/mobile-audit.json", JSON.stringify(findings, null, 2), "utf8");

    const overflowing = findings.filter((f) => f.overflow || f.offscreen.length).map((f) => `${f.where}: ${f.offscreen.join(", ") || "page scrolls horizontally"}`);
    const unfit = findings.filter((f) => f.dialogFits === false).map((f) => f.where);
    const tiny = [...new Set(findings.flatMap((f) => f.smallTargets.map((t) => `${f.where.split("@")[0]}: ${t.name} [${t.w}x${t.h}]`)))];
    expect(overflowing, "no screen or dialog overflows horizontally").toEqual([]);
    expect(unfit, "dialogs fit inside the viewport").toEqual([]);
    expect(tiny, `every tap target is at least ${MIN_TARGET}px`).toEqual([]);
    // The bell is desktop-only, so it must never appear on a touch phone.
    await expect(page.getByTestId("activity-bell-btn")).toHaveCount(0);
  });

  test("landscape phones: every screen fits, dialogs fit the short height, navigation stays reachable", async ({ page }) => {
    test.setTimeout(240_000);
    await signUp(page, uniqueIdentity("mobile-landscape"), { readyTimeout: 60_000 });
    await seedRealisticWedding(page);
    const findings = [];

    for (const { width, height } of [{ width: 852, height: 393 }, { width: 667, height: 375 }]) {
      await page.setViewportSize({ width, height });
      for (const screen of SCREENS) {
        await navigateTo(page, screen);
        await page.waitForTimeout(400);
        findings.push(await auditViewport(page, `${screen}@${width}x${height}`));
      }

      await navigateTo(page, "seating");
      await page.getByRole("button", { name: "שבץ מוזמן" }).first().click();
      const picker = page.getByRole("dialog", { name: /שיבוץ ל/ });
      await expect(picker).toBeVisible();
      const pickerBox = await picker.locator("> div").last().boundingBox();
      findings.push({
        ...(await auditViewport(page, `seating-picker@${width}x${height}`)),
        pickerBox,
        dialogFits: pickerBox ? pickerBox.y >= -1 && pickerBox.y + pickerBox.height <= height + 1 && pickerBox.x + pickerBox.width <= width + 1 : false,
      });
      await picker.getByRole("button", { name: "סגירת חלון השיבוץ" }).click();

      await page.getByRole("button", { name: "פתיחת הסיור המודרך" }).click();
      const tour = page.getByRole("dialog").filter({ has: page.locator("#guided-tour-title") });
      await expect(tour).toBeVisible();
      await expect.poll(async () => (await tour.boundingBox())?.y ?? -1, { timeout: 5_000 }).toBeGreaterThanOrEqual(0);
      const tourBox = await tour.boundingBox();
      findings.push({
        ...(await auditViewport(page, `tour@${width}x${height}`)),
        tourBox,
        dialogFits: tourBox ? tourBox.y >= -1 && tourBox.y + tourBox.height <= height + 1 : false,
      });
      // The close button must be reachable even when the card is taller than the screen.
      await tour.getByRole("button", { name: "סגירת ההדרכה" }).click();
      await expect(tour).toHaveCount(0);
    }

    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/mobile-landscape-audit.json", JSON.stringify(findings, null, 2), "utf8");

    const overflowing = findings.filter((f) => f.overflow || f.offscreen.length).map((f) => `${f.where}: ${f.offscreen.join(", ") || "page scrolls horizontally"}`);
    const unfit = findings.filter((f) => f.dialogFits === false).map((f) => f.where);
    const tiny = [...new Set(findings.flatMap((f) => f.smallTargets.map((t) => `${f.where.split("@")[0]}: ${t.name} [${t.w}x${t.h}]`)))];
    expect(overflowing, "no screen or dialog overflows horizontally in landscape").toEqual([]);
    expect(unfit, "dialogs fit inside the short landscape viewport").toEqual([]);
    expect(tiny, `every tap target is at least ${MIN_TARGET}px in landscape`).toEqual([]);
    await expect(page.getByTestId("activity-bell-btn")).toHaveCount(0);
  });
});
