/* =========================================================================
 *  BACKUP CRYPTO – הצפנת קובצי גיבוי בסיסמה (WebCrypto)
 *  ------------------------------------------------------------------------
 *  קובץ הגיבוי מכיל שמות וטלפונים של כל המוזמנים וכל נתוני התקציב. אם הוא
 *  יורד לתיקיית ההורדות או נשלח באימייל – הוא חשוף. כאן מצפינים אותו:
 *
 *    passphrase --PBKDF2(SHA-256, 250k iterations, salt אקראי)--> מפתח 256 ביט
 *    JSON --AES-GCM(IV אקראי 12 בייט)--> ciphertext
 *
 *  ה-salt וה-IV נשמרים לצד ה-ciphertext (הם אינם סודיים).
 *  ⚠ אין מנגנון שחזור סיסמה. סיסמה שאבדה = קובץ שאבד.
 * ====================================================================== */

export const BACKUP_FORMAT = "wedding-planner-encrypted";
const PBKDF2_ITERATIONS = 250_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** WebCrypto (subtle) זמין רק ב-secure context – https או localhost. */
export const isCryptoAvailable =
  typeof globalThis.crypto !== "undefined" &&
  typeof globalThis.crypto.subtle !== "undefined";

function toBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** מצפין אובייקט לגיבוי. מחזיר את המעטפת שנכתבת לקובץ. */
export async function encryptBackup(payload, passphrase) {
  if (!isCryptoAvailable) throw new Error("crypto_unavailable");
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);

  return {
    app: "wedding-planner",
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS },
    cipher: "AES-GCM",
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(cipher)),
  };
}

/** true אם קובץ הגיבוי שנטען מוצפן. */
export function isEncryptedBackup(obj) {
  return !!obj && obj.format === BACKUP_FORMAT && typeof obj.data === "string";
}

/** מפענח מעטפת גיבוי. זורק 'bad_passphrase' אם הסיסמה שגויה. */
export async function decryptBackup(envelope, passphrase) {
  if (!isCryptoAvailable) throw new Error("crypto_unavailable");
  //  מספר הסיבובים נקרא מהקובץ כדי שגיבויים ישנים ימשיכו להיפתח אחרי
  //  שנעלה את ברירת המחדל. הקובץ מגיע מהמשתמש, ולכן הוא יכול להכיל
  //  iterations עצום שמקפיא את הלשונית — לכן יש תקרה. סיבובים מעטים
  //  אינם מחלישים דבר: הקובץ כבר מוצפן, ומי ששולט בערך שולט גם בתוכן.
  const iterations = Math.min(
    Math.max(Math.trunc(Number(envelope.kdf?.iterations)) || PBKDF2_ITERATIONS, 1),
    2_000_000
  );
  const salt = fromBase64(envelope.salt);
  const iv = fromBase64(envelope.iv);
  const key = await deriveKey(passphrase, salt, iterations);
  let plain;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      fromBase64(envelope.data)
    );
  } catch {
    // AES-GCM מאמת את התוכן, ולכן כישלון = סיסמה שגויה או קובץ פגום.
    throw new Error("bad_passphrase");
  }
  return JSON.parse(new TextDecoder().decode(plain));
}
