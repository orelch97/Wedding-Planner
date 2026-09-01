/* =============================================================================
 *  api.js — נתיבי ה-API
 * -----------------------------------------------------------------------------
 *  עיקרון מנחה: השרת לא מחליט מי רשאי לראות מה. הוא רק מצהיר מי המשתמש
 *  (withUser), וה-RLS ב-CockroachDB אוכף. בדיקות בקוד כאן הן לשיפור הודעות
 *  השגיאה — לא הן הגבול.
 *
 *  withAdmin מופיע רק במקומות שבהם אין ברירה: הזדהות, ומימוש הזמנה (המוזמן
 *  עדיין אינו חבר, ולכן RLS יסתיר ממנו את ההזמנה).
 * ========================================================================== */

import express from "express";
import { randomBytes } from "node:crypto";
import { withUser, withAdmin } from "./db.js";
import {
  registerUser,
  authenticateUser,
  addPartnerToWedding,
  resendPartnerSetup,
  createSession,
  destroySession,
  validateCredentials,
  normalizeEmail,
  createPasswordReset,
  consumePasswordReset,
  sessionCookie,
  clearCookie,
  hashToken,
  asText,
} from "./auth.js";
import { sendPasswordResetEmail, sendPartnerWelcomeEmail, APP_URL } from "./mailer.js";

/* ── סכימת הטבלאות: רשימת עמודות לבנה ─────────────────────────────────────
 *  שמות הטבלאות והעמודות לעולם לא מגיעים מהלקוח. הלקוח שולח מפתח לוגי
 *  ('guests'), והשרת מתרגם. זה מה שמונע SQL injection דרך שמות מזהים,
 *  שאותם אי אפשר לקשור כפרמטרים.
 */
const ENTITIES = {
  guests: {
    table: "guests",
    columns: [
      "name", "phone", "category", "seats", "mention", "source",
      "probably_coming", "considering", "glatt", "drinkers", "rsvp", "gift",
    ],
    jsonColumns: [],
    //  עמודות NOT NULL. ה-INSERT מונה את כל העמודות מפורשות, ולכן
    //  שדה חסר היה נשלח כ-NULL ודורס את ברירת המחדל של העמודה.
    defaults: {
      name: "", seats: 1, probably_coming: false, considering: false,
      glatt: false, drinkers: 0, rsvp: "pending", gift: 0,
    },
  },
  tables: {
    table: "seating_tables",
    columns: ["name", "type", "guest_ids"],
    jsonColumns: ["guest_ids"],
    defaults: { name: "", type: "standard", guest_ids: [] },
  },
  vendors: {
    table: "vendors",
    columns: [
      "name", "type", "phone", "email",
      "contract_cost", "deposit", "notes", "tasks",
    ],
    jsonColumns: ["tasks"],
    defaults: { name: "", contract_cost: 0, deposit: 0, tasks: [] },
  },
  budget: {
    table: "budget_items",
    //  vendor_id = הספק שממנו נוצר הסעיף, או NULL לסעיף שהוקלד ידנית.
    columns: ["category", "expected", "actual", "paid", "vendor_id"],
    jsonColumns: [],
    defaults: { category: "", expected: 0, actual: 0, paid: 0 },
  },
  checklist: {
    table: "checklist_items",
    columns: ["title", "category", "assignee", "done", "position"],
    jsonColumns: [],
    defaults: { title: "", category: "", assignee: "both", done: false, position: 0 },
  },
};

const CHUNK = 400; // מגבלת הפרמטרים בפרוטוקול היא 65535

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ── היקפי שיתוף (scopes) ──────────────────────────────────────────────────
 *  היקף = מסך במערכת. 'all' = הכול, כולל הדאשבורד הראשי.
 *  האכיפה עצמה היא במדיניות ה-RLS (ראו db/002_scopes_and_files.sql);
 *  הניקוי כאן רק מונע שמירת ערכי זבל בעמודה.
 */
const SCOPE_KEYS = ["guests", "vendors", "finance", "checklist"];

function sanitizeScopes(input) {
  if (!Array.isArray(input)) return ["all"];
  if (input.includes("all")) return ["all"];
  const picked = SCOPE_KEYS.filter((s) => input.includes(s));
  if (!picked.length) return null; // שיתוף בלי אף מסך הוא חסר משמעות
  return picked.length === SCOPE_KEYS.length ? ["all"] : picked;
}

/* ── קבצים מצורפים לספק ────────────────────────────────────────────────── */

const MAX_FILE_BYTES = 5 * 1024 * 1024;

//  מכסה לכל חתונה. הקבצים יושבים בעמודת BYTES במסד עצמו, ולכן חתונה אחת
//  שמעלה בלי גבול פוגעת בכל הלקוחות. 200MB ו-300 קבצים הם הרבה מעבר
//  לחוזים והצעות מחיר של אירוע אחד.
const MAX_FILES_PER_WEDDING = 300;
const MAX_BYTES_PER_WEDDING = 200 * 1024 * 1024;

//  רק הטיפוסים האלה מוגשים inline. SVG לא נמצא ברשימה בכוונה — הוא מסמך
//  שמריץ סקריפטים, והגשתו inline מאותו origin שקולה ל-XSS מאוחסן.
const INLINE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const router = express.Router();

/* ── עזרים ─────────────────────────────────────────────────────────────── */

function fail(res, status, code) {
  res.status(status).json({ error: code });
}

/** עוטף handler אסינכרוני כך ששגיאה לא תפיל את התהליך ולא תדלוף החוצה. */
function route(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireAuth(req, res, next) {
  if (!req.user) return fail(res, 401, "not_authenticated");
  next();
}

function weddingId(req, res) {
  const id = req.params.id;
  if (!UUID_RE.test(id)) {
    fail(res, 400, "invalid_wedding_id");
    return null;
  }
  return id;
}

function mapWedding(row, role, scopes = ["all"]) {
  return {
    id: row.id,
    name: row.name,
    weddingDate: row.wedding_date ?? null,
    partnerA: row.partner_a ?? "",
    partnerB: row.partner_b ?? "",
    ownerId: row.owner_id,
    createdAt: row.created_at,
    role,
    scopes: Array.isArray(scopes) && scopes.length ? scopes : ["all"],
  };
}

/* -----------------------------------------------------------------------------
 *  הגדרות ברמת החתונה (יעד תקציב, קטגוריות מוזמנים, כותרות מסך התקציב)
 * -------------------------------------------------------------------------- */

/**  הגדרות הן JSONB חופשי, ולכן זהו גבול המערכת: מותר רק מה שברשימה הלבנה,
 *   וכל ערך נחתך לגודל סביר כדי שלקוח לא יוכל לנפח את השורה ללא הגבלה.  */
const MAX_CATEGORIES = 60;
const MAX_LABELS = 40;

//  לאיזה היקף שיתוף שייך כל מפתח הגדרות. שיתוף חלקי חייב להתנהג כאן בדיוק
//  כמו בטבלאות הנתונים: מי ששותפו איתו רק המוזמנים לא אמור לראות את יעד
//  התקציב, ובוודאי לא לדרוס אותו.
const SETTING_SCOPE = {
  budgetGoal: "finance",
  financeLabels: "finance",
  categories: "guests",
};

/**  מחזיר רק את המפתחות שנשלחו בפועל, כדי שכתיבה תהיה מיזוג ולא החלפה.
 *   בלי זה, לקוח שרואה חלק מההגדרות היה מוחק בשמירה את מה שלא ראה.  */
function sanitizeSettings(raw, allowed = null) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const may = (key) => !allowed || allowed.includes(SETTING_SCOPE[key]);
  const out = {};

  if (src.budgetGoal !== undefined && may("budgetGoal")) {
    const goal = Number(src.budgetGoal);
    if (Number.isFinite(goal) && goal >= 0) out.budgetGoal = Math.min(goal, 1e12);
  }

  if (Array.isArray(src.categories) && may("categories")) {
    const seen = new Set();
    for (const c of src.categories) {
      const name = String(c ?? "").trim().slice(0, 60);
      if (name) seen.add(name);
      if (seen.size >= MAX_CATEGORIES) break;
    }
    out.categories = [...seen];
  }

  if (
    src.financeLabels &&
    typeof src.financeLabels === "object" &&
    !Array.isArray(src.financeLabels) &&
    may("financeLabels")
  ) {
    const labels = {};
    for (const [k, v] of Object.entries(src.financeLabels)) {
      if (Object.keys(labels).length >= MAX_LABELS) break;
      const key = String(k).slice(0, 40);
      const val = String(v ?? "").slice(0, 80);
      if (key && val) labels[key] = val;
    }
    out.financeLabels = labels;
  }

  return out;
}

/* ── נוכחות חברים ──────────────────────────────────────────────────────────
 *  wedding_members.last_seen_at עונה על שאלה אחת של בעל החתונה: מי נכנס
 *  בפועל, ומי עובד כאן ברגע זה. הכתיבה מווסתת ויוצאת מהטרנזקציה מאותה סיבה
 *  בדיוק שתוארה ב-server/auth.js לגבי app.sessions.last_seen_at — הדפדפן
 *  שולח כמה בקשות סנכרון במקביל, וכתיבה של שדה סטטיסטי בתוך טרנזקציית
 *  Serializable הפילה שמירות אמיתיות ב-40001. שדה תצוגה לא מפיל שמירה.
 *  המפה מונעת כתיבה חוזרת; היא נמחקת מעצמה כדי שלא תגדל ללא גבול.
 */
const MEMBER_TOUCH_MS = 5 * 60_000;
const memberTouched = new Map();

function touchMembership(wid, userId) {
  const key = `${wid}:${userId}`;
  const now = Date.now();
  if (now - (memberTouched.get(key) ?? 0) < MEMBER_TOUCH_MS) return;
  //  מסמנים לפני הכתיבה ולא אחריה, אחרת כמה בקשות מקבילות ייצאו יחד.
  memberTouched.set(key, now);
  withAdmin((q) =>
    q(
      `UPDATE public.wedding_members SET last_seen_at = now()
        WHERE wedding_id = $1 AND user_id = $2`,
      [wid, userId]
    )
  ).then(
    //  0 שורות = הפונה אינו חבר בחתונה (ה-RLS כבר לא החזיר לו כלום). אסור
    //  שהניסיון הזה יחסום את הרישום האמיתי אם הוא יצטרף בדקות הקרובות.
    (result) => {
      if (!result?.rowCount) memberTouched.delete(key);
    },
    () => memberTouched.delete(key)
  );
}

setInterval(() => {
  const cutoff = Date.now() - MEMBER_TOUCH_MS;
  for (const [key, at] of memberTouched) if (at < cutoff) memberTouched.delete(key);
}, MEMBER_TOUCH_MS).unref();

/** ההיקפים של המשתמש הנוכחי בחתונה. `null` (או 'all') = גישה מלאה. */
async function memberScopes(q, wid, userId) {
  const { rows } = await q(
    `SELECT scopes FROM public.wedding_members
      WHERE wedding_id = $1 AND user_id = $2`,
    [wid, userId]
  );
  const scopes = rows[0]?.scopes;
  if (!Array.isArray(scopes) || !scopes.length || scopes.includes("all")) return null;
  return scopes;
}

/**
 * תאריך חתונה: `null` כשלא נשלח, מחרוזת 'YYYY-MM-DD' כשתקין, `false` כששגוי.
 * שלושה מצבים ולא שניים, כי "לא נשלח" ו"נשלח שגוי" חייבים להתנהג אחרת.
 */
function normalizeDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = asText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  //  הרגקס לבדו מקבל 2027-02-31. Date מנרמל תאריך כזה ליום אחר, ולכן
  //  השוואה חזרה למחרוזת המקורית היא מה שפוסל אותו.
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === text ? text : false;
}

/* ── תקרות אורך לשדות חופשיים ──────────────────────────────────────────────
 *  ה-RLS מחליט *מי* רשאי לכתוב, אבל לא *כמה*. בלי תקרה, בעל חשבון לגיטימי
 *  אחד (או סקריפט שרץ עם העוגייה שלו) יכול לדחוף מגה-בייט למחרוזת בכל
 *  סנכרון ולנפח את מסד הנתונים ללא גבול. עמודות TEXT ב-CockroachDB חסרות
 *  אורך מוגדר, ולכן זו התקרה היחידה שקיימת.
 *  הגזירה היא חיתוך שקט ולא שגיאה: הלקוח לעולם לא שולח ערכים כאלה בעצמו,
 *  ושגיאה כאן הייתה מכשילה סנכרון שלם בגלל שדה בודד.
 */
const MAX_TEXT = 300;
const TEXT_LIMITS = { notes: 5_000, mention: 1_000 };
const MAX_JSON_CHARS = 200_000; // לוח משימות / רשימת מושבים לשולחן

/** מנקה שורה נכנסת לפי הרשימה הלבנה. שדות לא מוכרים נזרקים בשקט. */
function sanitizeRow(cfg, raw, wid) {
  const id = Number(raw?.id);
  if (!Number.isInteger(id)) throw new HttpError(400, "invalid_row_id");

  const values = [wid, id];
  for (const col of cfg.columns) {
    let v = raw[col];
    if (v === undefined || v === null) v = cfg.defaults[col] ?? null;
    if (cfg.jsonColumns.includes(col)) {
      v = JSON.stringify(v ?? []);
      if (v.length > MAX_JSON_CHARS) throw new HttpError(413, "row_too_large");
    } else if (typeof v === "string") {
      v = v.slice(0, TEXT_LIMITS[col] ?? MAX_TEXT);
    } else if (typeof v === "object") {
      //  אובייקט בעמודה סקלרית הוא תמיד קלט זדוני או באג בלקוח. pg היה
      //  מסדר אותו כמחרוזת ומכניס זבל לעמודה, ולכן הוא נופל לברירת המחדל.
      v = cfg.defaults[col] ?? null;
    }
    values.push(v);
  }
  return values;
}

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

/* =============================================================================
 *  הזדהות
 * ========================================================================== */

//  הגבלת קצב פשוטה בזיכרון על נתיבי ההזדהות. מטרתה לעכב ניחוש סיסמאות.
//  בפריסה מרובת-מופעים צריך מנגנון משותף (Redis / הגבלה ברמת ה-CDN).
const attempts = new Map();
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 20;

/**
 * סופר **ניסיונות ניחוש** בלבד, ולא כל פנייה. הגבלה שסופרת גם הצלחות
 * מענישה שיתוף רשת תקין (משרד, אולם, NAT ביתי) שבו הרבה אנשים מתחברים
 * כרגיל מאותו IP, בלי להוסיף שום הגנה. גם 400 על קלט פסול (מייל לא תקין,
 * סיסמה קצרה) אינו ניחוש אלא טעות הקלדה, ולכן נספר רק 401.
 * `countAlways` נועד לנתיבים שבהם *כל* פנייה היא ניסיון: שכחתי סיסמה
 * (שמחזיר 200 תמיד בכוונה, ואחרת הופך למכונת שליחת מיילים) ומימוש טוקן.
 */
function makeRateLimit(countAlways = false, extraCodes = []) {
  return function rateLimit(req, res, next) {
    const key = req.ip || "unknown";
    const now = Date.now();
    const entry = attempts.get(key);

    if (entry && now <= entry.resetAt && entry.count >= MAX_ATTEMPTS) {
      return fail(res, 429, "too_many_attempts");
    }

    res.on("finish", () => {
      const counted =
        countAlways ||
        res.statusCode === 401 ||
        extraCodes.includes(res.statusCode);
      if (!counted) return;
      const cur = attempts.get(key);
      if (!cur || Date.now() > cur.resetAt) {
        attempts.set(key, { count: 1, resetAt: Date.now() + WINDOW_MS });
      } else {
        cur.count++;
      }
    });

    next();
  };
}

const rateLimit = makeRateLimit();
const rateLimitAlways = makeRateLimit(true);
//  בהרשמה, 409 “המייל כבר רשום” הוא מידע שימושי למשתמש אמיתי, אבל
//  בלולאה הוא הופך לסורק שמגלה אילו כתובות רשומות במערכת.
const rateLimitRegister = makeRateLimit(false, [409]);

/*  צירוף בן/בת זוג שולח מייל לכתובת שהמשתמש הקליד, ויוצר חשבון.
 *  בלי תקרה, חשבון לגיטימי אחד הופך את השרת למכונת שליחת מיילים.
 *  מונה נפרד מזה של ההזדהות בכוונה: ניסיון כאן לא אמור לנעול את מסך
 *  ההתחברות לאותו IP.  */
const partnerAttempts = new Map();
const PARTNER_WINDOW_MS = 60 * 60_000;
const MAX_PARTNER_ADDS = 10;

function rateLimitPartner(req, res, next) {
  const key = req.ip || "unknown";
  const now = Date.now();
  const entry = partnerAttempts.get(key);

  if (!entry || now > entry.resetAt) {
    partnerAttempts.set(key, { count: 1, resetAt: now + PARTNER_WINDOW_MS });
    return next();
  }
  if (++entry.count > MAX_PARTNER_ADDS) return fail(res, 429, "too_many_attempts");
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of partnerAttempts) {
    if (now > entry.resetAt) partnerAttempts.delete(key);
  }
}, PARTNER_WINDOW_MS).unref();

/**  קורא למייל היידוע בלי להמתין לו. הצירוף כבר נשמר במסד, וכשל דואר
 *   (או SMTP שלא הוגדר כלל) לא אמור לעכב את התשובה ובוודאי שלא להפיל אותה.  */
function notifyPartner(partner, ownerEmail) {
  if (!partner || partner.alreadyMember) return;
  const setupLink = partner.setupToken
    ? `${APP_URL}/?reset=${encodeURIComponent(partner.setupToken)}`
    : null;
  Promise.resolve(
    sendPartnerWelcomeEmail(partner.email, {
      ownerEmail,
      created: partner.created,
      setupLink,
    })
  ).catch(() => {});
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) if (now > entry.resetAt) attempts.delete(key);
}, WINDOW_MS).unref();

/* ── תקרת תעבורה כללית ─────────────────────────────────────────────────────
 *  ההגבלה שלמעלה שומרת רק על ההזדהות. אחרי התחברות אחת אפשר היה להריץ
 *  לולאה אינסופית מול /data או מול העלאת קבצים, ולשרוף את מכסת מסד הנתונים
 *  ואת התעבורה של האתר. זו תקרה רחבה בכוונה — היא לא אמורה להיתקל בשימוש
 *  אנושי (אפילו סנכרון מלא הוא כמה עשרות בקשות), רק לעצור לולאה.
 *  המונה בזיכרון התהליך: אחרי פריסה הוא מתאפס, וכשירוצו כמה מופעים כל אחד
 *  יספור לחוד. להגבלה אמיתית בקנה מידה גדול צריך Redis או שכבת CDN.
 */
const traffic = new Map();
const TRAFFIC_WINDOW_MS = 60_000;
const MAX_REQUESTS = 300;

router.use((req, res, next) => {
  const key = req.ip || "unknown";
  const now = Date.now();
  const entry = traffic.get(key);

  if (!entry || now > entry.resetAt) {
    traffic.set(key, { count: 1, resetAt: now + TRAFFIC_WINDOW_MS });
    return next();
  }
  if (++entry.count > MAX_REQUESTS) {
    res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
    return fail(res, 429, "too_many_requests");
  }
  next();
});

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of traffic) if (now > entry.resetAt) traffic.delete(key);
}, TRAFFIC_WINDOW_MS).unref();

router.post(
  "/auth/register",
  rateLimitRegister,
  route(async (req, res) => {
    const creds = validateCredentials(req.body?.email, req.body?.password, {
      isRegistration: true,
    });
    if (creds.error) return fail(res, 400, creds.error);

    //  תאריך החתונה נקבע כבר בהרשמה. הוא רשות — אפשר להירשם בלי לדעת עדיין.
    const date = normalizeDate(req.body?.weddingDate);
    if (date === false) return fail(res, 400, "invalid_date");

    //  מייל בן/בת הזוג רשות. נבדק *לפני* יצירת המשתמש, כדי שכתובת שגויה
    //  תיפסל בהודעה ברורה ולא תשאיר חשבון חצי-מוגדר.
    const partnerRaw = req.body?.partnerEmail;
    let partnerEmail = null;
    if (partnerRaw != null && asText(partnerRaw).trim() !== "") {
      partnerEmail = normalizeEmail(partnerRaw);
      if (!partnerEmail) return fail(res, 400, "invalid_partner_email");
      if (partnerEmail === creds.email.toLowerCase()) return fail(res, 400, "partner_same_email");
    }

    //  נרשמים דרך קישור הזמנה: בודקים את ההזמנה לפני יצירת המשתמש, כדי לא
    //  לפתוח לו חתונה פרטית משלו. חתונה כזו הופכת אותו לבעלים עם גישה מלאה
    //  ומציגה לו את כל תפריט המערכת — למרות שההזמנה הוגבלה למסך אחד.
    const inviteToken = asText(req.body?.inviteToken);
    const pending = inviteToken ? await withAdmin((q) => loadInvite(q, inviteToken)) : null;
    const invite = pending?.invite ?? null;
    const joining =
      !!invite && (!invite.email || invite.email.toLowerCase() === creds.email.toLowerCase());

    const result = await registerUser(creds.email, creds.password, date, {
      createWedding: !joining,
      //  מצטרף לחתונה קיימת אינו הבעלים שלה, ולכן אין לו את מי לצרף.
      partnerEmail: joining ? null : partnerEmail,
    });
    if (result.error) return fail(res, 409, result.error);

    let joinedWeddingId = null;
    if (joining) {
      const joined = await withAdmin((q) =>
        redeemInvite(q, invite, result.user.id, creds.email)
      );
      joinedWeddingId = joined.weddingId ?? null;
    }

    notifyPartner(result.partner, result.user.email);

    const { token, expiresAt } = await createSession(result.user.id);
    res.setHeader("Set-Cookie", sessionCookie(token, expiresAt));
    res.json({
      user: result.user,
      joinedWeddingId,
      partner: result.partner
        ? { email: result.partner.email, created: result.partner.created }
        : null,
    });
  })
);

router.post(
  "/auth/login",
  rateLimit,
  route(async (req, res) => {
    const creds = validateCredentials(req.body?.email, req.body?.password);
    //  לא מסגירים אם הכשל הוא בפורמט, במייל או בסיסמה.
    if (creds.error) return fail(res, 401, "invalid_credentials");

    const user = await authenticateUser(creds.email, creds.password);
    if (!user) return fail(res, 401, "invalid_credentials");

    const { token, expiresAt } = await createSession(user.id);
    res.setHeader("Set-Cookie", sessionCookie(token, expiresAt));
    res.json({ user });
  })
);

router.post(
  "/auth/logout",
  route(async (req, res) => {
    await destroySession(req.sessionToken);
    res.setHeader("Set-Cookie", clearCookie());
    res.json({ ok: true });
  })
);

router.get("/auth/me", (req, res) => {
  if (!req.user) return fail(res, 401, "not_authenticated");
  res.json({ user: { id: req.user.userId, email: req.user.email } });
});

//  בקשת איפוס סיסמה. **תמיד** מחזיר 200 עם אותו גוף, גם אם הכתובת אינה
//  רשומה: תשובה שונה הייתה הופכת את הטופס לכלי לגילוי מי רשום במערכת.
router.post(
  "/auth/forgot",
  rateLimitAlways,
  route(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (email) {
      const reset = await createPasswordReset(email);
      if (reset) {
        const link = `${APP_URL}/?reset=${encodeURIComponent(reset.token)}`;
        await sendPasswordResetEmail(reset.email, link);
      }
    }
    res.json({ ok: true });
  })
);

//  קביעת סיסמה חדשה מתוך הקישור שנשלח במייל. הטוקן עצמו הוא ההוכחה —
//  אין כאן requireAuth, כי מי ששכח סיסמה מטבע הדברים אינו מחובר.
router.post(
  "/auth/reset",
  rateLimitAlways,
  route(async (req, res) => {
    const password = asText(req.body?.password);
    if (password.length < 8) return fail(res, 400, "weak_password");
    if (password.length > 200) return fail(res, 400, "password_too_long");

    const result = await consumePasswordReset(asText(req.body?.token), password);
    if (result.error) return fail(res, 400, result.error);

    //  לא מחברים אוטומטית: consumePasswordReset מוחק את כל הסשנים, וזו
    //  בדיוק המטרה. המשתמש יתחבר מחדש עם הסיסמה החדשה.
    res.setHeader("Set-Cookie", clearCookie());
    res.json({ ok: true });
  })
);

/* =============================================================================
 *  חתונות
 * ========================================================================== */

router.get(
  "/weddings",
  requireAuth,
  route(async (req, res) => {
    const rows = await withUser(req.user.userId, async (q) => {
      const { rows } = await q(
        `SELECT w.id, w.name, w.wedding_date, w.partner_a, w.partner_b,
                w.owner_id, w.created_at, m.role, m.scopes
           FROM public.wedding_members m
           JOIN public.weddings w ON w.id = m.wedding_id
          WHERE m.user_id = $1
          ORDER BY w.created_at`,
        [req.user.userId]
      );
      return rows;
    });
    res.json(rows.map((r) => mapWedding(r, r.role, r.scopes)));
  })
);

router.post(
  "/weddings",
  requireAuth,
  route(async (req, res) => {
    const name = asText(req.body?.name).trim().slice(0, 120) || "החתונה שלי";
    const date = req.body?.date || null;
    if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return fail(res, 400, "invalid_date");
    }

    const wedding = await withUser(req.user.userId, async (q) => {
      const { rows } = await q(
        `INSERT INTO public.weddings (name, wedding_date, owner_id)
         VALUES ($1, $2, $3)
         RETURNING id, name, wedding_date, partner_a, partner_b, owner_id, created_at`,
        [name, date, req.user.userId]
      );
      //  אין טריגרים כאן — החברות נוצרת מפורשות, באותה טרנזקציה.
      await q(
        `INSERT INTO public.wedding_members (wedding_id, user_id, owner_id, role)
         VALUES ($1, $2, $2, 'owner') ON CONFLICT DO NOTHING`,
        [rows[0].id, req.user.userId]
      );
      return rows[0];
    });

    res.status(201).json(mapWedding(wedding, "owner"));
  })
);

//  עדכון שם/תאריך/שמות בני הזוג. ה-RLS על weddings מתיר UPDATE לבעלים בלבד,
//  ולכן 0 שורות = אין הרשאה (או שהחתונה לא קיימת) — בשני המקרים 403.
//  העדכון חלקי: רק שדות שנשלחו בפועל משתנים, כדי ששינוי שם לא ימחק תאריך.
router.patch(
  "/weddings/:id",
  requireAuth,
  route(async (req, res) => {
    const wid = weddingId(req, res);
    if (!wid) return;

    const sets = [];
    const values = [wid];
    const push = (column, value) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };

    if (req.body?.name !== undefined) {
      const name = asText(req.body.name).trim().slice(0, 120);
      if (!name) return fail(res, 400, "invalid_name");
      push("name", name);
    }

    if (req.body?.date !== undefined) {
      const date = req.body.date || null;
      if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
        return fail(res, 400, "invalid_date");
      }
      push("wedding_date", date);
    }

    //  שם ריק הוא ערך לגיטימי: כך מוחקים בן/בת זוג שהוזנו בטעות.
    for (const [key, column] of [
      ["partnerA", "partner_a"],
      ["partnerB", "partner_b"],
    ]) {
      if (req.body?.[key] === undefined) continue;
      push(column, asText(req.body[key]).trim().slice(0, 80));
    }

    if (!sets.length) return fail(res, 400, "no_changes");

    const row = await withUser(req.user.userId, async (q) => {
      const { rows } = await q(
        `UPDATE public.weddings SET ${sets.join(", ")}
          WHERE id = $1
      RETURNING id, name, wedding_date, partner_a, partner_b, owner_id, created_at`,
        values
      );
      return rows[0] ?? null;
    });

    if (!row) return fail(res, 403, "not_allowed");
    res.json(mapWedding(row, "owner"));
  })
);

/* =============================================================================
 *  חברים והזמנות
 * ========================================================================== */

router.get(
  "/weddings/:id/members",
  requireAuth,
  route(async (req, res) => {
    const wid = weddingId(req, res);
    if (!wid) return;

    //  ה-RLS מחזיר אפס שורות אם המשתמש אינו חבר — זו בדיקת ההרשאה עצמה.
    const members = await withUser(req.user.userId, async (q) => {
      const { rows } = await q(
        `SELECT user_id, role, scopes, created_at, last_seen_at
           FROM public.wedding_members
          WHERE wedding_id = $1 ORDER BY created_at`,
        [wid]
      );
      return rows;
    });
    if (!members.length) return fail(res, 403, "not_a_member");

    //  app_user חסום מ-app.users בכוונה; המיילים נשלפים רק אחרי שה-RLS אישר.
    const emails = await withAdmin(async (q) => {
      const { rows } = await q(`SELECT id, email FROM app.users WHERE id = ANY($1::UUID[])`, [
        members.map((m) => m.user_id),
      ]);
      return new Map(rows.map((r) => [r.id, r.email]));
    });

    //  זמן הפעילות הוא מידע על אנשים אחרים, ולכן הוא נשלח לבעל החתונה בלבד.
    //  ה-RLS ממילא מחזיר לחבר רגיל רק את השורה שלו, אבל תנאי מפורש כאן שומר
    //  שהמידע לא ידלוף אם המדיניות תשתנה מתישהו.
    const viewerIsOwner = members.some(
      (m) => m.user_id === req.user.userId && m.role === "owner"
    );

    res.json(
      members.map((m) => ({
        userId: m.user_id,
        email: emails.get(m.user_id) ?? "",
        role: m.role,
        scopes: m.scopes?.length ? m.scopes : ["all"],
        createdAt: m.created_at,
        lastSeenAt: viewerIsOwner || m.user_id === req.user.userId ? m.last_seen_at : null,
      }))
    );
  })
);

/**
 *  צירוף בן/בת זוג לחתונה קיימת. בעל החתונה בלבד.
 *
 *  להבדיל מהזמנה רגילה, כאן לא נוצר קישור שצריך למסור: החשבון נפתח מיד עם
 *  אותה סיסמה, כדי שבני הזוג יוכלו לעבוד שניהם בלי שום שלב ביניים. המחיר
 *  הוא שטעות הקלדה בכתובת פותחת חשבון על שם אדם זר, ולכן נשלח לשם מייל
 *  יידוע — זו רשת הביטחון היחידה, ולכן היא חובה ולא רשות.
 */
router.post(
  "/weddings/:id/partner",
  requireAuth,
  rateLimitPartner,
  route(async (req, res) => {
    const wid = weddingId(req, res);
    if (!wid) return;

    const email = normalizeEmail(req.body?.email);
    if (!email) return fail(res, 400, "invalid_email");

    const result = await addPartnerToWedding(wid, req.user.userId, email);
    if (result.error) {
      const status = { not_found: 404, not_allowed: 403, cannot_invite_self: 400 };
      return fail(res, status[result.error] ?? 400, result.error);
    }

    notifyPartner(result.partner, req.user.email);

    res.status(201).json({
      userId: result.partner.userId,
      email: result.partner.email,
      created: result.partner.created,
      alreadyMember: result.partner.alreadyMember,
    });
  })
);

/**  הנפקה מחדש של קישור קביעת הסיסמה, למקרה שהקודם פג או המייל לא הגיע.  */
router.post(
  "/weddings/:id/partner/:userId/resend",
  requireAuth,
  rateLimitPartner,
  route(async (req, res) => {
    const wid = weddingId(req, res);
    if (!wid) return;
    if (!UUID_RE.test(req.params.userId)) return fail(res, 400, "invalid_user_id");

    const result = await resendPartnerSetup(wid, req.user.userId, req.params.userId);
    if (result.error) {
      const status = { not_found: 404, not_allowed: 403, not_a_member: 404 };
      return fail(res, status[result.error] ?? 400, result.error);
    }

    Promise.resolve(
      sendPartnerWelcomeEmail(result.email, {
        ownerEmail: req.user.email,
        created: true,
        setupLink: `${APP_URL}/?reset=${encodeURIComponent(result.token)}`,
      })
    ).catch(() => {});

    res.json({ ok: true, email: result.email });
  })
);

/** עדכון הרשאות של חבר קיים (תפקיד ו/או מסכים). בעלים בלבד — נאכף ב-RLS. */router.patch(
  "/weddings/:id/members/:userId",
  requireAuth,
  route(async (req, res) => {
    const wid = weddingId(req, res);
    if (!wid) return;
    if (!UUID_RE.test(req.params.userId)) return fail(res, 400, "invalid_user_id");

    const role = req.body?.role;
    if (role !== "editor" && role !== "viewer") return fail(res, 400, "invalid_role");
    const scopes = sanitizeScopes(req.body?.scopes);
    if (!scopes) return fail(res, 400, "invalid_scopes");

    //  מדיניות wedding_members_update חוסמת role='owner' ומאפשרת רק לבעלים.
    const updated = await withUser(req.user.userId, async (q) => {
      const { rowCount } = await q(
        `UPDATE public.wedding_members SET role = $3, scopes = $4::TEXT[]
          WHERE wedding_id = $1 AND user_id = $2`,
        [wid, req.params.userId, role, scopes]
      );
      return rowCount;
    });

    if (!updated) return fail(res, 403, "not_allowed");
    res.json({ ok: true });
  })
);

router.delete(
  "/weddings/:id/members/:userId",
  requireAuth,
  route(async (req, res) => {
    const wid = weddingId(req, res);
    if (!wid) return;
    if (!UUID_RE.test(req.params.userId)) return fail(res, 400, "invalid_user_id");

    const removed = await withUser(req.user.userId, async (q) => {
      const { rowCount } = await q(
        `DELETE FROM public.wedding_members WHERE wedding_id = $1 AND user_id = $2`,
        [wid, req.params.userId]
      );
      return rowCount;
    });

    if (!removed) return fail(res, 403, "not_allowed");
    res.json({ ok: true });
  })
);

/**
 *  מאתר הזמנה שעדיין ניתן לממש. הבדיקות כאן אינן תלויות במשתמש.
 *  מחזיר `{ invite }` או `{ error }`.
 */
async function loadInvite(q, token) {
  const { rows } = await q(
    `SELECT id, wedding_id, email, role, scopes, expires_at, accepted_at
       FROM public.wedding_invites WHERE token_hash = $1`,
    [hashToken(token)]
  );
  if (!rows.length) return { error: "invite_not_found" };

  const invite = rows[0];
  if (invite.accepted_at) return { error: "invite_already_used" };
  if (new Date(invite.expires_at) <= new Date()) return { error: "invite_expired" };
  return { invite };
}

/**
 *  מממש הזמנה עבור משתמש קיים. חייב לרוץ תחת `withAdmin`: המוזמן עדיין
 *  אינו חבר, ולכן RLS מסתיר ממנו את שורת ההזמנה.
 *
 *  הזמנה עם `email` צמודה לאותה כתובת בלבד. הזמנת קישור (`email = NULL`)
 *  פתוחה לכל מי שמחזיק בטוקן — ולכן היא נתפסת אטומית, כדי ששני אנשים
 *  שקיבלו את אותה הודעה לא ייכנסו שניהם.
 */
async function redeemInvite(q, invite, userId, emailLower) {
  if (invite.email && invite.email.toLowerCase() !== String(emailLower).toLowerCase()) {
    return { error: "invite_email_mismatch" };
  }

  //  התפיסה קודמת לצירוף: `WHERE accepted_at IS NULL` הוא מה שהופך את
  //  ההזמנה לחד-פעמית גם כששתי בקשות מגיעות באותו רגע.
  const claimed = await q(
    `UPDATE public.wedding_invites SET accepted_at = now()
      WHERE id = $1 AND accepted_at IS NULL RETURNING id`,
    [invite.id]
  );
  if (!claimed.rowCount) return { error: "invite_already_used" };

  await q(
    `INSERT INTO public.wedding_members (wedding_id, user_id, owner_id, role, scopes)
     SELECT w.id, $2::UUID, w.owner_id, $3, $4::TEXT[]
       FROM public.weddings w WHERE w.id = $1::UUID
     ON CONFLICT (wedding_id, user_id)
     DO UPDATE SET role = excluded.role, scopes = excluded.scopes
           WHERE public.wedding_members.role <> 'owner'`,
    [invite.wedding_id, userId, invite.role, invite.scopes ?? ["all"]]
  );

  return { weddingId: invite.wedding_id };
}

router.post(
  "/weddings/:id/invites",
  requireAuth,
  route(async (req, res) => {
    const wid = weddingId(req, res);
    if (!wid) return;

    //  המייל הוא רשות. כשהוא קיים ההזמנה נצמדת אליו (וההשוואה תמיד
    //  ב-lowercase, כמו `users.email_lower`); כשהוא ריק נוצרת הזמנת
    //  קישור שכל מי שמחזיק בטוקן יכול לממש — פעם אחת בלבד.
    const raw = req.body?.email;
    const wantsEmail = raw != null && asText(raw).trim() !== "";
    let email = null;
    if (wantsEmail) {
      const normalized = normalizeEmail(raw);
      if (!normalized) return fail(res, 400, "invalid_email");
      email = normalized.toLowerCase();
      //  הזמנה עצמית הייתה מורידה את הבעלים לתפקיד נמוך יותר ונועלת אותו
      //  מחוץ לחתונה שלו, כי מדיניות ה-UPDATE אוסרת להחזיר role='owner'.
      if (email === String(req.user.email ?? "").toLowerCase()) {
        return fail(res, 400, "cannot_invite_self");
      }
    }

    const role = req.body?.role;
    if (role !== "editor" && role !== "viewer") return fail(res, 400, "invalid_role");
    const scopes = sanitizeScopes(req.body?.scopes);
    if (!scopes) return fail(res, 400, "invalid_scopes");

    //  הטוקן נוצר כאן ומוחזר פעם אחת בלבד; במסד נשמר רק ה-hash שלו.
    const token = randomBytes(32).toString("base64url");

    const invite = await withUser(req.user.userId, async (q) => {
      const { rows } = await q(
        `INSERT INTO public.wedding_invites (wedding_id, email, role, scopes, token_hash, created_by)
         VALUES ($1, $2, $3, $4::TEXT[], $5, $6)
         RETURNING id, email, role, scopes, expires_at`,
        [wid, email, role, scopes, hashToken(token), req.user.userId]
      );
      return rows[0];
    });

    res.status(201).json({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      scopes: invite.scopes,
      token,
      expiresAt: invite.expires_at,
    });
  })
);

router.post(
  "/invites/accept",
  requireAuth,
  route(async (req, res) => {
    const token = asText(req.body?.token);
    if (!token) return fail(res, 400, "invite_not_found");

    const result = await withAdmin(async (q) => {
      const found = await loadInvite(q, token);
      if (found.error) return found;

      const me = await q(`SELECT email_lower FROM app.users WHERE id = $1`, [
        req.user.userId,
      ]);
      return redeemInvite(q, found.invite, req.user.userId, me.rows[0]?.email_lower ?? "");
    });

    if (result.error) return fail(res, 400, result.error);
    res.json(result);
  })
);

/* =============================================================================
 *  נתוני החתונה
 * ========================================================================== */

router.get(
  "/weddings/:id/data",
  requireAuth,
  route(async (req, res) => {
    const wid = weddingId(req, res);
    if (!wid) return;

    const data = await withUser(req.user.userId, async (q) => {
      const out = {};
      for (const [key, cfg] of Object.entries(ENTITIES)) {
        const cols = ["id", ...cfg.columns].join(", ");
        const { rows } = await q(
          `SELECT ${cols} FROM public.${cfg.table}
            WHERE wedding_id = $1 AND deleted_at IS NULL`,
          [wid]
        );
        out[key] = rows;
      }
      //  ההגדרות נשלחות יחד עם הנתונים כדי שטעינת המסך תישאר בקשה אחת,
      //  ומסוננות לפי היקף השיתוף כמו כל שאר הנתונים.
      const { rows: s } = await q(
        `SELECT data FROM public.wedding_settings WHERE wedding_id = $1`,
        [wid]
      );
      out.settings = sanitizeSettings(s[0]?.data, await memberScopes(q, wid, req.user.userId));
      return out;
    });

    //  אחרי ה-RLS: מי שלא חבר בחתונה לא מגיע לכאן בכלל.
    touchMembership(wid, req.user.userId);
    res.json(data);
  })
);

//  שמירת הגדרות. ה-RLS על wedding_settings מתיר כתיבה לכל מי שיכול לערוך את
//  החתונה (can_edit_wedding), ולא לבעלים בלבד — קטגוריות ויעד תקציב הם נתון
//  שיתופי. 0 שורות = אין הרשאה.
router.put(
  "/weddings/:id/settings",
  requireAuth,
  route(async (req, res) => {
    const wid = weddingId(req, res);
    if (!wid) return;

    const row = await withUser(req.user.userId, async (q) => {
      const scopes = await memberScopes(q, wid, req.user.userId);
      const patch = sanitizeSettings(req.body?.settings, scopes);
      //  מיזוג (`||`) ולא החלפה: מי ששותף איתו רק מסך המוזמנים שומר רק את
      //  הקטגוריות, ואסור שהשמירה הזו תמחק את יעד התקציב שהוא לא רואה.
      const { rows } = await q(
        `INSERT INTO public.wedding_settings (wedding_id, data)
         VALUES ($1::UUID, $2::JSONB)
         ON CONFLICT (wedding_id) DO UPDATE
            SET data = public.wedding_settings.data || excluded.data, updated_at = now()
         RETURNING data`,
        [wid, JSON.stringify(patch)]
      );
      return rows[0] ? { data: rows[0].data, scopes } : null;
    });

    if (!row) return fail(res, 403, "not_allowed");
    res.json({ settings: sanitizeSettings(row.data, row.scopes) });
  })
);

router.get(
  "/weddings/:id/empty",
  requireAuth,
  route(async (req, res) => {
    const wid = weddingId(req, res);
    if (!wid) return;

    const empty = await withUser(req.user.userId, async (q) => {
      for (const cfg of Object.values(ENTITIES)) {
        const { rows } = await q(
          `SELECT 1 FROM public.${cfg.table} WHERE wedding_id = $1 LIMIT 1`,
          [wid]
        );
        if (rows.length) return false;
      }
      return true;
    });

    res.json({ empty });
  })
);

/** upsert של מקטע שורות אחד. */
async function upsertChunk(q, cfg, wid, rows) {
  const allCols = ["wedding_id", "id", ...cfg.columns];
  //  CockroachDB רגיש יותר מ-PostgreSQL בהסקת טיפוסים של פרמטרים,
  //  ולכן כל עמודה מקבלת המרה מפורשת.
  const casts = allCols.map((c) => {
    if (c === "wedding_id") return "::UUID";
    if (c === "id") return "::INT8";
    return cfg.jsonColumns.includes(c) ? "::JSONB" : "";
  });
  const width = allCols.length;
  const values = [];
  const tuples = [];

  rows.forEach((raw, i) => {
    values.push(...sanitizeRow(cfg, raw, wid));
    const base = i * width;
    tuples.push(`(${casts.map((cast, c) => `$${base + c + 1}${cast}`).join(", ")})`);
  });

  const updates = cfg.columns
    .map((c) => `${c} = excluded.${c}`)
    .concat("deleted_at = NULL", "updated_at = now()")
    .join(", ");

  await q(
    `INSERT INTO public.${cfg.table} (${allCols.join(", ")})
     VALUES ${tuples.join(", ")}
     ON CONFLICT (wedding_id, id) DO UPDATE SET ${updates}`,
    values
  );
}

router.post(
  "/weddings/:id/sync",
  requireAuth,
  route(async (req, res) => {
    const wid = weddingId(req, res);
    if (!wid) return;

    const key = req.body?.key;
    //  גישה ישירה לאובייקט מחזירה גם תכונות שירשה (“__proto__”, “toString”)
    //  ומעבירה קלט פסול הלאה עד לכשל 500 במקום להידחות כאן.
    const cfg = Object.hasOwn(ENTITIES, key) ? ENTITIES[key] : null;
    if (!cfg) return fail(res, 400, "invalid_dataset");

    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const removed = Array.isArray(req.body?.removedIds)
      ? req.body.removedIds.map(Number).filter(Number.isInteger)
      : [];

    await withUser(req.user.userId, async (q) => {
      for (let i = 0; i < rows.length; i += CHUNK) {
        await upsertChunk(q, cfg, wid, rows.slice(i, i + CHUNK));
      }
      if (removed.length) {
        //  מחיקה רכה: שום דבר לא נמחק לצמיתות.
        await q(
          `UPDATE public.${cfg.table} SET deleted_at = now(), updated_at = now()
            WHERE wedding_id = $1::UUID AND id = ANY($2::INT8[])`,
          [wid, removed]
        );
      }
    });

    touchMembership(wid, req.user.userId);
    res.json({ ok: true });
  })
);

/** זריעה ראשונית של כמה datasets בבת אחת. */
router.post(
  "/weddings/:id/seed",
  requireAuth,
  route(async (req, res) => {
    const wid = weddingId(req, res);
    if (!wid) return;

    const datasets = req.body?.datasets;
    if (!datasets || typeof datasets !== "object") return fail(res, 400, "invalid_body");

    await withUser(req.user.userId, async (q) => {
      for (const [key, cfg] of Object.entries(ENTITIES)) {
        const rows = Array.isArray(datasets[key]) ? datasets[key] : [];
        for (let i = 0; i < rows.length; i += CHUNK) {
          await upsertChunk(q, cfg, wid, rows.slice(i, i + CHUNK));
        }
      }
    });

    res.json({ ok: true });
  })
);

/* =============================================================================
 *  קבצים מצורפים לספק (חוזים, הצעות מחיר, תמונות)
 * -----------------------------------------------------------------------------
 *  הקבצים יושבים באותו מסד ותחת אותו RLS כמו שאר הנתונים, בהיקף 'vendors'.
 *  אין URL ציבורי ואין bucket — ההורדה עוברת דרך נתיב מאומת בלבד.
 * ========================================================================== */

/** מזהה ספק — מספר שלם. */
function vendorIdParam(req, res) {
  const id = Number(req.params.vendorId);
  if (!Number.isInteger(id)) {
    fail(res, 400, "invalid_vendor_id");
    return null;
  }
  return id;
}

/** שם קובץ בטוח לכותרת Content-Disposition. */
function safeFileName(name) {
  const clean = asText(name)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"\\/:*?<>|]/g, "_")
    .trim()
    .slice(0, 120);
  return clean || "attachment";
}

/** גרסת ASCII בלבד — כותרות HTTP אינן יכולות להכיל תווים מעל 0x7f (עברית). */
function asciiFileName(name) {
  const ascii = safeFileName(name).replace(/[^\x20-\x7e]/g, "_").trim();
  return ascii.replace(/^_+$/, "") || "attachment";
}

router.get(
  "/weddings/:id/files",
  requireAuth,
  route(async (req, res) => {
    const wid = weddingId(req, res);
    if (!wid) return;

    const rows = await withUser(req.user.userId, async (q) => {
      const { rows } = await q(
        `SELECT id, vendor_id, name, mime, size, created_at
           FROM public.vendor_files WHERE wedding_id = $1
          ORDER BY created_at`,
        [wid]
      );
      return rows;
    });

    res.json(
      rows.map((r) => ({
        id: r.id,
        vendorId: Number(r.vendor_id),
        name: r.name,
        mime: r.mime,
        size: Number(r.size),
        createdAt: r.created_at,
      }))
    );
  })
);

router.post(
  "/weddings/:id/vendors/:vendorId/files",
  requireAuth,
  route(async (req, res) => {
    const wid = weddingId(req, res);
    if (!wid) return;
    const vendorId = vendorIdParam(req, res);
    if (vendorId === null) return;

    const name = safeFileName(req.body?.name);
    const mime = asText(req.body?.mime).slice(0, 100) || "application/octet-stream";
    const b64 = asText(req.body?.data);
    if (!b64) return fail(res, 400, "empty_file");

    const buf = Buffer.from(b64, "base64");
    if (!buf.length) return fail(res, 400, "empty_file");
    if (buf.length > MAX_FILE_BYTES) return fail(res, 413, "file_too_large");

    //  ה-FK אל vendors מבטיח שאי אפשר לתלות קובץ על ספק שאינו קיים,
    //  וה-RLS מבטיח שהספק שייך לחתונה שהמשתמש מורשה לערוך.
    //  הבדיקה המקדימה קיימת רק כדי להחזיר שגיאה מובנת: ספק שזה עתה נוצר
    //  בלקוח עדיין לא הספיק להיסנכרן (debounce של 800ms).
    const file = await withUser(req.user.userId, async (q) => {
      const exists = await q(
        `SELECT 1 FROM public.vendors WHERE wedding_id = $1 AND id = $2`,
        [wid, vendorId]
      );
      if (!exists.rows.length) throw new HttpError(409, "vendor_not_synced");

      //  מכסת אחסון לחתונה. בלעדיה כל בעל חשבון יכול להעלות קבצים של 5MB
      //  בלולאה עד שהמסד מתמלא — הגבלה לקובץ בודד אינה מגבילה כמות.
      //  הספירה בתוך אותה טרנזקציה של ה-INSERT, ולכן שתי העלאות מקבילות
      //  לא יכולות לחמוק שתיהן מעבר לתקרה.
      const used = await q(
        `SELECT count(*)::INT8 AS files, coalesce(sum(size), 0)::INT8 AS bytes
           FROM public.vendor_files WHERE wedding_id = $1`,
        [wid]
      );
      if (Number(used.rows[0].files) >= MAX_FILES_PER_WEDDING) {
        throw new HttpError(413, "file_quota_exceeded");
      }
      if (Number(used.rows[0].bytes) + buf.length > MAX_BYTES_PER_WEDDING) {
        throw new HttpError(413, "storage_quota_exceeded");
      }

      const { rows } = await q(
        `INSERT INTO public.vendor_files (wedding_id, vendor_id, name, mime, size, data)
         VALUES ($1::UUID, $2::INT8, $3, $4, $5::INT8, $6)
         RETURNING id, vendor_id, name, mime, size, created_at`,
        [wid, vendorId, name, mime, buf.length, buf]
      );
      return rows[0];
    });

    res.status(201).json({
      id: file.id,
      vendorId: Number(file.vendor_id),
      name: file.name,
      mime: file.mime,
      size: Number(file.size),
      createdAt: file.created_at,
    });
  })
);

router.get(
  "/weddings/:id/files/:fileId",
  requireAuth,
  route(async (req, res) => {
    const wid = weddingId(req, res);
    if (!wid) return;
    if (!UUID_RE.test(req.params.fileId)) return fail(res, 400, "invalid_file_id");

    const file = await withUser(req.user.userId, async (q) => {
      const { rows } = await q(
        `SELECT name, mime, data FROM public.vendor_files
          WHERE wedding_id = $1 AND id = $2`,
        [wid, req.params.fileId]
      );
      return rows[0] ?? null;
    });
    if (!file) return fail(res, 404, "file_not_found");

    const inline = INLINE_MIME.has(file.mime) && req.query.download !== "1";

    //  כל מה שאינו תמונה מוכרת יורד כקובץ אטום, לעולם לא מתפרש כ-HTML.
    res.setHeader("Content-Type", inline ? file.mime : "application/octet-stream");
    //  filename מכיל ASCII בלבד (מגבלת HTTP), ו-filename* נושא את השם המלא
    //  בעברית לפי RFC 5987. דפדפנים מודרניים מעדיפים את השני.
    res.setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename="${asciiFileName(file.name)}"; ` +
        `filename*=UTF-8''${encodeURIComponent(safeFileName(file.name))}`
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(file.data);
  })
);

router.delete(
  "/weddings/:id/files/:fileId",
  requireAuth,
  route(async (req, res) => {
    const wid = weddingId(req, res);
    if (!wid) return;
    if (!UUID_RE.test(req.params.fileId)) return fail(res, 400, "invalid_file_id");

    const removed = await withUser(req.user.userId, async (q) => {
      const { rowCount } = await q(
        `DELETE FROM public.vendor_files WHERE wedding_id = $1 AND id = $2`,
        [wid, req.params.fileId]
      );
      return rowCount;
    });

    if (!removed) return fail(res, 404, "file_not_found");
    res.json({ ok: true });
  })
);

export { router, HttpError };
