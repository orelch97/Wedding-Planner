/* =============================================================================
 *  auth.js — הזדהות (מחליף את Supabase Auth)
 * -----------------------------------------------------------------------------
 *  • סיסמאות: scrypt עם salt אקראי לכל משתמש. אין תלות חיצונית.
 *  • סשנים: טוקן אקראי של 32 בייט. במסד נשמר רק SHA-256 שלו, כך שדליפת
 *    הטבלה לא מאפשרת להתחזות לסשן פעיל.
 *  • הטוקן נשלח בעוגיית httpOnly + SameSite=Strict — לא נגיש ל-JavaScript,
 *    ולכן XSS לא יכול לגנוב אותו, ו-CSRF חוצה-אתרים נחסם.
 * ========================================================================== */

import {
  scrypt,
  randomBytes,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { withAdmin } from "./db.js";

const scryptAsync = promisify(scrypt);

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_DAYS = 30;
const COOKIE_NAME = "wp_session";
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200; // חוסם DoS דרך scrypt על קלט ענק

/*  המזהה של המשתמש הוא **כתובת מייל**. זה לא רק תווית: המייל הוא הערוץ
 *  היחיד שדרכו אפשר להחזיר גישה למי ששכח סיסמה, ולכן חייבים לוודא שהוא
 *  תקין כבר בהרשמה. אין כאן אימות בעלות על התיבה (לא נשלח מייל אישור),
 *  אבל כתובת שגויה פשוט לא תקבל את קישור האיפוס.
 *
 *  הרגקס מכוון להיות שמרני ולא "חכם": מקומי@דומיין.סיומת, בלי רווחים,
 *  בלי פסיקים ובלי סוגריים. תקן RFC 5322 המלא מתיר צורות אקזוטיות שאף
 *  ספק דואר אמיתי לא מנפיק, וקבלתן רק פותחת פתח לטעויות הקלדה.  */
export const MAX_EMAIL = 254;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/*  גוף הבקשה הוא JSON של הלקוח, ולכן שדה "מחרוזת" יכול להגיע ככל דבר.
 *  ל-String() יש מלכודת: אובייקט כמו {"toString": 1} מפיל אותה ב-TypeError
 *  ("Cannot convert object to primitive value"), והבקשה חוזרת 500 במקום דחייה מסודרת.
 *  על נתיב לא-מזוהה זהו גם וקטור להצפת לוגים בזול. שדה שאינו מחרוזת
 *  פשוט אינו קלט תקין, ולכן הוא מטופל כריק. */
export function asText(value) {
  return typeof value === "string" ? value : "";
}

/** בודק שכתובת המייל תקינה ומחזיר אותה מנוקה, או `null`. */
export function normalizeEmail(value) {
  const trimmed = asText(value).trim();
  if (!trimmed || trimmed.length > MAX_EMAIL) return null;
  if (!EMAIL_RE.test(trimmed)) return null;
  //  כל חלק ב"מקומי" רגיש-רישיות לפי התקן, אבל בפועל אף ספק לא מבחין.
  //  שמירה באותיות קטנות מונעת שני חשבונות לאותה תיבה.
  return trimmed.toLowerCase();
}

//  hash "מבזבז" שמשמש להשוואה מדומה כשהמייל לא קיים, כדי שזמן התגובה
//  לא יסגיר אילו כתובות רשומות במערכת.
const DUMMY_HASH = await hashPassword(randomBytes(24).toString("hex"));

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/*  \u05e4\u05e8\u05de\u05d8\u05e8\u05d9 scrypt \u05e0\u05e7\u05e8\u05d0\u05d9\u05dd \u05de\u05ea\u05d5\u05da \u05d4-hash \u05d4\u05e9\u05de\u05d5\u05e8, \u05db\u05d3\u05d9 \u05e9\u05e0\u05d5\u05db\u05dc \u05dc\u05d4\u05e2\u05dc\u05d5\u05ea \u05d0\u05d5\u05ea\u05dd \u05d1\u05e2\u05ea\u05d9\u05d3\n *  \u05d1\u05dc\u05d9 \u05dc\u05e4\u05e1\u05d5\u05dc \u05e1\u05d9\u05e1\u05de\u05d0\u05d5\u05ea \u05e7\u05d9\u05d9\u05de\u05d5\u05ea. \u05d4\u05de\u05e9\u05de\u05e2\u05d5\u05ea: \u05e2\u05e8\u05da \u05d1\u05e9\u05d5\u05e8\u05d4 \u05e9\u05dc\u05d5\u05d8\u05d4 \u05de\u05db\u05ea\u05d9\u05d1 \u05db\u05de\u05d4 \u05e2\u05d1\u05d5\u05d3\u05ea\n *  CPU \u05d4\u05e9\u05e8\u05ea \u05d9\u05e9\u05e7\u05d9\u05e2 \u05d1\u05db\u05dc \u05d4\u05ea\u05d7\u05d1\u05e8\u05d5\u05ea. N=2^30 \u05d9\u05e7\u05e4\u05d9\u05d0 \u05d0\u05ea \u05d4\u05ea\u05d4\u05dc\u05d9\u05da, \u05d5\u05dc\u05db\u05df \u05d4\u05d2\u05d1\u05d5\u05dc\u05d5\u05ea\n *  \u05de\u05d7\u05d5\u05e9\u05d1\u05d9\u05dd \u05d1\u05e7\u05d5\u05d3 \u05d5\u05dc\u05d0 \u05e0\u05dc\u05e7\u05d7\u05d9\u05dd \u05db\u05dc\u05e9\u05d5\u05e0\u05dd \u05de\u05d1\u05e1\u05d9\u05e1 \u05d4\u05e0\u05ea\u05d5\u05e0\u05d9\u05dd.  */
const SCRYPT_MAX = { N: 1 << 20, r: 32, p: 4, keylen: 128 };

function scryptParam(value, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : 0;
}

export async function verifyPassword(password, stored) {
  const parts = typeof stored === "string" ? stored.split("$") : [];
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, "base64");
  const cost = scryptParam(N, SCRYPT_MAX.N);
  const block = scryptParam(r, SCRYPT_MAX.r);
  const par = scryptParam(p, SCRYPT_MAX.p);
  if (!cost || !block || !par || !expected.length || expected.length > SCRYPT_MAX.keylen) return false;

  const actual = await scryptAsync(asText(password), Buffer.from(salt, "base64"), expected.length, {
    N: cost,
    r: block,
    p: par,
    maxmem: 256 * 1024 * 1024,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function validateCredentials(email, password, { isRegistration = false } = {}) {
  //  ולידציה מכוונת-רזה: המטרה היא לחסום קלט מופרך, לא לנסות "לתקן" כתובות.
  //  אותם כללים בהתחברות ובהרשמה — כתובת שלא עומדת בהם ממילא לא נשמרה
  //  מעולם, ולכן אין כאן סיכון לנעול חשבון קיים בחוץ.
  const normalized = normalizeEmail(email);
  if (!normalized) return { error: "invalid_email" };
  const pw = asText(password);
  if (pw.length < MIN_PASSWORD) return { error: "weak_password" };
  if (pw.length > MAX_PASSWORD) return { error: "password_too_long" };
  return { email: normalized, password: pw, isRegistration };
}

// ── סשנים ───────────────────────────────────────────────────────────────────

export async function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);

  await withAdmin((q) =>
    q(
      `INSERT INTO app.sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
      [hashToken(token), userId, expiresAt]
    )
  );

  return { token, expiresAt };
}

/*  `last_seen_at` הוא מידע תפעולי בלבד. עד עכשיו הוא עודכן בכל בקשה, בתוך
 *  אותה טרנזקציה Serializable של קריאת הסשן — והדפדפן שולח כמה בקשות סנכרון
 *  במקביל (מוזמנים, שולחנות, ספקים, תקציב). כולן כתבו לאותה שורת סשן, נוצרה
 *  התנגשות 40001 (WriteTooOldError), הניסיונות החוזרים נגמרו והבקשה חזרה 500 —
 *  כלומר **שמירה של המשתמש נכשלה בגלל שדה סטטיסטי**. לכן העדכון יצא מהטרנזקציה,
 *  הוא לא מעוכב (fire-and-forget) וכישלון שלו נבלע, וגם מווסת לפעם ב-5 דקות.  */
const TOUCH_EVERY_MS = 5 * 60_000;

function touchSession(tokenHash, lastSeenAt) {
  if (lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < TOUCH_EVERY_MS) return;
  withAdmin((q) =>
    q(`UPDATE app.sessions SET last_seen_at = now() WHERE token_hash = $1`, [tokenHash])
  ).catch(() => {});
}

export async function readSession(token) {
  if (!token) return null;
  const tokenHash = hashToken(token);

  const session = await withAdmin(async (q) => {
    const { rows } = await q(
      `SELECT s.user_id, u.email, s.last_seen_at
         FROM app.sessions s
         JOIN app.users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [tokenHash]
    );
    return rows[0] ?? null;
  });
  if (!session) return null;

  touchSession(tokenHash, session.last_seen_at);
  return { userId: session.user_id, email: session.email };
}

export async function destroySession(token) {
  if (!token) return;
  await withAdmin((q) =>
    q(`DELETE FROM app.sessions WHERE token_hash = $1`, [hashToken(token)])
  );
}

export async function destroyAllSessions(userId) {
  await withAdmin((q) => q(`DELETE FROM app.sessions WHERE user_id = $1`, [userId]));
}

export async function purgeExpiredSessions() {
  await withAdmin((q) => q(`DELETE FROM app.sessions WHERE expires_at < now()`));
}

// ── משתמשים ─────────────────────────────────────────────────────────────────

/**
 * יוצר משתמש ואת החתונה הראשונה שלו באותה טרנזקציה.
 * ב-Supabase זה היה טריגר; כאן זה מפורש.
 * @param {string|null} weddingDate  'YYYY-MM-DD' או null — נקבע כבר בהרשמה
 */
/**
 *  יוצר משתמש חדש.
 *
 *  `createWedding = false` שמור למי שנרשם דרך קישור הזמנה: פתיחת חתונה
 *  פרטית עבורו הופכת אותו לבעלים עם גישה מלאה, וזה נראה בדיוק כמו כשל
 *  אבטחה — הוא רואה את כל תפריט המערכת אף שההזמנה שקיבל הוגבלה למסך אחד.
 */
/**
 *  מצרף בן/בת זוג לחתונה, בתוך טרנזקציה קיימת.
 *
 *  לכל אחד מבני הזוג חשבון משלו עם **סיסמה שלו**. החשבון נוצר עם סיסמה
 *  אקראית שאיש אינו יודע — כולל בעל החתונה — ונשלח קישור לקביעת סיסמה.
 *  כך אף אחד לא מחזיק את הסיסמה של השני, וטעות הקלדה בכתובת לא נותנת
 *  לאדם זר חשבון עובד — רק קישור שפג תוקף.
 *
 *  התפקיד הוא 'editor' עם scopes=['all']: גישה מלאה לכל הנתונים, בלי עריכת
 *  הגדרות החתונה ובלי הזמנת אנשים נוספים — אלה שמורים לבעלים ברמת ה-RLS
 *  (weddings.owner_id). בנוסף, שורת role='owner' חסומה למחיקה במדיניות
 *  wedding_members_delete, ולכן צירוף בטעות היה בלתי הפיך.
 */
async function linkPartner(q, { weddingId, ownerId, email }) {
  const lower = email.toLowerCase();

  const found = await q(`SELECT id FROM app.users WHERE email_lower = $1`, [lower]);
  let userId = found.rows[0]?.id ?? null;
  const created = !userId;
  let setupToken = null;

  if (!userId) {
    //  סיסמה אקראית שאיש אינו מחזיק: העמודה היא NOT NULL, והכניסה
    //  היחידה האפשרית היא דרך קישור קביעת הסיסמה.
    const unusable = await hashPassword(randomBytes(32).toString("base64url"));
    const { rows } = await q(
      `INSERT INTO app.users (email, email_lower, password_hash)
       VALUES ($1, $2, $3) RETURNING id`,
      [lower, lower, unusable]
    );
    userId = rows[0].id;
    setupToken = await issueSetupToken(q, userId);
  }

  //  כבר חבר (למשל דרך הזמנה קודמת)? לא דורסים לו את ההרשאות.
  const { rowCount } = await q(
    `INSERT INTO public.wedding_members (wedding_id, user_id, owner_id, role, scopes)
     VALUES ($1, $2, $3, 'editor', ARRAY['all'])
     ON CONFLICT (wedding_id, user_id) DO NOTHING`,
    [weddingId, userId, ownerId]
  );

  return { userId, email: lower, created, alreadyMember: rowCount === 0, setupToken };
}

export async function registerUser(email, password, weddingDate = null, options = {}) {
  const { createWedding = true, partnerEmail = null } = options;
  const passwordHash = await hashPassword(password);

  return withAdmin(async (q) => {
    const existing = await q(`SELECT 1 FROM app.users WHERE email_lower = $1`, [
      email.toLowerCase(),
    ]);
    if (existing.rows.length) return { error: "email_taken" };

    const { rows } = await q(
      `INSERT INTO app.users (email, email_lower, password_hash)
       VALUES ($1, $2, $3) RETURNING id, email`,
      [email, email.toLowerCase(), passwordHash]
    );
    const user = rows[0];

    let weddingId = null;
    let partner = null;

    if (createWedding) {
      const wedding = await q(
        `INSERT INTO public.weddings (name, owner_id, wedding_date)
         VALUES ($1, $2, $3::DATE) RETURNING id`,
        ["החתונה שלי", user.id, weddingDate]
      );
      weddingId = wedding.rows[0].id;
      await q(
        `INSERT INTO public.wedding_members (wedding_id, user_id, owner_id, role)
         VALUES ($1, $2, $2, 'owner')`,
        [weddingId, user.id]
      );

      if (partnerEmail && partnerEmail.toLowerCase() !== email.toLowerCase()) {
        partner = await linkPartner(q, {
          weddingId,
          ownerId: user.id,
          email: partnerEmail,
        });
      }
    }

    return { user: { id: user.id, email: user.email }, weddingId, partner };
  });
}

/**
 * מצרף בן/בת זוג לחתונה קיימת. בעל החתונה בלבד.
 *
 * הבדיקה כאן מפורשת ולא נשענת על RLS, כי הפעולה חייבת לרוץ עם חיבור ה-admin:
 * היא נוגעת ב-app.users, שחסומה לחלוטין בפני app_user.
 */
export async function addPartnerToWedding(weddingId, ownerId, partnerEmail) {
  return withAdmin(async (q) => {
    const wedding = await q(`SELECT owner_id FROM public.weddings WHERE id = $1`, [weddingId]);
    if (!wedding.rows.length) return { error: "not_found" };
    if (wedding.rows[0].owner_id !== ownerId) return { error: "not_allowed" };

    const owner = await q(`SELECT email_lower FROM app.users WHERE id = $1`, [ownerId]);
    if (!owner.rows.length) return { error: "not_allowed" };
    if (owner.rows[0].email_lower === partnerEmail.toLowerCase()) {
      return { error: "cannot_invite_self" };
    }

    const partner = await linkPartner(q, { weddingId, ownerId, email: partnerEmail });
    return { partner };
  });
}

/**
 * מנפיק לבן/בת זוג קישור חדש לקביעת סיסמה, למקרה שהקודם פג או אבד.
 * בעל החתונה בלבד, ורק עבור מי שאכן חבר בחתונה שלו.
 */
export async function resendPartnerSetup(weddingId, ownerId, partnerUserId) {
  return withAdmin(async (q) => {
    const wedding = await q(`SELECT owner_id FROM public.weddings WHERE id = $1`, [weddingId]);
    if (!wedding.rows.length) return { error: "not_found" };
    if (wedding.rows[0].owner_id !== ownerId) return { error: "not_allowed" };

    const member = await q(
      `SELECT 1 FROM public.wedding_members WHERE wedding_id = $1 AND user_id = $2`,
      [weddingId, partnerUserId]
    );
    if (!member.rows.length) return { error: "not_a_member" };

    const user = await q(`SELECT email FROM app.users WHERE id = $1`, [partnerUserId]);
    if (!user.rows.length) return { error: "not_found" };

    const token = await issueSetupToken(q, partnerUserId);
    return { token, email: user.rows[0].email };
  });
}

export async function authenticateUser(email, password) {
  const { rows } = await withAdmin((q) =>
    q(`SELECT id, email, password_hash FROM app.users WHERE email_lower = $1`, [
      email.toLowerCase(),
    ])
  );

  if (!rows.length) {
    await verifyPassword(password, DUMMY_HASH); // השוואה מדומה — ראה DUMMY_HASH
    return null;
  }

  const ok = await verifyPassword(password, rows[0].password_hash);
  return ok ? { id: rows[0].id, email: rows[0].email } : null;
}

// ── איפוס סיסמה ─────────────────────────────────────────────────────────────

const RESET_TTL_MS = 60 * 60_000; // שעה. מספיק כדי לפתוח מייל, קצר מספיק כדי להזיק פחות אם דלף

/*  קישור קביעת סיסמה לבן/בת זוג חי שבוע ולא שעה: להבדיל מאיפוס סיסמה,
    שהמשתמש יזם בעצמו ומחכה לו, כאן ההזמנה מגיעה בלי שביקשו אותה ועלולה
    לחכות במייל כמה ימים. עדיין מוגבל בזמן, ועדיין חד-פעמי.  */
const SETUP_TTL_MS = 7 * 24 * 60 * 60_000;

/**
 * מנפיק טוקן קביעת סיסמה למשתמש ידוע. משתמש באותה טבלה ובאותו מימוש של
 * איפוס סיסמה, ולכן consumePasswordReset מטפל בשניהם ואין מסלול שני לתחזק.
 */
async function issueSetupToken(q, userId, ttlMs = SETUP_TTL_MS) {
  const token = randomBytes(32).toString("base64url");

  //  טוקן חדש מבטל קודמים, אחרת כל הנפקה מותירה עוד מפתח פעיל לחשבון.
  await q(
    `UPDATE app.password_resets SET used_at = now()
      WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );
  await q(
    `INSERT INTO app.password_resets (token_hash, user_id, expires_at)
     VALUES ($1, $2, $3)`,
    [hashToken(token), userId, new Date(Date.now() + ttlMs)]
  );

  return token;
}

/**
 * יוצר טוקן איפוס למי שהכתובת שלו רשומה. מחזיר `null` אם אין חשבון כזה —
 * והקורא **חייב** להחזיר ללקוח את אותה תשובה בשני המקרים, אחרת הטופס הופך
 * לכלי לגילוי אילו כתובות רשומות במערכת.
 */
export async function createPasswordReset(email) {
  const token = randomBytes(32).toString("base64url");

  return withAdmin(async (q) => {
    const { rows } = await q(`SELECT id, email FROM app.users WHERE email_lower = $1`, [
      email.toLowerCase(),
    ]);
    if (!rows.length) return null;

    //  בקשה חדשה מבטלת קודמות. אחרת כל בקשה מותירה עוד מפתח פעיל לחשבון.
    await q(
      `UPDATE app.password_resets SET used_at = now()
        WHERE user_id = $1 AND used_at IS NULL`,
      [rows[0].id]
    );
    await q(
      `INSERT INTO app.password_resets (token_hash, user_id, expires_at)
       VALUES ($1, $2, $3)`,
      [hashToken(token), rows[0].id, new Date(Date.now() + RESET_TTL_MS)]
    );

    return { token, email: rows[0].email };
  });
}

/**
 * מממש טוקן איפוס וקובע סיסמה חדשה.
 * @returns {Promise<{error?: string, ok?: true}>}
 */
export async function consumePasswordReset(token, newPassword) {
  if (!token) return { error: "invalid_reset_token" };
  const passwordHash = await hashPassword(newPassword);

  return withAdmin(async (q) => {
    //  שליפה ונעילה באותה טרנזקציה: `used_at IS NULL` בתנאי ה-UPDATE הוא
    //  מה שמונע מימוש כפול של אותו טוקן בשתי בקשות מקבילות.
    const { rows } = await q(
      `UPDATE app.password_resets SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [hashToken(token)]
    );
    if (!rows.length) return { error: "invalid_reset_token" };

    await q(`UPDATE app.users SET password_hash = $2 WHERE id = $1`, [
      rows[0].user_id,
      passwordHash,
    ]);
    //  מי שאיפס סיסמה כנראה חושש שמישהו נכנס לחשבון. מנתקים כל סשן קיים,
    //  אחרת התוקף נשאר מחובר בדיוק כמו קודם.
    await q(`DELETE FROM app.sessions WHERE user_id = $1`, [rows[0].user_id]);

    return { ok: true, userId: rows[0].user_id };
  });
}

export async function purgeExpiredResets() {
  await withAdmin((q) =>
    q(`DELETE FROM app.password_resets WHERE expires_at < now() - INTERVAL '7 days'`)
  );
}

// ── עוגיות ──────────────────────────────────────────────────────────────────

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function sessionCookie(token, expiresAt) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return (
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict${secure}` +
    `; Expires=${expiresAt.toUTCString()}`
  );
}

export function clearCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=0`;
}

export { COOKIE_NAME };
