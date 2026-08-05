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
  try {
    const data = await apiFetch("/auth/me");
    return setSession(data.user);
  } catch {
    // 401 הוא מצב תקין לחלוטין — פשוט אין סשן.
    return setSession(null);
  }
}

export function getSession() {
  return currentSession;
}

/** נרשם לשינויי סשן. מחזיר פונקציית ניתוק. */
export function onAuthChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function signUp(email, password, weddingDate = null) {
  const data = await apiFetch("/auth/register", {
    method: "POST",
    body: { email, password, weddingDate },
  });
  return setSession(data.user);
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
    default:
      return mode === "signup" ? "ההרשמה נכשלה. נסו שוב." : "התחברות נכשלה. נסו שוב.";
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
