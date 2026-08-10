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

//  קובץ מוצפן תקין מיוצר תמיד עם אותם ערכים. כל חריגה מהם היא קובץ פגום או
//  קובץ שאינו שלנו, ועדיף לומר זאת מיד מאשר לשרוף שניות על גזירת מפתח
//  שממילא תיכשל — או, במקרה של iterations מנופח, להקפיא את הלשונית.
const MAX_ITERATIONS = 600_000;
const MIN_ITERATIONS = 1_000;

/**
 *  אימות מבנה המעטפת לפני הפענוח. מחזיר מחרוזת שגיאה או null אם תקין.
 */
export function validateEncryptedBackup(envelope) {
  if (!isEncryptedBackup(envelope)) return "not_backup_file";
  if (envelope.app !== "wedding-planner") return "not_backup_file";
  if (envelope.cipher !== "AES-GCM") return "unsupported_backup";
  if (envelope.kdf?.name !== "PBKDF2" || envelope.kdf?.hash !== "SHA-256") {
    return "unsupported_backup";
  }
  const iterations = Number(envelope.kdf?.iterations);
  if (
    !Number.isInteger(iterations) ||
    iterations < MIN_ITERATIONS ||
    iterations > MAX_ITERATIONS
  ) {
    return "unsupported_backup";
  }
  //  base64 בלבד, ובאורך שמתאים ל-salt/IV שאנחנו מייצרים. קלט אחר יפיל את
  //  atob בחריגה לא מובנת במקום בהודעה ברורה.
  const b64 = /^[A-Za-z0-9+/]+={0,2}$/;
  if (!b64.test(envelope.salt || "") || !b64.test(envelope.iv || "")) {
    return "corrupt_backup";
  }
  if (!b64.test(envelope.data || "")) return "corrupt_backup";
  try {
    if (fromBase64(envelope.salt).length !== SALT_BYTES) return "corrupt_backup";
    if (fromBase64(envelope.iv).length !== IV_BYTES) return "corrupt_backup";
  } catch {
    return "corrupt_backup";
  }
  return null;
}

/** מפענח מעטפת גיבוי. זורק 'bad_passphrase' אם הסיסמה שגויה. */
export async function decryptBackup(envelope, passphrase) {
  if (!isCryptoAvailable) throw new Error("crypto_unavailable");
  const invalid = validateEncryptedBackup(envelope);
  if (invalid) throw new Error(invalid);
  //  מספר הסיבובים נקרא מהקובץ כדי שגיבויים ישנים ימשיכו להיפתח אחרי
  //  שנעלה את ברירת המחדל. הטווח נאכף למעלה ב-validateEncryptedBackup.
  const iterations = Math.trunc(Number(envelope.kdf.iterations));
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
