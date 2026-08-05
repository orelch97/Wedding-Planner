/*  סקריפט QA חד-פעמי: מציג הזמנות ממתינות פעילות וחשבונות אחרונים,
 *  כדי לזהות שאריות מנתוני בדיקה לפני ניקוי. קריאה בלבד.  */
import { loadEnv } from "../server/env.mjs";
loadEnv();
const { withAdmin, closePool } = await import("../server/db.js");

const invites = await withAdmin(
  async (q) =>
    (
      await q(
        `SELECT i.email, i.role, i.expires_at, w.name
           FROM public.wedding_invites i
           JOIN public.weddings w ON w.id = i.wedding_id
          WHERE i.accepted_at IS NULL AND i.expires_at > now()
          ORDER BY i.expires_at`
      )
    ).rows
);
console.log("הזמנות ממתינות פעילות:");
console.table(invites);

const users = await withAdmin(
  async (q) =>
    (
      await q(
        `SELECT u.email,
                (SELECT count(*) FROM public.wedding_members m WHERE m.user_id = u.id) AS weddings
           FROM app.users u
          ORDER BY u.created_at DESC`
      )
    ).rows
);
console.log(`\nסה״כ חשבונות: ${users.length}`);
console.log(
  "חשבונות בדיקה (test.local / example.test):",
  users.filter((u) => /@(test\.local|example\.test)$/.test(u.email)).length
);
console.log(
  "חשבונות אמיתיים:",
  users.filter((u) => !/@(test\.local|example\.test)$/.test(u.email)).map((u) => u.email)
);

await closePool();
