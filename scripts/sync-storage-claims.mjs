/* =============================================================================
 *  sync-storage-claims.mjs — עדכון custom claims לפי חברות בחתונות
 * -----------------------------------------------------------------------------
 *  כללי ה-Storage לא יכולים לקרוא את Firestore (firestore.get מוחזר 403
 *  בפרויקט הזה), ולכן ההרשאה לקבצים נגזרת מ-claim על הטוקן:
 *      w_test / w_prod  →  רשימת מזהי החתונות שהמשתמש חבר בהן.
 *
 *  אידמפוטנטי — נבנה מחדש מתוך מסמכי החברות בכל ריצה.
 *  בייצור השוטף התחזוקה נעשית ב-functions/index.js.
 *
 *  שימוש:  node scripts/sync-storage-claims.mjs [--env test|prod|both]
 * ========================================================================== */

import { readFileSync } from "node:fs";
import { loadEnv } from "../server/env.mjs";

loadEnv();

const argv = process.argv.slice(2);
const i = argv.indexOf("--env");
const which = i !== -1 && argv[i + 1] ? argv[i + 1] : "both";
const targets = which === "both" ? ["test", "prod"] : [which];

const { initializeApp, cert } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const { getAuth } = await import("firebase-admin/auth");

const sa = JSON.parse(readFileSync("./firebase-service-account.json", "utf8"));
const app = initializeApp({ credential: cert(sa) });
const db = getFirestore(app);
const auth = getAuth(app);

//  נאסף לכל המשתמשים בבת אחת, כדי לא לדרוס claim של סביבה אחת בשנייה.
const byUser = new Map();

for (const env of targets) {
  const root = db.collection("envs").doc(env);
  const weddings = await root.collection("weddings").get();

  for (const w of weddings.docs) {
    const members = await w.ref.collection("members").get();
    for (const m of members.docs) {
      if (!byUser.has(m.id)) byUser.set(m.id, {});
      const claims = byUser.get(m.id);
      const key = `w_${env}`;
      claims[key] = [...(claims[key] ?? []), w.id];
    }
  }
}

let updated = 0;
let failed = 0;

for (const [userId, fresh] of byUser) {
  try {
    const user = await auth.getUser(userId);
    //  שמירת claims קיימים שאינם שלנו.
    const merged = { ...(user.customClaims ?? {}), ...fresh };
    await auth.setCustomUserClaims(userId, merged);
    updated++;
    const summary = targets.map((e) => `${e}:${(fresh[`w_${e}`] ?? []).length}`).join(" ");
    console.log(`  ✓ ${(user.email ?? userId).padEnd(32)} ${summary}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${userId} — ${err.code ?? err.message}`);
  }
}

console.log(`\n  ${updated} משתמשים עודכנו${failed ? ` · ${failed} נכשלו` : ""}`);
console.log("  ⚠ הטוקן בדפדפן מתרענן אחת לשעה — כניסה מחדש מחילה מיד.\n");
process.exit(failed === 0 ? 0 : 1);
