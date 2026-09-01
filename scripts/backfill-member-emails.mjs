/* =============================================================================
 *  backfill-member-emails.mjs — הוספת email למסמכי החברות
 * -----------------------------------------------------------------------------
 *  מסך השיתוף מציג את המייל של כל חבר. שליפתו מאוסף users נחסמת בכללי
 *  האבטחה — משתמש רשאי לקרוא רק את המסמך של עצמו, אחרת כל בעל חשבון היה
 *  יכול לשלוף את כל כתובות המייל במערכת. לכן המייל נשמר על מסמך החברות.
 *
 *  אידמפוטנטי. המקור הוא Firebase Auth, שהוא מקור האמת לכתובות.
 *
 *  שימוש:  node scripts/backfill-member-emails.mjs [--env test|prod|both]
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

const emails = new Map();
let page = await auth.listUsers(1000);
for (const u of page.users) emails.set(u.uid, u.email ?? "");
while (page.pageToken) {
  page = await auth.listUsers(1000, page.pageToken);
  for (const u of page.users) emails.set(u.uid, u.email ?? "");
}

for (const env of targets) {
  const root = db.collection("envs").doc(env);
  const weddings = await root.collection("weddings").get();
  let updated = 0;
  let missing = 0;

  for (const w of weddings.docs) {
    const members = await w.ref.collection("members").get();
    for (const m of members.docs) {
      const email = emails.get(m.id);
      if (!email) {
        missing++;
        continue;
      }
      if (m.data().email === email) continue;
      await m.ref.set({ email }, { merge: true });
      updated++;
    }
  }

  console.log(`  [${env}] ${updated} שורות חברות עודכנו${missing ? ` · ${missing} בלי חשבון Auth` : ""}`);
}

console.log("\n✓ הושלם\n");
