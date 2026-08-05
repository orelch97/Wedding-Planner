/*  ניקוי שאריות QA: מבטל הזמנות שיתוף ממתינות שנוצרו בבדיקות על החתונה
 *  האמיתית. הזמנה ממתינה היא קישור חי לנתונים — לא משאירים אותה תלויה.  */
import { loadEnv } from "../server/env.mjs";
loadEnv();
const { withAdmin, closePool } = await import("../server/db.js");

const TEST_EMAILS = ["testshare123", "qa-share@example.test", "qa-member@example.test"];

const removed = await withAdmin(
  async (q) =>
    (
      await q(
        `DELETE FROM public.wedding_invites
          WHERE accepted_at IS NULL AND email = ANY($1::TEXT[])
      RETURNING email`,
        [TEST_EMAILS]
      )
    ).rows
);

console.log(`בוטלו ${removed.length} הזמנות ממתינות:`, removed.map((r) => r.email).join(", "));
await closePool();
