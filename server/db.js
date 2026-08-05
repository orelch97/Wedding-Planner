/* =============================================================================
 *  db.js — חיבור ל-CockroachDB
 * -----------------------------------------------------------------------------
 *  שני מסלולים, ורק שניים:
 *
 *    withUser(userId, fn)  — כל מה שנוגע בנתוני חתונה. מריץ בתוך טרנזקציה
 *                            עם SET LOCAL ROLE app_user, כך שה-RLS אוכף את
 *                            הבידוד. גם אם יש באג בשרת, המסד לא ייתן לדלוף.
 *
 *    withAdmin(fn)         — רק הזדהות והקצאה ראשונית (יצירת משתמש, סשנים,
 *                            מימוש הזמנה). עוקף RLS — להשתמש רק כשאין ברירה.
 *
 *  זהות המשתמש עוברת ב-application_name בפורמט `wp:<uuid>`, כי ל-CockroachDB
 *  אין משתני סשן מותאמים. זה הדפוס שמופיע בתיעוד ה-RLS הרשמי שלהם.
 * ========================================================================== */

import pg from "pg";

const MAX_RETRIES = 3; // CockroachDB עובד ב-SERIALIZABLE — 40001 הוא מצב צפוי

//  כברירת מחדל pg מחזיר INT8 כמחרוזת, כי 2^63 לא נכנס ל-Number. כאן כל
//  ערכי ה-INT8 הם מזהי שורות שנוצרים כ-max(id)+1 וספירות, הרבה מתחת ל-2^53,
//  ולכן ההמרה בטוחה ומונעת "1" != 1 בכל הדרך עד ה-UI.
pg.types.setTypeParser(20, (value) => Number(value));

//  DATE (oid 1082) מומר כברירת מחדל ל-Date בחצות מקומית, ואז JSON.stringify
//  מסיט אותו ל-UTC ולפעמים ליום קודם. תאריך חתונה חייב להישאר בדיוק כפי
//  שהוזן, ולכן מחזירים אותו כמחרוזת 'YYYY-MM-DD' גולמית.
pg.types.setTypeParser(1082, (value) => value);

let pool = null;

export function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  pool = new pg.Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    application_name: "wp:anon",
    //  בלי הערכים האלה בקשה יכולה להיתקע לנצח: אחרי שהמחשב חוזר משינה
    //  (או אחרי ניתוק רשת) הסוקט אל CockroachDB מת בשקט, ה-TCP לא מודיע
    //  על כך, והשאילתה פשוט ממתינה — ה-UI נתקע ב"טוען…" בלי שום שגיאה.
    //  keepAlive מאלץ את מערכת ההפעלה לזהות חיבור מת, ושני ה-timeout
    //  מבטיחים שבקשה תיכשל במפורש במקום להיתלות.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 20_000),
    query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS || 25_000),
  });

  pool.on("error", (err) => {
    console.error("[db] idle client error:", err.message);
  });

  return pool;
}

function isRetryable(err) {
  return err?.code === "40001";
}

async function runTransaction(setup, fn) {
  const client = await getPool().connect();
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await client.query("BEGIN");
        await setup(client);
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        if (isRetryable(err) && attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
          continue;
        }
        throw err;
      }
    }
  } finally {
    await client.query("RESET ROLE").catch(() => {});
    client.release();
  }
}

/**
 * מריץ פעולות בהקשר של משתמש מזוהה, כפוף ל-RLS.
 * @param {string} userId  UUID של המשתמש
 * @param {(q: (text: string, params?: unknown[]) => Promise<import("pg").QueryResult>) => Promise<any>} fn
 */
export function withUser(userId, fn) {
  if (!userId) throw new Error("withUser called without a user id");

  return runTransaction(
    async (client) => {
      //  set_config מקבל פרמטר קשור; ל-SET אין תחביר כזה. חשוב, כי הערך
      //  הזה הוא שקובע את גבול הבידוד.
      await client.query("SELECT set_config('application_name', $1, true)", [
        `wp:${userId}`,
      ]);
      await client.query("SET LOCAL ROLE app_user");
    },
    (client) => fn((text, params) => client.query(text, params))
  );
}

/**
 * מריץ פעולות בהרשאות מלאות, ללא RLS. רק להזדהות והקצאה ראשונית.
 */
export function withAdmin(fn) {
  return runTransaction(
    async () => {},
    (client) => fn((text, params) => client.query(text, params))
  );
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
