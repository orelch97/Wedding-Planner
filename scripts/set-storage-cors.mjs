/* =============================================================================
 *  set-storage-cors.mjs — הגדרת CORS ל-bucket
 * -----------------------------------------------------------------------------
 *  הורדת קובץ באפליקציה עוברת דרך fetch ל-blob ולא דרך <a href> ישיר:
 *  קישור ישיר מנווט את הלשונית אל הקובץ, ובטלפון ה-PDF נפתח במציג המובנה
 *  והאפליקציה נעלמת בלי דרך חזרה. אבל fetch חוצה-מקור נחסם ב-CORS, ולכן
 *  ה-bucket חייב להתיר במפורש את המקורות שמהם האפליקציה מוגשת.
 *
 *  <img src> אינו מושפע — לכן התצוגה המקדימה עבדה גם לפני התיקון הזה.
 *
 *  שימוש:  node scripts/set-storage-cors.mjs
 * ========================================================================== */

import { readFileSync } from "node:fs";
import { loadEnv } from "../server/env.mjs";
import { accessToken } from "./lib/gcs.mjs";

loadEnv();

const sa = JSON.parse(readFileSync("./firebase-service-account.json", "utf8"));
const bucket = process.env.FIREBASE_STORAGE_BUCKET;

//  APP_URL מאפשר להוסיף את דומיין הייצור בלי לגעת בקוד.
//  שתי כתובות הייצור רשומות במפורש כדי שהרשימה תישאר נכונה גם כשהסקריפט
//  רץ בלי APP_URL: הראשונה היא הכניסה הראשית, והשנייה היא הכתובת הישנה
//  שממשיכה להגיש עותק של הממשק כדי שקישורים שכבר נשלחו לא יישברו.
const origins = [
  "http://localhost:5173",
  "http://localhost:5176",
  "http://localhost:4173",
  process.env.APP_URL,
  "https://wedding-planner-web.onrender.com",
  "https://wedding-planner-vixy.onrender.com",
].filter(Boolean);

const cors = [
  {
    origin: [...new Set(origins)],
    method: ["GET", "HEAD"],
    responseHeader: ["Content-Type", "Content-Disposition", "Content-Length"],
    maxAgeSeconds: 3600,
  },
];

//  שינוי מטא-דאטה של bucket דורש full_control, לא read_write.
const token = await accessToken(sa, "https://www.googleapis.com/auth/devstorage.full_control");
const res = await fetch(
  `https://storage.googleapis.com/storage/v1/b/${bucket}?fields=cors`,
  {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ cors }),
  }
);

const data = await res.json();
if (res.ok) {
  console.log(`  ✓ CORS הוגדר על ${bucket}`);
  console.log(`    מקורות מותרים: ${cors[0].origin.join(", ")}`);
} else {
  console.log(`  ✗ נכשל (${res.status}): ${JSON.stringify(data).slice(0, 400)}`);
  process.exit(1);
}
