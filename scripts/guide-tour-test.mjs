import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appTourSteps, readTourProgress, saveTourProgress } from "../src/data/guide.js";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const admin = readFileSync(new URL("../src/components/AdminDashboard.jsx", import.meta.url), "utf8");
const allMarkup = `${app}\n${admin}`;
const weddingApp = app.slice(app.indexOf("function WeddingApp("));
assert.ok(weddingApp.indexOf("const [vendors, setVendors]") < weddingApp.indexOf("const tourSteps = useMemo"), "vendors state initializes before tour steps read its length");
const context = {
  canEdit: true,
  isOwner: true,
  navKeys: ["overview", "checklist", "guests", "alcohol", "seating", "vendors", "finance", "admin"],
  currentScreen: "overview",
  isMobile: false,
  hasVendors: true,
  canTransferBudget: true,
};
const screens = ["overview", "checklist", "guests", "alcohol", "seating", "vendors", "finance", "admin"];
let checked = 0;

for (const screen of screens) {
  const steps = appTourSteps({ ...context, currentScreen: screen });
  assert.ok(steps.length > 0, `${screen} has at least one page-specific step`);
  for (const step of steps) {
    assert.ok(!/ברוכים הבאים|נתחיל לתכנן|וזהו|גיבוי וייצוא|nav-/.test(`${step.title} ${step.target || ""}`), `${screen} has no global or cross-page tour step`);
    if (!step.target) continue;
    const target = step.target.match(/^\[data-tour="([^"]+)"\]$/)?.[1];
    assert.ok(target, `${screen} target uses a stable data-tour selector`);
    assert.ok(
      allMarkup.includes(`data-tour="${target}"`) || allMarkup.includes(`tourId="${target}"`),
      `${screen} target ${target} exists in rendered component source`
    );
    checked++;
  }
}

const guestsOnly = appTourSteps({ ...context, currentScreen: "guests" });
assert.ok(guestsOnly.every((step) => !step.target?.includes("finance-") && !step.target?.includes("vendors-")));
const vendorEmpty = appTourSteps({ ...context, currentScreen: "vendors", hasVendors: false });
assert.ok(vendorEmpty.some((step) => step.target === '[data-tour="vendors-empty"]'));
const financeDesktop = appTourSteps({ ...context, currentScreen: "finance", isMobile: false });
const financeMobile = appTourSteps({ ...context, currentScreen: "finance", isMobile: true });
assert.ok(!financeDesktop.some((step) => step.target === '[data-tour="finance-mobile-totals"]'));
assert.ok(financeMobile.some((step) => step.target === '[data-tour="finance-mobile-totals"]'));
const alcoholWithoutFinance = appTourSteps({ ...context, currentScreen: "alcohol", canTransferBudget: false });
assert.ok(!alcoholWithoutFinance.some((step) => step.target === '[data-tour="alcohol-budget-transfer"]'));

console.log(`Page-specific tour targets: ${checked} verified; no global/cross-screen steps; responsive and permission variants passed.`);

const originalStorage = globalThis.localStorage;
const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
};
try {
  assert.deepEqual(readTourProgress("first-user"), {});
  saveTourProgress("first-user", { guests: "dismissed", overview: "completed" });
  assert.deepEqual(readTourProgress("first-user"), { guests: "dismissed", overview: "completed" });
  assert.deepEqual(readTourProgress("second-user"), {});
  assert.deepEqual(readTourProgress(), {});
  saveTourProgress("first-user", { guests: "dismissed", overview: "completed", finance: "completed" });
  assert.equal(readTourProgress("first-user").guests, "dismissed");
  assert.equal(readTourProgress("first-user").finance, "completed");
  assert.equal(readTourProgress("legacy-user", true).guests, "dismissed");
  saveTourProgress("legacy-user", readTourProgress("legacy-user", true));
  assert.equal(readTourProgress("legacy-user").guests, "dismissed");
  saveTourProgress("first-user", { guests: "invalid", overview: "completed", unknown: "completed" });
  assert.deepEqual(readTourProgress("first-user"), { overview: "completed" });
  stored.set("wp:guide:user:broken:tourProgress", "not-json");
  assert.deepEqual(readTourProgress("broken"), {});
  stored.set("wp:guide:user:broken:tourProgress", "[]");
  assert.deepEqual(readTourProgress("broken"), {});
  globalThis.localStorage = {
    getItem: () => { throw new Error("Storage unavailable"); },
    setItem: () => { throw new Error("Storage unavailable"); },
  };
  assert.deepEqual(readTourProgress("blocked"), {});
  assert.doesNotThrow(() => saveTourProgress("blocked", { guests: "dismissed" }));
  console.log("Tour preferences: per-user isolation, per-screen status, legacy dismissal, malformed/blocked storage passed.");
} finally {
  if (originalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalStorage;
}
