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

/** בודק שכתובת המייל תקינה ומחזיר אותה מנוקה, או `null`. */
export function normalizeEmail(value) {
  const trimmed = String(value ?? "").trim();
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

export async function verifyPassword(password, stored) {
  const parts = String(stored).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
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
  const pw = String(password ?? "");
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
export async function registerUser(email, password, weddingDate = null) {
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

    const wedding = await q(
      `INSERT INTO public.weddings (name, owner_id, wedding_date)
       VALUES ($1, $2, $3::DATE) RETURNING id`,
      ["החתונה שלי", user.id, weddingDate]
    );
    await q(
      `INSERT INTO public.wedding_members (wedding_id, user_id, owner_id, role)
       VALUES ($1, $2, $2, 'owner')`,
      [wedding.rows[0].id, user.id]
    );

    return { user: { id: user.id, email: user.email } };
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
