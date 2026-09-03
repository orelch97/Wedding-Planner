/* =============================================================================
 *  firebase.js — אתחול Firebase והנתיבים של הסביבה
 * -----------------------------------------------------------------------------
 *  כל הנתונים יושבים תחת שורש סביבה אחד:
 *
 *      envs/{test|prod}/weddings/{weddingId}/guests|tables|vendors|
 *                                            budget|checklist|files|
 *                                            members|settings
 *      envs/{env}/users/{userId}
 *      envs/{env}/invites/{inviteId}
 *
 *  שורש במקום קידומות שמות (prod_guests / test_guests) משתי סיבות מעשיות:
 *  כלל אבטחה אחד על נתיב החתונה מכסה את כל תת-האוספים שלה, ואין שאילתה
 *  שיכולה בטעות לחצות בין הסביבות.
 *
 *  ⚠ מפתחות ה-VITE_ כאן אינם סוד. הם נצרבים ל-build ונשלחים לכל דפדפן,
 *    וכך זה אמור להיות. מה ששומר על הנתונים הוא firestore.rules בלבד.
 * ========================================================================== */

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, collection, doc } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/*  איזו סביבה. ברירת המחדל בפיתוח היא 'test': הגדרה חסרה במחשב מקומי
    צריכה להוביל לנתוני בדיקה, לא לעריכת חתונות אמיתיות.

    ⚠ בבנייה לייצור אין ברירת מחדל בכוונה. שקט כאן פירושו שזוגות אמיתיים
    היו נוחתים בסביבת הבדיקות בלי ששום דבר ייראה שבור — עד שמישהו היה
    שואל למה רשימת המוזמנים שלו התרוקנה. עדיף שהאפליקציה תסרב לעלות.

    שימו לב: קובץ .env מקומי גובר על משתנה סביבה של המעטפת, ולכן בנייה
    מקומית תמיד תשקף את מה שכתוב ב-.env ולא את מה שהוגדר בטרמינל.  */
const rawEnv = import.meta.env.VITE_FIREBASE_ENV;

if (import.meta.env.PROD && rawEnv !== "prod" && rawEnv !== "test") {
  throw new Error(
    "VITE_FIREBASE_ENV חייב להיות 'prod' או 'test' בבנייה לייצור. " +
      `התקבל: ${JSON.stringify(rawEnv)}. הגדירו אותו בסביבת הפריסה.`
  );
}

export const FIREBASE_ENV = rawEnv === "prod" ? "prod" : "test";

export const firebaseConfigured = Boolean(config.apiKey && config.projectId);

const app = firebaseConfigured ? initializeApp(config) : null;

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const storage = app ? getStorage(app) : null;
//  האזור חייב להתאים לזה שב-functions/index.js, אחרת הקריאה מגיעה ל-404.
export const functions = app ? getFunctions(app, "europe-west1") : null;
if (functions && import.meta.env.DEV) {
  connectFunctionsEmulator(functions, "localhost", 5001);
}

function requireDb() {
  if (!db) {
    throw new Error(
      "Firebase לא מוגדר — חסרים VITE_FIREBASE_API_KEY / VITE_FIREBASE_PROJECT_ID ב-.env"
    );
  }
  return db;
}

/* ── נתיבים ──────────────────────────────────────────────────────────────── */

export const envRoot = () => doc(requireDb(), "envs", FIREBASE_ENV);

export const usersCol = () => collection(envRoot(), "users");
export const userRef = (userId) => doc(envRoot(), "users", userId);

export const weddingsCol = () => collection(envRoot(), "weddings");
export const weddingRef = (weddingId) => doc(envRoot(), "weddings", weddingId);

export const invitesCol = () => collection(envRoot(), "invites");
export const inviteRef = (inviteId) => doc(envRoot(), "invites", inviteId);

/** אוסף נתונים של חתונה: guests | tables | vendors | budget | checklist | files | members */
export const weddingCol = (weddingId, name) => collection(weddingRef(weddingId), name);

/** מסמך יחיד באוסף של חתונה. המזהה הוא אותו מזהה שהיה במסד הישן. */
export const weddingDoc = (weddingId, name, id) =>
  doc(weddingRef(weddingId), name, String(id));

/** ההגדרות של החתונה יושבות במסמך יחיד קבוע. */
export const settingsRef = (weddingId) => weddingDoc(weddingId, "settings", "main");

/*  אותו מיפוי היקף→מסך שקיים ב-firestore.rules. שינוי כאן בלי שינוי שם
    יוצר פער בין מה שה-UI מציג לבין מה שהמסד מרשה.  */
export const SCOPE_OF_COLLECTION = {
  guests: "guests",
  tables: "guests",
  vendors: "vendors",
  files: "vendors",
  budget: "finance",
  checklist: "checklist",
};
