/* =============================================================================
 *  index.js — שרת ה-API
 * -----------------------------------------------------------------------------
 *      npm run server         (פיתוח, יחד עם npm run dev)
 *      npm start              (ייצור — מגיש גם את dist/)
 * ========================================================================== */

import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

import { loadEnv } from "./env.mjs";
loadEnv();

import { router } from "./api.js";
import { parseCookies, readSession, purgeExpiredSessions, COOKIE_NAME } from "./auth.js";
import { getPool, closePool, pingDatabase, isConnectionError } from "./db.js";
import { APP_URL } from "./mailer.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 3001);
const isProd = process.env.NODE_ENV === "production";

if (!process.env.DATABASE_URL) {
  console.error("\x1b[31mחסר DATABASE_URL ב-.env\x1b[0m");
  process.exit(1);
}

const app = express();

//  מאחורי proxy (Render / Fly / nginx) — כדי ש-req.ip יהיה אמיתי ו-Secure יזוהה.
//  בייצור זה מופעל תמיד: השרת עולה מאחורי מאזן עומסים שמסיים את ה-TLS,
//  ובלי זה כל הבקשות נראות מאותו IP — והגבלת הקצב היתה נועלת את כולם
//  בבת אחת. הערך הוא מספר הקפיצות המהימנות, ולכן אי אפשר לזייף
//  X-Forwarded-For: כל מה שמעבר להן מתעלמים ממנו.
//
//  ברירת המחדל 1 מתאימה לשרת שעומד ישירות מאחורי Render. כשהממשק מוגש
//  מאתר סטטי שמעביר /api הלאה יש קפיצה נוספת, אבל אין להעלות את הערך
//  בקלות ראש: השירות נגיש גם ישירות בכתובת שלו, ובערך גבוה מדי כל אחד
//  יכול לשלוח X-Forwarded-For משלו, להיראות כמו כתובת חדשה בכל ניסיון
//  ולעקוף את חסימת ניסיונות ההתחברות. חייב להתאים לפריסה בפועל.
const trustProxyHops = Number(process.env.TRUST_PROXY) || 1;
if (isProd || process.env.TRUST_PROXY) app.set("trust proxy", trustProxyHops);
app.disable("x-powered-by");

//  כותרות אבטחה. public/_headers עובד רק אצל מארחים סטטיים (Netlify /
//  Cloudflare Pages); כשהשרת הזה מגיש את הבילד בעצמו (Render) הן חייבות
//  לצאת מכאן, אחרת אין CSP ואין HSTS כלל. שמור על התאמה בין שני הקבצים.
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; worker-src 'self'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' data: https://fonts.gstatic.com; " +
    "img-src 'self' data: blob:; " +
    "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; " +
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

app.use((_req, res, next) => {
  res.set(SECURITY_HEADERS);
  //  HSTS רק ב-HTTPS. בפיתוח מקומי הוא היה נועל את הדפדפן על https://localhost.
  if (isProd) {
    res.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  next();
});

/* ── גודל גוף הבקשה ——————————————————————————————————
 *  רק שלושה נתיבים מעבירים נפח אמיתי: ייבוא רשימת מוזמנים והעלאת קובץ.
 *  מגבלה גלובלית של 8MB הייתה מאפשרת לכל אדם — גם ללא הזדהות, כי הפרסור
 *  רץ לפני בדיקת העוגייה — להכריח את השרת לפרסר 8MB של JSON בכל קריאה
 *  ל-/api/auth/login. שאר הנתיבים שולחים עשרות בייטים, ולכן 64kb מרווח להם.
 */
const bulkJson = express.json({ limit: "8mb" });
const smallJson = express.json({ limit: "64kb" });
const BULK_ROUTES = /^\/api\/weddings\/[^/]+\/(sync|seed|vendors\/[^/]+\/files)\/?$/;

app.use((req, res, next) =>
  (BULK_ROUTES.test(req.path) ? bulkJson : smallJson)(req, res, next)
);

/* ── הגנה מפני CSRF —————————————————————————————————————
 *  עוגיית הסשן היא SameSite=Strict, שמונעת את התקיפה בכל דפדפן עדכני.
 *  הבדיקה כאן היא השכבה השנייה: היא לא תלויה בהתנהגות הדפדפן ולא
 *  בניסוח העוגייה, ולכן גם אם אחד מהם ישתנה בעתיד ההגנה נשמרת.
 *  בקשה ללא Origin (curl, סקריפט, בדיקות) עוברת — היא אינה וקטור CSRF,
 *  שכן CSRF מוגדרת כבקשה שהדפדפן שולח לבד עם העוגייה.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const APP_ORIGIN_HOST = (() => {
  try {
    return new URL(APP_URL).host;
  } catch {
    return null;
  }
})();

app.use("/api", (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    return res.status(403).json({ error: "bad_origin" });
  }
  if (host === req.headers.host || host === APP_ORIGIN_HOST) return next();
  return res.status(403).json({ error: "bad_origin" });
});

//  בדיקת חיים ל-Render. חייבת להיות לפני זיהוי המשתמש, כדי שהיא לא תיגע
//  במסד ולא תיכשל בזמן שהמסד מתעורר. לא מחזירה שום מידע על המערכת.
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/*  כל תשובה מ-/api היא נתונים של משתמש מסוים. ה-CDN שמעביר את הבקשות
 *  אינו יודע את זה, ובלי הכותרת הזו תשובה של זוג אחד עלולה להישמר
 *  ולהיות מוגשת לזוג אחר שביקש את אותו נתיב. גם דפדפן שחוזר אחורה
 *  אחרי התנתקות לא יציג נתונים מהמטמון.  */
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

//  מזהה את המשתמש מהעוגייה. לא חוסם — כל נתיב מחליט בעצמו אם הוא דורש זיהוי.
app.use(async (req, _res, next) => {
  try {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    req.sessionToken = token || null;
    req.user = token ? await readSession(token) : null;
    next();
  } catch (err) {
    next(err);
  }
});

app.use("/api", router);

app.use("/api", (_req, res) => res.status(404).json({ error: "not_found" }));

// ── הגשת הבילד בייצור ───────────────────────────────────────────────────────
const dist = join(ROOT, "dist");
if (isProd && existsSync(dist)) {
  app.use(
    express.static(dist, {
      maxAge: "1h",
      index: false,
      setHeaders(res, filePath) {
        //  ה-Service Worker חייב להיבדק מול השרת בכל טעינה. אם הדפדפן מחזיק
        //  אותו במטמון לשעה, תיקון בלוגיקת המטמון עצמו לא מגיע למשתמשים.
        if (filePath.endsWith("sw.js")) res.set("Cache-Control", "no-cache");
      },
    })
  );
  //  ה-fallback של ה-SPA. ב-Express 5 הנתיב '*' כבר אינו חוקי (path-to-regexp
  //  זורק "Missing parameter name"), ולכן משתמשים ב-middleware רגיל.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    res.sendFile(join(dist, "index.html"));
  });
}

// ── טיפול בשגיאות ───────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  //  42501 = insufficient_privilege — כך נראית דחייה של RLS.
  if (err?.code === "42501") return res.status(403).json({ error: "forbidden" });
  if (err?.status) return res.status(err.status).json({ error: err.code });

  //  המסד לא זמין גם אחרי כל הניסיונות החוזרים. 503 ולא 500, כדי
  //  שהלקוח ידע שזה מצב זמני ששווה לנסות בגללו שוב, ולא באג קבוע.
  if (err?.code === "ECONNREFUSED" || err?.code === "ETIMEDOUT" || err?.code?.startsWith?.("08")) {
    console.error("[db] המסד אינו זמין:", err.message);
    return res.status(503).json({ error: "database_unavailable" });
  }

  //  הודעות שגיאה של המסד עלולות להסגיר מבנה סכימה. נרשמות אצלנו, לא נשלחות.
  console.error("[api]", err);
  res.status(500).json({ error: "server_error" });
});

getPool();

//  קלאסטר CockroachDB Basic נרדם כשאין אליו תנועה. בלי החימום הזה,
//  המשתמש הראשון שנכנס אחרי יממה של שקט הוא זה שממתין להתעוררות.
//  כישלון כאן אינו קטלני: הבקשה הבאה תנסה שוב דרך אותו מנגנון.
await pingDatabase().catch((err) => console.warn("[db] חימום נכשל:", err.message));

//  שומר על הקלאסטר ער כל עוד השרת חי. unref — כדי שלא יעכב כיבוי תקין.
const KEEPALIVE_MS = Number(process.env.DB_KEEPALIVE_MS || 4 * 60_000);
setInterval(() => pingDatabase().catch(() => {}), KEEPALIVE_MS).unref();

await purgeExpiredSessions().catch((err) =>
  console.warn("[db] session cleanup skipped:", err.message)
);
setInterval(() => purgeExpiredSessions().catch(() => {}), 6 * 60 * 60_000).unref();

const server = app.listen(PORT, () => {
  console.log(`\x1b[32m✓\x1b[0m API על http://localhost:${PORT}`);
});

//  רשת ביטחון אחרונה. סוקט שמת מול המסד אינו סיבה להפיל שרת שלם —
//  הבקשה שנפגעה כבר קיבלה שגיאה דרך לולאת הניסיונות, ושאר המשתמשים לא
//  אמורים לשלם על כך בהפסקת שירות. כל חריגה אחרת מפילה כרגיל:
//  מצב לא ידוע מסוכן יותר מאתחול מחדש.
process.on("uncaughtException", (err) => {
  if (isConnectionError(err)) {
    console.error("[db] חיבור נפל מחוץ לבקשה:", err.message);
    return;
  }
  console.error("[fatal]", err);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  });
}
