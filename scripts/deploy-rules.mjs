/* =============================================================================
 *  deploy-rules.mjs — פריסת כללי אבטחה דרך Firebase Rules API
 * -----------------------------------------------------------------------------
 *  firebase-tools עושה בדיקת קדם מול serviceusage.googleapis.com, ומפתח
 *  ה-firebase-adminsdk חסר לה הרשאה. ה-API של הכללים עצמו נגיש, ולכן כאן
 *  פונים אליו ישירות: יצירת ruleset ואז שחרורו (release).
 *
 *  שימוש:  node scripts/deploy-rules.mjs [firestore|storage|all]
 * ========================================================================== */

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { loadEnv } from "../server/env.mjs";

loadEnv();

const sa = JSON.parse(readFileSync("./firebase-service-account.json", "utf8"));
const which = process.argv[2] ?? "all";

const now = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
  iss: sa.client_email,
  scope: "https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/cloud-platform",
  aud: "https://oauth2.googleapis.com/token",
  exp: now + 3600,
  iat: now,
})}`;
const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");

const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${unsigned}.${sig}`,
  }),
});
const { access_token } = await tokenRes.json();
if (!access_token) {
  console.error("✗ לא התקבל טוקן:", JSON.stringify(await tokenRes.json?.() ?? {}));
  process.exit(1);
}

const API = "https://firebaserules.googleapis.com/v1";
const project = sa.project_id;

const headers = {
  Authorization: `Bearer ${access_token}`,
  "Content-Type": "application/json",
};

const TARGETS = {
  firestore: { file: "firestore.rules", release: "cloud.firestore", path: "firestore.rules" },
  storage: {
    file: "storage.rules",
    release: `firebase.storage/${process.env.FIREBASE_STORAGE_BUCKET}`,
    path: "storage.rules",
  },
};

let failed = 0;

for (const [name, cfg] of Object.entries(TARGETS)) {
  if (which !== "all" && which !== name) continue;

  const source = readFileSync(cfg.file, "utf8");

  //  שלב א: יצירת ruleset. שגיאת תחביר בכללים נתפסת כאן, לפני השחרור.
  const created = await fetch(`${API}/projects/${project}/rulesets`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      source: { files: [{ name: cfg.path, content: source }] },
    }),
  });
  const ruleset = await created.json();

  if (!created.ok) {
    console.log(`  ✗ ${name}: יצירת ruleset נכשלה (${created.status})`);
    console.log(`     ${JSON.stringify(ruleset).slice(0, 400)}`);
    failed++;
    continue;
  }

  //  שלב ב: שחרור. PATCH על release קיים, POST אם עדיין אין.
  const releaseName = `projects/${project}/releases/${cfg.release}`;
  let res = await fetch(`${API}/${releaseName}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      release: { name: releaseName, rulesetName: ruleset.name },
    }),
  });

  if (!res.ok) {
    res = await fetch(`${API}/projects/${project}/releases`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: releaseName, rulesetName: ruleset.name }),
    });
  }

  if (res.ok) {
    console.log(`  ✓ ${name}: נפרס  (${ruleset.name.split("/").pop()})`);
  } else {
    console.log(`  ✗ ${name}: שחרור נכשל (${res.status})`);
    console.log(`     ${(await res.text()).slice(0, 400)}`);
    failed++;
  }
}

console.log(failed === 0 ? "\n✓ כל הכללים נפרסו\n" : `\n✗ ${failed} נכשלו\n`);
process.exit(failed === 0 ? 0 : 1);
