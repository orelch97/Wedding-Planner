/**
 * Summarize the shopping plan without mixing alcohol volumes and unit counts.
 *
 * Whether a line counts toward the alcohol volume is the user's call: a case of
 * energy drinks, a crate of soft drinks or even wine may legitimately sit
 * outside that number. `countsInLiters` carries the choice; when it is missing
 * we fall back to the category, so plans saved earlier behave as before.
 */
export function summarizeDrinkPurchase(lines) {
  const items = Array.isArray(lines) ? lines : [];
  const countsInLiters = (line) =>
    line.countsInLiters == null ? line.drinkType !== "mixer" : !!line.countsInLiters;

  const alcoholicLiters = items.reduce((sum, line) => (
    sum + (countsInLiters(line)
      ? Math.max(0, Number(line.units) || 0) * Math.max(0, Number(line.volumeLiters) || 0)
      : 0)
  ), 0);
  const mixerUnits = items.reduce((sum, line) => (
    sum + (countsInLiters(line) ? 0 : Math.max(0, Number(line.units) || 0))
  ), 0);

  return {
    alcoholicLiters: Number(alcoholicLiters.toFixed(2)),
    mixerUnits,
  };
}
