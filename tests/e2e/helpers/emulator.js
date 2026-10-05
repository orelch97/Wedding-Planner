import { expect } from "@playwright/test";

const PROJECT_ID = "demo-wedding-planner-e2e";
const HOSTS = {
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
  STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
  FUNCTIONS_EMULATOR_HOST: "127.0.0.1:5001",
};

export function assertEmulatorEnvironment() {
  if (process.env.GCLOUD_PROJECT !== PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID !== PROJECT_ID) {
    throw new Error("E2E safety stop: expected demo-only Firebase project.");
  }
  for (const [key, value] of Object.entries(HOSTS)) {
    if (process.env[key] !== value) throw new Error(`E2E safety stop: ${key} is not the local emulator.`);
  }
}

export function uniqueIdentity(label = "test") {
  const id = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return { id, email: `${id}@example.test`, password: "E2E-only-Password-938!" };
}

export async function openSignup(page) {
  await page.goto("/");
  const signupToggle = page.locator('[data-tour="auth-toggle"]');
  if (/להרשמה/.test(await signupToggle.innerText())) await signupToggle.click();
}

export async function openNavigationMenu(page) {
  const menuButton = page.getByRole("button", { name: "פתיחת תפריט הניווט" });
  if (!(await menuButton.isVisible())) return;
  // The drawer may already be open (e.g. after using the sidebar's share button).
  if ((await menuButton.getAttribute("aria-expanded")) === "true") return;
  await menuButton.click();
}

export async function navigateTo(page, key) {
  await openNavigationMenu(page);
  await page.locator(`[data-tour="nav-${key}"]`).click();
}

// The add-guest form is collapsed by default.
export async function openAddGuestForm(page) {
  const toggle = page.locator('[data-tour="guests-add"]').getByRole("button", { name: "הוספת מוזמן חדש" });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}

export async function expectGuestPresent(page, name) {
  const label = (page.viewportSize()?.width ?? 1365) < 500 ? "שם האורח" : "שם";
  await expect(page.getByRole("textbox", { name: label, exact: true })).toHaveValue(name);
}

export async function signUp(page, identity, { weddingDate } = {}) {
  await openSignup(page);
  if (weddingDate) await page.locator('[data-tour="auth-date"] input').fill(weddingDate);
  const email = page.getByLabel("מייל", { exact: true });
  const password = page.getByLabel(/^סיסמה|^password/i);
  await email.fill(identity.email);
  await password.fill(identity.password);
  const submit = page.locator('[data-tour="auth-submit"]');
  await expect(submit).toHaveText("הרשמה");
  await submit.click();
  await expect(page.getByRole("main")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[aria-label="מצב סנכרון: מסונכרן"]')).toBeVisible({ timeout: 30_000 });
}

export async function signIn(page, identity) {
  await page.goto("/");
  const login = page.getByRole("button", { name: /יש לי כבר חשבון/ });
  if (await login.count()) await login.click();
  await page.getByLabel("מייל", { exact: true }).fill(identity.email);
  await page.getByLabel(/^סיסמה|^password/i).fill(identity.password);
  await page.locator('[data-tour="auth-submit"]').click();
  await expect(page.getByRole("main")).toBeVisible({ timeout: 30_000 });
}

export async function expectAppHealthy(page) {
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/something went wrong|application error|שגיאה בלתי צפויה/i);
}
