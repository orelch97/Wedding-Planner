/* =============================================================================
 *  db-export.mjs — ייצוא מלא של CockroachDB לקבצים מקומיים
 * -----------------------------------------------------------------------------
 *  שלב 1 מתוך 2 במעבר ל-Firestore. הסקריפט הזה *קורא בלבד* — הוא לא נוגע
 *  במסד ולא משנה בו דבר, ולכן אפשר להריץ אותו שוב ושוב בלי סיכון.
 *
 *  שלוש החלטות שחשוב להכיר:
 *
 *  1. הייצוא הוא מלא ונאמן — כולל שורות שנמחקו רכות (deleted_at) וכולל
 *     חשבונות בדיקה. סינון מתבצע בשלב הייבוא, לא כאן. קובץ ייצוא שכבר סינן
 *     משהו אינו גיבוי, והרגע שבו מגלים שסיננו יותר מדי הוא הרגע שבו המסד
 *     המקורי כבר לא זמין.
 *
 *  2. הקבצים של הספקים (vendor_files.data, טיפוס BYTES) נכתבים כקבצים
 *     בינאריים נפרדים ולא כ-base64 בתוך ה-JSON. שניים מהם גדולים מ-1 MiB,
 *     שהיא התקרה הקשיחה של מסמך ב-Firestore — הם *חייבים* ללכת ל-Storage.
 *
 *  3. app.sessions ו-app.password_resets לא מיוצאים בכוונה: אלה טוקנים
 *     זמניים, הם חסרי ערך אחרי המעבר, והעברתם היא סיכון מיותר.
 *
 *  שימוש:  node scripts/db-export.mjs [--out <תיקייה>]
 * ========================================================================== */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";
import { loadEnv } from "../server/env.mjs";

loadEnv();
const { withAdmin, closePool } = await import("../server/db.js");

const NUMERIC_OID = 1700;
const BYTEA_OID = 17;

//  סדר הייצוא הוא סדר התלות: כל טבלה מיוצאת אחרי מה שהיא מצביעה עליו.
//  הייבוא ל-Firestore ילך באותו סדר, ולכן אין רגע שבו יש הפניה ליתום.
const TABLES = [
  "app.users",
  "public.weddings",
  "public.wedding_members",
  "public.wedding_invites",
  "public.wedding_settings",
  "public.guests",
  "public.seating_tables",
  "public.vendors",
  "public.budget_items",
  "public.checklist_items",
];

const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir =
  outFlag !== -1 && args[outFlag + 1]
    ? args[outFlag + 1]
    : join("migration", `export-${stamp}`);

const filesDir = join(outDir, "files");
mkdirSync(filesDir, { recursive: true });

/*  pg מחזיר NUMERIC כמחרוזת, כי הטיפוס תומך בדיוק גדול מ-Number. כל הערכים
    כאן הם סכומי כסף ומספרי מקומות הרבה מתחת לתקרה, וה-UI ממילא עושה Number()
    עליהם בכל מקום. ההמרה כאן ולא בייבוא, כדי שקובץ הייצוא כבר יהיה נכון.  */
function coerce(res) {
  const numericCols = res.fields
    .filter((f) => f.dataTypeID === NUMERIC_OID)
    .map((f) => f.name);
  if (!numericCols.length) return res.rows;

  for (const row of res.rows) {
    for (const col of numericCols) {
      if (row[col] !== null && row[col] !== undefined) row[col] = Number(row[col]);
    }
  }
  return res.rows;
}

const data = {};
const counts = {};

console.log(`\nייצוא מ-CockroachDB → ${outDir}\n`);

for (const table of TABLES) {
  const res = await withAdmin((q) => q(`SELECT * FROM ${table}`));
  data[table] = coerce(res);
  counts[table] = res.rows.length;
  console.log(`  ${table.padEnd(28)} ${String(res.rows.length).padStart(5)} שורות`);
}

/* ── קבצי הספקים: מטא-דאטה ל-JSON, התוכן לדיסק ──────────────────────────── */

const filesRes = await withAdmin((q) => q(`SELECT * FROM public.vendor_files`));
const byteaCol = filesRes.fields.find((f) => f.dataTypeID === BYTEA_OID)?.name ?? "data";

const fileRecords = [];
let totalBytes = 0;

for (const row of filesRes.rows) {
  const buf = row[byteaCol];
  if (!Buffer.isBuffer(buf)) {
    throw new Error(`vendor_files.${byteaCol} של ${row.id} אינו Buffer — הייצוא נעצר`);
  }

  //  שם הקובץ על הדיסק הוא ה-UUID בלבד: השם המקורי מכיל עברית, רווחים
  //  ותווים שנשברים בין מערכות קבצים. השם האמיתי נשמר במטא-דאטה.
  const ext = extname(row.name || "") || "";
  const diskName = `${row.id}${ext}`;
  writeFileSync(join(filesDir, diskName), buf);

  totalBytes += buf.length;
  fileRecords.push({
    id: row.id,
    weddingId: row.wedding_id,
    vendorId: row.vendor_id,
    name: row.name,
    mime: row.mime,
    size: Number(row.size),
    actualBytes: buf.length,
    createdAt: row.created_at,
    diskName,
    sha256: createHash("sha256").update(buf).digest("hex"),
    //  התקרה הקשיחה של מסמך ב-Firestore. base64 מנפח עוד ~33%, ולכן גם
    //  קבצים קצת מתחת לתקרה לא יכולים לשבת בתוך מסמך.
    exceedsFirestoreDocLimit: buf.length > 1_048_576,
  });
}

data["public.vendor_files"] = fileRecords;
counts["public.vendor_files"] = fileRecords.length;
console.log(`  ${"public.vendor_files".padEnd(28)} ${String(fileRecords.length).padStart(5)} קבצים  (${(totalBytes / 1_048_576).toFixed(2)} MB)`);

/* ── כתיבה ואימות ────────────────────────────────────────────────────────── */

const payload = {
  exportedAt: new Date().toISOString(),
  source: "cockroachdb",
  counts,
  tables: data,
};

const json = JSON.stringify(payload, null, 2);
writeFileSync(join(outDir, "data.json"), json, "utf8");

const manifest = {
  exportedAt: payload.exportedAt,
  counts,
  totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
  dataJsonSha256: createHash("sha256").update(json).digest("hex"),
  dataJsonBytes: Buffer.byteLength(json),
  files: fileRecords.map((f) => ({ diskName: f.diskName, sha256: f.sha256, size: f.actualBytes })),
  filesTotalBytes: totalBytes,
  oversizedForFirestore: fileRecords.filter((f) => f.exceedsFirestoreDocLimit).length,
};
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

await closePool();

console.log(`\n  סה״כ ${manifest.totalRows} שורות · data.json = ${(manifest.dataJsonBytes / 1024).toFixed(0)} KB`);
if (manifest.oversizedForFirestore) {
  console.log(`  ⚠ ${manifest.oversizedForFirestore} קבצים גדולים מ-1 MiB — חייבים ללכת ל-Firebase Storage.`);
}
console.log(`\n✓ הייצוא הושלם: ${outDir}\n`);
