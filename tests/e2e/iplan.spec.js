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

async function openIplanModalFromBell(page) {
  await page.getByTestId("activity-bell-btn").click();
  await page.getByTestId("activity-open-iplan-btn").click();
  return page.getByTestId("iplan-sync-modal");
}

test("iPlan controls stay hidden when no iPlan source is available", async ({ page }) => {
  await signUp(page, uniqueIdentity("iplan-no-source"), { readyTimeout: 60_000 });
  await navigateTo(page, "guests");
  await expect(page.getByTestId("activity-bell-btn")).toHaveCount(0);
  await expect(page.getByTestId("activity-open-iplan-btn")).toHaveCount(0);
});

test("iPlan RSVP preview modal matches by phone and exact name, and updates ONLY rsvp + attendingCount on approval", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, uniqueIdentity("iplan-rsvp-sync"), { readyTimeout: 60_000 });
  await navigateTo(page, "guests");

  // זריעת שלושה מוזמנים: שניים עם טלפון ואחד ללא טלפון (כמו 293 הרשומות בחתונה האמיתית)
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
        {
          id: 103,
          name: "נריה ושילת בחור",
          phone: "",
          category: "חברים חתן",
          seats: 2,
          mention: "ללא מספר טלפון אצלנו",
          rsvp: "pending",
          attendingCount: null,
          gift: 350,
        },
        {
          id: 104,
          name: "אופיר ושרון",
          phone: "050-444-5566",
          category: "חברים כלה",
          seats: 2,
          mention: "מתלבטים לגבי הגעה",
          rsvp: "pending",
          attendingCount: null,
          gift: 0,
        },
      ],
    });
  });

  await expect(page.getByText("4 רשומות ברשימה")).toBeVisible({ timeout: 30_000 });

  // Extension presence exposes the single iPlan entrypoint in the activity bell.
  await page.evaluate(() => window.postMessage({ type: "WEDDING_PLANNER_IPLAN_EXTENSION_AVAILABLE" }, "*"));
  const modal = await openIplanModalFromBell(page);
  await expect(modal).toBeVisible();

  // העלאת קובץ CSV במבנה הייצוא של iPlan (כולל רשומה בעמודת "מתלבטים")
  const csvContent = [
    ",,שיוך,,פרטי התקשרות,,,כתובת,,,,,,,,",
    "הזמנה לכבוד,מס' אורחים שהוזמנו,צד,קבוצה,סלולרי,טלפון רגיל,אימייל,עיר,רחוב,מיקוד,תא דואר,,אישרו שיגיעו,מתלבטים,מספר שולחן,הגיעו",
    "ליאור אלעזרי,2,חתן,משפחה,0506970046,,,,,,,,2,,,",
    "דנה כהן,3,כלה,חברים,0521112222,,,,,,,,0,,,",
    "נריה ושילת בחור,2,חתן,חברים,0549998877,,,,,,,,2,,,",
    "אופיר ושרון,2,כלה,חברים,0504445566,,,,,,,,0,2,,",
  ].join("\n");

  await modal.getByTestId("iplan-file-input").setInputFiles({
    name: "iplan-export.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("\uFEFF" + csvContent, "utf8"),
  });

  // וידוא שארבע הרשומות מוצגות בפופ-אפ האישור (כולל נריה ושילת בחור לפי שם, ואופיר ושרון כ"מתלבטים")
  await expect(modal.getByTestId("iplan-update-row-101")).toBeVisible();
  await expect(modal.getByTestId("iplan-update-row-102")).toBeVisible();
  await expect(modal.getByTestId("iplan-update-row-103")).toBeVisible();
  await expect(modal.getByTestId("iplan-update-row-104")).toBeVisible();
  await expect(modal.getByTestId("iplan-update-row-104")).toContainText("מתלבטים");
  await expect(modal.getByTestId("iplan-approve-btn")).toContainText("כן, עדכן אישורי הגעה (4)");

  const beforeApproval = await page.evaluate(async () => {
    const store = await import("/src/lib/firebaseStore.js");
    const [wedding] = await store.listWeddings();
    const data = await store.cloudFetchAll(wedding.id, { scopes: ["guests"] });
    return data.guests.map(({ id, rsvp, attendingCount }) => ({ id, rsvp, attendingCount }));
  });
  expect(beforeApproval.every((guest) => guest.rsvp === "pending" && guest.attendingCount == null)).toBe(true);

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
          const g103 = data.guests.find((g) => g.id === 103);
          const g104 = data.guests.find((g) => g.id === 104);
          return { g101, g102, g103, g104 };
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
      g103: {
        id: 103,
        name: "נריה ושילת בחור",
        phone: "",
        category: "חברים חתן",
        seats: 2,
        mention: "ללא מספר טלפון אצלנו",
        rsvp: "confirmed",
        attendingCount: 2,
        gift: 350,
      },
      g104: {
        id: 104,

        name: "אופיר ושרון",
        phone: "050-444-5566",
        category: "חברים כלה",
        seats: 2,
        mention: "מתלבטים לגבי הגעה",
        rsvp: "maybe",
        attendingCount: 0,
        gift: 0,
      },
    });
});

test("iPlan approval failure leaves guests unchanged, shows no success, and can be retried", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, uniqueIdentity("iplan-commit-failure"), { readyTimeout: 60_000 });
  await navigateTo(page, "guests");
  await page.evaluate(async () => {
    const store = await import("/src/lib/firebaseStore.js");
    const [wedding] = await store.listWeddings();
    await store.cloudSeed(wedding.id, {
      guests: [{
        id: 901,
        name: "Commit failure guest",
        phone: "050-888-9000",
        category: "QA",
        seats: 2,
        mention: "Preserve this note",
        rsvp: "pending",
        attendingCount: null,
        gift: 0,
      }],
    });
  });
  await expect(page.getByText("1 רשומות ברשימה")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => window.postMessage({
    type: "WEDDING_PLANNER_IPLAN_ROWS",
    syncedAt: new Date().toISOString(),
    rows: [{ name: "Commit failure guest", phone: "0508889000", invited: 2, rsvp: "confirmed", attendingCount: 2, hasResponse: true }],
  }, "*"));

  const modal = await openIplanModalFromBell(page);
  await expect(modal.getByTestId("iplan-update-row-901")).toBeVisible();
  let commitWasIntercepted = false;
  await page.route(/commitIplanRsvpUpdates/, async (route) => {
    commitWasIntercepted = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ error: { status: "ABORTED", message: "Simulated stale RSVP" } }),
    });
  });
  await modal.getByTestId("iplan-approve-btn").click();
  expect(commitWasIntercepted).toBe(true);
  await expect(modal.getByRole("alert")).toContainText("שמירת העדכונים נכשלה");
  await expect(modal).toBeVisible();
  await expect(page.getByText("עודכנו אישורי הגעה עבור 1 רשומות", { exact: true })).toHaveCount(0);

  const afterFailedCommit = await page.evaluate(async () => {
    const store = await import("/src/lib/firebaseStore.js");
    const [wedding] = await store.listWeddings();
    const data = await store.cloudFetchAll(wedding.id, { scopes: ["guests"] });
    return data.guests.find((guest) => guest.id === 901);
  });
  expect(afterFailedCommit).toMatchObject({
    id: 901,
    name: "Commit failure guest",
    rsvp: "pending",
    attendingCount: null,
    mention: "Preserve this note",
  });

  await page.unroute(/commitIplanRsvpUpdates/);
  await modal.getByTestId("iplan-approve-btn").click();
  await expect(modal).toHaveCount(0);
  await expect.poll(async () => page.evaluate(async () => {
    const store = await import("/src/lib/firebaseStore.js");
    const [wedding] = await store.listWeddings();
    const data = await store.cloudFetchAll(wedding.id, { scopes: ["guests"] });
    const guest = data.guests.find((row) => row.id === 901);
    return { rsvp: guest?.rsvp, attendingCount: guest?.attendingCount, mention: guest?.mention };
  }), { timeout: 30_000 }).toEqual({ rsvp: "confirmed", attendingCount: 2, mention: "Preserve this note" });
});

test("server rejects a stale iPlan approval atomically without adding activity", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, uniqueIdentity("iplan-stale-server"), { readyTimeout: 60_000 });
  await navigateTo(page, "guests");
  const weddingId = await page.evaluate(async () => {
    const store = await import("/src/lib/firebaseStore.js");
    const [wedding] = await store.listWeddings();
    await store.cloudSeed(wedding.id, {
      guests: [{
        id: 902,
        name: "Stale RSVP guest",
        phone: "050-777-9000",
        category: "QA",
        seats: 2,
        mention: "Keep this untouched",
        rsvp: "pending",
        attendingCount: null,
        gift: 0,
      }],
    });
    return wedding.id;
  });
  await expect(page.getByText("1 רשומות ברשימה")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => window.postMessage({
    type: "WEDDING_PLANNER_IPLAN_ROWS",
    syncedAt: new Date().toISOString(),
    rows: [{ name: "Stale RSVP guest", phone: "0507779000", invited: 2, rsvp: "confirmed", attendingCount: 2, hasResponse: true }],
  }, "*"));
  const modal = await openIplanModalFromBell(page);
  await expect(modal.getByTestId("iplan-update-row-902")).toBeVisible();

  let concurrentUpdateApplied = false;
  await page.route(/commitIplanRsvpUpdates/, async (route) => {
    await page.evaluate(async (weddingId) => {
      const store = await import("/src/lib/firebaseStore.js");
      const data = await store.cloudFetchAll(weddingId, { scopes: ["guests"] });
      const rows = data.guests.map((guest) => guest.id === 902
        ? { ...guest, rsvp: "declined", attendingCount: 0 }
        : guest);
      await store.cloudSyncDataset(
        weddingId,
        "guests",
        rows,
        new Set(data.guests.map((guest) => guest.id)),
        new Map(data.guests.map((guest) => [guest.id, guest]))
      );
    }, weddingId);
    concurrentUpdateApplied = true;
    await route.continue();
  });

  await modal.getByTestId("iplan-approve-btn").click();
  await expect.poll(() => concurrentUpdateApplied).toBe(true);
  await expect(modal.getByRole("alert")).toContainText("שמירת העדכונים נכשלה");
  await expect(modal).toBeVisible();
  await expect(page.getByText("עודכנו אישורי הגעה עבור 1 רשומות", { exact: true })).toHaveCount(0);

  const result = await page.evaluate(async (weddingId) => {
    const store = await import("/src/lib/firebaseStore.js");
    const data = await store.cloudFetchAll(weddingId, { scopes: ["guests"] });
    const guest = data.guests.find((row) => row.id === 902);
    const activity = await new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error("Timed out reading the iPlan activity stream."));
      }, 10_000);
      unsubscribe = store.subscribeActivity(weddingId, (items) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(items);
      }, reject);
    });
    return { guest, activityCount: activity.length };
  }, weddingId);
  expect(result.guest).toMatchObject({
    id: 902,
    name: "Stale RSVP guest",
    rsvp: "declined",
    attendingCount: 0,
    mention: "Keep this untouched",
  });
  expect(result.activityCount).toBe(0);
});

test("iPlan commit rejects a malformed batch without partially updating guests or activity", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, uniqueIdentity("iplan-invalid-batch"), { readyTimeout: 60_000 });
  await navigateTo(page, "guests");
  const result = await page.evaluate(async () => {
    const store = await import("/src/lib/firebaseStore.js");
    const [wedding] = await store.listWeddings();
    await store.cloudSeed(wedding.id, {
      guests: [{ id: 905, name: "Atomic validation guest", seats: 2, rsvp: "pending", attendingCount: null, mention: "Preserve", gift: 0 }],
    });
    let errorCode = "";
    try {
      await store.commitIplanRsvpUpdates(wedding.id, [
        {
          guestId: 905,
          guestName: "Atomic validation guest",
          fromRsvp: "pending",
          fromAttendingCount: 0,
          toRsvp: "confirmed",
          toAttendingCount: 2,
        },
        {
          guestId: 906,
          fromRsvp: "pending",
          toRsvp: "not-a-status",
        },
      ], { source: "invalid-batch-test" });
    } catch (error) {
      errorCode = error.code || "";
    }
    const data = await store.cloudFetchAll(wedding.id, { scopes: ["guests"] });
    const guest = data.guests.find((row) => row.id === 905);
    const activity = await new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error("Timed out reading iPlan activity after invalid batch."));
      }, 10_000);
      unsubscribe = store.subscribeActivity(wedding.id, (items) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(items);
      }, reject);
    });
    return { errorCode, guest, activityCount: activity.length };
  });

  expect(result.errorCode).toContain("invalid-argument");
  expect(result.guest).toMatchObject({ rsvp: "pending", attendingCount: null, mention: "Preserve" });
  expect(result.activityCount).toBe(0);
});

test("legacy iPlan client activity-only commit does not update guest RSVPs", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, uniqueIdentity("iplan-legacy-client"), { readyTimeout: 60_000 });
  await navigateTo(page, "guests");
  const result = await page.evaluate(async () => {
    const store = await import("/src/lib/firebaseStore.js");
    const [wedding] = await store.listWeddings();
    await store.cloudSeed(wedding.id, {
      guests: [{ id: 903, name: "Legacy client guest", phone: "050-777-9003", seats: 2, rsvp: "pending", attendingCount: null, mention: "Preserve", gift: 0 }],
    });
    const response = await store.commitIplanRsvpUpdates(wedding.id, [{
      guestId: 903,
      guestName: "Legacy client guest",
      fromRsvp: "pending",
      fromAttendingCount: 0,
      toRsvp: "confirmed",
      toAttendingCount: 2,
    }], { source: "legacy-compat-test", applyToGuests: false });
    const data = await store.cloudFetchAll(wedding.id, { scopes: ["guests"] });
    const guest = data.guests.find((row) => row.id === 903);
    const activity = await new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error("Timed out reading the legacy iPlan activity record."));
      }, 10_000);
      unsubscribe = store.subscribeActivity(wedding.id, (items) => {
        if (!items.some((item) => item.batchId === response.batchId)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(items.find((item) => item.batchId === response.batchId));
      }, reject);
    });
    return { response, guest, activity };
  });

  expect(result.response).toMatchObject({ updatedCount: 1, appliedToGuests: false });
  expect(result.guest).toMatchObject({ rsvp: "pending", attendingCount: null, mention: "Preserve" });
  expect(result.activity).toMatchObject({ source: "legacy-compat-test", updatedCount: 1 });
});

test("a newer iPlan snapshot cannot silently replace an open review; only explicit refresh rebases it", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, uniqueIdentity("iplan-pinned-review"), { readyTimeout: 60_000 });
  await navigateTo(page, "guests");
  const weddingId = await page.evaluate(async () => {
    const store = await import("/src/lib/firebaseStore.js");
    const [wedding] = await store.listWeddings();
    await store.cloudSeed(wedding.id, {
      guests: [{ id: 904, name: "Pinned review guest", phone: "050-777-9004", seats: 2, rsvp: "pending", attendingCount: null, mention: "Unchanged", gift: 0 }],
    });
    return wedding.id;
  });
  await expect(page.getByText("1 רשומות ברשימה")).toBeVisible({ timeout: 30_000 });

  const proposedRows = [{ name: "Pinned review guest", phone: "0507779004", invited: 2, rsvp: "confirmed", attendingCount: 2, hasResponse: true }];
  const refreshedRows = [{ name: "Pinned review guest", phone: "0507779004", invited: 2, rsvp: "pending", attendingCount: 0, hasResponse: false }];
  const postSnapshot = (rows, syncedAt) => page.evaluate(({ rows, syncedAt }) => window.postMessage({
    type: "WEDDING_PLANNER_IPLAN_ROWS",
    rows,
    syncedAt,
  }, "*"), { rows, syncedAt });

  await postSnapshot(proposedRows, "2026-10-21T12:00:00.000Z");
  const bellButton = page.getByTestId("activity-bell-btn");
  await expect(bellButton).toBeVisible({ timeout: 10_000 });
  await bellButton.click();
  const bellPopover = page.getByTestId("activity-bell-popover");
  const reviewButton = bellPopover.getByTestId("activity-open-iplan-btn");
  await expect(reviewButton).toContainText("בדיקה ואישור (1)");
  await reviewButton.click();
  const modal = page.getByTestId("iplan-sync-modal");
  await expect(modal.getByTestId("iplan-update-row-904")).toBeVisible();
  await expect(modal.getByTestId("iplan-approve-btn")).toContainText("(1)");

  await postSnapshot(refreshedRows, "2026-10-21T12:01:00.000Z");
  await expect(modal.getByRole("status")).toContainText("הרשימה נשארה כפי שנבדקה");
  await expect(modal.getByTestId("iplan-update-row-904")).toBeVisible();
  await expect(modal.getByTestId("iplan-approve-btn")).toContainText("(1)");
  const beforeExplicitRefresh = await page.evaluate(async (weddingId) => {
    const store = await import("/src/lib/firebaseStore.js");
    const data = await store.cloudFetchAll(weddingId, { scopes: ["guests"] });
    return data.guests.find((guest) => guest.id === 904);
  }, weddingId);
  expect(beforeExplicitRefresh).toMatchObject({ rsvp: "pending", attendingCount: null, mention: "Unchanged" });

  await modal.getByRole("button", { name: "רענון מהתוסף", exact: true }).click();
  await postSnapshot(refreshedRows, "2026-10-21T12:01:01.000Z");
  await expect(modal).toContainText("לא נמצאו הבדלים בסריקה הנוכחית");
  await expect(modal.getByTestId("iplan-approve-btn")).toBeDisabled();
  await expect(page.getByText("עודכנו אישורי הגעה עבור 1 רשומות", { exact: true })).toHaveCount(0);
});

test("Mobile viewport (375x812) layout of IplanSyncModal has concise text and zero overlapping elements", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await signUp(page, uniqueIdentity("iplan-mobile-ui"), { readyTimeout: 60_000 });
  await navigateTo(page, "guests");

  await page.evaluate(async () => {
    const store = await import("/src/lib/firebaseStore.js");
    const [wedding] = await store.listWeddings();
    await store.cloudSeed(wedding.id, {
      guests: [
        {
          id: 201,
          name: "אביגיל לוי",
          phone: "050-999-1111",
          category: "משפחה",
          seats: 2,
          mention: "",
          rsvp: "pending",
          attendingCount: null,
          gift: 0,
        },
        {
          id: 202,
          name: "נריה ושילת בחור",
          phone: "",
          category: "חברים",
          seats: 2,
          mention: "",
          rsvp: "pending",
          attendingCount: null,
          gift: 0,
        },
      ],
    });
  });

  await expect(page.getByText("2 רשומות ברשימה")).toBeVisible({ timeout: 30_000 });

  // סימולציה של נתונים שהגיעו מתוסף ה-Chrome של iPlan
  await page.evaluate(() => {
    window.postMessage(
      {
        type: "WEDDING_PLANNER_IPLAN_ROWS",
        syncedAt: "2026-10-20T21:11:00.000Z",
        rows: [
          { name: "אביגיל לוי", phone: "0509991111", invited: "2", confirmed: "2", undecided: "" },
          { name: "נריה ושילת בחור", phone: "0541234567", invited: "2", confirmed: "2", undecided: "" },
        ],
      },
      "*"
    );
  });

  const modal = await openIplanModalFromBell(page);
  await expect(modal).toBeVisible();

  // וידוא שההסבר קוצר לשורה אחת תמציתית והכיתוב הארוך הישן הוסר
  await expect(modal).toContainText("מעדכן את סטטוס ההגעה ומספר המגיעים בלבד — שאר פרטי המוזמן לא ישתנו.");
  await expect(modal).not.toContainText("הגנה מלאה על הנתונים שלכם");

  // בדיקת Bounding Boxes במובייל — וידוא שאין שום דריסה או חפיפה בין טקסט המקור לבין שני הכפתורים
  const sourceTitle = modal.getByText(/מתוסף.*iPlan/);
  const uploadBtn = modal.getByRole("button", { name: "טעינת אקסל מ-iPlan" });
  const refreshBtn = modal.getByRole("button", { name: "רענון מהתוסף" });

  await expect(sourceTitle).toBeVisible();
  await expect(uploadBtn).toBeVisible();
  await expect(refreshBtn).toBeVisible();

  const sourceBox = await sourceTitle.boundingBox();
  const uploadBox = await uploadBtn.boundingBox();
  const refreshBox = await refreshBtn.boundingBox();

  expect(sourceBox).not.toBeNull();
  expect(uploadBox).not.toBeNull();
  expect(refreshBox).not.toBeNull();

  // במובייל (375px), שורת הכותרת של מקור הנתונים חייבת להיות מעל הכפתורים (ללא חפיפה אנכית)
  expect(sourceBox.y + sourceBox.height).toBeLessThanOrEqual(uploadBox.y + 2);
  expect(sourceBox.y + sourceBox.height).toBeLessThanOrEqual(refreshBox.y + 2);

  // שני הכפתורים מופיעים זה לצד זה בשורה תחתונה נקייה ללא חפיפה אופקית ביניהם
  const horizontalOverlap =
    Math.min(uploadBox.x + uploadBox.width, refreshBox.x + refreshBox.width) -
    Math.max(uploadBox.x, refreshBox.x);
  expect(horizontalOverlap).toBeLessThanOrEqual(0);

  // וידוא שאין גלילה אופקית חורגת במודאל בנייד
  const hasHorizontalOverflow = await modal.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});

test("ActivityBell collapses large update batches by default, expands on click, and supports single dismiss & Clear All", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, uniqueIdentity("iplan-bell-ux"), { readyTimeout: 60_000 });
  await navigateTo(page, "guests");

  // זריעת 12 מוזמנים כדי לבדוק סבב עדכון מרובה רשומות בהתראה
  await page.evaluate(async () => {
    const store = await import("/src/lib/firebaseStore.js");
    const [wedding] = await store.listWeddings();
    const guests = Array.from({ length: 12 }, (_, idx) => ({
      id: 300 + idx,
      name: `מוזמן בדיקה ${idx + 1}`,
      phone: `050-777-00${String(idx + 1).padStart(2, "0")}`,
      category: "חברים",
      seats: 2,
      mention: "",
      rsvp: "pending",
      attendingCount: null,
      gift: 0,
    }));
    await store.cloudSeed(wedding.id, { guests });
  });

  await expect(page.getByText("12 רשומות ברשימה")).toBeVisible({ timeout: 30_000 });

  // סימולציה של סנכרון 12 רשומות שאישרו הגעה
  await page.evaluate(() => {
    const rows = Array.from({ length: 12 }, (_, idx) => ({
      name: `מוזמן בדיקה ${idx + 1}`,
      phone: `05077700${String(idx + 1).padStart(2, "0")}`,
      invited: "2",
      confirmed: "2",
      undecided: "",
    }));
    window.postMessage(
      {
        type: "WEDDING_PLANNER_IPLAN_ROWS",
        syncedAt: new Date().toISOString(),
        rows,
      },
      "*"
    );
  });

  const modal = await openIplanModalFromBell(page);
  await expect(modal.getByTestId("iplan-approve-btn")).toContainText("כן, עדכן אישורי הגעה (12)");
  await modal.getByTestId("iplan-approve-btn").click();
  await expect(modal).toHaveCount(0);

  // פתיחת פעמון ההתראות
  const bellBtn = page.getByTestId("activity-bell-btn");
  await bellBtn.click();

  const popover = page.getByTestId("activity-bell-popover");
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("עודכנו 12 רשומות");

  // וידוא שחלונית ההתראות נמצאת במלואה בתוך המסך (גם במובייל וגם בדסקטופ)
  const popBox = await popover.boundingBox();
  const vp = page.viewportSize();
  expect(popBox).not.toBeNull();
  expect(popBox.x).toBeGreaterThanOrEqual(0);
  expect(popBox.x + popBox.width).toBeLessThanOrEqual((vp?.width || 1365) + 1);

  // כברירת מחדל הרשימה מקופלת ומציגה רק תקציר ("מוזמן בדיקה 1, מוזמן בדיקה 2 ועוד 10…")
  await expect(popover).toContainText("ועוד 10…");
  await expect(popover).toContainText("הצג פירוט (12)");
  await expect(popover.getByText("מוזמן בדיקה 12")).toHaveCount(0);

  // לחיצה על "הצג פירוט (12)" פותחת את הרשימה הנגללת
  await popover.getByTestId("activity-batch-toggle").first().click();
  await expect(popover).toContainText("הסתר פירוט");
  await expect(popover.getByText("מוזמן בדיקה 12")).toBeVisible();

  // לחיצה חוזרת מקפלת את הרשימה
  await popover.getByTestId("activity-batch-toggle").first().click();
  await expect(popover.getByText("מוזמן בדיקה 12")).toHaveCount(0);

  // לחיצה על "נקה הכל" מסתירה את כל ההתראות ומציגה מצב ריק נקי
  await popover.getByTestId("activity-clear-all-btn").click();
  await expect(popover).toContainText("אין התראות חדשות על עדכוני אישורי הגעה.");
});
