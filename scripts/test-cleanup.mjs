// =============================================================================
//  scripts/test-cleanup.mjs — מחיקת חשבונות הבדיקה שהבדיקות פותחות במסד.
// -----------------------------------------------------------------------------
//  test:api נרשם כמשתמש אמיתי דרך ה-API, ולכן כל ריצה משאירה אחריה כ-13
//  חשבונות. בלי ניקוי הם מצטברים (הגענו ל-199 לפני שניקינו ידנית).
//
//  הקובץ משמש בשתי דרכים:
//    1. אוטומטית בסוף test:api — עם ה-stamp של אותה ריצה בלבד.
//    2. ידנית: npm run test:cleanup — סורק ומוחק כל שארית בדיקה שנשארה,
//       למשל אחרי ריצה שקרסה באמצע או אחרי בדיקות ידניות בדפדפן.
//
//  הבטיחות היחידה שנדרשת כאן היא הדומיין: נמחקים רק חשבונות שכתובתם
//  מסתיימת באחד מדומייני הבדיקה. חשבון אמיתי לא יכול להיכנס לרשימה.
// =============================================================================

import { pathToFileURL } from "node:url";
import { loadEnv } from "../server/env.mjs";

//  קריאה חוזרת ל-loadEnv בטוחה: משתנה שכבר קיים בסביבה מנצח.
loadEnv();
const { withAdmin, closePool } = await import("../server/db.js");

//  הדומיינים שמותר למחוק. כל שינוי כאן משנה את היקף המחיקה — בזהירות.
const TEST_DOMAIN_RE = "@(test\\.local|example\\.test|scope\\.test)$";

/**
 * מוחק חשבונות בדיקה ואת כל מה שתלוי בהם (חתונות, מוזמנים, ספקים, תקציב,
 * חברויות, סשנים ואיפוסי סיסמה — הכול ב-CASCADE).
 *
 * @param {{ stamp?: number|string }} options  stamp מצמצם את המחיקה לריצה אחת.
 * @returns {Promise<{ users: number, invites: number }>}
 */
export async function purgeTestData({ stamp } = {}) {
  const only = stamp == null ? null : String(stamp);

  /*  הזמנות שנשלחו לכתובת בדיקה בתוך חתונה של משתמש אמיתי לא נמחקות
      ב-CASCADE, כי הן תלויות בחתונה ששורדת. מנקים אותן בנפרד.  */
  const invites = await withAdmin(
    async (q) =>
      (
        await q(
          `DELETE FROM public.wedding_invites
            WHERE email ~ $1
              AND ($2::TEXT IS NULL OR email LIKE '%' || $2 || '%')
        RETURNING id`,
          [TEST_DOMAIN_RE, only]
        )
      ).rowCount ?? 0
  );

  const ids = await withAdmin(
    async (q) =>
      (
        await q(
          `SELECT id FROM app.users
            WHERE email ~ $1
              AND ($2::TEXT IS NULL OR email LIKE '%' || $2 || '%')`,
          [TEST_DOMAIN_RE, only]
        )
      ).rows.map((r) => r.id)
  );

  //  מנות קטנות: מחיקה של מאות חשבונות בטרנזקציה אחת מול CockroachDB
  //  נוטה להיכשל ב-retry, ואין שום סיבה שהניקוי יהיה אטומי.
  let users = 0;
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20);
    users += await withAdmin(
      async (q) => (await q(`DELETE FROM app.users WHERE id = ANY($1::UUID[])`, [batch])).rowCount ?? 0
    );
  }

  return { users, invites };
}

//  הרצה ישירה מהטרמינל (ולא import מתוך api-test) — סריקה מלאה.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { users, invites } = await purgeTestData();
  console.log(`נמחקו ${users} חשבונות בדיקה ו-${invites} הזמנות בדיקה.`);

  const left = await withAdmin(
    async (q) => (await q(`SELECT email FROM app.users ORDER BY created_at`)).rows.map((r) => r.email)
  );
  console.log(`נשארו ${left.length} חשבונות: ${left.join(", ")}`);
  await closePool();
}
