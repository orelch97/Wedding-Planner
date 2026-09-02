/* מוסיף את דומיין הייצור לרשימת הדומיינים המורשים של Firebase Auth. */
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { loadEnv } from "../server/env.mjs";

loadEnv();

const sa = JSON.parse(readFileSync("./firebase-service-account.json", "utf8"));
const host = new URL(process.argv[2] || "https://wedding-planner-web.onrender.com").hostname;

const now = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
  iss: sa.client_email,
  scope: "https://www.googleapis.com/auth/cloud-platform",
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

const base = `https://identitytoolkit.googleapis.com/admin/v2/projects/${sa.project_id}/config`;
const headers = { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" };

const cfg = await (await fetch(base, { headers })).json();
const domains = cfg.authorizedDomains ?? [];

if (domains.includes(host)) {
  console.log(`  · ${host} כבר מורשה`);
  process.exit(0);
}

const res = await fetch(`${base}?updateMask=authorizedDomains`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ authorizedDomains: [...domains, host] }),
});

if (res.ok) {
  const after = await res.json();
  console.log(`  ✓ נוסף: ${host}`);
  console.log(`  דומיינים מורשים: ${after.authorizedDomains.join(", ")}`);
} else {
  console.error(`  ✗ נכשל (${res.status}): ${(await res.text()).slice(0, 250)}`);
  console.error(`  הוסיפו ידנית: Authentication → Settings → Authorized domains → ${host}`);
  process.exit(1);
}
