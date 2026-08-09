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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 3001);
const isProd = process.env.NODE_ENV === "production";

if (!process.env.DATABASE_URL) {
  console.error("\x1b[31mחסר DATABASE_URL ב-.env\x1b[0m");
  process.exit(1);
}

const app = express();

//  מאחורי proxy (Render / Fly / nginx) — כדי ש-req.ip יהיה אמיתי ו-Secure יזוהה.
if (process.env.TRUST_PROXY) app.set("trust proxy", 1);
app.disable("x-powered-by");

//  כותרות אבטחה. public/_headers עובד רק אצל מארחים סטטיים (Netlify /
//  Cloudflare Pages); כשהשרת הזה מגיש את הבילד בעצמו (Render) הן חייבות
//  לצאת מכאן, אחרת אין CSP ואין HSTS כלל. שמור על התאמה בין שני הקבצים.
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; " +
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

app.use(express.json({ limit: "8mb" })); // ייבוא רשימת מוזמנים גדולה

//  בדיקת חיים ל-Render. חייבת להיות לפני זיהוי המשתמש, כדי שהיא לא תיגע
//  במסד ולא תיכשל בזמן שהמסד מתעורר. לא מחזירה שום מידע על המערכת.
app.get("/api/health", (_req, res) => res.json({ ok: true }));

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
  app.use(express.static(dist, { maxAge: "1h", index: false }));
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
