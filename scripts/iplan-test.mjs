import assert from "node:assert/strict";
import {
  phoneKey,
  phoneKeys,
  parseIplanSheetRows,
  normalizeIplanRow,
  mergeIplanRows,
  buildIplanManagedRsvpMap,
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
  assert.equal(rows[2].rsvp, "maybe");
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
  assert.equal(u3.toRsvp, "maybe");
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

await check("phoneKeys and reconcileIplan match multi-phone guest records like שי ושקד אלעזרי (050-6970046 / 054-5666710)", () => {
  assert.deepEqual(phoneKeys("050-6970046 / 054-5666710"), ["506970046", "545666710"]);
  const guests = [
    {
      id: 222,
      name: "שי ושקד אלעזרי",
      phone: "050-6970046 / 054-5666710",
      seats: 2,
      category: "צד חתן - משפחה צד אמא",
      rsvp: "pending",
    },
    {
      id: 68,
      name: "אתי וקובי נעים",
      phone: "053-53338930",
      seats: 1,
      category: "צד חתן",
      rsvp: "pending",
    },
    {
      id: 29,
      name: "אורטל אלעזר(הבת של עופרה)",
      phone: "",
      seats: 1,
      category: "צד חתן",
      rsvp: "pending",
    },
  ];
  const rows = [
    { name: "שי ושקד אלעזרי", phone: "050-697-0046", invited: 2, confirmed: "2" },
    { name: "אתי וקובי נעים", phone: "053-533-8930", invited: 1, confirmed: "1" },
    { name: "אורטל אלעזר", phone: "", invited: 1, confirmed: "1" },
  ];

  const result = reconcileIplan({ guests, rows });
  assert.equal(result.updates.length, 3);
  const shay = result.updates.find((u) => u.guestId === 222);
  assert.ok(shay);
  assert.equal(shay.toRsvp, "confirmed");
  assert.equal(shay.toAttendingCount, 2);
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
  assert.equal(formatRsvpLabel("maybe", 0, 2), "מתלבטים");
  assert.equal(formatRsvpLabel("declined", 0, 2), "לא מגיעים");
  assert.equal(formatRsvpLabel("pending", 0, 2), "ממתין");
  assert.equal(normalizeIplanRow({ name: "בדיקה", phone: "0501234567", confirmed: "1" }).rsvp, "confirmed");
});

await check("reconcileIplan detects transition from pending ('ממתין') to maybe ('מתלבטים') and applyIplanUpdates applies it", () => {
  const guests = [
    { id: 88, name: "אופיר ושרון", phone: "050-4445566", seats: 2, rsvp: "pending", attendingCount: null },
  ];
  // גם כאשר בייצוא מופיע 0 ב"אישרו שיגיעו" ו-2 ב"מתלבטים", וגם כאשר מגיע מהתוסף כ-rsvp="maybe"
  const rows = [
    { name: "אופיר ושרון", phone: "050-444-5566", invited: 2, confirmed: "0", considering: "2" },
  ];

  const result = reconcileIplan({ guests, rows });
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].guestId, 88);
  assert.equal(result.updates[0].fromRsvp, "pending");
  assert.equal(result.updates[0].toRsvp, "maybe");
  assert.equal(result.updates[0].toAttendingCount, 0);

  const { nextGuests, changes } = applyIplanUpdates(guests, result.updates);
  assert.equal(changes.length, 1);
  assert.equal(nextGuests[0].rsvp, "maybe");
  assert.equal(nextGuests[0].attendingCount, 0);
});

await check("iplan-extension content-iplan.js enforces passive DOM scraping on edits, 3-min export cooldown, and context guard", async () => {
  const fs = await import("node:fs");
  const contentScript = fs.readFileSync(new URL("../iplan-extension/content-iplan.js", import.meta.url), "utf8");
  assert.ok(contentScript.includes("EXPORT_FETCH_COOLDOWN_MS = 180_000"), "Must enforce 3-min export cooldown");
  assert.ok(contentScript.includes("function isContextValid()"), "Must guard against invalidated extension context");
  assert.ok(contentScript.includes("window.__wpIplanCleanup = cleanup"), "Must clean up previous content-script instances");
  assert.ok(
    contentScript.includes('runSync({ includeExport: false, forceExport: false, source: "iplan-dom-change" })'),
    "DOM change events must trigger passive DOM sync without network export"
  );
  assert.ok(
    contentScript.includes("function isSearchFilterActiveOnPage()"),
    "Must detect active search filter to avoid unnecessary export.xls requests"
  );
});

await check("mergeIplanRows merges a partial 95-row filtered extension sync into a full 538-row cloud snapshot so all 7 updates are preserved", () => {
  const guests = [
    { id: 1, name: "אופיר קוזי", phone: "052-558-5956", seats: 1, rsvp: "pending" },
    { id: 2, name: "שיי-לי מדמוני", phone: "052-538-1648", seats: 1, rsvp: "pending" },
    { id: 3, name: "מור דוידי", phone: "050-216-9499", seats: 1, rsvp: "pending" },
    { id: 4, name: "שי ושקד אלעזרי", phone: "050-6970046 / 054-5666710", seats: 2, rsvp: "pending" },
    { id: 5, name: "נריה ושילת בחור", phone: "", seats: 2, rsvp: "pending" },
    { id: 6, name: "אתי וקובי נעים", phone: "053-53338930", seats: 1, rsvp: "pending" },
    { id: 7, name: "אורטל אלעזר(הבת של עופרה)", phone: "", seats: 1, rsvp: "pending" },
    { id: 8, name: "מנשה בן ברוך", phone: "", seats: 1, rsvp: "pending" },
  ];

  // תמונת מצב מלאה בענן (עם כל המוזמנים ו-7 עדכונים):
  const fullCloudRows = [
    { name: "אופיר קוזי", phone: "052-558-5956", invited: 1, rsvp: "confirmed", attendingCount: 1, hasResponse: true, rawStatus: "confirmed" },
    { name: "שיי-לי מדמוני", phone: "052-538-1648", invited: 1, rsvp: "declined", attendingCount: 0, hasResponse: true, rawStatus: "declined" },
    { name: "מור דוידי", phone: "050-216-9499", invited: 1, rsvp: "maybe", attendingCount: 0, hasResponse: true, rawStatus: "considering" },
    { name: "שי ושקד אלעזרי", phone: "050-697-0046", invited: 2, rsvp: "confirmed", attendingCount: 2, hasResponse: true, rawStatus: "confirmed" },
    { name: "נריה ושילת בחור", phone: "052-279-8717", invited: 2, rsvp: "confirmed", attendingCount: 2, hasResponse: true, rawStatus: "confirmed" },
    { name: "אתי וקובי נעים", phone: "053-533-8930", invited: 1, rsvp: "confirmed", attendingCount: 1, hasResponse: true, rawStatus: "confirmed" },
    { name: "אורטל אלעזר", phone: "", invited: 1, rsvp: "confirmed", attendingCount: 1, hasResponse: true, rawStatus: "confirmed" },
    { name: "מנשה בן ברוך", phone: "", invited: 1, rsvp: "pending", attendingCount: 0, hasResponse: false, rawStatus: "unanswered" },
  ];

  // משיכה חלקית/מסוננת מהתוסף (למשל 95 הזמנות מתוך 538, שמכילה רק 3 מתוך 7 העדכונים):
  const partialExtensionRows = [
    { name: "אופיר קוזי", phone: "052-558-5956", invited: 1, rsvp: "confirmed", attendingCount: 1, hasResponse: true, rawStatus: "confirmed" },
    { name: "שיי-לי מדמוני", phone: "052-538-1648", invited: 1, rsvp: "declined", attendingCount: 0, hasResponse: true, rawStatus: "declined" },
    { name: "מור דוידי", phone: "050-216-9499", invited: 1, rsvp: "maybe", attendingCount: 0, hasResponse: true, rawStatus: "considering" },
  ];

  // ללא מיזוג, המשיכה החלקית הייתה מציגה רק 3 עדכונים:
  assert.equal(reconcileIplan({ guests, rows: partialExtensionRows }).updates.length, 3);

  // עם mergeIplanRows (בשני הכיוונים: ענן כבסיס ותוסף כעדכון, או להפך), כל 8 השורות וכל 7 העדכונים נשמרים במלואם!
  const merged = mergeIplanRows(fullCloudRows, partialExtensionRows);
  assert.equal(merged.length, 8);
  const reconciled = reconcileIplan({ guests, rows: merged });
  assert.equal(reconciled.updates.length, 7);
});

await check("Reset in iPlan (answered -> unanswered) returns an iPlan-sourced guest to 'pending', but protects manual local statuses", () => {
  const guests = [
    // הסטטוס הגיע מ-iPlan (מופיע ביומן הפעילות) ואז אופס ב-iPlan
    { id: 1, name: "דנה כהן", phone: "050-1111111", seats: 2, rsvp: "confirmed", attendingCount: 2 },
    // אופס ב-iPlan מ"מתלבטים"
    { id: 2, name: "יוסי לוי", phone: "050-2222222", seats: 1, rsvp: "maybe", attendingCount: 0 },
    // סטטוס שהוזן ידנית אצלנו (לא דרך iPlan) — מוגן
    { id: 3, name: "רונית אברהם", phone: "050-3333333", seats: 1, rsvp: "confirmed", attendingCount: 1 },
    // הגיע מ-iPlan כ"אישרו", אבל אחר כך שונה אצלנו ידנית ל"לא מגיעים" — מוגן
    { id: 4, name: "משה דוד", phone: "050-4444444", seats: 1, rsvp: "declined", attendingCount: 0 },
  ];
  const activity = [
    { at: "2026-10-20T10:00:00Z", changes: [{ guestId: 1, toRsvp: "confirmed" }, { guestId: 4, toRsvp: "confirmed" }] },
    { at: "2026-10-21T10:00:00Z", changes: [{ guestId: 2, toRsvp: "maybe" }] },
  ];
  const unanswered = (name, phone) => ({
    name, phone, invited: 1, rsvp: "pending", attendingCount: 0, hasResponse: false, rawStatus: "unanswered",
  });
  const rows = [
    unanswered("דנה כהן", "050-1111111"),
    unanswered("יוסי לוי", "050-2222222"),
    unanswered("רונית אברהם", "050-3333333"),
    unanswered("משה דוד", "050-4444444"),
  ];

  const managed = buildIplanManagedRsvpMap(activity);
  const result = reconcileIplan({ guests, rows, iplanManagedRsvp: managed });
  assert.deepEqual(result.updates.map((u) => u.guestId).sort(), [1, 2]);
  for (const u of result.updates) {
    assert.equal(u.toRsvp, "pending");
    assert.equal(u.toAttendingCount, 0);
    assert.equal(u.isReset, true);
  }
  assert.deepEqual(result.unansweredLocals.map((u) => u.guestId).sort(), [3, 4]);

  // החלת האיפוס מחזירה ל"ממתין" ומעדכנת רק rsvp + attendingCount
  const { nextGuests, changes } = applyIplanUpdates(guests, result.updates);
  assert.equal(changes.length, 2);
  assert.equal(nextGuests[0].rsvp, "pending");
  assert.equal(nextGuests[0].attendingCount, 0);
  assert.equal(nextGuests[0].name, "דנה כהן");
  assert.equal(nextGuests[2].rsvp, "confirmed");
});

await check("mergeIplanRows lets a newer unanswered row override an older answered row (so iPlan resets propagate)", () => {
  const older = [{ name: "דנה כהן", phone: "050-1111111", invited: 2, rsvp: "confirmed", attendingCount: 2, hasResponse: true, rawStatus: "confirmed" }];
  const newer = [{ name: "דנה כהן", phone: "050-1111111", invited: 2, rsvp: "pending", attendingCount: 0, hasResponse: false, rawStatus: "unanswered" }];
  const merged = mergeIplanRows(older, newer);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].rsvp, "pending");
  assert.equal(merged[0].hasResponse, false);
});

console.log(`\niPlan checks: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

