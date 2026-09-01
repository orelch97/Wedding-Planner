/* =============================================================================
 *  invite-flow-test.mjs — בדיקת מסלול ההזמנה מקצה לקצה
 * -----------------------------------------------------------------------------
 *  קורא ל-Cloud Functions החיות עם טוקן של משתמש אמיתי, בדיוק כמו הדפדפן.
 *  זו הדרך היחידה לבדוק את acceptInvite: הוא דורש *שני* משתמשים שונים.
 *
 *  מנקה אחרי עצמו. שימוש:  node scripts/invite-flow-test.mjs
 * ========================================================================== */

import { readFileSync } from "node:fs";
import { loadEnv } from "../server/env.mjs";

loadEnv();

const { initializeApp, cert } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const { getAuth } = await import("firebase-admin/auth");

const sa = JSON.parse(readFileSync("./firebase-service-account.json", "utf8"));
const app = initializeApp({ credential: cert(sa) });
const db = getFirestore(app);
const auth = getAuth(app);

const KEY = process.env.VITE_FIREBASE_API_KEY;
const REGION = "europe-west1";
const PROJECT = sa.project_id;
const ENV = "test";
const WID = "cb542e2b-83bb-45a2-9a24-20cc303a4bc7";
const OWNER_UID = "4ee7ba5e-2278-4ff4-af6f-4fb7af091e0e";

let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${name}${detail ? `  — ${detail}` : ""}`);
  ok ? passed++ : failed++;
};

/** מתחבר דרך Identity Toolkit ומחזיר idToken, כמו שהדפדפן עושה. */
async function signIn(email, password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (!data.idToken) throw new Error(`login failed: ${JSON.stringify(data).slice(0, 200)}`);
  return data.idToken;
}

async function callFn(name, idToken, payload) {
  const res = await fetch(`https://${REGION}-${PROJECT}.cloudfunctions.net/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data: { ...payload, env: ENV } }),
  });
  const body = await res.json();
  return { status: res.status, result: body.result, error: body.error };
}

console.log("\nמסלול הזמנה מקצה לקצה\n");

const stamp = Date.now();
const guestEmail = `invitee-qa-${stamp}@test.local`;
const guestPass = "InviteeQA!2026";
let guestUid = null;

try {
  const ownerToken = await signIn("qa-batch2@test.local", "QaFirebase!2026");
  check("בעל החתונה התחבר", !!ownerToken);

  // 1. יצירת הזמנה מוגבלת למסך אחד
  const inv = await callFn("createInvite", ownerToken, {
    weddingId: WID,
    role: "viewer",
    scopes: ["finance"],
    email: guestEmail,
  });
  check("הזמנה נוצרה", inv.status === 200 && !!inv.result?.token, JSON.stringify(inv.error ?? "").slice(0, 120));
  const token = inv.result?.token;

  // 2. הטוקן הגולמי לא נשמר במסד
  const doc = await db.collection("envs").doc(ENV).collection("invites").doc(inv.result.id).get();
  check("במסד נשמר hash בלבד", !!doc.data()?.tokenHash && doc.data()?.token === undefined);

  // 3. המוזמן נרשם ומממש
  const guest = await auth.createUser({ email: guestEmail, password: guestPass });
  guestUid = guest.uid;
  const guestToken = await signIn(guestEmail, guestPass);
  check("המוזמן התחבר", !!guestToken);

  const acc = await callFn("acceptInvite", guestToken, { token });
  check("ההזמנה מומשה", acc.status === 200 && acc.result?.weddingId === WID, JSON.stringify(acc.error ?? "").slice(0, 140));

  // 4. החברות נוצרה עם ההיקף הנכון — לא יותר
  const m = await db.collection("envs").doc(ENV).collection("weddings").doc(WID)
    .collection("members").doc(guestUid).get();
  check("מסמך חברות נוצר", m.exists);
  check("התפקיד viewer", m.data()?.role === "viewer", `role=${m.data()?.role}`);
  check("ההיקף finance בלבד", JSON.stringify(m.data()?.scopes) === '["finance"]', JSON.stringify(m.data()?.scopes));

  // 5. מימוש כפול נדחה
  const again = await callFn("acceptInvite", guestToken, { token });
  check("מימוש כפול נדחה", again.status !== 200, `status=${again.status} ${again.error?.status ?? ""}`);

  // 6. טוקן שגוי נדחה
  const bogus = await callFn("acceptInvite", guestToken, { token: "not-a-real-token" });
  check("טוקן שגוי נדחה", bogus.status !== 200, `status=${bogus.status}`);

  // 7. מי שאינו בעלים לא מנפיק הזמנות
  const notOwner = await callFn("createInvite", guestToken, {
    weddingId: WID, role: "editor", scopes: ["all"],
  });
  check("מי שאינו בעלים לא מנפיק הזמנה", notOwner.status !== 200, `status=${notOwner.status}`);
} catch (err) {
  check("הריצה הושלמה", false, err.message.slice(0, 200));
} finally {
  //  ניקוי
  if (guestUid) {
    await db.collection("envs").doc(ENV).collection("weddings").doc(WID)
      .collection("members").doc(guestUid).delete().catch(() => {});
    await db.collection("envs").doc(ENV).collection("users").doc(guestUid).delete().catch(() => {});
    await auth.deleteUser(guestUid).catch(() => {});
  }
  const stale = await db.collection("envs").doc(ENV).collection("invites")
    .where("tokenHash", "!=", null).get();
  for (const d of stale.docs) await d.ref.delete();
  console.log(`\n  ניקוי: ${guestUid ? "חשבון בדיקה נמחק · " : ""}${stale.size} הזמנות בדיקה נמחקו`);
}

console.log(`\n${failed === 0 ? "\x1b[32m" : "\x1b[31m"}${passed}/${passed + failed} עברו\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
