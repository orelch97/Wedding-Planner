// =============================================================================
//  scripts/excel-test.mjs — אימות מקיף של הייצוא לאקסל.
// -----------------------------------------------------------------------------
//  הרצה:  npm run test:excel
//
//  הבדיקה בונה חוברת אמיתית מנתוני הדגמה, כותבת אותה לזיכרון וקוראת אותה
//  בחזרה עם ExcelJS. כל ערך נבדק מול נתוני המקור ולא מול הפלט של
//  `buildSheets`, אחרת הבדיקה הייתה טאוטולוגית.
// =============================================================================

import ExcelJS from "exceljs";
import { buildSheets, buildWorkbookBuffer, workbookFileName } from "../src/lib/excelExport.js";
import { SEED_GUESTS } from "../src/data/guestsData.js";
import { SEED_TABLES, SEED_VENDORS, SEED_BUDGET } from "../src/data/seedData.js";

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `  — ${detail}` : ""}`);
  }
}

const cell = (v) => {
  if (v == null) return "";
  //  ExcelJS מחזיר לפעמים אובייקט עשיר (נוסחה / טקסט מעוצב).
  if (typeof v === "object" && "result" in v) return v.result ?? "";
  if (typeof v === "object" && "richText" in v)
    return v.richText.map((t) => t.text).join("");
  return v;
};
const str = (v) => String(cell(v));

const RSVP_LABELS = { confirmed: "אישרו הגעה", pending: "ממתין", declined: "לא מגיעים" };
const TASK_LABELS = { todo: "לביצוע", inprogress: "בתהליך", done: "הושלם" };
const yesNo = (v) => (v ? "כן" : "לא");

/*  שיבוץ אמיתי: נתוני הדגמה מגיעים עם שולחנות ריקים, ולכן משבצים כאן
    מוזמנים ידנית — אחרת גיליון ההושבה נבדק רק במסלול הריק.  */
const seatedA = SEED_GUESTS.slice(0, 5).map((g) => g.id);
const seatedB = SEED_GUESTS.slice(5, 9).map((g) => g.id);
const tables = [
  { ...SEED_TABLES[0], guestIds: seatedA },
  { ...SEED_TABLES[1], guestIds: seatedB },
  { id: 99, name: "שולחן ריק", type: "standard", guestIds: [] },
];

const data = {
  guests: SEED_GUESTS,
  tables,
  vendors: SEED_VENDORS,
  budget: SEED_BUDGET,
  budgetGoal: 170000,
};

const tableOfGuest = new Map();
for (const t of tables) for (const gid of t.guestIds) if (!tableOfGuest.has(gid)) tableOfGuest.set(gid, t);

const seatsOf = (g) => Math.max(1, Math.round(Number(g.seats) || 0) || 1);
const capacityOf = (t) => (t.type === "knight" ? 24 : 12);

console.log("\n🔎 בדיקת הייצוא לאקסל\n");

/* ---------------------------------------------------------------- 1. מבנה */
console.log("1. מבנה החוברת");
const sheets = buildSheets(data);
check(
  "חמישה גיליונות בשמות הנכונים",
  JSON.stringify(sheets.map((s) => s.name)) ===
    JSON.stringify(["מוזמנים", "ספקים", "סדר הושבה", "ניהול תקציב", "צ׳קליסט"]),
  sheets.map((s) => s.name).join(", ")
);
check("אין גיליון פורטל ספקים", !sheets.some((s) => s.name.includes("פורטל")));
check(
  "לכל עמודה יש כותרת ומפתח ייחודיים",
  sheets.every((s) => {
    const keys = s.columns.map((c) => c.key);
    const heads = s.columns.map((c) => c.header);
    return (
      new Set(keys).size === keys.length &&
      new Set(heads).size === heads.length &&
      heads.every(Boolean)
    );
  })
);
check("קלט ריק לא מפיל את הבנייה", buildSheets({}).length === 5);
check(
  "שם הקובץ מנקה תווים אסורים",
  workbookFileName('א/ב:ג*ד?ה"ו<ז>ח|ט').startsWith("אבגדהוזחט - "),
  workbookFileName('א/ב:ג*ד?ה"ו<ז>ח|ט')
);

/* --------------------------------------------------- 2. כתיבה וקריאה חוזרת */
console.log("\n2. כתיבה וקריאה חוזרת של הקובץ");
const buffer = await buildWorkbookBuffer(data);
check("נוצר קובץ לא ריק", buffer.byteLength > 5000, `${buffer.byteLength} bytes`);

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buffer);
check("הקובץ נפתח מחדש עם 5 גיליונות", wb.worksheets.length === 5);
check(
  "כל הגיליונות מוגדרים מימין לשמאל",
  wb.worksheets.every((ws) => ws.views?.[0]?.rightToLeft === true)
);

const readSheet = (name) => {
  const ws = wb.getWorksheet(name);
  const headers = ws.getRow(1).values.slice(1).map(str);
  const rows = [];
  for (let i = 2; i <= ws.rowCount; i++) {
    const values = ws.getRow(i).values;
    const obj = {};
    headers.forEach((h, j) => (obj[h] = cell(values[j + 1])));
    rows.push(obj);
  }
  return { ws, headers, rows };
};

/* ------------------------------------------------------- 3. גיליון מוזמנים */
console.log("\n3. גיליון \u201eמוזמנים\u201d");
const G = readSheet("מוזמנים");
const guestHeaders = [
  "מס׳", "שם", "נייד", "קטגוריה", "כיסאות", "אישור הגעה",
  "כמה אישרו", "כנראה יבוא", "לשקול", "גלאט", "שותים", "מתנה", "שולחן", "אזכור",
];
check("כל 14 העמודות קיימות ובסדר הנכון", JSON.stringify(G.headers) === JSON.stringify(guestHeaders), G.headers.join(" | "));
check(`כל ${SEED_GUESTS.length} המוזמנים יורדו`, G.rows.length === SEED_GUESTS.length, `${G.rows.length}`);

const byId = new Map(G.rows.map((r) => [Number(r["מס׳"]), r]));
const mismatches = [];
for (const g of SEED_GUESTS) {
  const r = byId.get(g.id);
  if (!r) { mismatches.push(`${g.id}: חסר`); continue; }
  const seats = seatsOf(g);
  const expected = {
    "שם": g.name ?? "",
    "נייד": g.phone ?? "",
    "קטגוריה": g.category ?? "",
    "כיסאות": seats,
    "אישור הגעה": RSVP_LABELS[g.rsvp] || RSVP_LABELS.pending,
    "כמה אישרו": g.attendingCount != null ? Math.min(Math.round(g.attendingCount), seats) : seats,
    "כנראה יבוא": yesNo(g.probablyComing),
    "לשקול": yesNo(g.considering),
    "גלאט": yesNo(g.glatt),
    "שותים": Math.min(seats, Math.round(Number(g.drinkers) || 0)),
    "מתנה": Math.round(Number(g.gift) || 0),
    "שולחן": tableOfGuest.get(g.id)?.name || "ללא שיבוץ",
    "אזכור": g.mention ?? "",
  };
  for (const [k, v] of Object.entries(expected)) {
    if (str(r[k]) !== String(v)) mismatches.push(`${g.id}/${k}: "${str(r[k])}" ≠ "${v}"`);
  }
}
check("כל שדה של כל מוזמן זהה למקור", mismatches.length === 0, mismatches.slice(0, 4).join(" ; "));
check(
  "מוזמנים משובצים מקבלים את שם השולחן",
  seatedA.every((id) => str(byId.get(id)["שולחן"]) === tables[0].name)
);
check(
  "סכום המתנות בגיליון שווה לסכום במערכת",
  G.rows.reduce((s, r) => s + (Number(cell(r["מתנה"])) || 0), 0) ===
    SEED_GUESTS.reduce((s, g) => s + (Number(g.gift) || 0), 0)
);
check(
  "ערכים בוליאניים מתורגמים לכן/לא בלבד",
  G.rows.every((r) => ["כן", "לא"].includes(str(r["גלאט"])) && ["כן", "לא"].includes(str(r["כנראה יבוא"])))
);
check(
  "כל סטטוס אישור הוא אחד משלושת התרגומים",
  G.rows.every((r) => Object.values(RSVP_LABELS).includes(str(r["אישור הגעה"])))
);

/* --------------------------------------------------------- 4. גיליון ספקים */
console.log("\n4. גיליון \u201eספקים\u201d");
const V = readSheet("ספקים");
const vendorHeaders = [
  "מס׳", "שם הספק", "סוג", "טלפון", "אימייל", "עלות בחוזה", "מקדמה ששולמה",
  "יתרה לתשלום", "משימות שהושלמו", "סה״כ משימות", "פירוט המשימות", "הערות",
];
check("כל 12 העמודות קיימות ובסדר הנכון", JSON.stringify(V.headers) === JSON.stringify(vendorHeaders), V.headers.join(" | "));
check(`כל ${SEED_VENDORS.length} הספקים יורדו`, V.rows.length === SEED_VENDORS.length, `${V.rows.length}`);

const vMismatch = [];
for (const v of SEED_VENDORS) {
  const r = V.rows.find((x) => Number(x["מס׳"]) === v.id);
  if (!r) { vMismatch.push(`${v.id}: חסר`); continue; }
  const expected = {
    "שם הספק": v.name,
    "סוג": v.type,
    "טלפון": v.phone,
    "אימייל": v.email,
    "עלות בחוזה": v.contractCost,
    "מקדמה ששולמה": v.deposit,
    "יתרה לתשלום": v.contractCost - v.deposit,
    "משימות שהושלמו": v.tasks.filter((t) => t.status === "done").length,
    "סה״כ משימות": v.tasks.length,
    "הערות": v.notes ?? "",
  };
  for (const [k, val] of Object.entries(expected)) {
    if (str(r[k]) !== String(val)) vMismatch.push(`${v.name}/${k}: "${str(r[k])}" ≠ "${val}"`);
  }
  for (const t of v.tasks) {
    const line = `[${TASK_LABELS[t.status]}] ${t.title}`;
    if (!str(r["פירוט המשימות"]).includes(line)) vMismatch.push(`${v.name}: חסרה המשימה "${t.title}"`);
  }
}
check("כל שדה של כל ספק זהה למקור (כולל כל המשימות)", vMismatch.length === 0, vMismatch.slice(0, 4).join(" ; "));
check("אין עמודת קבצים מצורפים", !V.headers.some((h) => /קבצ|קובץ|file/i.test(h)));

/* ---------------------------------------------------- 5. גיליון סדר הושבה */
console.log("\n5. גיליון \u201eסדר הושבה\u201d");
const S = readSheet("סדר הושבה");
const seatingHeaders = [
  "מס׳ שולחן", "שם השולחן", "סוג השולחן", "קיבולת", "מקומות בשימוש",
  "מקומות פנויים", "שם המוזמן", "נייד", "קטגוריה", "כיסאות", "אישור הגעה",
];
check("כל 11 העמודות קיימות ובסדר הנכון", JSON.stringify(S.headers) === JSON.stringify(seatingHeaders), S.headers.join(" | "));

const expectedSeatingRows =
  tables.reduce((s, t) => s + Math.max(1, t.guestIds.length), 0) +
  (SEED_GUESTS.length - tableOfGuest.size);
check("מספר השורות מכסה שולחנות, משובצים ולא-משובצים", S.rows.length === expectedSeatingRows, `${S.rows.length} ≠ ${expectedSeatingRows}`);

const knightRows = S.rows.filter((r) => str(r["שם השולחן"]) === tables[0].name);
check("שולחן האבירים מופיע עם שורה לכל מוזמן", knightRows.length === seatedA.length);
check("סוג השולחן מתורגם לעברית", knightRows.every((r) => str(r["סוג השולחן"]) === "שולחן אבירים"));
check("קיבולת שולחן אבירים היא 24", knightRows.every((r) => Number(cell(r["קיבולת"])) === capacityOf(tables[0])));

const usedA = seatedA.reduce((s, id) => s + seatsOf(SEED_GUESTS.find((g) => g.id === id)), 0);
check("מקומות בשימוש מחושבים לפי כיסאות המוזמנים", knightRows.every((r) => Number(cell(r["מקומות בשימוש"])) === usedA), `${usedA}`);
check("מקומות פנויים = קיבולת פחות שימוש", knightRows.every((r) => Number(cell(r["מקומות פנויים"])) === capacityOf(tables[0]) - usedA));
check(
  "שמות המוזמנים המשובצים נכונים",
  seatedA.every((id) => knightRows.some((r) => str(r["שם המוזמן"]) === SEED_GUESTS.find((g) => g.id === id).name))
);

const emptyRows = S.rows.filter((r) => str(r["שם השולחן"]) === "שולחן ריק");
check("שולחן ריק מקבל שורה אחת בלי מוזמן", emptyRows.length === 1 && str(emptyRows[0]["שם המוזמן"]) === "");

const unassignedRows = S.rows.filter((r) => str(r["שם השולחן"]) === "ללא שיבוץ");
check(
  "כל מי שלא שובץ מופיע תחת \u201eללא שיבוץ\u201d",
  unassignedRows.length === SEED_GUESTS.length - tableOfGuest.size,
  `${unassignedRows.length}`
);
check("שורות ללא שיבוץ מכילות שם מוזמן", unassignedRows.every((r) => str(r["שם המוזמן"]).length > 0));

/* --------------------------------------------------- 6. גיליון ניהול תקציב */
console.log("\n6. גיליון \u201eניהול תקציב\u201d");
const B = readSheet("ניהול תקציב");
check(
  "כל 7 העמודות קיימות ובסדר הנכון",
  JSON.stringify(B.headers) ===
    JSON.stringify(["מס׳", "סעיף", "הוצאה צפויה", "הוצאה בפועל", "סה״כ שולם", "נותר לשלם", "פער"]),
  B.headers.join(" | ")
);

const bMismatch = [];
SEED_BUDGET.forEach((b, i) => {
  const r = B.rows[i];
  const expected = {
    "מס׳": b.id,
    "סעיף": b.category,
    "הוצאה צפויה": b.expected,
    "הוצאה בפועל": b.actual,
    "סה״כ שולם": b.paid,
    "נותר לשלם": Math.max(0, b.actual - b.paid),
    "פער": b.actual - b.expected,
  };
  for (const [k, v] of Object.entries(expected)) {
    if (str(r?.[k]) !== String(v)) bMismatch.push(`${b.category}/${k}: "${str(r?.[k])}" ≠ "${v}"`);
  }
});
check(`כל ${SEED_BUDGET.length} סעיפי התקציב זהים למקור`, bMismatch.length === 0, bMismatch.slice(0, 4).join(" ; "));
check("סדר הסעיפים נשמר", str(B.rows[0]["סעיף"]) === SEED_BUDGET[0].category);

const expectedTotal = SEED_BUDGET.reduce((s, b) => s + b.expected, 0);
const actualTotal = SEED_BUDGET.reduce((s, b) => s + b.actual, 0);
const paidTotal = SEED_BUDGET.reduce((s, b) => s + b.paid, 0);
const income = SEED_GUESTS.reduce((s, g) => s + (Number(g.gift) || 0), 0);
const summary = new Map(
  B.rows.slice(SEED_BUDGET.length).filter((r) => str(r["סעיף"])).map((r) => [str(r["סעיף"]), Number(cell(r["הוצאה צפויה"]))])
);
check("סכום הסעיפים הצפוי", summary.get("סכום הסעיפים הצפוי") === expectedTotal, `${summary.get("סכום הסעיפים הצפוי")} ≠ ${expectedTotal}`);
check("סה\u05f4כ נדרש לשלם", summary.get("סה״כ נדרש לשלם") === actualTotal, `${summary.get("סה״כ נדרש לשלם")} ≠ ${actualTotal}`);
check("סה\u05f4כ שולם", summary.get("סה״כ שולם") === paidTotal, `${summary.get("סה״כ שולם")} ≠ ${paidTotal}`);
check("נותר לשלם", summary.get("נותר לשלם") === Math.max(0, actualTotal - paidTotal), `${summary.get("נותר לשלם")} ≠ ${actualTotal - paidTotal}`);
check("הכנסות ממתנות זהות לסכום בגיליון המוזמנים", summary.get("הכנסות (מתנות)") === income, `${summary.get("הכנסות (מתנות)")} ≠ ${income}`);
check("מאזן סופי = הכנסות פחות הוצאה בפועל", summary.get("מאזן סופי") === income - actualTotal);
check("יעד התקציב יורד לקובץ", summary.get("יעד התקציב הכולל") === 170000);

/* ------------------------------------------------------------ 7. מקרי קצה */
console.log("\n7. מקרי קצה");
const empty = buildSheets({ guests: [], tables: [], vendors: [], budget: [], budgetGoal: 0 });
check("חתונה ריקה מייצרת גיליונות בלי שורות", empty.every((s) => s.rows.length === 0));
const emptyBuffer = await buildWorkbookBuffer({});
check("חוברת של חתונה ריקה נכתבת בהצלחה", emptyBuffer.byteLength > 1000);

const messy = buildSheets({
  guests: [{ id: 1, name: "בלי שדות" }],
  tables: [{ id: 1, name: "שולחן", type: "standard" }],
  vendors: [{ id: 1, name: "ספק" }],
  budget: [{ id: 1, category: "סעיף" }],
});
const mg = messy[0].rows[0];
//  ב-`buildSheets` השורות ממופתחות לפי `key` ולא לפי הכותרת בעברית.
check("מוזמן חלקי מקבל ברירות מחדל שפויות", mg.seats === 1 && mg.rsvp === "ממתין" && mg.gift === 0 && mg.table === "ללא שיבוץ");
check("שולחן בלי guestIds לא מפיל את הגיליון", messy[2].rows.length === 2);
check("ספק בלי משימות מקבל 0/0", messy[1].rows[0].tasksTotal === 0 && messy[1].rows[0].tasks === "");
check("סעיף תקציב בלי סכומים מתאפס", messy[3].rows[0].expected === 0 && messy[3].rows[0].diff === 0);

console.log(
  `\n${failed === 0 ? "\x1b[32m" : "\x1b[31m"}${passed} עברו, ${failed} נכשלו\x1b[0m\n`
);
process.exit(failed === 0 ? 0 : 1);
