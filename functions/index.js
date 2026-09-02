/* =============================================================================
 *  functions/index.js — הפעולות שדורשות הרשאות אדמין
 * -----------------------------------------------------------------------------
 *  כל השאר באפליקציה עובד ישירות מול Firestore מהדפדפן. הפעולות כאן לא
 *  יכולות לעבוד כך, ולא מטעמי נוחות:
 *
 *    addPartner    — יוצרת חשבון למשתמש *אחר*. ה-SDK בדפדפן לא מסוגל.
 *    acceptInvite  — המוזמן חייב ליצור לעצמו מסמך חברות, וכללי האבטחה
 *                    מתירים זאת לבעלים בלבד. אחרת כל אחד היה מצרף את עצמו
 *                    לכל חתונה שירצה.
 *    syncMyClaims  — כותבת custom claims, פעולה שאפשרית רק בצד השרת.
 *
 *  ⚠ שליחת המיילים אינה כאן בכוונה. Firebase Auth שולח בעצמו את מייל
 *    קביעת הסיסמה, ו-sendPasswordResetEmail ניתן לקריאה מהלקוח גם עבור
 *    כתובת של מישהו אחר. זה חוסך SMTP, סודות, ותלות נוספת.
 *    התאמת הנוסח: Console → Authentication → Templates.
 *
 *  ⚠ onCall מאמת את הזהות לבד (request.auth), אבל **אינו** מאמת הרשאות.
 *    כל פונקציה כאן בודקת בעלות במפורש מול Firestore.
 * ========================================================================== */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { randomBytes, createHash } = require("node:crypto");

initializeApp();
const db = getFirestore();
const auth = getAuth();

//  חייב להתאים ל-getFunctions(app, "europe-west1") ב-src/lib/firebase.js,
//  אחרת הקריאה מהלקוח מגיעה ל-404.
const REGION = "europe-west1";

const envRoot = (env) => db.collection("envs").doc(env);
const weddingRef = (env, id) => envRoot(env).collection("weddings").doc(id);

/*  'test' ולא 'prod' כברירת מחדל: פרמטר חסר או שגוי צריך להוביל לנתוני
    בדיקה, לא לעריכת חתונות אמיתיות.  */
const envOf = (data) => (data && data.env === "prod" ? "prod" : "test");

const hashToken = (token) => createHash("sha256").update(token).digest("hex");

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

function normalizeEmail(value) {
  const trimmed = String(value == null ? "" : value).trim();
  if (!trimmed || trimmed.length > 254 || !EMAIL_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function requireAuth(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "צריך להיות מחובר.");
  }
  return request.auth.uid;
}

/** מוודא שהפונה הוא בעל החתונה. הבדיקה מפורשת — onCall לא בודק הרשאות. */
async function requireOwner(env, weddingId, uid) {
  const snap = await weddingRef(env, weddingId).get();
  if (!snap.exists) throw new HttpsError("not-found", "החתונה לא נמצאה.");
  if (snap.data().ownerId !== uid) {
    throw new HttpsError("permission-denied", "רק בעל החתונה רשאי לבצע פעולה זו.");
  }
  return snap.data();
}

/* =============================================================================
 *  הרשאות הקבצים — custom claims
 * -----------------------------------------------------------------------------
 *  כללי ה-Storage אינם יכולים לקרוא את מסמך החברות: firestore.get() בתוך
 *  storage.rules מוחזר כ-403 בפרויקט הזה (נבדק אמפירית — אותה העלאה עוברת
 *  ברגע שהתנאי מוסר). לכן רשימת החתונות נשמרת כ-claim על הטוקן, וכללי
 *  ה-Storage בודקים אותה בלי שום קריאה חוצת-שירות.
 *
 *  ⚠ הטוקן מתרענן אחת לשעה. הוספת גישה נכנסת לתוקף מיד בכניסה מחדש;
 *    *הסרת* גישה עלולה להימשך עד שעה במכשיר שכבר פתוח.
 * ========================================================================== */

async function refreshWeddingClaims(env, userId) {
  //  מקור האמת הוא מסמכי החברות; weddingIds הוא רק רמז לצד הלקוח.
  const u = await envRoot(env).collection("users").doc(userId).get();
  const hinted = u.exists && Array.isArray(u.data().weddingIds) ? u.data().weddingIds : [];

  const confirmed = [];
  for (const wid of hinted) {
    const m = await weddingRef(env, wid).collection("members").doc(userId).get();
    if (m.exists) confirmed.push(wid);
  }

  const user = await auth.getUser(userId);
  const claims = Object.assign({}, user.customClaims || {});
  claims[`w_${env}`] = confirmed;
  await auth.setCustomUserClaims(userId, claims);
  return confirmed;
}

/** נקראת מהלקוח אחרי כניסה, כדי לוודא שה-claim מעודכן. */
exports.syncMyClaims = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const env = envOf(request.data);
  return { weddingIds: await refreshWeddingClaims(env, uid) };
});

exports.getAdminStats = onCall({ region: REGION }, async (request) => {
  requireAuth(request);
  if (String(request.auth.token.email || "").toLowerCase() !== "orelch97@gmail.com") {
    throw new HttpsError("permission-denied", "אין הרשאה.");
  }

  const weddings = await envRoot("prod").collection("weddings").get();
  const cutoff = Date.now() - 10 * 60 * 1000;
  const active = new Set();

  //  מעבר על החתונות ולא collectionGroup: שאילתה חוצת-אוספים על
  //  members.lastSeenAt דורשת אינדקס חריג שצריך לתחזק בנפרד, ומספר
  //  החתונות כאן קטן מכדי להצדיק אותו.
  await Promise.all(
    weddings.docs.map(async (wedding) => {
      const members = await wedding.ref.collection("members").get();
      for (const member of members.docs) {
        const seen = member.get("lastSeenAt");
        if (seen && typeof seen.toMillis === "function" && seen.toMillis() > cutoff) {
          active.add(member.id);
        }
      }
    })
  );

  return { weddings: weddings.size, activeUsers: active.size };
});

/* =============================================================================
 *  addPartner — צירוף בן/בת זוג
 * -----------------------------------------------------------------------------
 *  לכל אחד מבני הזוג חשבון משלו עם **סיסמה משלו**. החשבון נוצר בלי סיסמה,
 *  והלקוח שולח אחר כך מייל קביעת סיסמה. כך אף אחד — כולל בעל החתונה —
 *  אינו מחזיק את הסיסמה של השני, וטעות הקלדה בכתובת לא נותנת לאדם זר
 *  חשבון עובד אלא רק קישור שפג תוקפו.
 * ========================================================================== */

exports.addPartner = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const env = envOf(request.data);
  const weddingId = String((request.data && request.data.weddingId) || "");
  const email = normalizeEmail(request.data && request.data.email);

  if (!weddingId) throw new HttpsError("invalid-argument", "חסר מזהה חתונה.");
  if (!email) throw new HttpsError("invalid-argument", "כתובת המייל אינה תקינה.");

  await requireOwner(env, weddingId, uid);

  const owner = await auth.getUser(uid);
  if (owner.email && owner.email.toLowerCase() === email) {
    throw new HttpsError("invalid-argument", "זו כתובת המייל שלכם.");
  }

  let partner;
  let created = false;
  try {
    partner = await auth.getUserByEmail(email);
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
    //  בלי סיסמה: הכניסה היחידה היא דרך קישור קביעת הסיסמה שיישלח למייל.
    partner = await auth.createUser({ email, emailVerified: false });
    created = true;
  }

  await envRoot(env).collection("users").doc(partner.uid).set(
    { id: partner.uid, email, emailLower: email, createdAt: FieldValue.serverTimestamp() },
    { merge: true }
  );

  const memberRef = weddingRef(env, weddingId).collection("members").doc(partner.uid);
  const existing = await memberRef.get();
  const alreadyMember = existing.exists;

  if (!alreadyMember) {
    await memberRef.set({
      userId: partner.uid,
      email,
      ownerId: uid,
      role: "editor",
      scopes: ["all"],
      createdAt: FieldValue.serverTimestamp(),
      lastSeenAt: null,
    });
    await envRoot(env).collection("users").doc(partner.uid).set(
      { weddingIds: FieldValue.arrayUnion(weddingId) },
      { merge: true }
    );
    await refreshWeddingClaims(env, partner.uid);
  }

  //  needsPasswordSetup אומר ללקוח לשלוח את מייל קביעת הסיסמה.
  return { userId: partner.uid, email, created, alreadyMember, needsPasswordSetup: created };
});

/* =============================================================================
 *  createInvite / acceptInvite — שיתוף מוגבל
 * ========================================================================== */

exports.createInvite = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const env = envOf(request.data);
  const data = request.data || {};
  const weddingId = String(data.weddingId || "");
  const role = data.role;
  const scopes = Array.isArray(data.scopes) && data.scopes.length ? data.scopes : ["all"];
  const email = data.email ? normalizeEmail(data.email) : null;

  if (role !== "editor" && role !== "viewer") {
    throw new HttpsError("invalid-argument", "תפקיד לא חוקי.");
  }
  await requireOwner(env, weddingId, uid);

  //  במסד נשמר רק ה-hash: דליפת האוסף לא מאפשרת לממש הזמנה.
  const token = randomBytes(32).toString("base64url");
  const ref = envRoot(env).collection("invites").doc();

  await ref.set({
    id: ref.id,
    weddingId,
    email,
    role,
    scopes,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    acceptedAt: null,
    createdBy: uid,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { id: ref.id, token, role, scopes, email };
});

exports.acceptInvite = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const env = envOf(request.data);
  const token = String((request.data && request.data.token) || "");
  if (!token) throw new HttpsError("invalid-argument", "חסר טוקן.");

  const found = await envRoot(env)
    .collection("invites")
    .where("tokenHash", "==", hashToken(token))
    .limit(1)
    .get();

  if (found.empty) throw new HttpsError("not-found", "ההזמנה אינה קיימת.");

  const doc = found.docs[0];
  const invite = doc.data();

  if (invite.acceptedAt) throw new HttpsError("failed-precondition", "ההזמנה כבר מומשה.");
  if (invite.expiresAt && invite.expiresAt.toDate() < new Date()) {
    throw new HttpsError("deadline-exceeded", "תוקף ההזמנה פג.");
  }

  //  הזמנה שהונפקה לכתובת מסוימת תקפה רק לה.
  if (invite.email) {
    const user = await auth.getUser(uid);
    if (!user.email || user.email.toLowerCase() !== invite.email) {
      throw new HttpsError("permission-denied", "ההזמנה הונפקה לכתובת מייל אחרת.");
    }
  }

  const wedding = await weddingRef(env, invite.weddingId).get();
  if (!wedding.exists) throw new HttpsError("not-found", "החתונה לא נמצאה.");

  const batch = db.batch();
  batch.set(weddingRef(env, invite.weddingId).collection("members").doc(uid), {
    userId: uid,
    email: (await auth.getUser(uid)).email || "",
    ownerId: wedding.data().ownerId,
    role: invite.role,
    scopes: invite.scopes && invite.scopes.length ? invite.scopes : ["all"],
    createdAt: FieldValue.serverTimestamp(),
    lastSeenAt: null,
  });
  batch.set(
    envRoot(env).collection("users").doc(uid),
    { weddingIds: FieldValue.arrayUnion(invite.weddingId) },
    { merge: true }
  );
  batch.update(doc.ref, { acceptedAt: FieldValue.serverTimestamp() });
  await batch.commit();

  await refreshWeddingClaims(env, uid);

  return { weddingId: invite.weddingId };
});
