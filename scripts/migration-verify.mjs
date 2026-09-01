/* =============================================================================
 *  migration-verify.mjs — אימות עומק של ההעברה
 * -----------------------------------------------------------------------------
 *  עונה על שאלה אחת: האם *כל* נתון מהמסד הישן קיים ונכון בצד השני.
 *
 *  הבדיקה אינה מסתמכת על רשימת עמודות שכתובה בקוד. היא שואלת את
 *  information_schema מה קיים בפועל, ומשווה שורה-שורה ועמודה-עמודה. אם
 *  מישהו יוסיף עמודה למסד ולא יעדכן את מפת ההעברה — הבדיקה תיפול.
 *
 *  שלבים:
 *    --stage export     CockroachDB חי  ↔  data.json      (רץ עכשיו)
 *    --stage firestore  data.json       ↔  Firestore      (אחרי הייבוא)
 *    --stage all        שניהם
 *
 *  שימוש:
 *    node scripts/migration-verify.mjs --dir migration/export-... --stage export
 * ========================================================================== */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadEnv } from "../server/env.mjs";
import { COLUMN_MAP, COLLECTIONS } from "./lib/migration-map.mjs";

loadEnv();

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const dir = flag("dir");
const stage = flag("stage", "export");
const env = flag("env", "prod");
const showMax = Number(flag("show", "8"));

/*  חייב לקבל את אותם --exclude שהועברו לייבוא. בלעדיהם הבדיקה משווה
    מול חתונות שמעולם לא היו אמורות לעבור, ומדווחת כשל שאינו קיים.  */
const excluded = new Set(
  argv.reduce((acc, a, i) => (a === "--exclude" && argv[i + 1] ? [...acc, argv[i + 1]] : acc), [])
);

if (!dir || !existsSync(join(dir, "data.json"))) {
  console.error("\n✗ חסר --dir עם תיקיית ייצוא תקינה.\n");
  process.exit(1);
}

const payload = JSON.parse(readFileSync(join(dir, "data.json"), "utf8"));
const T = payload.tables;

let failures = 0;
let checksRun = 0;
const problems = [];

const pass = (name, detail = "") => {
  checksRun++;
  console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? `  \x1b[90m${detail}\x1b[0m` : ""}`);
};
const fail = (name, detail = "") => {
  checksRun++;
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `  — ${detail}` : ""}`);
};

/* ── מפתחות ראשיים ───────────────────────────────────────────────────────── */

const PK = {
  "app.users": ["id"],
  "public.weddings": ["id"],
  "public.wedding_members": ["wedding_id", "user_id"],
  "public.wedding_invites": ["id"],
  "public.wedding_settings": ["wedding_id"],
  "public.guests": ["wedding_id", "id"],
  "public.seating_tables": ["wedding_id", "id"],
  "public.vendors": ["wedding_id", "id"],
  "public.budget_items": ["wedding_id", "id"],
  "public.checklist_items": ["wedding_id", "id"],
  "public.vendor_files": ["id"],
};

const keyOf = (table, row) => PK[table].map((c) => String(row[c] ?? row[camel(c)])).join("|");
const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

/*  השוואה שמנטרלת הבדלי ייצוג בלבד (Date מול ISO, numeric מול string),
    ולא הבדלי ערך. כל שאר ההבדלים נחשבים כשל.  */
function normalize(value, dataType) {
  if (value === null || value === undefined) return null;

  switch (dataType) {
    case "timestamp with time zone":
    case "timestamp without time zone":
      return new Date(value).toISOString();
    case "numeric":
    case "bigint":
    case "integer":
      return Number(value);
    case "boolean":
      return !!value;
    case "jsonb":
    case "json":
    case "ARRAY":
      return JSON.stringify(value);
    case "bytea":
      return Buffer.isBuffer(value) ? createHash("sha256").update(value).digest("hex") : String(value);
    default:
      return String(value);
  }
}

/* =============================================================================
 *  שלב 1 — CockroachDB חי  ↔  data.json
 * ========================================================================== */

async function verifyExport() {
  console.log("\n\x1b[1mשלב 1 — המסד החי מול קובץ הייצוא\x1b[0m\n");

  const { withAdmin, closePool } = await import("../server/db.js");

  //  רשימת הטבלאות מגיעה מהמסד, לא מהקוד — אחרת טבלה חדשה נעלמת בשקט.
  const live = await withAdmin((q) =>
    q(`SELECT table_schema, table_name FROM information_schema.tables
        WHERE table_schema IN ('app','public') AND table_type='BASE TABLE'
        ORDER BY 1,2`)
  );

  const TRANSIENT = new Set(["app.sessions", "app.password_resets"]);
  const liveTables = live.rows
    .map((r) => `${r.table_schema}.${r.table_name}`)
    .filter((t) => !TRANSIENT.has(t));

  console.log("\x1b[1mא. כיסוי טבלאות\x1b[0m");
  for (const t of liveTables) {
    if (T[t]) pass(`הטבלה ${t} יוצאה`);
    else fail(`הטבלה ${t} לא יוצאה כלל`, "נתונים אבודים");
  }

  console.log("\n\x1b[1mב. כיסוי עמודות — כל עמודה חייבת החלטה מפורשת\x1b[0m");
  const colTypes = {};
  for (const t of liveTables) {
    const [schema, name] = t.split(".");
    const cols = await withAdmin((q) =>
      q(
        `SELECT column_name, data_type FROM information_schema.columns
          WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`,
        [schema, name]
      )
    );
    colTypes[t] = Object.fromEntries(cols.rows.map((c) => [c.column_name, c.data_type]));

    const mapped = COLUMN_MAP[t];
    if (!mapped) {
      fail(`${t} — אין מיפוי ל-Firestore`);
      continue;
    }
    const missing = cols.rows.map((c) => c.column_name).filter((c) => !(c in mapped));
    if (missing.length) fail(`${t} — עמודות ללא החלטה: ${missing.join(", ")}`);
    else pass(`${t}`, `${cols.rows.length} עמודות, כולן ממופות או מוחרגות מפורשות`);
  }

  console.log("\n\x1b[1mג. השוואת שורות — ערך מול ערך, כל עמודה\x1b[0m");
  for (const t of liveTables) {
    if (!T[t]) continue;

    //  vendor_files עברה שינוי צורה בייצוא (הבינארי לדיסק) — נבדקת בסעיף ד.
    if (t === "public.vendor_files") continue;

    const res = await withAdmin((q) => q(`SELECT * FROM ${t}`));
    const exported = new Map(T[t].map((r) => [keyOf(t, r), r]));

    let missingRows = 0;
    let diffFields = 0;
    const samples = [];

    for (const dbRow of res.rows) {
      const k = keyOf(t, dbRow);
      const exp = exported.get(k);
      if (!exp) {
        missingRows++;
        if (samples.length < showMax) samples.push(`שורה חסרה: ${k}`);
        continue;
      }
      for (const [col, type] of Object.entries(colTypes[t])) {
        const a = normalize(dbRow[col], type);
        const b = normalize(exp[col], type);
        if (a !== b) {
          diffFields++;
          if (samples.length < showMax) {
            samples.push(`${k} · ${col}: מסד=${JSON.stringify(a)} ייצוא=${JSON.stringify(b)}`);
          }
        }
      }
    }

    const extra = T[t].length - res.rows.length;
    const label = `${t.padEnd(26)} ${res.rows.length} שורות`;
    if (!missingRows && !diffFields && extra === 0) {
      pass(label, "כל השדות זהים");
    } else {
      fail(label, `${missingRows} שורות חסרות, ${diffFields} שדות שונים, ${extra} עודפות`);
      problems.push(...samples.map((s) => `${t}: ${s}`));
    }
  }

  console.log("\n\x1b[1mד. קבצי הספקים — תוכן בינארי\x1b[0m");
  const dbFiles = await withAdmin((q) => q(`SELECT * FROM public.vendor_files`));
  const expFiles = new Map(T["public.vendor_files"].map((f) => [f.id, f]));

  let fileOk = 0;
  for (const row of dbFiles.rows) {
    const exp = expFiles.get(row.id);
    if (!exp) {
      fail(`קובץ ${row.name} לא יוצא`);
      continue;
    }
    const onDisk = readFileSync(join(dir, "files", exp.diskName));
    const dbHash = createHash("sha256").update(row.data).digest("hex");
    const diskHash = createHash("sha256").update(onDisk).digest("hex");

    const sameBytes = dbHash === diskHash;
    const sameMeta =
      exp.name === row.name && exp.mime === row.mime && Number(exp.size) === Number(row.size) &&
      exp.vendorId === row.vendor_id && exp.weddingId === row.wedding_id;

    if (sameBytes && sameMeta) fileOk++;
    else fail(`קובץ ${row.name}`, sameBytes ? "מטא-דאטה שונה" : "תוכן בינארי שונה!");
  }
  if (fileOk === dbFiles.rows.length) {
    pass(`כל ${fileOk} הקבצים`, "בייט-בבייט זהים (sha256) כולל מטא-דאטה");
  }

  console.log("\n\x1b[1mה. קשרים לוגיים\x1b[0m");
  const wIds = new Set(T["public.weddings"].map((w) => w.id));
  const uIds = new Set(T["app.users"].map((u) => u.id));
  const vendorKeys = new Set(T["public.vendors"].map((v) => `${v.wedding_id}|${v.id}`));
  const guestKeys = new Set(T["public.guests"].map((g) => `${g.wedding_id}|${g.id}`));

  const budgetLinked = T["public.budget_items"].filter((b) => b.vendor_id != null);
  const brokenBudget = budgetLinked.filter((b) => !vendorKeys.has(`${b.wedding_id}|${b.vendor_id}`));
  brokenBudget.length
    ? fail("סעיפי תקציב המקושרים לספק", `${brokenBudget.length} מצביעים לספק שאינו קיים`)
    : pass("סעיפי תקציב המקושרים לספק", `${budgetLinked.length} קישורים תקינים`);

  let seatRefs = 0;
  let brokenSeats = 0;
  for (const tb of T["public.seating_tables"]) {
    for (const gid of tb.guest_ids ?? []) {
      seatRefs++;
      if (!guestKeys.has(`${tb.wedding_id}|${gid}`)) brokenSeats++;
    }
  }
  brokenSeats
    ? fail("מוזמנים משובצים לשולחנות", `${brokenSeats} מתוך ${seatRefs} מצביעים למוזמן שאינו קיים`)
    : pass("מוזמנים משובצים לשולחנות", `${seatRefs} שיבוצים תקינים`);

  const tasksTotal = T["public.vendors"].reduce((n, v) => n + (v.tasks?.length ?? 0), 0);
  pass("משימות המקושרות לספקים", `${tasksTotal} משימות על ${T["public.vendors"].filter((v) => v.tasks?.length).length} ספקים`);

  const orphanFiles = T["public.vendor_files"].filter(
    (f) => !vendorKeys.has(`${f.weddingId}|${f.vendorId}`)
  );
  orphanFiles.length
    ? fail("מסמכים מקושרים לספק", `${orphanFiles.length} מצביעים לספק שאינו קיים`)
    : pass("מסמכים מקושרים לספק", `${T["public.vendor_files"].length} מסמכים תקינים`);

  T["public.wedding_members"].every((m) => uIds.has(m.user_id) && wIds.has(m.wedding_id))
    ? pass("חברויות בחתונות", `${T["public.wedding_members"].length} רשומות`)
    : fail("חברויות בחתונות", "יש הפניה למשתמש או לחתונה שאינם קיימים");

  await closePool();
}

/* =============================================================================
 *  שלב 2 — data.json  ↔  Firestore
 * ========================================================================== */

async function verifyFirestore() {
  console.log(`\n\x1b[1mשלב 2 — קובץ הייצוא מול Firestore (סביבת ${env})\x1b[0m\n`);

  let initializeApp, cert, getFirestore, getApps;
  try {
    ({ initializeApp, cert, getApps } = await import("firebase-admin/app"));
    ({ getFirestore } = await import("firebase-admin/firestore"));
  } catch {
    console.log("  \x1b[33m⚠ firebase-admin לא מותקן — השלב הזה לא רץ.\x1b[0m");
    console.log("    npm i -D firebase-admin\n");
    return false;
  }

  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT || "./firebase-service-account.json";
  if (!existsSync(keyPath)) {
    console.log(`  \x1b[33m⚠ לא נמצא ${keyPath} — השלב הזה לא רץ.\x1b[0m\n`);
    return false;
  }

  const sa = JSON.parse(readFileSync(keyPath, "utf8"));
  const app = getApps().length ? getApps()[0] : initializeApp({ credential: cert(sa) });
  const db = getFirestore(app);
  const root = db.collection("envs").doc(env);

  const wIds = T["public.weddings"].map((w) => w.id).filter((id) => !excluded.has(id));
  if (excluded.size) {
    console.log(`  \x1b[90mמוחרגות מהבדיקה: ${[...excluded].join(", ")}\x1b[0m\n`);
  }

  for (const [collName, { table, map }] of Object.entries(COLLECTIONS)) {
    let compared = 0;
    let missing = 0;
    let diffs = 0;
    const samples = [];

    for (const wid of wIds) {
      const rows = T[table].filter((r) => r.wedding_id === wid && !r.deleted_at);
      if (!rows.length) continue;

      const snap = await root.collection("weddings").doc(wid).collection(collName).get();
      const got = new Map(snap.docs.map((d) => [d.id, d.data()]));

      for (const r of rows) {
        const expected = map(r);
        const actual = got.get(String(r.id));
        if (!actual) {
          missing++;
          if (samples.length < showMax) samples.push(`חסר מסמך ${collName}/${r.id}`);
          continue;
        }
        compared++;
        for (const [field, want] of Object.entries(expected)) {
          const a = want instanceof Date ? want.toISOString() : JSON.stringify(want);
          const rawB = actual[field];
          const b =
            rawB && typeof rawB.toDate === "function"
              ? rawB.toDate().toISOString()
              : JSON.stringify(rawB ?? null);
          if (a !== b) {
            diffs++;
            if (samples.length < showMax) samples.push(`${collName}/${r.id} · ${field}: צפוי=${a} בפועל=${b}`);
          }
        }
      }
    }

    if (!missing && !diffs) pass(`${collName.padEnd(10)} ${compared} מסמכים`, "כל השדות זהים");
    else {
      fail(`${collName.padEnd(10)} ${compared} מסמכים`, `${missing} חסרים, ${diffs} שדות שונים`);
      problems.push(...samples);
    }
  }
  /*  המסמכים המצורפים נבדקים בנפרד: מטא-דאטה ב-Firestore, והתוכן עצמו
      ב-Storage. בלי הבדיקה הזו קבצים שנשמטו בשקט נראים כמו הצלחה מלאה.  */
  const expectedFiles = T["public.vendor_files"].filter(
    (f) => !excluded.has(f.weddingId) && T["public.weddings"].some((w) => w.id === f.weddingId)
  );
  let fileDocs = 0;
  let fileBlobs = 0;
  const fileSamples = [];

  //  אותה עקיפה כמו בייבוא: נתיב ה-REST של firebase-admin נשבר על Node 24
  //  (node-fetch@2 → ERR_STREAM_PREMATURE_CLOSE). ראו scripts/lib/gcs.mjs.
  const { objectExists, bucketExists } = await import("./lib/gcs.mjs");
  const bucketName =
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.VITE_FIREBASE_STORAGE_BUCKET ||
    `${sa.project_id}.firebasestorage.app`;
  const storageReady = await bucketExists(sa, bucketName);

  for (const f of expectedFiles) {
    const snap = await root
      .collection("weddings").doc(f.weddingId)
      .collection("files").doc(f.id)
      .get();

    if (!snap.exists) {
      if (fileSamples.length < showMax) fileSamples.push(`חסר מסמך מטא לקובץ ${f.name}`);
      continue;
    }
    fileDocs++;

    if (storageReady) {
      const path = snap.data().storagePath;
      if (path && (await objectExists(sa, bucketName, path))) fileBlobs++;
      else if (fileSamples.length < showMax) fileSamples.push(`הקובץ ${f.name} חסר ב-Storage`);
    }
  }

  fileDocs === expectedFiles.length
    ? pass(`מסמכי ספקים — מטא`, `${fileDocs}/${expectedFiles.length}`)
    : fail(`מסמכי ספקים — מטא`, `${fileDocs}/${expectedFiles.length}`);

  if (storageReady) {
    fileBlobs === expectedFiles.length
      ? pass(`מסמכי ספקים — התוכן ב-Storage`, `${fileBlobs}/${expectedFiles.length}`)
      : fail(`מסמכי ספקים — התוכן ב-Storage`, `${fileBlobs}/${expectedFiles.length}`);
  } else {
    fail("מסמכי ספקים — התוכן ב-Storage", `ה-bucket ${bucketName} לא נגיש`);
  }
  problems.push(...fileSamples);

  return true;
}

/* ── הרצה ────────────────────────────────────────────────────────────────── */

if (stage === "export" || stage === "all") await verifyExport();
if (stage === "firestore" || stage === "all") await verifyFirestore();

if (problems.length) {
  console.log("\n\x1b[1mדוגמאות לבעיות:\x1b[0m");
  for (const p of problems.slice(0, 20)) console.log(`    ${p}`);
}

console.log(
  `\n${failures === 0 ? "\x1b[32m" : "\x1b[31m"}${checksRun - failures}/${checksRun} בדיקות עברו\x1b[0m\n`
);
process.exit(failures === 0 ? 0 : 1);
