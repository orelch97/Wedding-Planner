/* =========================================================================
 *  import-test.mjs — בדיקות לייבוא מוזמנים מקובץ Excel / CSV
 * -------------------------------------------------------------------------
 *  הרצה:  npm run test:import
 *
 *  הבדיקה בונה קובץ .xlsx אמיתי בעזרת ExcelJS, קוראת אותו חזרה דרך אותו
 *  קוד שרץ בדפדפן, ומוודאת שכל שדה בכל שורה הגיע ליעדו. בנוסף נבדקים
 *  מקרי הקצה שנשברו בפועל: קידוד windows-1255, פסיק בתוך מרכאות, טלפון
 *  שאיבד אפס מוביל, סדר עמודות שונה וקובץ בלי כותרות.
 * ====================================================================== */

import ExcelJS from "exceljs";
import {
  parseDelimited,
  rowsToGuests,
  normalizePhone,
  decodeText,
  readGuestRows,
  ImportError,
} from "../src/lib/guestImport.js";

let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log("  \u2714 " + name);
  } else {
    failed++;
    console.log("  \u2716 " + name + (detail ? "  \u2192 " + detail : ""));
  }
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  check(name, a === b, `${a} \u2260 ${b}`);
}

function section(title) {
  console.log("\n" + title);
}

/* -------------------------------------------------------------- fixtures */

const HEADERS = [
  "שם",
  "נייד",
  "קטגוריה",
  "אזכור",
  "כיסאות",
  "מקור",
  "גלאט",
  "כנראה יבוא",
  "לשקול",
  "אישור הגעה",
  "כמה אישרו",
  "מתנה",
];

//  רשימת מוזמנים שמכסה את כל הצירופים שמשתמש אמיתי מייצר.
const ROWS = [
  //  שם, טלפון עם מקפים, קטגוריה חדשה, אזכור, כיסאות, מקור, גלאט, כנראה, לשקול, סטטוס, אישרו, מתנה
  ["ישראל ישראלי", "050-1234567", "משפחת החתן", "דוד של אבא", 2, "צד חתן", "כן", "", "", "אישרו הגעה", 2, 500],
  ["דנה כהן", "0527654321", "חברות של הכלה", "", 4, "צד כלה", "", "V", "", "ממתין", "", 0],
  ["משפחת לוי", 501112233, "משפחת הכלה", "שכנים", 3, "צד כלה", "", "", "V", "לא מגיעים", "", 0],
  ["אבי מזרחי", "03-9876543", "חברים מהצבא", "", 1, "צד חתן", "כן", "", "", "אישרו הגעה", 1, 300],
  ["רות ואורי", "+972 54 111 2222", "משפחת החתן", "בני דודים", 2, "צד חתן", "", "", "", "אישרו הגעה", 5, 0],
];

/* ------------------------------------------------------------ unit tests */

section("1. נרמול טלפון");
eq("מספר עם מקפים נשמר כפי שהוא", normalizePhone("050-1234567"), "050-1234567");
eq("אפס מוביל שנמחק ב-Excel משוחזר", normalizePhone("501234567"), "0501234567");
eq("קווי בן 8 ספרות משוחזר", normalizePhone("39876543"), "039876543");
eq("מספר עם אפס מוביל לא משתנה", normalizePhone("0527654321"), "0527654321");
eq("מספר בינלאומי נשמר", normalizePhone("+972541112222"), "+972541112222");
eq("ערך ריק מחזיר מחרוזת ריקה", normalizePhone(null), "");
eq("מספר שאינו טלפון לא נגוע", normalizePhone("123"), "123");

section("2. פירוק CSV");
{
  const csv = 'שם,נייד,אזכור\n"כהן, ישראל",050-1234567,"אמר ""אולי"""\nדנה,0521111111,';
  const rows = parseDelimited(csv);
  eq("פסיק בתוך מרכאות לא שובר עמודה", rows[1], ["כהן, ישראל", "050-1234567", 'אמר "אולי"']);
  eq("שורה שנייה נקראה", rows[2], ["דנה", "0521111111", ""]);
  eq("שורות ריקות מסוננות", parseDelimited("a,b\n\n\nc,d").length, 2);
}
{
  const tsv = "שם\tנייד\nדנה\t0521111111";
  eq("קובץ מופרד בטאב מזוהה", parseDelimited(tsv)[1], ["דנה", "0521111111"]);
}
{
  const semi = "שם;נייד\nדנה;0521111111";
  eq("קובץ מופרד בנקודה-פסיק מזוהה", parseDelimited(semi)[1], ["דנה", "0521111111"]);
}

section("3. קידוד");
{
  const utf8 = new TextEncoder().encode("\uFEFFשם,נייד\nדנה,0521111111");
  check("UTF-8 עם BOM מפוענח בלי הסימן", decodeText(utf8.buffer).startsWith("שם"));

  //  windows-1255: אותיות עבריות במיפוי 0xE0 ומעלה.
  const win1255 = new Uint8Array([0xf9, 0xed, 0x2c, 0xe3, 0xf0, 0xe4]); // "שם,דנה"
  eq("windows-1255 מפוענח לעברית", decodeText(win1255.buffer), "שם,דנה");

  const utf16 = new Uint8Array([0xff, 0xfe, 0xe9, 0x05, 0xdd, 0x05]); // BOM + "שם"
  eq("UTF-16LE מפוענח", decodeText(utf16.buffer), "שם");
}

section("4. המרה לרשומות – עמודות לפי כותרת");
{
  const rows = [HEADERS, ...ROWS.map((r) => r.map(String))];
  const { guests, newCategories, skipped } = rowsToGuests(rows, { categories: [] });
  eq("כל השורות יובאו", guests.length, 5);
  eq("לא דולגו שורות", skipped, 0);
  eq("קטגוריות חדשות נאספו", newCategories, [
    "משפחת החתן",
    "חברות של הכלה",
    "משפחת הכלה",
    "חברים מהצבא",
  ]);

  const g = guests[0];
  eq("שם", g.name, "ישראל ישראלי");
  eq("טלפון", g.phone, "050-1234567");
  eq("קטגוריה", g.category, "משפחת החתן");
  eq("אזכור", g.mention, "דוד של אבא");
  eq("כיסאות", g.seats, 2);
  eq("מקור", g.source, "צד חתן");
  eq("גלאט", g.glatt, true);
  eq("אישור הגעה", g.rsvp, "confirmed");
  eq("כמה אישרו", g.attendingCount, 2);
  eq("מתנה", g.gift, 500);

  eq('"כנראה יבוא" מסומן', guests[1].probablyComing, true);
  eq("ממתין נשאר ממתין", guests[1].rsvp, "pending");
  eq("ממתין לא סופר מאושרים", guests[1].attendingCount, 0);
  eq('"לשקול" מסומן', guests[2].considering, true);
  eq("לא מגיעים", guests[2].rsvp, "declined");
  eq("טלפון מספרי משוחזר", guests[2].phone, "0501112233");
  eq("מספר מאושרים לא עולה על הכיסאות", guests[4].attendingCount, 2);
}

section("5. סדר עמודות שונה וכותרות חלופיות");
{
  const rows = [
    ["טלפון", "שם מלא", "הערות", "מספר אנשים", "סטטוס"],
    ["0521234567", "נועה בר", "חברה מהעבודה", "3", "אישרה הגעה"],
  ];
  const { guests } = rowsToGuests(rows, { categories: [] });
  eq("שם זוהה בעמודה שנייה", guests[0].name, "נועה בר");
  eq("טלפון זוהה בעמודה ראשונה", guests[0].phone, "0521234567");
  eq("הערות מופו לאזכור", guests[0].mention, "חברה מהעבודה");
  eq("מספר אנשים מופה לכיסאות", guests[0].seats, 3);
  eq("סטטוס מופה לאישור הגעה", guests[0].rsvp, "confirmed");
  eq("בלי עמודת מאושרים – מניחים את כל הכיסאות", guests[0].attendingCount, 3);
}

section("6. קובץ בלי שורת כותרת");
{
  const rows = [["יוסי לוי", "0501234567", "חברים", "", "2"]];
  const { guests, hasHeader } = rowsToGuests(rows, { categories: [] });
  eq("לא זוהתה כותרת", hasHeader, false);
  eq("השורה הראשונה היא מוזמן", guests[0].name, "יוסי לוי");
  eq("סדר קנוני נשמר", guests[0].category, "חברים");
}

section("7. שורות פסולות");
{
  const rows = [
    HEADERS,
    ["", "", "", "", "", "", "", "", "", "", "", ""],
    ["סה״כ", "", "", "", "", "", "", "", "", "", "", ""],
    ["", "0501234567", "", "", "", "", "", "", "", "", "", ""],
  ];
  const { guests, skipped } = rowsToGuests(rows, { categories: [] });
  eq("שורה ריקה לגמרי לא נספרת", skipped, 0);
  eq("שורת סיכום נכנסת כשם (אין דרך להבדיל)", guests.length, 2);
  eq("רשומה עם טלפון בלבד מקבלת שם זמני", guests[1].name.startsWith("אורח"), true);
}

section("8. קטגוריות קיימות");
{
  const rows = [HEADERS, ...ROWS.map((r) => r.map(String))];
  const { newCategories } = rowsToGuests(rows, {
    categories: ["משפחת החתן", "משפחת הכלה"],
  });
  eq("קטגוריה שכבר קיימת לא נוספת שוב", newCategories, [
    "חברות של הכלה",
    "חברים מהצבא",
  ]);
}

/* --------------------------------------------------- end-to-end via .xlsx */

async function buildWorkbook(rows, { sheetName = "מוזמנים", extraSheet = false } = {}) {
  const wb = new ExcelJS.Workbook();
  if (extraSheet) {
    const other = wb.addWorksheet("ספקים");
    other.addRow(["שם הספק", "סוג"]);
    other.addRow(["אולם השרון", "אולם"]);
  }
  const ws = wb.addWorksheet(sheetName);
  for (const r of rows) ws.addRow(r);
  const buffer = await wb.xlsx.writeBuffer();
  return new File([buffer], "מוזמנים.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

section("9. קובץ Excel אמיתי (.xlsx)");
{
  const file = await buildWorkbook([HEADERS, ...ROWS], { extraSheet: true });
  const rows = await readGuestRows(file);
  eq("נבחר גיליון המוזמנים ולא גיליון הספקים", rows[0][0], "שם");
  eq("כל השורות נקראו", rows.length, 6);

  const { guests } = rowsToGuests(rows, { categories: [] });
  eq("כל הרשומות יובאו", guests.length, 5);
  eq("שם מהקובץ", guests[0].name, "ישראל ישראלי");
  eq("טלפון עם מקפים נשמר כטקסט", guests[0].phone, "050-1234567");
  eq("טלפון שנשמר כמספר קיבל אפס מוביל", guests[2].phone, "0501112233");
  eq("כיסאות מספריים", guests[0].seats, 2);
  eq("מתנה מספרית", guests[0].gift, 500);
  eq("גלאט", guests[3].glatt, true);
  eq("קווי עם מקף", guests[3].phone, "03-9876543");
  eq("סטטוס", guests[3].rsvp, "confirmed");
  eq("אזכור עברי", guests[4].mention, "בני דודים");

  //  אין שדה שנשאר ריק בלי סיבה
  const missing = [];
  for (const g of guests) {
    for (const key of ["name", "phone", "category", "seats", "source", "rsvp"]) {
      if (g[key] === "" || g[key] == null) missing.push(`${g.name}.${key}`);
    }
  }
  eq("אין שדות חובה ריקים", missing, []);
}

section("10. Excel עם ערכים מיוחדים");
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("מוזמנים");
  ws.addRow(HEADERS);
  const row = ws.addRow(["", "", "", "", "", "", "", "", "", "", "", ""]);
  row.getCell(1).value = { richText: [{ text: "שרה " }, { text: "כהן" }] };
  row.getCell(2).value = { text: "0501234567", hyperlink: "tel:0501234567" };
  row.getCell(3).value = "משפחה";
  row.getCell(5).value = { formula: "1+1", result: 2 };
  row.getCell(10).value = "אישרו הגעה";
  row.getCell(12).value = { error: "#N/A" };
  const file = new File([await wb.xlsx.writeBuffer()], "special.xlsx");

  const { guests } = rowsToGuests(await readGuestRows(file), { categories: [] });
  eq("טקסט מעוצב (richText) נקרא", guests[0].name, "שרה כהן");
  eq("תא עם קישור טלפון נקרא", guests[0].phone, "0501234567");
  eq("תוצאת נוסחה נקראת", guests[0].seats, 2);
  eq("תא שגיאה לא מפיל את הייבוא", guests[0].gift, 0);
}

section("11. הודעות שגיאה");
{
  let msg = "";
  try {
    await readGuestRows(new File([new Uint8Array([1, 2, 3])], "old.xls"));
  } catch (e) {
    msg = e instanceof ImportError ? e.message : "wrong type";
  }
  check("קובץ .xls מקבל הסבר ברור", msg.includes(".xlsx"), msg);

  let big = "";
  try {
    const blob = new Blob([new Uint8Array(9 * 1024 * 1024)]);
    await readGuestRows(new File([blob], "big.csv"));
  } catch (e) {
    big = e.message;
  }
  check("קובץ ענק נחסם", big.includes("8MB"), big);
}

section("12. הלוך-חזור: ייצוא ואז ייבוא");
{
  //  כותרות גיליון המוזמנים של הייצוא, כולל עמודות שהייבוא לא מכיר.
  const exportHeaders = [
    "מס׳", "שם", "נייד", "קטגוריה", "מקור", "כיסאות", "אישור הגעה",
    "כמה אישרו", "כנראה יבוא", "לשקול", "גלאט", "מתנה", "שולחן", "אזכור",
  ];
  const file = await buildWorkbook([
    exportHeaders,
    [1, "ישראל ישראלי", "050-1234567", "משפחה", "צד חתן", 2, "אישרו הגעה", 2, "לא", "לא", "כן", 500, "שולחן 1", "דוד של אבא"],
  ]);
  const { guests } = rowsToGuests(await readGuestRows(file), { categories: [] });
  const g = guests[0];
  eq('עמודת "מס׳" לא נחשבה לשם', g.name, "ישראל ישראלי");
  eq("טלפון", g.phone, "050-1234567");
  eq("קטגוריה", g.category, "משפחה");
  eq("מקור", g.source, "צד חתן");
  eq("כיסאות", g.seats, 2);
  eq("אישור הגעה", g.rsvp, "confirmed");
  eq("כמה אישרו", g.attendingCount, 2);
  eq('"לא" אינו סימון חיובי', g.probablyComing, false);
  eq("גלאט", g.glatt, true);
  eq("מתנה", g.gift, 500);
  eq("אזכור מהעמודה האחרונה", g.mention, "דוד של אבא");
}

console.log(`\n${passed} עברו, ${failed} נכשלו`);
process.exit(failed ? 1 : 0);
