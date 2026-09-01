/* =============================================================================
 *  deploy-indexes.mjs — יצירת אינדקסים ב-Firestore
 * -----------------------------------------------------------------------------
 *  firebase-tools נחסם על serviceusage, ולכן פונים ישירות ל-Firestore Admin API.
 *  אינדקס collection-group על members הוא תנאי לשאילתה שמחזירה למשתמש את
 *  החתונות שלו — בלעדיו האפליקציה נופלת ב-failed-precondition בכניסה.
 * ========================================================================== */

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { loadEnv } from "../server/env.mjs";

loadEnv();

const sa = JSON.parse(readFileSync("./firebase-service-account.json", "utf8"));
const spec = JSON.parse(readFileSync("./firestore.indexes.json", "utf8"));

const now = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
  iss: sa.client_email,
  scope: "https://www.googleapis.com/auth/datastore",
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

const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/collectionGroups`;
let failed = 0;

for (const idx of spec.indexes) {
  const res = await fetch(`${base}/${idx.collectionGroup}/indexes`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      queryScope: idx.queryScope,
      fields: idx.fields.map((f) => ({ fieldPath: f.fieldPath, order: f.order })),
    }),
  });
  const data = await res.json();

  if (res.ok) {
    console.log(`  ✓ ${idx.collectionGroup} (${idx.fields.map((f) => f.fieldPath).join(", ")}) — נוצר`);
  } else if (JSON.stringify(data).includes("already exists")) {
    console.log(`  · ${idx.collectionGroup} — כבר קיים`);
  } else {
    failed++;
    console.log(`  ✗ ${idx.collectionGroup} — ${JSON.stringify(data).slice(0, 300)}`);
  }
}

console.log(failed === 0 ? "\n✓ האינדקסים מוכנים\n" : `\n✗ ${failed} נכשלו\n`);
process.exit(failed === 0 ? 0 : 1);
