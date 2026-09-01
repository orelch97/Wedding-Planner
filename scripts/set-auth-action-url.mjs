/* =============================================================================
 *  set-auth-action-url.mjs — מפנה את קישורי המייל של Firebase לאפליקציה
 * -----------------------------------------------------------------------------
 *  כברירת מחדל קישור "שכחתי סיסמה" נוחת ב-
 *      https://<project>.firebaseapp.com/__/auth/action
 *  שהוא עמוד גנרי של Google באנגלית, ולא מחזיר את המשתמש לאתר.
 *
 *  אחרי השינוי הקישור מצביע לאפליקציה עצמה עם mode + oobCode, ו-
 *  captureResetToken ב-App.jsx קולט אותם ומציג את מסך קביעת הסיסמה בעברית.
 *
 *  שימוש:  node scripts/set-auth-action-url.mjs [url]
 * ========================================================================== */

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { loadEnv } from "../server/env.mjs";

loadEnv();

const sa = JSON.parse(readFileSync("./firebase-service-account.json", "utf8"));
const APP_URL = (process.argv[2] || process.env.APP_URL || "https://wedding-planner-vixy.onrender.com")
  .replace(/\/+$/, "");

const now = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
  iss: sa.client_email,
  scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase",
  aud: "https://oauth2.googleapis.com/token",
  exp: now + 3600,
  iat: now,
})}`;
const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");

const tr = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${unsigned}.${sig}`,
  }),
});
const { access_token } = await tr.json();
if (!access_token) {
  console.error("✗ לא התקבל טוקן");
  process.exit(1);
}

const base = `https://identitytoolkit.googleapis.com/admin/v2/projects/${sa.project_id}/config`;
const headers = { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" };

const before = await fetch(base, { headers });
if (!before.ok) {
  console.error(`✗ אין הרשאה לקרוא את הגדרות ההזדהות (${before.status}).`);
  console.error(`  ${(await before.text()).slice(0, 250)}`);
  console.error(`\n  הגדירו ידנית: Firebase Console → Authentication → Templates →`);
  console.error(`  Password reset → עריכה → Customize action URL → ${APP_URL}`);
  process.exit(2);
}
const cfg = await before.json();
console.log(`  callbackUri נוכחי: ${cfg.notification?.sendEmail?.callbackUri ?? "(ברירת מחדל של Firebase)"}`);
console.log(`  דומיינים מורשים:   ${(cfg.authorizedDomains ?? []).join(", ")}`);

//  הדומיין של האפליקציה חייב להיות ברשימת המורשים, אחרת Firebase יסרב
//  להפנות אליו והקישור יישבר.
const host = new URL(APP_URL).hostname;
const domains = cfg.authorizedDomains ?? [];
const needsDomain = !domains.includes(host);

const body = {
  notification: { sendEmail: { callbackUri: APP_URL } },
  ...(needsDomain ? { authorizedDomains: [...domains, host] } : {}),
};
const mask = needsDomain
  ? "notification.sendEmail.callbackUri,authorizedDomains"
  : "notification.sendEmail.callbackUri";

const res = await fetch(`${base}?updateMask=${mask}`, {
  method: "PATCH",
  headers,
  body: JSON.stringify(body),
});

if (!res.ok) {
  console.error(`\n✗ העדכון נכשל (${res.status}): ${(await res.text()).slice(0, 300)}`);
  console.error(`\n  הגדירו ידנית: Firebase Console → Authentication → Templates →`);
  console.error(`  Password reset → עריכה → Customize action URL → ${APP_URL}`);
  process.exit(2);
}

const after = await res.json();
console.log(`\n  ✓ callbackUri חדש: ${after.notification?.sendEmail?.callbackUri}`);
if (needsDomain) console.log(`  ✓ נוסף דומיין מורשה: ${host}`);
