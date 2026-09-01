/* =============================================================================
 *  gcs.mjs — העלאה ל-Cloud Storage דרך fetch המובנה של Node
 * -----------------------------------------------------------------------------
 *  למה לא getStorage().bucket().upload() של firebase-admin:
 *  נתיב ה-REST של ה-SDK עובר דרך gaxios → node-fetch@2, שנשבר על Node 24
 *  עם ERR_STREAM_PREMATURE_CLOSE כבר בשלב שליפת טוקן ה-OAuth (הכשל הוא
 *  ב-Gunzip של node-fetch). נבדק: אותה בקשה בדיוק עם fetch המובנה מחזירה
 *  200. Firestore לא מושפע כי הוא עובד ב-gRPC ולא דרך אותו stack.
 *
 *  לכן כאן: JWT חתום מקומית → החלפה לטוקן → העלאה ב-REST. בלי תלויות.
 * ========================================================================== */

import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

const cache = new Map();

/** טוקן גישה, עם מטמון עד דקה לפני הפקיעה. מטמון נפרד לכל scope. */
export async function accessToken(serviceAccount, scope = SCOPE) {
  const hit = cache.get(scope);
  if (hit && Date.now() < hit.expiresAt - 60_000) return hit.token;

  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: serviceAccount.client_email,
    scope,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  })}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(serviceAccount.private_key, "base64url");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`OAuth נכשל (${res.status}): ${JSON.stringify(data).slice(0, 200)}`);
  }

  cache.set(scope, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}

/** האם ה-bucket קיים. false = Storage לא הופעל, או שם שגוי. */
export async function bucketExists(serviceAccount, bucket) {
  const token = await accessToken(serviceAccount);
  const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.status === 200;
}

/** רשימת ה-buckets בפרויקט — לאבחון כשההעלאה נכשלת. */
export async function listBuckets(serviceAccount) {
  const token = await accessToken(serviceAccount);
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b?project=${serviceAccount.project_id}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return (data.items ?? []).map((b) => b.name);
}

export async function uploadFile(serviceAccount, bucket, localPath, destPath, contentType) {
  const token = await accessToken(serviceAccount);
  const body = await readFile(localPath);

  const url =
    `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o` +
    `?uploadType=media&name=${encodeURIComponent(destPath)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": contentType || "application/octet-stream",
      "Content-Length": String(body.length),
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`העלאה נכשלה (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

export async function objectExists(serviceAccount, bucket, destPath) {
  const token = await accessToken(serviceAccount);
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(destPath)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.status === 200;
}
