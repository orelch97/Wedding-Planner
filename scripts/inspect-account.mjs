/* =============================================================================
 *  inspect-account.mjs — הצצה לקריאה בלבד לנתונים של חשבון
 * -----------------------------------------------------------------------------
 *  שימוש:  node scripts/inspect-account.mjs <שם משתמש>
 *
 *  מדפיס לכל חתונה של המשתמש כמה שורות יש בכל טבלה. נועד לענות על השאלה
 *  "הנתונים באמת נמחקו מהמסד, או שרק הדפדפן לא מציג אותם?" — ולכן הוא
 *  לא כותב כלום ולא נוגע ב-RLS (רץ כאדמין, קריאה בלבד).
 * ========================================================================== */

import { loadEnv } from "../server/env.mjs";
import { withAdmin, closePool } from "../server/db.js";

loadEnv();

const [username] = process.argv.slice(2);
if (!username) {
  console.error("שימוש: node scripts/inspect-account.mjs <שם משתמש>");
  process.exit(1);
}

try {
  await withAdmin(async (q) => {
    const user = await q(`SELECT id, email FROM app.users WHERE email_lower = $1`, [
      String(username).trim().toLowerCase(),
    ]);
    if (!user.rows.length) throw new Error(`לא נמצא משתמש בשם "${username}".`);
    const { id: userId, email } = user.rows[0];
    console.log(`\nמשתמש: ${email}  (${userId})`);

    const weddings = await q(
      `SELECT w.id, w.name, w.wedding_date, w.partner_a, w.partner_b, m.role
         FROM public.wedding_members m
         JOIN public.weddings w ON w.id = m.wedding_id
        WHERE m.user_id = $1
        ORDER BY w.created_at`,
      [userId]
    );

    for (const w of weddings.rows) {
      const names = [w.partner_a, w.partner_b].filter(Boolean).join(" & ") || "—";
      console.log(`\n  חתונה: ${w.name}  (${w.role})`);
      console.log(`    id:      ${w.id}`);
      console.log(`    בני הזוג: ${names}`);
      console.log(`    תאריך:   ${w.wedding_date || "—"}`);

      for (const table of ["guests", "seating_tables", "vendors", "budget_items"]) {
        //  שמות הטבלאות מגיעים מרשימה קבועה בקוד, לא מקלט של משתמש.
        //  מפרידים בין שורות פעילות למחוקות-רכות, כי `GET /data` מחזיר רק
        //  את הפעילות — ספירה כוללת מסתירה בדיוק את התקלה שמחפשים.
        const { rows } = await q(
          `SELECT count(*)::INT AS total,
                  count(*) FILTER (WHERE deleted_at IS NULL)::INT AS active,
                  max(deleted_at) AS last_deleted
             FROM public.${table} WHERE wedding_id = $1`,
          [w.id]
        );
        const { total, active, last_deleted } = rows[0];
        const suffix =
          total === active ? "" : `  ← ${total - active} מחוקות (אחרונה: ${last_deleted?.toISOString?.() ?? last_deleted})`;
        console.log(`    ${table.padEnd(15)} פעילות: ${String(active).padStart(4)}${suffix}`);
      }
    }
    console.log("");
  });
} catch (err) {
  console.error(`\n✗ ${err.message}\n`);
  process.exitCode = 1;
} finally {
  await closePool();
}
