/* =========================================================================
 *  passkeys.js — כניסה עם Face ID / טביעת אצבע (WebAuthn)
 *  ------------------------------------------------------------------------
 *  הביומטריה נשארת במכשיר. מה שנשמר אצלנו הוא מפתח ציבורי בלבד, ולכן
 *  דליפה של המסד אינה מאפשרת להתחזות לאיש.
 *
 *  ⚠ מפתח נצמד לדומיין (RP ID). מפתח שנרשם ב-localhost לא יעבוד בייצור
 *    ולהפך — כך התקן מונע פישינג, וזו לא תקלה.
 * ====================================================================== */

import { signInWithCustomToken } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, functions, FIREBASE_ENV } from "./firebase.js";

const LAST_EMAIL_KEY = "wp:passkeyEmail";
const LOGIN_OPTIONS_MAX_AGE_MS = 4 * 60_000;
let preparedLoginOptions = null;

function callable(name) {
  return async (payload) => {
    if (!functions) throw new Error("passkeys: Firebase לא מוגדר");
    const fn = httpsCallable(functions, name);
    const res = await fn({ ...payload, env: FIREBASE_ENV, origin: window.location.origin });
    return res.data;
  };
}

const callRegisterOptions = callable("passkeyRegisterOptions");
const callRegisterVerify = callable("passkeyRegisterVerify");
const callLoginOptions = callable("passkeyLoginOptions");
const callLoginVerify = callable("passkeyLoginVerify");
const callList = callable("passkeyList");
const callDelete = callable("passkeyDelete");

function emailKey(email) {
  return String(email || "").trim().toLowerCase();
}

/** Prepare the one-time request before a user taps the Passkey action. */
export function preparePasskeyLogin(email) {
  if (!passkeySupported()) return Promise.resolve(null);
  const key = emailKey(email);
  if (
    preparedLoginOptions?.email === key &&
    Date.now() - preparedLoginOptions.startedAt < LOGIN_OPTIONS_MAX_AGE_MS
  ) {
    return preparedLoginOptions.promise;
  }

  const entry = { email: key, startedAt: Date.now(), ready: false, promise: null };
  entry.promise = callLoginOptions({ email: key || null })
    .then((value) => {
      entry.ready = true;
      return value;
    })
    .catch((error) => {
      if (preparedLoginOptions === entry) preparedLoginOptions = null;
      throw error;
    });
  preparedLoginOptions = entry;
  return entry.promise;
}

/**
 * האם האתגר כבר בידינו. כשהתשובה שלילית הלחיצה תמתין לרשת, והמסך אמור
 * לומר זאת במפורש במקום להציג ספינר כללי שנראה כמו תקיעה.
 */
export function passkeyLoginWarm(email) {
  const key = emailKey(email);
  return Boolean(
    preparedLoginOptions?.email === key &&
      preparedLoginOptions.ready &&
      Date.now() - preparedLoginOptions.startedAt < LOGIN_OPTIONS_MAX_AGE_MS
  );
}

/** האם הדפדפן תומך בכלל. ללא זה אין טעם להציג את הכפתור. */
export function passkeySupported() {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential === "function" &&
    typeof navigator.credentials?.create === "function"
  );
}

/** האם קיים חיישן ביומטרי במכשיר (Face ID / טביעת אצבע / Windows Hello). */
export async function platformAuthenticatorAvailable() {
  if (!passkeySupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/*  ה-API של הדפדפן עובד ב-ArrayBuffer, וה-JSON שעובר לשרת עובד
    ב-base64url. שתי הפונקציות האלה הן הגשר, והן חייבות להישאר סימטריות.  */
const b64uToBuf = (value) => {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
};

const bufToB64u = (buf) => {
  const bytes = new Uint8Array(buf);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** רושם את המכשיר הנוכחי. דורש משתמש מחובר. */
export async function registerPasskey(label) {
  if (!passkeySupported()) throw new Error("passkey_unsupported");

  const options = await callRegisterOptions({});
  const credential = await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: b64uToBuf(options.challenge),
      user: { ...options.user, id: b64uToBuf(options.user.id) },
      excludeCredentials: (options.excludeCredentials || []).map((c) => ({
        ...c,
        id: b64uToBuf(c.id),
      })),
    },
  });
  if (!credential) throw new Error("passkey_cancelled");

  const res = await callRegisterVerify({
    label,
    credential: {
      id: credential.id,
      rawId: bufToB64u(credential.rawId),
      type: credential.type,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: {
        clientDataJSON: bufToB64u(credential.response.clientDataJSON),
        attestationObject: bufToB64u(credential.response.attestationObject),
        transports: credential.response.getTransports?.() || [],
      },
    },
  });

  try {
    const email = auth?.currentUser?.email;
    if (email) localStorage.setItem(LAST_EMAIL_KEY, email);
  } catch {
    /* אחסון חסום — הכניסה עדיין תעבוד, רק בלי רמז לכתובת */
  }
  return res;
}

/**
 * כניסה עם המכשיר. בלי email המכשיר מציע בעצמו את החשבונות ששמורים בו.
 * מחזיר את המשתמש אחרי כניסה מלאה ל-Firebase.
 */
export async function signInWithPasskey(email) {
  if (!passkeySupported()) throw new Error("passkey_unsupported");

  const key = emailKey(email);
  const prepared = preparedLoginOptions;
  preparedLoginOptions = null;
  let loginOptions;
  if (
    prepared?.email === key &&
    Date.now() - prepared.startedAt < LOGIN_OPTIONS_MAX_AGE_MS
  ) {
    try {
      loginOptions = await prepared.promise;
    } catch {
      loginOptions = await callLoginOptions({ email: key || null });
    }
  } else {
    loginOptions = await callLoginOptions({ email: key || null });
  }
  const { options, challengeKey } = loginOptions;
  const assertion = await navigator.credentials.get({
    publicKey: {
      ...options,
      challenge: b64uToBuf(options.challenge),
      allowCredentials: (options.allowCredentials || []).map((c) => ({
        ...c,
        id: b64uToBuf(c.id),
      })),
    },
  });
  if (!assertion) throw new Error("passkey_cancelled");

  const { token } = await callLoginVerify({
    challengeKey,
    credential: {
      id: assertion.id,
      rawId: bufToB64u(assertion.rawId),
      type: assertion.type,
      clientExtensionResults: assertion.getClientExtensionResults(),
      response: {
        clientDataJSON: bufToB64u(assertion.response.clientDataJSON),
        authenticatorData: bufToB64u(assertion.response.authenticatorData),
        signature: bufToB64u(assertion.response.signature),
        userHandle: assertion.response.userHandle
          ? bufToB64u(assertion.response.userHandle)
          : undefined,
      },
    },
  });

  const cred = await signInWithCustomToken(auth, token);
  return { id: cred.user.uid, email: cred.user.email };
}

export async function listPasskeys() {
  const res = await callList({});
  return res?.passkeys ?? [];
}

export async function deletePasskey(credentialId) {
  return callDelete({ credentialId });
}

/** הכתובת שממנה נרשם מפתח במכשיר הזה, כדי לקצר את מסך הכניסה. */
export function rememberedPasskeyEmail() {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) || "";
  } catch {
    return "";
  }
}

export function passkeyErrorMessage(err, operation = "login") {
  const name = err?.name || "";
  const code = err?.message || "";
  if (name === "NotAllowedError" || code.includes("cancelled")) {
    return "הפעולה בוטלה או שפג הזמן. נסו שוב.";
  }
  if (name === "InvalidStateError") return "המכשיר הזה כבר רשום לכניסה מהירה.";
  if (code.includes("passkey_unsupported")) return "הדפדפן הזה לא תומך בכניסה מהירה.";
  if (operation !== "login") {
    if (code.includes("Firebase לא מוגדר")) return "רישום Passkey אינו זמין בתצוגה המקומית ללא חיבור ל-Firebase. פתחו את האתר המחובר למערכת ונסו שוב.";
    if (code.includes("מקור לא מורשה") || name === "SecurityError") return "לא ניתן לרשום Passkey בכתובת הזו. פתחו את כתובת האתר המאושרת בחיבור מאובטח ונסו שוב.";
    if (code.includes("האתגר פג")) return "בקשת הרישום פגה. לחצו שוב על הוספת Passkey.";
    return operation === "register"
      ? "רישום ה-Passkey נכשל. ודאו שנעילת המסך, Face ID, טביעת אצבע או Windows Hello מוגדרים במכשיר ונסו שוב."
      : "עדכון ה-Passkey נכשל. בדקו את החיבור ונסו שוב.";
  }
  if (code.includes("not-found") || code.includes("אינו רשום")) {
    return "לא נמצאה כניסה מהירה למכשיר הזה. התחברו עם מייל וסיסמה, ואז הפעילו בהגדרות את הכניסה המהירה באמצעות Passkey.";
  }
  if (code.includes("האתגר פג")) return "הבקשה פגה. נסו שוב.";
  return "לא ניתן להיכנס באמצעות Passkey. התחברו עם מייל וסיסמה. אם עדיין לא הפעלתם כניסה מהירה, הפעילו אותה בהגדרות לאחר ההתחברות.";
}
