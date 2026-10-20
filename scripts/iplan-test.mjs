import assert from "node:assert/strict";
import {
  phoneKey,
  parseIplanSheetRows,
  normalizeIplanRow,
  reconcileIplan,
  applyIplanUpdates,
  readIplanBuffer,
  formatRsvpLabel,
} from "../src/lib/iplanSync.js";

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

console.log("\niPlan RSVP Reconciliation Tests\n");

await check("phoneKey normalizes Israeli mobile numbers across formats", () => {
  assert.equal(phoneKey("050-697-0046"), "506970046");
  assert.equal(phoneKey("0506970046"), "506970046");
  assert.equal(phoneKey("506970046"), "506970046");
  assert.equal(phoneKey("+972-50-697-0046"), "506970046");
  assert.equal(phoneKey("00972 50 697 0046"), "506970046");
  assert.equal(phoneKey("(052) 123.45.67"), "521234567");
});

await check("phoneKey normalizes landlines and rejects empty/short values", () => {
  assert.equal(phoneKey("03-1234567"), "31234567");
  assert.equal(phoneKey("+972-3-1234567"), "31234567");
  assert.equal(phoneKey(""), "");
  assert.equal(phoneKey("-"), "");
  assert.equal(phoneKey("12345"), "");
  assert.equal(phoneKey(null), "");
});

await check("parseIplanSheetRows parses iPlan double-header export structure", () => {
  const matrix = [
    ["", "", "שיוך", "", "פרטי התקשרות", "", "", "כתובת", "", "", "", "", "", "", "", ""],
    [
      "הזמנה לכבוד",
      "מס' אורחים שהוזמנו",
      "צד",
      "קבוצה",
      "סלולרי",
      "טלפון רגיל",
      "אימייל",
      "עיר",
      "רחוב",
      "מיקוד",
      "תא דואר",
      "",
      "אישרו שיגיעו",
      "מתלבטים",
      "מספר שולחן",
      "הגיעו",
    ],
    ["ליאור אלעזרי", "2", "חתן", "משפחה", "050-1112222", "", "", "", "", "", "", "", "2", "", "", ""],
    ["דנה כהן", "3", "כלה", "חברים", "052-3334444", "", "", "", "", "", "", "", "0", "", "", ""],
    ["יוסי לוי", "2", "חתן", "עבודה", "054-5556666", "", "", "", "", "", "", "", "", "2", "", ""],
    ["רונית אברהם", "1", "כלה", "משפחה", "053-7778888", "", "", "", "", "", "", "", "", "", "", ""],
  ];

  const rows = parseIplanSheetRows(matrix);
  assert.equal(rows.length, 4);

  assert.equal(rows[0].name, "ליאור אלעזרי");
  assert.equal(rows[0].rsvp, "confirmed");
  assert.equal(rows[0].attendingCount, 2);
  assert.equal(rows[0].hasResponse, true);

  assert.equal(rows[1].name, "דנה כהן");
  assert.equal(rows[1].rsvp, "declined");
  assert.equal(rows[1].attendingCount, 0);
  assert.equal(rows[1].hasResponse, true);

  assert.equal(rows[2].name, "יוסי לוי");
  assert.equal(rows[2].rsvp, "pending");
  assert.equal(rows[2].attendingCount, 0);
  assert.equal(rows[2].hasResponse, true);
  assert.equal(rows[2].rawStatus, "considering");

  assert.equal(rows[3].name, "רונית אברהם");
  assert.equal(rows[3].rsvp, "pending");
  assert.equal(rows[3].hasResponse, false);
});

await check("reconcileIplan detects confirmed, declined, considering, and clamps attendingCount to seats", () => {
  const guests = [
    { id: 1, name: "ליאור", phone: "0501112222", seats: 2, rsvp: "pending", attendingCount: null },
    { id: 2, name: "דנה", phone: "+972-52-333-4444", seats: 2, rsvp: "pending", attendingCount: null },
    { id: 3, name: "יוסי", phone: "054-5556666", seats: 3, rsvp: "confirmed", attendingCount: 3 },
    { id: 4, name: "עמית (חלקי)", phone: "058-9990000", seats: 4, rsvp: "pending", attendingCount: null },
    { id: 5, name: "ללא שינוי", phone: "050-2223333", seats: 2, rsvp: "confirmed", attendingCount: 2 },
  ];

  const rows = [
    { name: "ליאור אלעזרי", phone: "050-111-2222", invited: 2, confirmed: "2" },
    { name: "דנה כהן", phone: "0523334444", invited: 2, confirmed: "0" },
    { name: "יוסי לוי", phone: "545556666", invited: 3, confirmed: "", considering: "3" },
    { name: "עמית", phone: "0589990000", invited: 4, confirmed: "2" },
    { name: "ללא שינוי", phone: "0502223333", invited: 2, confirmed: "2" },
  ];

  const result = reconcileIplan({ guests, rows });
  assert.equal(result.unchangedCount, 1);
  assert.equal(result.updates.length, 4);

  const u1 = result.updates.find((u) => u.guestId === 1);
  assert.equal(u1.toRsvp, "confirmed");
  assert.equal(u1.toAttendingCount, 2);

  const u2 = result.updates.find((u) => u.guestId === 2);
  assert.equal(u2.toRsvp, "declined");
  assert.equal(u2.toAttendingCount, 0);

  const u3 = result.updates.find((u) => u.guestId === 3);
  assert.equal(u3.fromRsvp, "confirmed");
  assert.equal(u3.toRsvp, "pending");
  assert.equal(u3.toAttendingCount, 0);

  const u4 = result.updates.find((u) => u.guestId === 4);
  assert.equal(u4.toRsvp, "confirmed");
  assert.equal(u4.toAttendingCount, 2);
});

await check("reconcileIplan flags duplicate phones as ambiguous and never auto-updates them", () => {
  const guests = [
    { id: 10, name: "אח א'", phone: "050-1234567", seats: 1, rsvp: "pending" },
    { id: 11, name: "אח ב'", phone: "0501234567", seats: 1, rsvp: "pending" },
  ];
  const rows = [{ name: "משפחת אחים", phone: "050-123-4567", invited: 2, confirmed: "2" }];

  const result = reconcileIplan({ guests, rows });
  assert.equal(result.updates.length, 0);
  assert.equal(result.ambiguous.length, 1);
  assert.equal(result.ambiguous[0].reason, "duplicate_guest_phone");
});

await check("reconcileIplan flags missing phones and guests not in our list as unmatched", () => {
  const guests = [{ id: 1, name: "ישראל ישראלי", phone: "050-1111111", seats: 2, rsvp: "pending" }];
  const rows = [
    { name: "אורח ללא נייד שאינו ברשימה", phone: "", invited: 2, confirmed: "2" },
    { name: "אורח חדש מ-iPlan", phone: "052-9999999", invited: 1, confirmed: "1" },
  ];

  const result = reconcileIplan({ guests, rows });
  assert.equal(result.updates.length, 0);
  assert.equal(result.unmatched.length, 2);
  assert.equal(result.unmatched[0].reason, "missing_phone");
  assert.equal(result.unmatched[1].reason, "not_in_guest_list");
});

await check("reconcileIplan matches unique guest by exact name when phone is missing in Wedding Planner", () => {
  const guests = [
    { id: 77, name: "נריה ושילת בחור", phone: "", seats: 2, category: "צד חתן - חברים", rsvp: "pending" },
  ];
  const rows = [
    { name: "נריה ושילת בחור", phone: "052-279-8717", invited: 2, confirmed: "2 מגיעים" },
  ];

  const result = reconcileIplan({ guests, rows });
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].guestId, 77);
  assert.equal(result.updates[0].toRsvp, "confirmed");
  assert.equal(result.updates[0].toAttendingCount, 2);
});

await check("reconcileIplan protects manual local confirmations when iPlan row is unanswered unless requested", () => {
  const guests = [{ id: 1, name: "דוד כהן", phone: "050-7654321", seats: 2, rsvp: "confirmed", attendingCount: 2 }];
  const rows = [{ name: "דוד כהן", phone: "050-7654321", invited: 2, confirmed: "", considering: "" }];

  const safeResult = reconcileIplan({ guests, rows, includeUnansweredReset: false });
  assert.equal(safeResult.updates.length, 0);
  assert.equal(safeResult.unansweredLocals.length, 1);

  const resetResult = reconcileIplan({ guests, rows, includeUnansweredReset: true });
  assert.equal(resetResult.updates.length, 1);
  assert.equal(resetResult.updates[0].toRsvp, "pending");
  assert.equal(resetResult.updates[0].toAttendingCount, 0);
});

await check("applyIplanUpdates ONLY modifies rsvp and attendingCount and preserves all other fields", () => {
  const originalGuest = {
    id: 42,
    name: "משפחת אלעזרי",
    phone: "050-697-0046",
    category: "משפחה צד אמא",
    seats: 4,
    mention: "הערה אישית חשובה שלנו",
    source: "חתן",
    probablyComing: true,
    considering: true,
    glatt: true,
    drinkers: 3,
    rsvp: "pending",
    gift: 1000,
    attendingCount: null,
  };

  const { nextGuests, changes } = applyIplanUpdates(
    [originalGuest],
    [{ guestId: 42, toRsvp: "confirmed", toAttendingCount: 3 }]
  );

  assert.equal(changes.length, 1);
  const updated = nextGuests[0];
  assert.equal(updated.rsvp, "confirmed");
  assert.equal(updated.attendingCount, 3);

  // וידוא מוחלט שאף שדה אחר לא השתנה:
  for (const key of [
    "id",
    "name",
    "phone",
    "category",
    "seats",
    "mention",
    "source",
    "probablyComing",
    "considering",
    "glatt",
    "drinkers",
    "gift",
  ]) {
    assert.deepEqual(updated[key], originalGuest[key], `Field ${key} must not change`);
  }
});

await check("readIplanBuffer reads binary .xls / .xlsx buffers via SheetJS", async () => {
  const mod = await import("xlsx");
  const XLSX = mod.default || mod;
  const ws = XLSX.utils.aoa_to_sheet([
    ["", "", "שיוך", "", "פרטי התקשרות"],
    ["הזמנה לכבוד", "מס' אורחים שהוזמנו", "צד", "קבוצה", "סלולרי", "אישרו שיגיעו", "מתלבטים"],
    ["אורח בדיקה", "2", "חתן", "חברים", "050-8887777", "2", ""],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "הזמנות");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "biff8" });

  const rows = await readIplanBuffer(buf, "export.xls");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "אורח בדיקה");
  assert.equal(rows[0].rsvp, "confirmed");
  assert.equal(rows[0].attendingCount, 2);
});

await check("formatRsvpLabel formats Hebrew status labels with count", () => {
  assert.equal(formatRsvpLabel("confirmed", 3, 4), "אישרו הגעה (3)");
  assert.equal(formatRsvpLabel("declined", 0, 2), "לא מגיעים");
  assert.equal(formatRsvpLabel("pending", 0, 2), "ממתין");
  assert.equal(normalizeIplanRow({ name: "בדיקה", phone: "0501234567", confirmed: "1" }).rsvp, "confirmed");
});

console.log(`\niPlan checks: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

