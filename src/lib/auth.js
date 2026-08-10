/* =========================================================================
 *  AUTH — ניהול הסשן בצד הלקוח
 *  ------------------------------------------------------------------------
 *  הטוקן עצמו לעולם לא מגיע לכאן. הוא יושב בעוגיית httpOnly שהשרת קבע.
 *  כל מה שנשמר בזיכרון הוא { id, email } לצורכי תצוגה — ולכן "התחזות"
 *  על ידי שינוי ה-state בדפדפן לא תשיג דבר: השרת מזהה מחדש בכל בקשה.
 * ====================================================================== */

import { apiFetch, isCloudConfigured } from "./api.js";

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

/** נקרא פעם אחת בעליית האפליקציה. מחזיר את הסשן הקיים או null. */
export async function loadSession() {
  if (!isCloudConfigured) return null;
  /*  השרת בענן נכבה כשאין פעילות, והבקשה הראשונה אליו עלולה להיכשל בפסק
      זמן בזמן שהוא מתעורר. בלי הניסיון החוזר משתמש מחובר היה נזרק למסך
      ההתחברות רק בגלל שהשרת ישן. תשובת שרת אמיתית (למשל 401) אינה מנוסה שוב.  */
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await apiFetch("/auth/me");
      return setSession(data.user);
    } catch (err) {
      if (err?.status) return setSession(null);
      if (attempt === 2) return setSession(null);
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }
  return setSession(null);
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
 *  הרשמה. `inviteToken` נשלח כבר כאן ולא רק אחרי הכניסה: כך השרת יודע
 *  לצרף את הנרשם לחתונה ששיתפו איתו במקום לפתוח לו חתונה פרטית משלו.
 *  מחזיר גם `joinedWeddingId` — מזהה החתונה שאליה צורף, או null.
 */
export async function signUp(email, password, weddingDate = null, inviteToken = null) {
  const data = await apiFetch("/auth/register", {
    method: "POST",
    body: { email, password, weddingDate, inviteToken: inviteToken || undefined },
  });
  setSession(data.user);
  return { user: data.user, joinedWeddingId: data.joinedWeddingId ?? null };
}

export async function signIn(email, password) {
  const data = await apiFetch("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  return setSession(data.user);
}

export async function signOut() {
  try {
    await apiFetch("/auth/logout", { method: "POST" });
  } finally {
    // גם אם הקריאה נכשלה, מנקים מקומית ולא משאירים מסך "מחובר".
    setSession(null);
  }
}

/**  הודעת ברירת המחדל לפי המסך שממנו הגיעה השגיאה. בלי הפילוח הזה מסך
 *   "שכחתי סיסמה" היה מציג "התחברות נכשלה", שזו לא הפעולה שנכשלה.  */
const FALLBACK_MESSAGE = {
  signin: "התחברות נכשלה. נסו שוב.",
  signup: "ההרשמה נכשלה. נסו שוב.",
  forgot: "שליחת קישור האיפוס נכשלה. נסו שוב.",
  reset: "עדכון הסיסמה נכשל. נסו שוב.",
};

/** הודעות שגיאה בעברית לפי קוד השגיאה מהשרת. */
export function authErrorMessage(err, mode) {
  switch (err?.code) {
    case "email_taken":
      return "כתובת המייל הזו כבר רשומה. התחברו איתה, או השתמשו בכתובת אחרת.";
    case "weak_password":
      return "הסיסמה חייבת להכיל לפחות 8 תווים.";
    case "password_too_long":
      return "הסיסמה ארוכה מדי.";
    case "invalid_email":
      return "כתובת המייל אינה תקינה. למשל: name@example.com";
    case "invalid_date":
      return "תאריך החתונה אינו תקין.";
    case "invalid_reset_token":
      return "קישור האיפוס אינו תקף או שכבר השתמשתם בו. בקשו קישור חדש.";
    case "invalid_credentials":
      return "התחברות נכשלה. בדקו את המייל והסיסמה.";
    case "too_many_attempts":
      return "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.";
    case "timeout":
      return "השרת לא השיב בזמן. נסו שוב בעוד רגע.";
    case "network_error":
      return "אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.";
    //  ה-API החזיר 5xx או תשובה שאינה JSON — בדרך כלל השרת כבוי או מתעורר.
    //  בלי המקרה הזה ההודעה הייתה "בדקו את המייל והסיסמה", ושולחת את
    //  המשתמש לחפש תקלה בפרטים שלו במקום בשרת.
    case "server_error":
      return "השרת אינו זמין כרגע. נסו שוב בעוד רגע.";
    //  המסד עדיין מתעורר. מצב זמני לחלוטין — ניסיון שני בדרך כלל מצליח.
    case "database_unavailable":
      return "השרת מתעורר. המתינו כמה שניות ונסו שוב.";
    default:
      return FALLBACK_MESSAGE[mode] ?? FALLBACK_MESSAGE.signin;
  }
}

/**
 * מבקש קישור איפוס סיסמה. השרת מחזיר הצלחה גם כשהכתובת אינה רשומה,
 * ולכן אסור לנסח את הודעת המסך כאילו היא מאשרת שהחשבון קיים.
 */
export async function requestPasswordReset(email) {
  await apiFetch("/auth/forgot", { method: "POST", body: { email } });
}

/** קובע סיסמה חדשה לפי הטוקן מהקישור שבמייל. לא מחבר — צריך להתחבר מחדש. */
export async function resetPassword(token, password) {
  await apiFetch("/auth/reset", { method: "POST", body: { token, password } });
  setSession(null);
}
