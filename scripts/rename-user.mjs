/* =============================================================================
 *  rename-user.mjs — שינוי כתובת המייל של חשבון קיים
 * -----------------------------------------------------------------------------
 *  שימוש:  node scripts/rename-user.mjs <מזהה ישן> <מייל חדש>
 *
 *  המייל הוא רק מזהה — הסיסמה, הסשנים, החתונות והנתונים לא מושפעים.
 *  ההזמנות הפתוחות **כן** נצמדות לכתובת, ולכן הן מעודכנות גם הן.
 * ========================================================================== */

import { loadEnv } from "../server/env.mjs";
import { withAdmin, closePool } from "../server/db.js";
import { normalizeEmail } from "../server/auth.js";

loadEnv();

const [oldName, newName] = process.argv.slice(2);
if (!oldName || !newName) {
  console.error("שימוש: node scripts/rename-user.mjs <מזהה ישן> <מייל חדש>");
  process.exit(1);
}

const normalized = normalizeEmail(newName);
if (!normalized) {
  console.error("כתובת המייל החדשה אינה תקינה. למשל: name@example.com");
  process.exit(1);
}

try {
  await withAdmin(async (q) => {
    const taken = await q(`SELECT id FROM app.users WHERE email_lower = $1`, [
      normalized.toLowerCase(),
    ]);
    if (taken.rows.length) throw new Error(`הכתובת "${normalized}" כבר תפוסה.`);

    const { rows } = await q(
      `UPDATE app.users SET email = $2, email_lower = $3
        WHERE email_lower = $1
        RETURNING id, email`,
      [String(oldName).trim().toLowerCase(), normalized, normalized.toLowerCase()]
    );
    if (!rows.length) throw new Error(`לא נמצא משתמש בשם "${oldName}".`);


    const invites = await q(
      `UPDATE public.wedding_invites SET email = $2
        WHERE email = $1 AND accepted_at IS NULL
        RETURNING id`,
      [String(oldName).trim().toLowerCase(), normalized.toLowerCase()]
    );

    console.log(`✓ ${oldName} → ${rows[0].email}`);
    console.log(`  הזמנות פתוחות שעודכנו: ${invites.rows.length}`);
  });
} catch (err) {
  console.error("✗", err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
