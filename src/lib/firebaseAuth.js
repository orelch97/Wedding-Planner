/* =========================================================================
 *  firebaseAuth.js — הזדהות מול Firebase Auth
 *  ------------------------------------------------------------------------
 *  מחליף את auth.js ומייצא **בדיוק את אותם שמות**, כדי ש-App.jsx לא ישתנה.
 *
 *  הבדל מהותי אחד מהמימוש הקודם: הסשן אינו עוגיית httpOnly של השרת אלא
 *  טוקן שה-SDK מנהל ומרענן לבד. המשמעות המעשית — אין יותר "השרת ישן"
 *  ואין צורך בניסיונות חוזרים בעליית האפליקציה.
 * ====================================================================== */

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  confirmPasswordReset,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";import { auth, db, firebaseConfigured, weddingRef, weddingCol, userRef } from "./firebase.js";

let currentSession = null;
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener(currentSession);
}

function setSession(user) {
  currentSession = user ? { user } : null;
  emit();
  return currentSession;
}

const toUser = (fbUser) => (fbUser ? { id: fbUser.uid, email: fbUser.email } : null);

/*  ה-SDK משחזר את הסשן מ-IndexedDB באופן אסינכרוני. onAuthStateChanged
    יורה פעם אחת עם המצב ההתחלתי, ולכן ההבטחה נפתרת רק אחריו — אחרת
    האפליקציה הייתה מציגה מסך התחברות לרגע לכל משתמש מחובר.  */
let resolveReady;
const ready = new Promise((resolve) => {
  resolveReady = resolve;
});

if (firebaseConfigured) {
  let first = true;
  onAuthStateChanged(auth, (fbUser) => {
    setSession(toUser(fbUser));
    if (first) {
      first = false;
      resolveReady(currentSession);
    }
  });
} else {
  resolveReady(null);
}

/** נקרא פעם אחת בעליית האפליקציה. מחזיר את הסשן הקיים או null. */
export async function loadSession() {
  if (!firebaseConfigured) return null;
  return ready;
}

export function getSession() {
  return currentSession;
}

/** נרשם לשינויי סשן. מחזיר פונקציית ניתוק. */
export function onAuthChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 *  הרשמה: יוצרת חשבון, מסמך משתמש, חתונה ראשונה ושורת בעלות — הכול
 *  מהלקוח. כללי האבטחה מתירים בדיוק את זה ולא יותר (ownerId חייב להיות
 *  המשתמש עצמו).
 *
 *  `inviteToken` ו-`partnerEmail` דורשים הרשאות אדמין ולכן עוברים
 *  ל-Cloud Functions אחרי שהחשבון נוצר.
 */
export async function signUp(
  email,
  password,
  weddingDate = null,
  inviteToken = null,
  partnerEmail = null
) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const user = toUser(cred.user);

  await setDoc(userRef(user.id), {
    id: user.id,
    email: user.email,
    emailLower: String(user.email).toLowerCase(),
    weddingIds: [],
    createdAt: serverTimestamp(),
  });

  //  מצטרף דרך הזמנה אינו פותח חתונה משלו: חתונה פרטית הייתה הופכת אותו
  //  לבעלים עם גישה מלאה, בניגוד להיקף המצומצם שקיבל.
  let joinedWeddingId = null;
  if (inviteToken) {
    const { acceptInvite } = await import("./firebaseStore.js");
    joinedWeddingId = await acceptInvite(inviteToken);
  } else {
    const weddingId = crypto.randomUUID();
    /*  שתי כתיבות נפרדות ולא אצווה: כלל האבטחה על מסמך החברות עושה
        `get()` על החתונה, ו-`get()` בכללים רואה רק מה שכבר נכתב. באצווה
        החתונה עדיין לא קיימת כשהכלל נבדק, וכל הרשמה נדחתה.  */
    await setDoc(weddingRef(weddingId), {
      id: weddingId,
      name: "החתונה שלי",
      weddingDate: weddingDate || null,
      partnerA: "",
      partnerB: "",
      ownerId: user.id,
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(weddingCol(weddingId, "members"), user.id), {
      userId: user.id,
      email: user.email ?? "",
      ownerId: user.id,
      role: "owner",
      scopes: ["all"],
      createdAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    });
    //  הרמז ש-listWeddings נשען עליו. בלעדיו המשתמש לא יראה את החתונה שלו.
    await setDoc(userRef(user.id), { weddingIds: [weddingId] }, { merge: true });
  }

  let partner = null;
  if (partnerEmail && !inviteToken) {
    const { addPartner } = await import("./firebaseStore.js");
    const list = await import("./firebaseStore.js").then((m) => m.listWeddings());
    const mine = list[0];
    if (mine) partner = await addPartner(mine.id, partnerEmail);
  }

  setSession(user);
  return { user, joinedWeddingId, partner };
}

export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const user = toUser(cred.user);

  //  מסמך המשתמש נדרש למסך השיתוף (הצגת מיילים של חברים). מי שנוצר
  //  בהעברה או דרך Cloud Function כבר יש לו אחד; זו רשת ביטחון.
  const snap = await getDoc(userRef(user.id));
  if (!snap.exists()) {
    await setDoc(userRef(user.id), {
      id: user.id,
      email: user.email,
      emailLower: String(user.email).toLowerCase(),
      createdAt: serverTimestamp(),
    });
  }

  //  כללי ה-Storage נשענים על custom claim, והוא עלול להיות מיושן אחרי
  //  שינוי הרשאות. רענון בכניסה מבטיח שהקבצים ייפתחו — אבל הוא קריאה
  //  ל-Cloud Function שעולה קרה, ולכן הוא לא מעכב את הכניסה עצמה.
  //  הקבצים נדרשים רק במסך הספקים, הרבה אחרי שהרענון מספיק להסתיים.
  import("./firebaseStore.js")
    .then((m) => m.syncStorageClaims())
    .catch(() => {});

  return setSession(user);
}

export async function signOut() {
  try {
    await fbSignOut(auth);
  } finally {
    setSession(null);
  }
}

const FALLBACK_MESSAGE = {
  signin: "התחברות נכשלה. נסו שוב.",
  signup: "ההרשמה נכשלה. נסו שוב.",
  forgot: "שליחת קישור האיפוס נכשלה. נסו שוב.",
  reset: "עדכון הסיסמה נכשל. נסו שוב.",
};

/*  Firebase מחזיר קודים משלו. המיפוי שומר על אותן הודעות בעברית שהיו
    קודם, כדי שהמשתמש לא יראה שינוי בשפה של המערכת.
    ⚠ auth/invalid-credential הוא הקוד המאוחד לסיסמה שגויה *ולמשתמש שאינו
    קיים* — במכוון, כדי לא להסגיר אילו כתובות רשומות. ההודעה חייבת להישאר
    מעורפלת באותה מידה.  */
export function authErrorMessage(err, mode) {
  const code = err?.code ?? "";
  switch (code) {
    case "auth/email-already-in-use":
      return "כתובת המייל הזו כבר רשומה. התחברו איתה, או השתמשו בכתובת אחרת.";
    case "auth/weak-password":
      return "הסיסמה חייבת להכיל לפחות 6 תווים.";
    case "auth/invalid-email":
      return "כתובת המייל אינה תקינה. למשל: name@example.com";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "התחברות נכשלה. בדקו את המייל והסיסמה.";
    case "auth/user-disabled":
      return "החשבון הזה הושבת. פנו לתמיכה.";
    case "auth/too-many-requests":
      return "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.";
    case "auth/invalid-action-code":
    case "auth/expired-action-code":
      return "קישור האיפוס אינו תקף או שכבר השתמשתם בו. בקשו קישור חדש.";
    case "auth/network-request-failed":
      return "אין חיבור למערכת. בדקו את החיבור לאינטרנט ונסו שוב.";
    case "permission-denied":
      return "אין לכם הרשאה לפעולה הזו.";
    case "unavailable":
      return "המערכת אינה זמינה כרגע. נסו שוב בעוד רגע.";
    default:
      return FALLBACK_MESSAGE[mode] ?? FALLBACK_MESSAGE.signin;
  }
}

/**
 * מבקש קישור איפוס סיסמה. Firebase לא מסגיר אם הכתובת רשומה, ולכן ההודעה
 * במסך חייבת להישאר מעורפלת בדיוק כמו קודם.
 */
export async function requestPasswordReset(email) {
  //  auth/user-not-found נבלע בכוונה: אחרת הטופס הופך לכלי לגילוי
  //  אילו כתובות רשומות במערכת.
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (err) {
    if (err?.code !== "auth/user-not-found") throw err;
  }
}

/** קובע סיסמה חדשה לפי ה-oobCode מהקישור שבמייל. לא מחבר — צריך להתחבר מחדש. */
export async function resetPassword(oobCode, password) {
  await confirmPasswordReset(auth, oobCode, password);
  await signOut();
}
