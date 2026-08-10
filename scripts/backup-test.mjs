/* =========================================================================
 *  test:backup — גיבוי ושחזור
 * -------------------------------------------------------------------------
 *  שני מסלולי השחזור שהמערכת מציעה נבדקים כאן, כי שניהם יכולים למחוק בשקט
 *  חתונה שלמה אם משהו בהם ישתבש:
 *    1. גיליון השחזור שבתוך קובץ האקסל — חייב להחזיר את ה-payload בדיוק
 *       כפי שנכתב, כולל שמות עם גרשיים, שורות חדשות ואמוג'י.
 *    2. מעטפת הגיבוי המוצפן — חייבת לפסול קובץ זר לפני שהיא נוגעת בסיסמה,
 *       ובפרט לפסול iterations מנופח שמקפיא את הלשונית.
 * ====================================================================== */

import {
  buildWorkbookBuffer,
  readWorkbookBackup,
  encodeBackupChunks,
  decodeBackupChunks,
  BACKUP_SHEET_NAME,
} from "../src/lib/excelExport.js";
import {
  encryptBackup,
  decryptBackup,
  isEncryptedBackup,
  validateEncryptedBackup,
} from "../src/lib/backupCrypto.js";

let pass = 0;
let fail = 0;
const eq = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++;
    console.log(`  ✔ ${label}`);
  } else {
    fail++;
    console.log(`  ✖ ${label}\n      התקבל: ${JSON.stringify(actual)}\n      צפוי:  ${JSON.stringify(expected)}`);
  }
};

/* ------------------------------------------------------- נתוני בדיקה */

const guests = Array.from({ length: 400 }, (_, i) => ({
  id: i + 1,
  name: `אורח מספר ${i + 1} "ציטוט" \\ לוכסן`,
  phone: `05${String(i).padStart(8, "0")}`,
  category: "משפחה של אמא",
  seats: (i % 4) + 1,
  rsvp: ["confirmed", "pending", "declined"][i % 3],
  probablyComing: i % 5 === 0,
  glatt: i % 7 === 0,
  gift: i * 13,
  mention: "שורה\nשנייה\tעם טאב",
}));
const tables = [
  { id: 1, name: "שולחן ראשי", type: "knight", guestIds: [1, 2, 3] },
  { id: 2, name: "שולחן 2", type: "standard", guestIds: [] },
];
const vendors = [
  {
    id: 1,
    name: "אולם אירועים",
    type: "אולם",
    contractCost: 60000,
    deposit: 10000,
    tasks: [{ id: 1, title: "לסגור תפריט", status: "done" }],
    notes: "הערה עם אמוג'י 🎉 ותו מיוחד ±",
  },
];
const budget = [
  { id: 1, category: "אולם", expected: 60000, actual: 10000, vendorId: 1 },
  { id: 2, category: "פרחים", expected: 4000, actual: 0, vendorId: null },
];
const payload = {
  app: "wedding-planner",
  version: 2,
  exportedAt: "2026-08-10T12:00:00.000Z",
  guests,
  tables,
  vendors,
  budget,
  settings: {
    budgetGoal: 180000,
    financeLabels: { income: "הכנסות", expense: "הוצאות" },
    categories: ["משפחה של אמא", "חברים מהצבא"],
    partnerA: "דנה",
    partnerB: "יואב",
    weddingDate: "2027-05-20",
  },
};

/* ------------------------------------------- גיליון השחזור באקסל */

console.log("\nגיליון השחזור באקסל");

const chunks = encodeBackupChunks(payload);
eq("הפיצול מייצר שורות", chunks.length > 0, true);
eq("כל שורה מכילה base64 בלבד", chunks.every((c) => /^[A-Za-z0-9+/=]+$/.test(c)), true);
eq("אף שורה לא חורגת ממגבלת התא", chunks.every((c) => c.length <= 20000), true);
eq("פענוח מחזיר את המקור", decodeBackupChunks(chunks), payload);

for (const [label, input, code] of [
  ["גיליון ריק", [], "no_backup_sheet"],
  ["תוכן שאינו base64", ["####"], "corrupt_backup"],
  ["base64 שאינו JSON", [Buffer.from("hello").toString("base64")], "corrupt_backup"],
  ["JSON שהוא מערך", [Buffer.from("[1,2]").toString("base64")], "corrupt_backup"],
]) {
  let got = null;
  try {
    decodeBackupChunks(input);
  } catch (err) {
    got = err.code;
  }
  eq(`נפסל: ${label}`, got, code);
}

const buffer = await buildWorkbookBuffer({
  guests,
  tables,
  vendors,
  budget,
  budgetGoal: 180000,
  backup: payload,
});
const restored = await readWorkbookBackup({ arrayBuffer: async () => buffer });
eq("מסלול מלא: קובץ → payload זהה", restored, payload);
eq("המוזמן ה-400 שרד", restored.guests[399].name, guests[399].name);
eq("ההגדרות שרדו", restored.settings, payload.settings);
eq("הקישור לספק שרד", restored.budget[0].vendorId, 1);

const ExcelJS = (await import("exceljs")).default;
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buffer);
eq(
  "הגיליונות לקריאה נשארו במקומם",
  wb.worksheets.map((w) => w.name),
  ["מוזמנים", "ספקים", "סדר הושבה", "ניהול תקציב", BACKUP_SHEET_NAME]
);
eq("גיליון המוזמנים מלא", wb.getWorksheet("מוזמנים").rowCount, guests.length + 1);

const noBackup = await buildWorkbookBuffer({ guests, tables, vendors, budget, budgetGoal: 0 });
for (const [label, bytes, code] of [
  ["חוברת ללא גיליון שחזור", noBackup, "no_backup_sheet"],
  ["קובץ שאינו אקסל", new TextEncoder().encode("not a zip").buffer, "unreadable_file"],
]) {
  let got = null;
  try {
    await readWorkbookBackup({ arrayBuffer: async () => bytes });
  } catch (err) {
    got = err.code;
  }
  eq(`נפסל: ${label}`, got, code);
}

/* ------------------------------------------------ גיבוי מוצפן */

console.log("\nמעטפת הגיבוי המוצפן");

const env = await encryptBackup(payload, "a-very-strong-pass");
eq("מזוהה כקובץ מוצפן", isEncryptedBackup(env), true);
eq("עובר ולידציה", validateEncryptedBackup(env), null);
eq("הצפנה ופענוח מחזירים את המקור", await decryptBackup(env, "a-very-strong-pass"), payload);

let wrong = false;
try {
  await decryptBackup(env, "wrong-password-here");
} catch {
  wrong = true;
}
eq("סיסמה שגויה נכשלת", wrong, true);

const clone = () => JSON.parse(JSON.stringify(env));
for (const [label, input, code] of [
  ["null", null, "not_backup_file"],
  ["גיבוי לא מוצפן", payload, "not_backup_file"],
  ["app אחר", { ...clone(), app: "other-app" }, "not_backup_file"],
  ["צופן אחר", { ...clone(), cipher: "DES" }, "unsupported_backup"],
  ["kdf אחר", { ...clone(), kdf: { ...env.kdf, name: "scrypt" } }, "unsupported_backup"],
  ["hash אחר", { ...clone(), kdf: { ...env.kdf, hash: "SHA-1" } }, "unsupported_backup"],
  ["iterations מנופח", { ...clone(), kdf: { ...env.kdf, iterations: 9e8 } }, "unsupported_backup"],
  ["iterations נמוך מדי", { ...clone(), kdf: { ...env.kdf, iterations: 5 } }, "unsupported_backup"],
  ["iterations שאינו מספר", { ...clone(), kdf: { ...env.kdf, iterations: "many" } }, "unsupported_backup"],
  ["salt שאינו base64", { ...clone(), salt: "!!!!" }, "corrupt_backup"],
  ["salt באורך שגוי", { ...clone(), salt: "AAAA" }, "corrupt_backup"],
  ["iv קטוע", { ...clone(), iv: "AAAA" }, "corrupt_backup"],
  ["data ריק", { ...clone(), data: "" }, "corrupt_backup"],
]) {
  eq(`נפסל: ${label}`, validateEncryptedBackup(input), code);
}

//  קובץ שהמבנה שלו תקין אך התוכן הוחלף חייב להיכשל בפענוח — ולא להחזיר זבל.
const tampered = clone();
tampered.data = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
eq("קובץ שהוחלף עובר את בדיקת המבנה", validateEncryptedBackup(tampered), null);
let tamperFailed = false;
try {
  await decryptBackup(tampered, "a-very-strong-pass");
} catch {
  tamperFailed = true;
}
eq("קובץ שהוחלף נכשל בפענוח", tamperFailed, true);

let earlyCode = null;
try {
  await decryptBackup({ ...clone(), cipher: "DES" }, "a-very-strong-pass");
} catch (err) {
  earlyCode = err.message;
}
eq("מעטפת פסולה נעצרת לפני גזירת המפתח", earlyCode, "unsupported_backup");

console.log(`\n${pass} עברו, ${fail} נכשלו`);
process.exit(fail ? 1 : 0);
