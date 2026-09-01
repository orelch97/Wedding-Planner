/* =============================================================================
 *  firebase-import.mjs — ייבוא קובץ הייצוא אל Firestore + Storage
 * -----------------------------------------------------------------------------
 *  שלב 2 מתוך 2. קורא את התיקייה ש-db-export.mjs יצר וכותב ל-Firebase.
 *
 *  ── מבנה הנתונים ──────────────────────────────────────────────────────────
 *  ביקשת קידומות בסגנון prod_guests / test_guests. מימשתי את אותו רעיון
 *  כשורש סביבה, שהוא עדיף כאן משלוש סיבות מעשיות:
 *
 *      envs/{prod|test}/weddings/{weddingId}/guests/{guestId}
 *                                           /tables/{tableId}
 *                                           /vendors/{vendorId}      ← tasks בפנים
 *                                           /budget/{itemId}
 *                                           /checklist/{itemId}
 *                                           /files/{fileId}          ← מטא בלבד
 *                                           /members/{userId}
 *                                           /settings/main
 *      envs/{env}/users/{userId}
 *      envs/{env}/invites/{inviteId}
 *
 *  1. כלל אבטחה אחד על נתיב החתונה מכסה את כל תת-האוספים שלה. באוספים
 *     שטוחים היה צריך get() על מסמך החברות בכל כלל בנפרד — קריאה בתשלום
 *     על כל בדיקה.
 *  2. הפרדה מוחלטת בין הסביבות: אין שאילתה שיכולה בטעות לחצות ביניהן.
 *  3. הקריאה באפליקציה ממילא תמיד מתחילה מחתונה אחת.
 *
 *  ── החלטות אבטחה ─────────────────────────────────────────────────────────
 *  • password_hash **אינו** נכתב ל-Firestore. הוא חסר ערך אחרי המעבר ל-
 *    Firebase Auth, והחזקתו במסד שהלקוח קורא ממנו היא סיכון מיותר. במקומו
 *    נוצר users-for-auth.json עם הזהויות בלבד, ליצירת החשבונות.
 *  • wedding_invites.token_hash אינו נכתב. ההזמנות הפתוחות יונפקו מחדש.
 *
 *  ── בטיחות ההרצה ─────────────────────────────────────────────────────────
 *  מזהי המסמכים דטרמיניסטיים (אותו UUID/מזהה מהמסד), ולכן הרצה חוזרת
 *  דורסת את אותם מסמכים ולא יוצרת כפילויות. אפשר להריץ שוב בבטחה.
 *
 *  שימוש:
 *    node scripts/firebase-import.mjs --dir migration/export-... --dry-run
 *    node scripts/firebase-import.mjs --dir migration/export-... --env test
 *    node scripts/firebase-import.mjs --dir migration/export-... --env both
 *
 *  דגלים:
 *    --dir <path>            תיקיית הייצוא (חובה)
 *    --env test|prod|both    לאן לכתוב (ברירת מחדל: test)
 *    --dry-run               מדפיס בלבד, לא כותב כלום
 *    --exclude <weddingId>   דילוג על חתונה (ניתן לחזור על הדגל)
 *    --include-deleted       גם שורות עם deleted_at (ברירת מחדל: לא)
 *    --skip-files            בלי העלאת קבצים ל-Storage
 * ========================================================================== */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { loadEnv } from "../server/env.mjs";
import {
  ts,
  guestDoc,
  tableDoc,
  vendorDoc,
  budgetDoc,
  checklistDoc,
} from "./lib/migration-map.mjs";

loadEnv();

/* ── פענוח דגלים ─────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const dir = flag("dir");
const envArg = flag("env", "test");
const dryRun = has("dry-run");
const includeDeleted = has("include-deleted");
const skipFiles = has("skip-files");

const excluded = new Set(
  argv.reduce((acc, a, i) => (a === "--exclude" && argv[i + 1] ? [...acc, argv[i + 1]] : acc), [])
);

if (!dir || !existsSync(join(dir, "data.json"))) {
  console.error("\n✗ חסר --dir עם תיקיית ייצוא תקינה (data.json לא נמצא).\n");
  process.exit(1);
}
if (!["test", "prod", "both"].includes(envArg)) {
  console.error("\n✗ --env חייב להיות test / prod / both.\n");
  process.exit(1);
}

const targets = envArg === "both" ? ["test", "prod"] : [envArg];

/* ── טעינת הייצוא ────────────────────────────────────────────────────────── */

const payload = JSON.parse(readFileSync(join(dir, "data.json"), "utf8"));
const T = payload.tables;

const weddings = T["public.weddings"].filter((w) => !excluded.has(w.id));
const keptWeddingIds = new Set(weddings.map((w) => w.id));

const alive = (rows) => (includeDeleted ? rows : rows.filter((r) => !r.deleted_at));

//  vendor_files עברה שינוי צורה בייצוא (הבינארי יצא לדיסק) ולכן המפתח שלה
//  הוא weddingId ולא wedding_id. בלי שני השמות כאן הקבצים נשמטים בשקט.
const forKept = (rows) =>
  rows.filter((r) => keptWeddingIds.has(r.wedding_id ?? r.weddingId));

const scoped = {
  guests: alive(forKept(T["public.guests"])),
  tables: alive(forKept(T["public.seating_tables"])),
  vendors: alive(forKept(T["public.vendors"])),
  budget: alive(forKept(T["public.budget_items"])),
  checklist: alive(forKept(T["public.checklist_items"])),
  files: forKept(T["public.vendor_files"]),
  members: forKept(T["public.wedding_members"]),
  settings: forKept(T["public.wedding_settings"]),
  invites: forKept(T["public.wedding_invites"]),
};

//  משתמש נחשב רלוונטי אם הוא בעלים או חבר באחת מהחתונות שנשמרו.
const relevantUserIds = new Set([
  ...weddings.map((w) => w.owner_id),
  ...scoped.members.map((m) => m.user_id),
]);
const users = T["app.users"].filter((u) => relevantUserIds.has(u.id));

/* ── סיכום לפני כתיבה ────────────────────────────────────────────────────── */

const plan = {
  weddings: weddings.length,
  users: users.length,
  members: scoped.members.length,
  invites: scoped.invites.length,
  settings: scoped.settings.length,
  guests: scoped.guests.length,
  tables: scoped.tables.length,
  vendors: scoped.vendors.length,
  budget: scoped.budget.length,
  checklist: scoped.checklist.length,
  files: skipFiles ? 0 : scoped.files.length,
};
const totalDocs = Object.values(plan).reduce((a, b) => a + b, 0);

console.log(`\nייבוא ל-Firebase  ·  מקור: ${dir}`);
console.log(`סביבות יעד: ${targets.join(", ")}${dryRun ? "   \x1b[33m[DRY RUN — לא נכתב כלום]\x1b[0m" : ""}\n`);

for (const w of weddings) {
  const c = (k) => scoped[k].filter((r) => r.wedding_id === w.id).length;
  console.log(
    `  ${w.id}  ${String(w.name).slice(0, 24).padEnd(26)} ` +
      `מוזמנים:${String(c("guests")).padStart(4)}  ספקים:${String(c("vendors")).padStart(3)}  ` +
      `תקציב:${String(c("budget")).padStart(3)}  צ׳קליסט:${String(c("checklist")).padStart(3)}`
  );
}
if (excluded.size) console.log(`\n  דילוג על ${excluded.size} חתונות: ${[...excluded].join(", ")}`);

console.log(`\n  סה״כ ${totalDocs} מסמכים לכל סביבה · ${targets.length} סביבות = ${totalDocs * targets.length} כתיבות`);
if (!includeDeleted) {
  const skipped = T["public.guests"].length - alive(T["public.guests"]).length;
  if (skipped) console.log(`  ${skipped} שורות עם deleted_at לא ייובאו (--include-deleted כדי לכלול).`);
}

if (dryRun) {
  console.log(`\n\x1b[33mDRY RUN — לא בוצעה שום כתיבה.\x1b[0m הסירו --dry-run כדי לבצע.\n`);
  process.exit(0);
}

/* ── חיבור ל-Firebase ────────────────────────────────────────────────────── */

let initializeApp, cert, getFirestore;
try {
  //  firebase-admin v13+ נחשף בנקודות כניסה מודולריות. ה-namespace הישן
  //  (admin.credential.cert) כבר לא קיים בייבוא ESM.
  ({ initializeApp, cert } = await import("firebase-admin/app"));
  ({ getFirestore } = await import("firebase-admin/firestore"));
} catch {
  console.error("\n✗ החבילה firebase-admin לא מותקנת. הריצו:  npm i -D firebase-admin\n");
  process.exit(1);
}

const { uploadFile, bucketExists, listBuckets } = await import("./lib/gcs.mjs");

const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT || "./firebase-service-account.json";
if (!existsSync(keyPath)) {
  console.error(`\n✗ לא נמצא קובץ service account בנתיב ${keyPath}.`);
  console.error("  Firebase Console → Project settings → Service accounts → Generate new private key.");
  console.error("  שמרו כ-firebase-service-account.json בשורש הפרויקט (ו-.gitignore!).\n");
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(keyPath, "utf8"));
//  ה-bucket בפרויקטים חדשים הוא <project>.firebasestorage.app ולא appspot.com,
//  ולכן ברירת המחדל של ה-SDK עלולה להצביע למקום שלא קיים.
const bucketName =
  process.env.FIREBASE_STORAGE_BUCKET ||
  process.env.VITE_FIREBASE_STORAGE_BUCKET ||
  `${serviceAccount.project_id}.firebasestorage.app`;

const app = initializeApp({
  credential: cert(serviceAccount),
  storageBucket: bucketName,
});

const db = getFirestore(app);

//  נבדק *לפני* הכתיבה: אם Storage לא הופעל בפרויקט, עדיף להגיד את זה
//  עכשיו מאשר לגלות אחרי 1378 מסמכים שהמסמכים אבדו.
if (!skipFiles && !(await bucketExists(serviceAccount, bucketName))) {
  const found = await listBuckets(serviceAccount);
  console.error(`\n✗ ה-bucket לא קיים: ${bucketName}`);
  console.error(
    found.length
      ? `  buckets שכן קיימים: ${found.join(", ")}\n  עדכנו FIREBASE_STORAGE_BUCKET ב-.env`
      : "  אין אף bucket — Firebase Storage לא הופעל בפרויקט.\n" +
        "  Firebase Console → Build → Storage → Get started\n" +
        "  או הריצו עם --skip-files כדי לייבא נתונים בלבד (8 המסמכים לא יעברו)."
  );
  process.exit(1);
}

console.log(`\n  פרויקט: ${serviceAccount.project_id}`);
console.log(`  bucket:  ${bucketName}\n`);

/* ── כתיבה מרובת אצוות ───────────────────────────────────────────────────── */
let uploadFailures = 0;
//  Firestore מגביל אצווה ל-500 פעולות. העטיפה סופרת ומשגרת לבד.
function batcher() {
  let batch = db.batch();
  let n = 0;
  let written = 0;
  return {
    async set(ref, data) {
      batch.set(ref, data, { merge: true });
      if (++n >= 450) {
        await batch.commit();
        written += n;
        batch = db.batch();
        n = 0;
      }
    },
    async flush() {
      if (n) await batch.commit();
      return written + n;
    },
  };
}

for (const env of targets) {
  const root = db.collection("envs").doc(env);
  const bw = batcher();

  await bw.set(root, { env, migratedAt: new Date(), source: "cockroachdb" });

  for (const u of users) {
    //  ללא password_hash — ראו הערת האבטחה בראש הקובץ.
    await bw.set(root.collection("users").doc(u.id), {
      id: u.id,
      email: u.email,
      emailLower: String(u.email || "").toLowerCase(),
      createdAt: ts(u.created_at),
    });
  }

  for (const w of weddings) {
    const wref = root.collection("weddings").doc(w.id);
    await bw.set(wref, {
      id: w.id,
      name: w.name ?? "",
      weddingDate: w.wedding_date ?? null,
      partnerA: w.partner_a ?? "",
      partnerB: w.partner_b ?? "",
      ownerId: w.owner_id,
      createdAt: ts(w.created_at),
    });

    const mine = (rows) => rows.filter((r) => r.wedding_id === w.id);

    for (const m of mine(scoped.members)) {
      await bw.set(wref.collection("members").doc(m.user_id), {
        userId: m.user_id,
        ownerId: m.owner_id,
        role: m.role,
        scopes: Array.isArray(m.scopes) && m.scopes.length ? m.scopes : ["all"],
        createdAt: ts(m.created_at),
        lastSeenAt: ts(m.last_seen_at),
      });
    }

    const s = mine(scoped.settings)[0];
    if (s) {
      await bw.set(wref.collection("settings").doc("main"), {
        ...(s.data && typeof s.data === "object" ? s.data : {}),
        updatedAt: ts(s.updated_at),
      });
    }

    for (const [name, rows, map] of [
      ["guests", mine(scoped.guests), guestDoc],
      ["tables", mine(scoped.tables), tableDoc],
      ["vendors", mine(scoped.vendors), vendorDoc],
      ["budget", mine(scoped.budget), budgetDoc],
      ["checklist", mine(scoped.checklist), checklistDoc],
    ]) {
      for (const r of rows) {
        await bw.set(wref.collection(name).doc(String(r.id)), map(r));
      }
    }
  }

  for (const inv of scoped.invites) {
    //  ללא token_hash — ההזמנות הפתוחות יונפקו מחדש אחרי המעבר.
    await bw.set(root.collection("invites").doc(inv.id), {
      id: inv.id,
      weddingId: inv.wedding_id,
      email: inv.email,
      role: inv.role,
      scopes: Array.isArray(inv.scopes) && inv.scopes.length ? inv.scopes : ["all"],
      expiresAt: ts(inv.expires_at),
      acceptedAt: ts(inv.accepted_at),
      createdBy: inv.created_by,
      createdAt: ts(inv.created_at),
      needsReissue: !inv.accepted_at,
    });
  }

  const docs = await bw.flush();
  console.log(`  [${env}] ${docs} מסמכים נכתבו ל-Firestore`);

  /* ── קבצים ל-Storage ──────────────────────────────────────────────────── */
  if (!skipFiles) {
    let uploaded = 0;
    const failed = [];

    //  העלאות נופלות מדי פעם על טוקן OAuth שנקטע באמצע. ניסיון חוזר עם
    //  השהיה עולה פותר את זה; כישלון אמיתי נאסף ומדווח בסוף.
    async function withRetry(label, fn, tries = 3) {
      for (let i = 1; i <= tries; i++) {
        try {
          return await fn();
        } catch (err) {
          if (i === tries) throw err;
          console.log(`    ↻ ניסיון ${i} ל-${label} נכשל (${err.code ?? err.message}) — מנסה שוב`);
          await new Promise((r) => setTimeout(r, 1500 * i));
        }
      }
    }

    for (const f of scoped.files) {
      const local = join(dir, "files", f.diskName);
      const dest = `${env}/weddings/${f.weddingId}/vendor-files/${f.id}${extname(f.name || "")}`;
      try {
        await withRetry(f.name, () =>
          uploadFile(serviceAccount, bucketName, local, dest, f.mime)
        );
        await withRetry(`${f.name} (מטא)`, () =>
          db
            .collection("envs").doc(env)
            .collection("weddings").doc(f.weddingId)
            .collection("files").doc(f.id)
            .set({
              id: f.id,
              vendorId: f.vendorId,
              name: f.name,
              mime: f.mime,
              size: f.size,
              storagePath: dest,
              sha256: f.sha256,
              createdAt: ts(f.createdAt),
            }, { merge: true })
        );
        uploaded++;
      } catch (err) {
        failed.push(`${f.name}: ${err.code ?? err.message}`);
      }
    }

    console.log(`  [${env}] ${uploaded}/${scoped.files.length} קבצים הועלו ל-Storage`);
    if (failed.length) {
      console.log(`  \x1b[31m[${env}] ${failed.length} קבצים נכשלו:\x1b[0m`);
      for (const f of failed) console.log(`      ${f}`);
      //  כשל בהעלאה הוא אובדן נתונים לכל דבר, ואסור שיוצג כהצלחה.
      uploadFailures += failed.length;
    }
  }
}

/* ── אימות: קריאה חוזרת וספירה ───────────────────────────────────────────── */

console.log("\nאימות מול Firestore:");
let mismatch = 0;
for (const env of targets) {
  const root = db.collection("envs").doc(env);
  const wsnap = await root.collection("weddings").get();
  let g = 0, v = 0, b = 0, c = 0, tb = 0;
  for (const w of wsnap.docs) {
    g += (await w.ref.collection("guests").count().get()).data().count;
    v += (await w.ref.collection("vendors").count().get()).data().count;
    b += (await w.ref.collection("budget").count().get()).data().count;
    c += (await w.ref.collection("checklist").count().get()).data().count;
    tb += (await w.ref.collection("tables").count().get()).data().count;
  }
  const rows = [
    ["חתונות", wsnap.size, plan.weddings],
    ["מוזמנים", g, plan.guests],
    ["שולחנות", tb, plan.tables],
    ["ספקים", v, plan.vendors],
    ["תקציב", b, plan.budget],
    ["צ׳קליסט", c, plan.checklist],
  ];
  console.log(`  [${env}]`);
  for (const [label, got, want] of rows) {
    const ok = got === want;
    if (!ok) mismatch++;
    console.log(`    ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${label.padEnd(10)} ${got}/${want}`);
  }
}

/* ── רשימת חשבונות ל-Firebase Auth ───────────────────────────────────────── */

const authFile = join(dir, "users-for-auth.json");
writeFileSync(
  authFile,
  JSON.stringify(
    users.map((u) => ({ uid: u.id, email: u.email, emailVerified: false })),
    null,
    2
  ),
  "utf8"
);
console.log(`\n  רשימת חשבונות ליצירה ב-Firebase Auth: ${authFile}`);
console.log("  הסיסמאות אינן ניתנות להעברה — כל חשבון יצטרך איפוס סיסמה.");

const problems = mismatch + uploadFailures;
if (problems === 0) {
  console.log("\n\x1b[32m✓ הייבוא הושלם — כל הספירות תואמות וכל הקבצים עלו\x1b[0m\n");
} else {
  console.log(
    `\n\x1b[31m✗ ${mismatch} אי-התאמות בספירות ו-${uploadFailures} קבצים שלא עלו — אל תמשיכו לשלב הבא\x1b[0m\n`
  );
}
process.exit(problems === 0 ? 0 : 1);
