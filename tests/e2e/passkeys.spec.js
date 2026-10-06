import { test, expect } from "@playwright/test";
import { assertEmulatorEnvironment, signUp, uniqueIdentity, openNavigationMenu } from "./helpers/emulator.js";
import { blockCloudRequests } from "./helpers/sharing.js";

assertEmulatorEnvironment();
test.use({ baseURL: "http://localhost:4173" });

test("registers a real WebAuthn credential and signs in with it", async ({ page, context }) => {
  test.setTimeout(120_000);
  const attempts = await blockCloudRequests(page);
  const protocol = await context.newCDPSession(page);
  await protocol.send("WebAuthn.enable");
  const { authenticatorId } = await protocol.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  try {
    const identity = uniqueIdentity("passkey");
    await signUp(page, identity);
    await openNavigationMenu(page);
    await page.getByRole("button", { name: "הגדרות החתונה", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "הגדרות החתונה" });
    await settings.getByRole("button", { name: "הוספת Passkey למכשיר הזה" }).click();
    await expect(settings).toContainText("הכניסה המהירה הופעלה במכשיר הזה.", { timeout: 30_000 });
    const { credentials } = await protocol.send("WebAuthn.getCredentials", { authenticatorId });
    expect(credentials).toHaveLength(1);
    await settings.getByRole("button", { name: "ביטול", exact: true }).click();
    const closeNavigation = page.getByRole("button", { name: "סגירת תפריט הניווט", exact: true });
    if (await closeNavigation.isVisible()) await closeNavigation.click();

    const logout = page.getByRole("button", { name: "יציאה", exact: true });
    if (await logout.isVisible()) await logout.click();
    else {
      await page.getByRole("button", { name: "פעולות נוספות" }).click();
      await page.getByRole("menuitem", { name: "יציאה מהחשבון" }).click();
    }
    await expect(page.getByLabel("מייל", { exact: true })).toBeVisible();
    await page.getByLabel("מייל", { exact: true }).fill(identity.email);
    await page.getByRole("button", { name: "כניסה מהירה עם Passkey" }).click();
    await expect(page.getByRole("main")).toBeVisible({ timeout: 30_000 });
    expect(attempts).toEqual([]);
  } finally {
    await protocol.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    await protocol.detach();
  }
});

test("allows the local 5175 origin but rejects an untrusted registration origin", async ({ page }) => {
  const attempts = await blockCloudRequests(page);
  await signUp(page, uniqueIdentity("passkey-origin"));
  const results = await page.evaluate(async () => {
    const { httpsCallable } = await import("/node_modules/.vite/deps/firebase_functions.js");
    const { functions, FIREBASE_ENV } = await import("/src/lib/firebase.js");
    const options = httpsCallable(functions, "passkeyRegisterOptions");
    const allowed = await options({ env: FIREBASE_ENV, origin: "http://localhost:5175" });
    let denied = "";
    try {
      await options({ env: FIREBASE_ENV, origin: "https://untrusted.example" });
    } catch (error) {
      denied = error.code;
    }
    return { rpID: allowed.data.rp.id, denied };
  });
  expect(results).toEqual({ rpID: "localhost", denied: "functions/permission-denied" });
  expect(attempts).toEqual([]);
});