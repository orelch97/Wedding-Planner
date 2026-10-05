/** Phone numbers are compared by their digits only, so "050-123 4567" equals "0501234567". */
export function phoneDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * Maps guest id -> the other guests that share the same mobile number.
 * A record with no digits (empty, "-") is never a duplicate, not even of another empty one.
 */
export function findDuplicatePhones(guests) {
  const byNumber = new Map();
  for (const guest of guests) {
    const digits = phoneDigits(guest?.phone);
    if (!digits) continue;
    const group = byNumber.get(digits);
    if (group) group.push(guest);
    else byNumber.set(digits, [guest]);
  }

  const duplicates = new Map();
  for (const group of byNumber.values()) {
    if (group.length < 2) continue;
    for (const guest of group) {
      duplicates.set(guest.id, group.filter((other) => other.id !== guest.id));
    }
  }
  return duplicates;
}

const SHOWN_NAMES = 3;

/** One line for a tooltip: who else holds this number. */
export function describeDuplicates(others) {
  const names = others.map((guest) => String(guest?.name ?? "").trim() || "ללא שם");
  const shown = names.slice(0, SHOWN_NAMES).join(", ");
  const rest = names.length - SHOWN_NAMES;
  return `מספר הנייד מופיע גם אצל: ${shown}${rest > 0 ? ` ועוד ${rest}` : ""}`;
}
