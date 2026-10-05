import assert from "node:assert/strict";
import { summarizeDrinkPurchase } from "../src/lib/alcoholCalculator.js";

const summary = summarizeDrinkPurchase([
  { drinkType: "heavy", units: 2, volumeLiters: 1 },
  { drinkType: "wineBeer", units: 2, volumeLiters: 0.75 },
  // Even if a mixer has a volume property, it must never affect alcoholic liters.
  { drinkType: "mixer", units: 5, volumeLiters: 1.5 },
]);
assert.deepEqual(summary, { alcoholicLiters: 3.5, mixerUnits: 5 });

const disabledOnly = summarizeDrinkPurchase([
  { drinkType: "mixer", units: 0, volumeLiters: 1 },
  { drinkType: "heavy", units: 0, volumeLiters: 1 },
]);
assert.deepEqual(disabledOnly, { alcoholicLiters: 0, mixerUnits: 0 });

const invalidValues = summarizeDrinkPurchase([
  { drinkType: "mixer", units: -2, volumeLiters: 0.5 },
  { drinkType: "wineBeer", units: 1, volumeLiters: -0.75 },
]);
assert.deepEqual(invalidValues, { alcoholicLiters: 0, mixerUnits: 0 });

// The user's per-line preference wins over the category in both directions.
const userChoice = summarizeDrinkPurchase([
  // Wine the couple does not want inside the alcohol volume.
  { drinkType: "wineBeer", units: 4, volumeLiters: 0.75, countsInLiters: false },
  // A soft-drink crate they do want counted.
  { drinkType: "mixer", units: 2, volumeLiters: 6, countsInLiters: true },
]);
assert.deepEqual(userChoice, { alcoholicLiters: 12, mixerUnits: 4 });

console.log("Alcohol calculator summaries: 4 passed, 0 failed");
