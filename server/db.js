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

//  שני מצבים צפויים דורשים ניסיון חוזר: 40001 (CockroachDB רץ ב-SERIALIZABLE)
//  וחיבור שנפל או קלאסטר שמתעורר מחוסר תנועה.
const MAX_RETRIES = 3;

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

/* ── חיבור שנפל מול שגיאה בשאילתה ───────────────────────────────────────────
 *  קלאסטר CockroachDB Basic מצטמצם לאפס כשאין אליו תנועה, ומתעורר רק
 *  כשמישהו מתחבר. הבקשה הראשונה אחרי יממה של שקט היא זו שמעירה אותו,
 *  והיא זו שנכשלת. בלי הרשימות האלה כשל כזה עלה עד ה-UI כמסך שגיאה, וכל
 *  מה שהיה חסר זה ניסיון שני שנייה אחר כך.
 *
 *  הרשימות מכוונות במפורש ולא "כל שגיאה": חזרה על שאילתה שנכשלה אמיתית
 *  רק מכפילה עומס ומסתירה באגים.
 */

//  SQLSTATE של מחלקה 08 = connection exception. 57P01/57P03 = השרת סוגר
//  את החיבור או עדיין אינו מוכן לקבל חיבורים — בדיוק מצב ההתעוררות.
const CONNECTION_SQLSTATES = new Set([
  "08000", "08001", "08003", "08004", "08006", "08007", "57P01", "57P02", "57P03",
]);

//  שגיאות ברמת הסוקט. הן מגיעות בלי SQLSTATE, עם code של libuv.
const CONNECTION_SYSCALLS = new Set([
  "ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT",
  "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH",
]);

//  pg מדווח על חלק מהמקרים בהודעה בלבד, בלי שום code. שימו לב ששתי הודעות
//  שונות מתארות את אותו אירוע: הסוקט פולט 'Connection terminated unexpectedly',
//  אבל שאילתה שנשלחת אחרי שהוא כבר מת נדחית ב-'…is not queryable'. חסרה אחת
//  מהן — והניסיון החוזר לא מתרחש בדיוק במקרה שבשבילו הוא נכתב.
//  'timeout exceeded when trying to connect' הוא ה-connectionTimeoutMillis
//  שלנו, כלומר הקלאסטר לא הספיק להתעורר בזמן.
const CONNECTION_MESSAGES =
  /connection terminated|connection ended|not queryable|socket hang up|timeout exceeded when trying to connect|server closed the connection/i;

export function isConnectionError(err) {
  if (!err) return false;
  if (CONNECTION_SQLSTATES.has(err.code) || CONNECTION_SYSCALLS.has(err.code)) return true;
  return CONNECTION_MESSAGES.test(err.message || "");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── למה החיבור צריך מאזין error משלו ──────────────────────────────────────
 *  ה-Pool של pg מאזין ל-'error' רק על חיבורים שיושבים בטל. ברגע שחיבור
 *  מושאל (connect) האחריות עוברת אלינו. אם הסוקט מת בדיוק אז — וזה בדיוק
 *  מה שקורה כשהקלאסטר נרדם באמצע בקשה — Client פולט 'error' בלי שאף אחד
 *  מאזין, ו-Node מפיל את **כל השרת** ב-"Unhandled 'error' event".
 *
 *  המאזין נרשם פעם אחת לכל חיבור פיזי (הסימון ב-Symbol) ולא מוסר לעולם:
 *  הסרה בזמן ה-release הייתה מחזירה בדיוק את חלון הזמן שאותו באנו לסגור,
 *  ורישום חוזר בכל השאלה היה מצטבר עד MaxListenersExceededWarning.
 */
const GUARDED = Symbol("wp:errorGuard");

function guardClient(client) {
  if (client[GUARDED]) return;
  client[GUARDED] = true;
  //  התפקיד היחיד כאן הוא למנוע קריסה ולתעד. הטיפול בשגיאה עצמה נעשה
  //  בלולאת הניסיונות, שמקבלת אותה דרך ה-Promise של השאילתה.
  client.on("error", (err) => console.error("[db] client error:", err.message));
}

/**  40001 נפתר במילישניות; קלאסטר שמתעורר צריך שניות. שתי ההשהיות שונות
 *   כדי שהמקרה הנפוץ לא ישלם על המקרה הנדיר.  */
function backoffMs(attempt, connection) {
  return connection ? Math.min(4000, 500 * 2 ** attempt) : 50 * 2 ** attempt;
}

async function runTransaction(setup, fn) {
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let client;
    try {
      client = await getPool().connect();
      guardClient(client);
    } catch (err) {
      //  הכשל הוא בהתחברות עצמה, עוד לפני שנפתחה טרנזקציה. זה המסלול
      //  שבו נופלת הבקשה הראשונה אל קלאסטר ישן, ולכן הוא חייב לנסות שוב.
      lastError = err;
      if (!isConnectionError(err) || attempt === MAX_RETRIES) throw err;
      console.warn(`[db] חיבור נכשל (ניסיון ${attempt + 1}): ${err.message}`);
      await sleep(backoffMs(attempt, true));
      continue;
    }

    let broken = false;
    try {
      await client.query("BEGIN");
      await setup(client);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      lastError = err;
      broken = isConnectionError(err);
      //  ROLLBACK על סוקט מת רק תוקע עוד timeout. אם החיבור נפל,
      //  הטרנזקציה כבר בוטלה בצד השרת ואין מה לגלגל אחורה.
      if (!broken) await client.query("ROLLBACK").catch(() => {});
      if ((broken || isRetryable(err)) && attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt, broken));
        continue;
      }
      throw err;
    } finally {
      //  release(err) זורק את החיבור מהבריכה במקום להחזיר אותו. בלי זה
      //  אותו סוקט מת נשלף שוב ושוב וכל ניסיון חוזר נכשל מאותה סיבה.
      if (broken) {
        client.release(lastError);
      } else {
        await client.query("RESET ROLE").catch(() => {});
        client.release();
      }
    }
  }

  throw lastError;
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

/**
 * מעיר את הקלאסטר ומוודא שיש בבריכה חיבור חי. רץ בעליית השרת
 * ואחר כך מדי כמה דקות, כדי שהמשתמש לא יהיה זה שמשלם על ההתעוררות.
 * עובר דרך runTransaction, ולכן הוא עצמו מנסה שוב על כשל חיבור.
 */
export function pingDatabase() {
  return withAdmin((q) => q("SELECT 1"));
}
