import { test, expect } from "@playwright/test";
import { assertEmulatorEnvironment, signUp, uniqueIdentity, navigateTo } from "./helpers/emulator.js";
import { blockCloudRequests } from "./helpers/sharing.js";

assertEmulatorEnvironment();
const attemptsByPage = new WeakMap();
test.beforeEach(async ({ page }) => {
  attemptsByPage.set(page, await blockCloudRequests(page));
});
test.afterEach(async ({ page }) => {
  expect(attemptsByPage.get(page)).toEqual([]);
});

test("iPlan RSVP preview modal displays updates and updates only rsvp + attendingCount on approval", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, uniqueIdentity("iplan-rsvp-sync"), { readyTimeout: 60_000 });
  await navigateTo(page, "guests");

  // זריעת שני מוזמנים בחתונה
  await page.evaluate(async () => {
    const store = await import("/src/lib/firebaseStore.js");
    const [wedding] = await store.listWeddings();
    await store.cloudSeed(wedding.id, {
      guests: [
        {
          id: 101,
          name: "ליאור אלעזרי",
          phone: "050-697-0046",
          category: "משפחה",
          seats: 2,
          mention: "הערה חשובה שאסור לדרוס",
          rsvp: "pending",
          attendingCount: null,
          gift: 500,
        },
        {
          id: 102,
          name: "דנה כהן",
          phone: "052-111-2222",
          category: "חברים",
          seats: 3,
          mention: "חברה מהלימודים",
          rsvp: "pending",
          attendingCount: null,
          gift: 0,
        },
      ],
    });
  });

  await expect(page.getByText("2 רשומות ברשימה")).toBeVisible({ timeout: 30_000 });

  // פתיחת פופ-אפ "עדכון אישורי הגעה"
  await page.getByTestId("open-iplan-sync-btn").click();
  const modal = page.getByTestId("iplan-sync-modal");
  await expect(modal).toBeVisible();

  // העלאת קובץ CSV במבנה הייצוא של iPlan (שורת כותרות-על + שורת כותרות עמודות)
  const csvContent = [
    ",,שיוך,,פרטי התקשרות,,,כתובת,,,,,,,,",
    "הזמנה לכבוד,מס' אורחים שהוזמנו,צד,קבוצה,סלולרי,טלפון רגיל,אימייל,עיר,רחוב,מיקוד,תא דואר,,אישרו שיגיעו,מתלבטים,מספר שולחן,הגיעו",
    "ליאור אלעזרי,2,חתן,משפחה,0506970046,,,,,,,,2,,,",
    "דנה כהן,3,כלה,חברים,0521112222,,,,,,,,0,,,",
  ].join("\n");

  await modal.getByTestId("iplan-file-input").setInputFiles({
    name: "iplan-export.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("\uFEFF" + csvContent, "utf8"),
  });

  // וידוא ששתי הרשומות מוצגות בפופ-אפ האישור
  await expect(modal.getByTestId("iplan-update-row-101")).toBeVisible();
  await expect(modal.getByTestId("iplan-update-row-102")).toBeVisible();
  await expect(modal.getByTestId("iplan-approve-btn")).toContainText("כן, עדכן אישורי הגעה (2)");

  // אישור העדכון
  await modal.getByTestId("iplan-approve-btn").click();
  await expect(modal).toHaveCount(0);

  // וידוא ב-Firestore שרק שדה אישור ההגעה (rsvp + attendingCount) עודכן, ושום שדה אחר לא השתנה
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const store = await import("/src/lib/firebaseStore.js");
          const [wedding] = await store.listWeddings();
          const data = await store.cloudFetchAll(wedding.id, { scopes: ["guests"] });
          const g101 = data.guests.find((g) => g.id === 101);
          const g102 = data.guests.find((g) => g.id === 102);
          return { g101, g102 };
        }),
      { timeout: 30_000 }
    )
    .toMatchObject({
      g101: {
        id: 101,
        name: "ליאור אלעזרי",
        phone: "050-697-0046",
        category: "משפחה",
        seats: 2,
        mention: "הערה חשובה שאסור לדרוס",
        rsvp: "confirmed",
        attendingCount: 2,
        gift: 500,
      },
      g102: {
        id: 102,
        name: "דנה כהן",
        phone: "052-111-2222",
        category: "חברים",
        seats: 3,
        mention: "חברה מהלימודים",
        rsvp: "declined",
        attendingCount: 0,
        gift: 0,
      },
    });
});

