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

  const { options, challengeKey } = await callLoginOptions({ email: email || null });
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

export function passkeyErrorMessage(err) {
  const name = err?.name || "";
  const code = err?.message || "";
  if (name === "NotAllowedError" || code.includes("cancelled")) {
    return "הפעולה בוטלה או שפג הזמן. נסו שוב.";
  }
  if (name === "InvalidStateError") return "המכשיר הזה כבר רשום לכניסה מהירה.";
  if (code.includes("passkey_unsupported")) return "הדפדפן הזה לא תומך בכניסה מהירה.";
  if (code.includes("not-found") || code.includes("אינו רשום")) {
    return "לא נמצאה כניסה מהירה למכשיר הזה. התחברו עם סיסמה והפעילו אותה בהגדרות.";
  }
  if (code.includes("האתגר פג")) return "הבקשה פגה. נסו שוב.";
  return "הכניסה המהירה נכשלה. התחברו עם מייל וסיסמה.";
}
