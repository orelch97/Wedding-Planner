/* =============================================================================
 *  firebase-auth-setup.mjs — יצירת חשבונות ב-Firebase Auth
 * -----------------------------------------------------------------------------
 *  ⚠ ה-uid חייב להיות זהה ל-UUID מ-CockroachDB.
 *
 *  firestore.rules מחפשות את מסמך החברות בנתיב
 *  envs/{env}/weddings/{id}/members/{request.auth.uid}, והמסמכים האלה
 *  ממופתחים ב-UUID הישן. uid אקראי מ-Firebase = אף כלל לא יתאים לעולם,
 *  והמשתמש יראה מסך ריק בלי שום שגיאה מובנת.
 *
 *  סיסמאות אינן ניתנות להעברה (scrypt של Node אינו הפורמט של Firebase),
 *  ולכן החשבונות נוצרים **בלי סיסמה**. הכניסה הראשונה היא דרך "שכחתי סיסמה".
 *
 *  שימוש:
 *    node scripts/firebase-auth-setup.mjs --dir migration/export-... [--dry-run]
 *    node scripts/firebase-auth-setup.mjs --dir ... --test-password <סיסמה>
 *        קובע סיסמה לחשבונות בדיקה בלבד (@test.local), כדי שאפשר יהיה
 *        להריץ QA אמיתי. לעולם לא נוגע בחשבונות אמיתיים.
 * ========================================================================== */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "../server/env.mjs";

loadEnv();

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const dir = flag("dir");
const dryRun = argv.includes("--dry-run");
const testPassword = flag("test-password");

if (!dir || !existsSync(join(dir, "data.json"))) {
  console.error("\n✗ חסר --dir עם תיקיית ייצוא תקינה.\n");
  process.exit(1);
}

const payload = JSON.parse(readFileSync(join(dir, "data.json"), "utf8"));
const users = payload.tables["app.users"];

//  חשבון בדיקה מזוהה לפי הסיומת. אין סיכוי שכתובת אמיתית תיפול לכאן.
const isTestAccount = (email) => /@test\.local$/i.test(email);

console.log(`\nיצירת חשבונות ב-Firebase Auth${dryRun ? "   \x1b[33m[DRY RUN]\x1b[0m" : ""}\n`);

for (const u of users) {
  const tag = isTestAccount(u.email) ? "\x1b[90m(בדיקה)\x1b[0m" : "\x1b[36m(אמיתי)\x1b[0m";
  console.log(`  ${u.email.padEnd(34)} ${tag}  uid=${u.id}`);
}

if (dryRun) {
  console.log(`\n\x1b[33mDRY RUN — לא נוצר דבר.\x1b[0m ${users.length} חשבונות ייווצרו.\n`);
  process.exit(0);
}

const { initializeApp, cert } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");

const sa = JSON.parse(readFileSync("./firebase-service-account.json", "utf8"));
const auth = getAuth(initializeApp({ credential: cert(sa) }));

let created = 0;
let existing = 0;
let failed = 0;

for (const u of users) {
  const props = { uid: u.id, email: u.email, emailVerified: false };

  //  סיסמה נקבעת רק לחשבונות בדיקה, ורק אם התבקש במפורש.
  if (testPassword && isTestAccount(u.email)) props.password = testPassword;

  try {
    await auth.createUser(props);
    created++;
    console.log(`  \x1b[32m✓\x1b[0m נוצר   ${u.email}`);
  } catch (err) {
    if (err.code === "auth/uid-already-exists" || err.code === "auth/email-already-exists") {
      //  הרצה חוזרת: מעדכנים סיסמת בדיקה אם התבקשה, ולא נוגעים בשאר.
      if (props.password) {
        await auth.updateUser(u.id, { password: props.password });
        console.log(`  \x1b[32m✓\x1b[0m קיים   ${u.email}  (סיסמת בדיקה עודכנה)`);
      } else {
        console.log(`  \x1b[90m·\x1b[0m קיים   ${u.email}`);
      }
      existing++;
    } else {
      failed++;
      console.log(`  \x1b[31m✗\x1b[0m נכשל   ${u.email} — ${err.code ?? err.message}`);
    }
  }
}

console.log(`\n  ${created} נוצרו · ${existing} כבר היו · ${failed} נכשלו`);
if (!testPassword) {
  console.log("  לחשבונות לא נקבעה סיסמה — הכניסה הראשונה דרך \"שכחתי סיסמה\".");
}
console.log();
process.exit(failed === 0 ? 0 : 1);
