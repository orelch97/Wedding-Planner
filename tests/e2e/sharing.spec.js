import { test, expect } from "@playwright/test";
import {
  assertEmulatorEnvironment,
  uniqueIdentity,
  signUp,
  signIn,
  navigateTo,
  openNavigationMenu,
  openAddGuestForm,
} from "./helpers/emulator.js";
import {
  ALL_NAV_KEYS,
  VIEW_ONLY_FIELDS,
  blockCloudRequests,
  createInviteLink,
  joinViaInvite,
  probeScreen,
  visibleNavKeys,
} from "./helpers/sharing.js";

assertEmulatorEnvironment();

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const synced = (page) => page.locator('[aria-label="מצב סנכרון: מסונכרן"]');
const countdownCard = (page) => page.locator('[data-tour="overview-countdown"] > div').first();
// Desktop table and mobile cards can both exist in the DOM; only the rendered one counts.
const shownText = (page, text) => page.getByText(text).filter({ visible: true }).first();
const shownGuest = (page, name) => page.locator(`input[value="${name}"]:visible`).first();

/** Real second users, in separate browser contexts, against the local emulators. */
const ctx = {};

async function reloadToScreen(page, key) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("main")).toBeVisible({ timeout: 30_000 });
  await expect(synced(page)).toBeVisible({ timeout: 30_000 });
  await navigateTo(page, key);
}

async function openSettings(page) {
  await openNavigationMenu(page);
  await page.getByRole("button", { name: /הגדרות החתונה/ }).click();
  return page.getByRole("dialog", { name: "הגדרות החתונה" });
}

test.describe.configure({ mode: "serial" });

test.describe("shared access: owner, editors and viewers", () => {
  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(420_000);
    const use = testInfo.project.use;
    ctx.use = use;

    const ownerContext = await browser.newContext({
      viewport: use.viewport,
      userAgent: use.userAgent,
      deviceScaleFactor: use.deviceScaleFactor,
      isMobile: use.isMobile,
      hasTouch: use.hasTouch,
    });
    const owner = await ownerContext.newPage();
    ctx.ownerContext = ownerContext;
    ctx.owner = owner;
    ctx.ownerErrors = [];
    owner.on("pageerror", (error) => ctx.ownerErrors.push(error.message));
    await blockCloudRequests(owner);
    ctx.ownerIdentity = uniqueIdentity("owner");
    await signUp(owner, ctx.ownerIdentity);

    // Couple names and date live on the wedding itself.
    const settings = await openSettings(owner);
    await settings.getByLabel("שם בן/בת זוג א׳").fill("דנה");
    await settings.getByLabel("שם בן/בת זוג ב׳").fill("יונתן");
    await settings.locator("#wedding-date").fill("2027-06-01");
    await settings.getByRole("button", { name: "שמירה" }).click();
    await expect(settings).toBeHidden({ timeout: 15_000 });

    // Seed one item per screen so every member has something real to look at.
    await navigateTo(owner, "guests");
    await openAddGuestForm(owner);
    await owner.getByRole("textbox", { name: "שם האורח או המשפחה" }).fill("אורח מהבעלים");
    await owner.getByRole("button", { name: /הוסף לרשימה/ }).click();

    await navigateTo(owner, "checklist");
    await owner.getByRole("textbox", { name: "שם המשימה החדשה" }).fill("משימה מהבעלים");
    await owner.locator('[data-tour="checklist-add"]').getByRole("button", { name: "הוספה" }).click();

    await navigateTo(owner, "finance");
    await owner.getByRole("button", { name: "הוספת סעיף", exact: true }).click();
    await owner.getByRole("textbox", { name: "שם הסעיף" }).fill("סעיף מהבעלים");
    await owner.getByRole("spinbutton", { name: "עלות" }).fill("5000");
    await owner.getByRole("spinbutton", { name: "שולם" }).fill("1000");
    await owner.locator('[data-tour="finance-add-item"]').getByRole("button", { name: /הוסף/ }).click();

    await navigateTo(owner, "vendors");
    await owner.getByRole("button", { name: /הוספת ספק ראשון/ }).click();

    await navigateTo(owner, "alcohol");
    await owner.getByRole("spinbutton", { name: "מספר האורחים המשוער באירוע" }).fill("400");
    const addDrink = owner.locator('[data-tour="alcohol-add-drink"]');
    await addDrink.getByRole("button", { name: "הוספת משקה חדש" }).click();
    await addDrink.getByRole("textbox", { name: "שם המשקה" }).fill("וודקה מהבעלים");
    await addDrink.getByRole("button", { name: "הוספה" }).click();
    await expect(owner.getByRole("textbox", { name: "שם המשקה וודקה מהבעלים" })).toBeVisible();

    await navigateTo(owner, "overview");
    await owner
      .locator('[data-tour="overview-countdown"] input[type=file]')
      .setInputFiles({ name: "bg.png", mimeType: "image/png", buffer: PNG_1X1 });
    await expect(countdownCard(owner)).toHaveAttribute("style", /countdown-background/, { timeout: 20_000 });
    // Settings and the alcohol list are saved on a short debounce.
    await owner.waitForTimeout(3000);
    await expect(synced(owner)).toBeVisible();

    const personas = {
      editorAll: { role: "editor", scopes: ["all"] },
      viewerAll: { role: "viewer", scopes: ["all"] },
      editorGuests: { role: "editor", scopes: ["guests"] },
      viewerFinance: { role: "viewer", scopes: ["finance"] },
    };
    for (const [name, cfg] of Object.entries(personas)) {
      const link = await createInviteLink(owner, cfg);
      ctx[name] = await joinViaInvite(browser, use, link, name);
    }
  });

  test.afterAll(async () => {
    for (const key of ["editorAll", "viewerAll", "editorGuests", "viewerFinance"]) {
      await ctx[key]?.context.close();
    }
    await ctx.ownerContext?.close();
  });

  test("joining by invite shows no error toast and reports a clean session", async () => {
    for (const key of ["editorAll", "viewerAll", "editorGuests", "viewerFinance"]) {
      const member = ctx[key];
      expect(member.inviteFailureToasts, `${key} invite failure toast`).toBe(0);
      expect(member.pageErrors, `${key} page errors`).toEqual([]);
      expect(member.cloudAttempts, `${key} must stay on the emulators`).toEqual([]);
      const failedInvite = member.badResponses.filter((entry) => /acceptInvite/.test(entry));
      expect(failedInvite, `${key} acceptInvite calls`).toEqual([]);
    }
  });

  test("every member's navigation matches exactly the screens they were granted", async () => {
    expect(await visibleNavKeys(ctx.owner)).toEqual(ALL_NAV_KEYS);
    expect(await visibleNavKeys(ctx.editorAll.page)).toEqual(ALL_NAV_KEYS);
    expect(await visibleNavKeys(ctx.viewerAll.page)).toEqual(ALL_NAV_KEYS);
    // The dashboard summarises every screen, so it is hidden from partial shares.
    expect(await visibleNavKeys(ctx.editorGuests.page)).toEqual(["guests", "alcohol", "seating"]);
    expect(await visibleNavKeys(ctx.viewerFinance.page)).toEqual(["finance"]);
  });

  test("the countdown picture and couple details reach every member who sees the dashboard", async () => {
    for (const key of ["editorAll", "viewerAll"]) {
      const page = ctx[key].page;
      await reloadToScreen(page, "overview");
      await expect(countdownCard(page), `${key} countdown image`).toHaveAttribute("style", /countdown-background/, {
        timeout: 15_000,
      });
      const hero = page.locator('[data-tour="overview-countdown"]');
      await expect(hero).toContainText("דנה");
      await expect(hero).toContainText("יונתן");
      await expect(hero).toContainText("הספירה לאחור לרגע הגדול");
    }
  });

  test("the picture is actually served to a member, not just referenced", async () => {
    const page = ctx.editorAll.page;
    const style = await countdownCard(page).getAttribute("style");
    const url = style.match(/url\("([^"]+)"\)/)?.[1];
    expect(url, "background url").toBeTruthy();
    const status = await page.evaluate(async (target) => (await fetch(target)).status, url);
    expect(status).toBe(200);
  });

  test("only the owner can change the picture or the couple's details", async () => {
    await expect(ctx.owner.locator('[data-tour="overview-countdown"]')).toContainText("החלפת תמונת רקע");
    for (const key of ["editorAll", "viewerAll"]) {
      const page = ctx[key].page;
      await navigateTo(page, "overview");
      await expect(page.locator('[data-tour="overview-countdown"]')).not.toContainText(/תמונת רקע/);
      const settings = await openSettings(page);
      await expect(settings.getByLabel("שם בן/בת זוג א׳")).toBeDisabled();
      await expect(settings.locator("#wedding-date")).toBeDisabled();
      await settings.getByRole("button", { name: "ביטול" }).click();
    }
  });

  test("an editor can work on every screen, and the owner sees the result", async () => {
    const page = ctx.editorAll.page;

    await navigateTo(page, "guests");
    await openAddGuestForm(page);
    await page.getByRole("textbox", { name: "שם האורח או המשפחה" }).fill("אורח מהשותף");
    await page.getByRole("button", { name: /הוסף לרשימה/ }).click();

    await navigateTo(page, "checklist");
    await page.getByRole("textbox", { name: "שם המשימה החדשה" }).fill("משימה מהשותף");
    await page.locator('[data-tour="checklist-add"]').getByRole("button", { name: "הוספה" }).click();

    await navigateTo(page, "finance");
    const financeForm = page.locator('[data-tour="finance-add-item"]');
    await financeForm.getByRole("button", { name: "הוספת סעיף", exact: true }).click();
    await financeForm.getByRole("textbox", { name: "שם הסעיף" }).fill("סעיף מהשותף");
    await financeForm.getByRole("spinbutton", { name: "עלות" }).fill("700");
    await financeForm.getByRole("button", { name: /הוסף/ }).click();

    await navigateTo(page, "alcohol");
    await page.getByRole("spinbutton", { name: "מספר האורחים המשוער באירוע" }).fill("500");

    await page.waitForTimeout(3000);
    await expect(synced(page)).toBeVisible();
    expect(ctx.editorAll.pageErrors).toEqual([]);

    const owner = ctx.owner;
    await reloadToScreen(owner, "guests");
    await expect(shownGuest(owner, "אורח מהשותף")).toBeVisible();
    await navigateTo(owner, "checklist");
    await expect(shownText(owner, "משימה מהשותף")).toBeVisible();
    await navigateTo(owner, "finance");
    await expect(shownText(owner, "סעיף מהשותף")).toBeVisible();
    await navigateTo(owner, "alcohol");
    await expect(owner.getByRole("spinbutton", { name: "מספר האורחים המשוער באירוע" })).toHaveValue("500");
  });

  test("the alcohol calculator is shared: partners see the owner's list and headcount", async () => {
    for (const key of ["editorAll", "viewerAll", "editorGuests"]) {
      const page = ctx[key].page;
      await reloadToScreen(page, "alcohol");
      await expect(page.getByRole("spinbutton", { name: "מספר האורחים המשוער באירוע" }), `${key} headcount`).toHaveValue("500");
      await expect(page.getByRole("textbox", { name: "שם המשקה וודקה מהבעלים" }), `${key} drink`).toBeVisible();
    }
  });

  test("a viewer sees every screen but cannot change anything", async () => {
    const page = ctx.viewerAll.page;
    const forbiddenButtons = /הוספת|הוסף|מחיקת|ייבוא|תבנית|שחזור|צירוף קובץ|העבר לסעיף|עריכת|קטגוריות$/;

    for (const key of ALL_NAV_KEYS) {
      await navigateTo(page, key);
      await page.waitForTimeout(500);
      const screen = await probeScreen(page);
      const editable = screen.editable.filter((label) => !VIEW_ONLY_FIELDS.test(label));
      expect(editable, `${key}: editable data fields`).toEqual([]);
      const actions = screen.buttons.filter((label) => forbiddenButtons.test(label));
      expect(actions, `${key}: enabled write actions`).toEqual([]);
    }

    // Spot checks that the screens are really showing the owner's data, read-only.
    await navigateTo(page, "guests");
    await expect(page.locator('[data-tour="guests-add"]')).toHaveCount(0);
    await expect(shownGuest(page, "אורח מהבעלים")).toBeVisible();
    await navigateTo(page, "checklist");
    await expect(shownText(page, "משימה מהבעלים")).toBeVisible();
    await expect(page.locator('[data-tour="checklist-add"]')).toHaveCount(0);
    await navigateTo(page, "finance");
    await expect(shownText(page, "סעיף מהבעלים")).toBeVisible();
    await expect(page.locator('[data-tour="finance-add-item"]')).toHaveCount(0);
    await navigateTo(page, "alcohol");
    await expect(page.locator('[data-tour="alcohol-add-drink"]')).toHaveCount(0);
    await expect(page.locator('[data-tour="alcohol-budget-transfer"]').getByRole("button", { name: /העבר לסעיף/ })).toHaveCount(0);
  });

  test("a viewer cannot change the shared alcohol calculator even by typing", async () => {
    const page = ctx.viewerAll.page;
    await navigateTo(page, "alcohol");
    const headcount = page.getByRole("spinbutton", { name: "מספר האורחים המשוער באירוע" });
    await expect(headcount).toBeDisabled();
    await expect(page.getByRole("spinbutton", { name: "אחוז האורחים ששותים אלכוהול" })).toBeDisabled();
    await expect(page.getByRole("spinbutton", { name: "כמה אנשים לבקבוק אחד" })).toBeDisabled();
    await expect(page.getByRole("textbox", { name: "שם המשקה וודקה מהבעלים" })).toBeDisabled();
  });

  test("members with a partial share see only their screens, with matching permissions", async () => {
    const guestsEditor = ctx.editorGuests.page;
    await navigateTo(guestsEditor, "guests");
    await expect(guestsEditor.locator('[data-tour="guests-add"]')).toHaveCount(1);
    await navigateTo(guestsEditor, "alcohol");
    // Budget transfer needs the finance screen, which this member was not given.
    await expect(guestsEditor.locator('[data-tour="alcohol-budget-transfer"]').getByRole("button", { name: /העבר לסעיף/ })).toHaveCount(0);

    const financeViewer = ctx.viewerFinance.page;
    await navigateTo(financeViewer, "finance");
    await expect(shownText(financeViewer, "סעיף מהבעלים")).toBeVisible();
    const screen = await probeScreen(financeViewer);
    expect(screen.editable).toEqual([]);
    await expect(financeViewer.locator('[data-tour="finance-add-item"]')).toHaveCount(0);

    for (const key of ["editorGuests", "viewerFinance"]) {
      expect(ctx[key].pageErrors, `${key} page errors`).toEqual([]);
    }
  });

  test("changing a member's role takes effect, and removing a member ends their access", async () => {
    const owner = ctx.owner;
    const partner = ctx.editorAll;

    await openNavigationMenu(owner);
    await owner.getByRole("button", { name: /שיתוף וחברים/ }).click();
    const dialog = owner.getByRole("dialog", { name: "שיתוף החתונה" });
    const row = dialog.locator("div.bg-slate-50", { hasText: partner.identity.email }).first();
    await row.getByRole("button", { name: "עריכת הרשאות" }).click();
    await row.getByLabel("רמת הרשאה").selectOption("viewer");
    await row.getByRole("button", { name: "שמירה" }).click();
    await expect(owner.getByText("ההרשאות עודכנו")).toBeVisible({ timeout: 15_000 });

    // A permission change signs the member out (their tokens are revoked), so the new
    // role is what they get when they log back in.
    await signIn(partner.page, partner.identity);
    await navigateTo(partner.page, "guests");
    await expect(partner.page.locator('[data-tour="guests-add"]')).toHaveCount(0);
    expect((await probeScreen(partner.page)).editable.filter((label) => !VIEW_ONLY_FIELDS.test(label))).toEqual([]);

    // Removing them takes the wedding away entirely.
    await row.getByRole("button", { name: "הסרת חבר" }).click();
    await owner.getByRole("alertdialog").getByRole("button", { name: "הסרה" }).click();
    await expect(owner.getByText("החבר הוסר")).toBeVisible({ timeout: 15_000 });
    await partner.page.goto("/");
    const existingAccount = partner.page.getByRole("button", { name: /יש לי כבר חשבון/ });
    if (await existingAccount.count()) await existingAccount.click();
    await partner.page.getByLabel("מייל", { exact: true }).fill(partner.identity.email);
    await partner.page.getByLabel(/^סיסמה|^password/i).fill(partner.identity.password);
    await partner.page.locator('[data-tour="auth-submit"]').click();
    // They land in a fresh wedding of their own, with none of the original wedding's data.
    await expect(partner.page.getByRole("main")).toBeVisible({ timeout: 30_000 });
    await expect(partner.page.locator('[data-tour="overview-countdown"]')).not.toContainText("דנה");
    await navigateTo(partner.page, "guests");
    await expect(partner.page.locator('input[value="אורח מהבעלים"]')).toHaveCount(0);
    await expect(partner.page.locator('input[value="אורח מהשותף"]')).toHaveCount(0);
  });

  test("the owner's own session stayed healthy throughout", async () => {
    expect(ctx.ownerErrors).toEqual([]);
  });
});
