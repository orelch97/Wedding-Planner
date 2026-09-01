/* =============================================================================
 *  backfill-wedding-ids.mjs — מילוי weddingIds על מסמכי המשתמשים
 * -----------------------------------------------------------------------------
 *  listWeddings נשען על users/{uid}.weddingIds. המשתמשים שהגיעו מההעברה
 *  נוצרו לפני שהשדה הזה היה קיים, ולכן בלי הריצה הזו הם יתחברו ויראו
 *  "אין חתונות" — למרות שהחברות שלהם קיימת.
 *
 *  אידמפוטנטי: בנוי מחדש מתוך מסמכי החברות בכל ריצה.
 *
 *  שימוש:  node scripts/backfill-wedding-ids.mjs [--env test|prod|both]
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

const sa = JSON.parse(readFileSync("./firebase-service-account.json", "utf8"));
const db = getFirestore(initializeApp({ credential: cert(sa) }));

for (const env of targets) {
  const root = db.collection("envs").doc(env);
  const weddings = await root.collection("weddings").get();

  //  נבנה מפה של משתמש → חתונות, מתוך מסמכי החברות עצמם.
  const byUser = new Map();
  for (const w of weddings.docs) {
    const members = await w.ref.collection("members").get();
    for (const m of members.docs) {
      if (!byUser.has(m.id)) byUser.set(m.id, []);
      byUser.get(m.id).push(w.id);
    }
  }

  let updated = 0;
  for (const [userId, ids] of byUser) {
    await root.collection("users").doc(userId).set({ weddingIds: ids }, { merge: true });
    updated++;
  }

  console.log(`  [${env}] ${updated} משתמשים עודכנו · ${weddings.size} חתונות נסרקו`);
  for (const [userId, ids] of byUser) {
    const u = await root.collection("users").doc(userId).get();
    console.log(`      ${(u.data()?.email ?? userId).padEnd(32)} → ${ids.length} חתונות`);
  }
}

console.log("\n✓ הושלם\n");
