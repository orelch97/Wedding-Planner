import { loadEnv } from "../server/env.mjs";
loadEnv();
import { readFileSync } from "node:fs";

const sa = JSON.parse(readFileSync("./firebase-service-account.json", "utf8"));
const project = sa.project_id;
const bucket = process.env.FIREBASE_STORAGE_BUCKET;
const apiKey = process.env.VITE_FIREBASE_API_KEY;

let bad = 0;
const check = (name, blocked, detail) => {
  console.log(`  ${blocked ? "\x1b[32m✓ חסום\x1b[0m" : "\x1b[31m✗ פתוח!\x1b[0m"}  ${name}  \x1b[90m${detail}\x1b[0m`);
  if (!blocked) bad++;
};

console.log("\nניסיון גישה לנתוני הייצור ללא הזדהות\n");

// א. קריאת רשימת החתונות
let r = await fetch(
  `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/envs/prod/weddings?key=${apiKey}`
);
check("רשימת החתונות", r.status === 403 || r.status === 401, `HTTP ${r.status}`);

// ב. קריאת מוזמנים של החתונה האמיתית
r = await fetch(
  `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/envs/prod/weddings/ef9e96b1-e593-43e4-8df9-883dd15a7acc/guests?key=${apiKey}`
);
check("מוזמנים (שמות + טלפונים)", r.status === 403 || r.status === 401, `HTTP ${r.status}`);

// ג. כתיבה
r = await fetch(
  `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/envs/prod/weddings/ef9e96b1-e593-43e4-8df9-883dd15a7acc/guests?documentId=999999&key=${apiKey}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { name: { stringValue: "פולש" } } }),
  }
);
check("כתיבת מוזמן חדש", r.status === 403 || r.status === 401, `HTTP ${r.status}`);

// ד. רשימת המשתמשים
r = await fetch(
  `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/envs/prod/users?key=${apiKey}`
);
check("רשימת המשתמשים (מיילים)", r.status === 403 || r.status === 401, `HTTP ${r.status}`);

// ה. הורדת חוזה חתום מ-Storage — נתיב אמיתי, נשלף דרך ה-admin
const { initializeApp, cert } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const app = initializeApp({ credential: cert(sa) });
const snap = await getFirestore(app)
  .collection("envs").doc("prod")
  .collection("weddings").doc("ef9e96b1-e593-43e4-8df9-883dd15a7acc")
  .collection("files").limit(1).get();

if (snap.empty) {
  console.log("  \x1b[33m⚠ אין קבצים לבדיקה\x1b[0m");
} else {
  const { storagePath, name } = snap.docs[0].data();

  //  נתיב ההורדה הציבורי של Firebase Storage. אם הכללים פתוחים הוא מחזיר
  //  200 עם תוכן הקובץ; כשהם סגורים — 403.
  r = await fetch(
    `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(storagePath)}?alt=media`
  );
  check(`הורדת קובץ (${name})`, r.status === 403 || r.status === 401, `HTTP ${r.status}`);

  //  גם קריאת המטא-דאטה בלבד מסגירה שמות חוזים.
  r = await fetch(
    `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(storagePath)}`
  );
  check("מטא-דאטה של קובץ", r.status === 403 || r.status === 401, `HTTP ${r.status}`);
}

console.log(
  `\n${bad === 0 ? "\x1b[32mכל הנתיבים חסומים לגישה אנונימית\x1b[0m" : `\x1b[31m${bad} נתיבים עדיין פתוחים!\x1b[0m`}\n`
);
process.exit(bad === 0 ? 0 : 1);
