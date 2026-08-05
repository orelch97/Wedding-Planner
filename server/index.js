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
import { getPool, closePool } from "./db.js";

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

app.use(express.json({ limit: "8mb" })); // ייבוא רשימת מוזמנים גדולה

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

  //  הודעות שגיאה של המסד עלולות להסגיר מבנה סכימה. נרשמות אצלנו, לא נשלחות.
  console.error("[api]", err);
  res.status(500).json({ error: "server_error" });
});

getPool();
await purgeExpiredSessions().catch((err) =>
  console.warn("[db] session cleanup skipped:", err.message)
);
setInterval(() => purgeExpiredSessions().catch(() => {}), 6 * 60 * 60_000).unref();

const server = app.listen(PORT, () => {
  console.log(`\x1b[32m✓\x1b[0m API על http://localhost:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  });
}
