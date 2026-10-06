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
const { getStorage } = require("firebase-admin/storage");
const { randomBytes, randomUUID, createHash } = require("node:crypto");
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");

const emulatorMode = Boolean(
  process.env.STORAGE_EMULATOR_HOST ||
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||
  process.env.FIRESTORE_EMULATOR_HOST
);
if (emulatorMode && process.env.GCLOUD_PROJECT !== "demo-wedding-planner-e2e") {
  throw new Error("E2E safety stop: Firebase emulators require project demo-wedding-planner-e2e.");
}
const storageBucket = emulatorMode
  ? "demo-wedding-planner-e2e.appspot.com"
  : "wedding-planner-c3d62.firebasestorage.app";
initializeApp({ storageBucket });
const db = getFirestore();
const auth = getAuth();
const storage = getStorage();

//  חייב להתאים ל-getFunctions(app, "europe-west1") ב-src/lib/firebase.js,
//  אחרת הקריאה מהלקוח מגיעה ל-404.
const REGION = "europe-west1";
// Keep this value synchronized with ADMIN_EMAIL in src/lib/adminConfig.js.
// Client-side navigation is only a convenience; this server check is the security boundary.
const ADMIN_EMAIL = "orelch97@gmail.com";

const envRoot = (env) => db.collection("envs").doc(env);
const weddingRef = (env, id) => envRoot(env).collection("weddings").doc(id);

/*  'test' ולא 'prod' כברירת מחדל: פרמטר חסר או שגוי צריך להוביל לנתוני
    בדיקה, לא לעריכת חתונות אמיתיות.  */
const envOf = (data) => (data && data.env === "prod" ? "prod" : "test");

const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const ALL_SCOPES = ["guests", "vendors", "finance", "checklist"];

function normalizeScopes(scopes) {
  if (Array.isArray(scopes) && scopes.includes("all")) return ["all"];
  const clean = Array.isArray(scopes)
    ? [...new Set(scopes.filter((scope) => ALL_SCOPES.includes(scope)))]
    : [];
  return clean.length ? clean : ["all"];
}

function hasScope(scopes, scope) {
  return !Array.isArray(scopes)
    || scopes.length === 0
    || scopes.includes("all")
    || scopes.includes(scope);
}

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
 *  ברגע שהתנאי מוסר). לכן מפת הרשאות קומפקטית לפי חתונה נשמרת כ-claim;
 *  היא כוללת חברות, scope ספקים ובעלות, בלי קריאה חוצת-שירות.
 *
 *  ⚠ הטוקן מתרענן אחת לשעה. הוספת גישה נכנסת לתוקף מיד בכניסה מחדש;
 *    *הסרת* גישה עלולה להימשך עד שעה במכשיר שכבר פתוח.
 * ========================================================================== */

async function refreshWeddingClaims(env, userId) {
  //  מקור האמת הוא מסמכי החברות; weddingIds הוא רק רמז לצד הלקוח.
  const u = await envRoot(env).collection("users").doc(userId).get();
  const hinted = u.exists && Array.isArray(u.data().weddingIds) ? u.data().weddingIds : [];

  const permissions = {};
  for (const wid of hinted) {
    const [wedding, membership] = await Promise.all([
      weddingRef(env, wid).get(),
      weddingRef(env, wid).collection("members").doc(userId).get(),
    ]);
    if (!membership.exists || !wedding.exists) continue;
    const member = membership.data();
    const isOwner = wedding.get("ownerId") === userId;
    permissions[wid] = isOwner
      ? "owner"
      : hasScope(member.scopes, "vendors")
        ? (["owner", "editor"].includes(member.role) ? "vendor_write" : "vendor_read")
        : "member";
  }

  const user = await auth.getUser(userId);
  const claims = Object.assign({}, user.customClaims || {});
  for (const targetEnv of ["test", "prod"]) {
    for (const prefix of ["w", "vr", "vw", "wo"]) delete claims[`${prefix}_${targetEnv}`];
  }
  claims[`p_${env}`] = permissions;
  await auth.setCustomUserClaims(userId, claims);
  return Object.keys(permissions);
}

/** נקראת מהלקוח אחרי כניסה, כדי לוודא שה-claim מעודכן. */
exports.syncMyClaims = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const env = envOf(request.data);
  return { weddingIds: await refreshWeddingClaims(env, uid) };
});

/** מחזיר את כל החתונות שבהן הפונה חבר. מקור האמת הוא members, לא user.weddingIds. */
exports.listMyWeddings = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const env = envOf(request.data);
  const candidates = await envRoot(env).collection("weddings").get();
  const weddings = await Promise.all(
    candidates.docs.map(async (wedding) => {
      const membership = await wedding.ref.collection("members").doc(uid).get();
      if (!membership.exists) return null;
      const member = membership.data();
      return {
        id: wedding.id,
        name: wedding.get("name") || "",
        weddingDate: wedding.get("weddingDate") || null,
        partnerA: wedding.get("partnerA") || "",
        partnerB: wedding.get("partnerB") || "",
        ownerId: wedding.get("ownerId") || "",
        role: member.role || "viewer",
        scopes: Array.isArray(member.scopes) && member.scopes.length ? member.scopes : ["all"],
      };
    })
  );
  return { weddings: weddings.filter(Boolean) };
});

/** Completes owner records after Auth creation; safe to retry after a partial client failure. */
exports.ensureMyWedding = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const env = envOf(request.data);
  const email = String(request.auth.token.email || "");
  const weddingId = randomBytes(16).toString("hex");
  const userDoc = envRoot(env).collection("users").doc(uid);
  const weddingDoc = weddingRef(env, weddingId);
  const memberDoc = weddingDoc.collection("members").doc(uid);

  const result = await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userDoc);
    const currentIds = userSnap.exists && Array.isArray(userSnap.get("weddingIds"))
      ? userSnap.get("weddingIds")
      : [];
    for (const currentId of currentIds) {
      const weddingRefForUser = weddingRef(env, currentId);
      const [wedding, membership] = await Promise.all([
        tx.get(weddingRefForUser),
        tx.get(weddingRefForUser.collection("members").doc(uid)),
      ]);
      if (wedding.exists && membership.exists) return { weddingId: currentId, created: false };
    }

    const requestedDate = String((request.data && request.data.weddingDate) || "");
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : null;
    tx.set(weddingDoc, {
      id: weddingId,
      name: "החתונה שלי",
      weddingDate: validDate,
      partnerA: "",
      partnerB: "",
      ownerId: uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(memberDoc, {
      userId: uid,
      email,
      ownerId: uid,
      role: "owner",
      scopes: ["all"],
      createdAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
    });
    tx.set(userDoc, {
      id: uid,
      email,
      emailLower: email.toLowerCase(),
      weddingIds: [weddingId],
      setupComplete: true,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { weddingId, created: true };
  });

  await refreshWeddingClaims(env, uid);
  return result;
});

exports.createWedding = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const env = envOf(request.data);
  const data = request.data || {};
  const id = randomBytes(16).toString("hex");
  const name = String(data.name || "החתונה שלי").trim().slice(0, 100) || "החתונה שלי";
  const requestedDate = String(data.weddingDate || "");
  const weddingDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : null;
  const email = String(request.auth.token.email || "");
  const weddingDoc = weddingRef(env, id);
  const userDoc = envRoot(env).collection("users").doc(uid);

  await db.runTransaction(async (tx) => {
    tx.set(weddingDoc, {
      id,
      name,
      weddingDate,
      partnerA: "",
      partnerB: "",
      ownerId: uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(weddingDoc.collection("members").doc(uid), {
      userId: uid,
      email,
      ownerId: uid,
      role: "owner",
      scopes: ["all"],
      createdAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
    });
    tx.set(userDoc, {
      id: uid,
      email,
      emailLower: email.toLowerCase(),
      weddingIds: FieldValue.arrayUnion(id),
    }, { merge: true });
  });

  await refreshWeddingClaims(env, uid);
  return { id, name, weddingDate, role: "owner", scopes: ["all"] };
});

exports.migrateVendorIds = onCall({ region: REGION, timeoutSeconds: 120 }, async (request) => {
  const uid = requireAuth(request);
  const env = envOf(request.data);
  const weddingId = String((request.data && request.data.weddingId) || "");
  if (!weddingId) throw new HttpsError("invalid-argument", "חסר מזהה חתונה.");
  await requireOwner(env, weddingId, uid);

  const root = weddingRef(env, weddingId);
  const migrationRef = envRoot(env).collection("migrations").doc(`vendor-ids-${weddingId}`);
  const lockId = randomUUID();
  const acquired = await db.runTransaction(async (tx) => {
    const state = await tx.get(migrationRef);
    if (state.get("complete") === true) return false;
    if (state.get("lockId") && Number(state.get("lockUntil")) > Date.now()) {
      throw new HttpsError("unavailable", "vendor_id_migration_in_progress");
    }
    tx.set(migrationRef, {
      lockId,
      lockUntil: Date.now() + 150_000,
      startedAt: FieldValue.serverTimestamp(),
      complete: false,
    }, { merge: true });
    return true;
  });
  if (!acquired) return { migrated: false, complete: true };

  try {
    const vendorSnapshot = await root.collection("vendors").get();
    const legacyToUuid = new Map();
    const vendorWrites = [];
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    for (const vendorDoc of vendorSnapshot.docs) {
      const old = vendorDoc.data();
      if (old.migratedTo) {
        legacyToUuid.set(vendorDoc.id, String(old.migratedTo));
        if (old.legacyId != null) legacyToUuid.set(String(old.legacyId), String(old.migratedTo));
        continue;
      }
      if (uuidPattern.test(vendorDoc.id) && uuidPattern.test(String(old.id || ""))) {
        if (old.legacyId != null) legacyToUuid.set(String(old.legacyId), vendorDoc.id);
        continue;
      }

      const newId = randomUUID();
      legacyToUuid.set(vendorDoc.id, newId);
      vendorWrites.push({
        legacyRef: vendorDoc.ref,
        uuidRef: root.collection("vendors").doc(newId),
        old,
        legacyId: vendorDoc.id,
        newId,
      });
    }

    for (let start = 0; start < vendorWrites.length; start += 200) {
      const batch = db.batch();
      for (const entry of vendorWrites.slice(start, start + 200)) {
        batch.create(entry.uuidRef, {
          ...entry.old,
          id: entry.newId,
          legacyId: entry.legacyId,
          revision: Number(entry.old.revision) || 1,
          updatedAt: FieldValue.serverTimestamp(),
        });
        batch.set(entry.legacyRef, {
          migratedTo: entry.newId,
          deletedAt: entry.old.deletedAt || FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      await batch.commit();
    }

    for (const collectionName of ["budget", "files"]) {
      const snapshot = await root.collection(collectionName).get();
      const updates = snapshot.docs.flatMap((record) => {
        const current = record.get("vendorId");
        if (current == null) return [];
        const mapped = legacyToUuid.get(String(current));
        const currentIsUuid = typeof current === "string"
          && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(current);
        if (!mapped && currentIsUuid) return [];
        return [{ ref: record.ref, mapped: mapped || null, revision: Number(record.get("revision")) || 0 }];
      });
      for (let start = 0; start < updates.length; start += 450) {
        const batch = db.batch();
        for (const update of updates.slice(start, start + 450)) {
          const patch = { vendorId: update.mapped, updatedAt: FieldValue.serverTimestamp() };
          if (collectionName === "budget") patch.revision = update.revision + 1;
          batch.update(update.ref, patch);
        }
        await batch.commit();
      }
    }

    await migrationRef.set({ complete: true, lockId: FieldValue.delete(), lockUntil: FieldValue.delete(), completedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { migrated: vendorWrites.length, complete: true };
  } catch (err) {
    await migrationRef.set({ lockId: FieldValue.delete(), lockUntil: FieldValue.delete() }, { merge: true });
    throw err;
  }
});

exports.updateWeddingMember = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const env = envOf(request.data);
  const data = request.data || {};
  const weddingId = String(data.weddingId || "");
  const memberId = String(data.userId || "");
  const role = data.role;
  const scopes = normalizeScopes(data.scopes);
  if (!weddingId || !memberId) throw new HttpsError("invalid-argument", "חסרים פרטי חבר.");
  if (!["editor", "viewer"].includes(role)) throw new HttpsError("invalid-argument", "תפקיד לא חוקי.");
  const wedding = await requireOwner(env, weddingId, uid);
  const memberRef = weddingRef(env, weddingId).collection("members").doc(memberId);
  const snapshot = await memberRef.get();
  if (!snapshot.exists || memberId === wedding.ownerId || snapshot.get("role") === "owner") {
    throw new HttpsError("failed-precondition", "לא ניתן לשנות את בעלות החתונה.");
  }
  await memberRef.update({ role, scopes, updatedAt: FieldValue.serverTimestamp() });
  await refreshWeddingClaims(env, memberId);
  await auth.revokeRefreshTokens(memberId);
  return { ok: true };
});

exports.removeWeddingMember = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const env = envOf(request.data);
  const weddingId = String((request.data && request.data.weddingId) || "");
  const memberId = String((request.data && request.data.userId) || "");
  if (!weddingId || !memberId) throw new HttpsError("invalid-argument", "חסרים פרטי חבר.");

  const wedding = await weddingRef(env, weddingId).get();
  if (!wedding.exists) throw new HttpsError("not-found", "החתונה לא נמצאה.");
  if (wedding.get("ownerId") !== uid && memberId !== uid) {
    throw new HttpsError("permission-denied", "אין הרשאה להסיר חבר זה.");
  }

  const root = weddingRef(env, weddingId);
  const memberRef = root.collection("members").doc(memberId);
  const userDoc = envRoot(env).collection("users").doc(memberId);
  await db.runTransaction(async (tx) => {
    const membership = await tx.get(memberRef);
    if (!membership.exists) return;
    if (memberId === wedding.get("ownerId") || membership.get("role") === "owner") {
      throw new HttpsError("failed-precondition", "לא ניתן להסיר את בעל החתונה.");
    }
    tx.delete(memberRef);
    tx.set(userDoc, { weddingIds: FieldValue.arrayRemove(weddingId) }, { merge: true });
  });

  await refreshWeddingClaims(env, memberId);
  await auth.revokeRefreshTokens(memberId);
  return { ok: true };
});

exports.getAdminStats = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);

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

function requireAdmin(request) {
  requireAuth(request);
  const email = String(request.auth.token.email || "").trim().toLowerCase();
  if (email !== ADMIN_EMAIL.toLowerCase() || request.auth.token.email_verified !== true) {
    throw new HttpsError("permission-denied", "אין הרשאה.");
  }
}

exports.getAdminActivity = onCall({ region: REGION, timeoutSeconds: 60 }, async (request) => {
  requireAdmin(request);
  try {
    const weddings = await envRoot("prod").collection("weddings").get();
    const snapshots = await Promise.all(
      weddings.docs.map((wedding) => wedding.ref.collection("members").get())
    );
    const rows = [];
    snapshots.forEach((members, index) => {
      const wedding = weddings.docs[index];
      for (const member of members.docs) {
        const lastSeen = member.get("lastSeenAt");
        rows.push({
          email: String(member.get("email") || ""),
          weddingId: wedding.id,
          weddingName: String(wedding.get("name") || ""),
          lastSeenAt: lastSeen && typeof lastSeen.toDate === "function"
            ? lastSeen.toDate().toISOString()
            : null,
        });
      }
    });
    rows.sort((a, b) => (Date.parse(b.lastSeenAt || "") || 0) - (Date.parse(a.lastSeenAt || "") || 0));
    return { rows: rows.slice(0, 500), truncated: rows.length > 500 };
  } catch (error) {
    console.error("Admin activity query failed:", error);
    throw new HttpsError("internal", "לא ניתן לטעון פעילות משתמשים.");
  }
});

/* =============================================================================
 *  deleteWedding — מחיקה לצמיתות של חתונה
 * -----------------------------------------------------------------------------
 *  הפעולה נשארת בצד השרת: מחיקת שורש Firestore לא מוחקת תת-אוספים, והדפדפן
 *  גם אינו רשאי למחוק חתונה לפי הכללים. שם החתונה משמש אישור מפורש נוסף
 *  מעבר לחלון האזהרה ב-UI, כדי שלא תוכל להיקרא בטעות ממסך אחר.
 * ========================================================================== */

exports.deleteWedding = onCall({ region: REGION, timeoutSeconds: 120 }, async (request) => {
  const uid = requireAuth(request);
  const env = envOf(request.data);
  const weddingId = String((request.data && request.data.weddingId) || "");
  const confirmationName = String((request.data && request.data.confirmationName) || "").trim();
  if (!weddingId) throw new HttpsError("invalid-argument", "חסר מזהה חתונה.");

  const wedding = await requireOwner(env, weddingId, uid);
  const weddingName = String(wedding.name || "החתונה שלי").trim();
  if (confirmationName !== weddingName) {
    throw new HttpsError("failed-precondition", "שם החתונה אינו תואם לאישור המחיקה.");
  }

  const root = weddingRef(env, weddingId);
  const [members, files, legacySettings, ownerSettings] = await Promise.all([
    root.collection("members").get(),
    root.collection("files").limit(1).get(),
    root.collection("settings").doc("main").get(),
    root.collection("settings").doc("owner").get(),
  ]);
  const memberIds = members.docs.map((member) => member.id);
  const invites = await envRoot(env).collection("invites").where("weddingId", "==", weddingId).get();
  const hasStorageAssets = !files.empty
    || Boolean(legacySettings.get("countdownBackgroundUrl"))
    || Boolean(ownerSettings.get("countdownBackgroundUrl"));

  //  ההזמנות חיות מחוץ לתת-העץ של החתונה, ולכן הן נמחקות בנפרד.
  for (let start = 0; start < invites.docs.length; start += 450) {
    const batch = db.batch();
    for (const invite of invites.docs.slice(start, start + 450)) batch.delete(invite.ref);
    await batch.commit();
  }

  //  מנקים לכל חבר את רמז החתונה ואת claim ה-Storage, לפני מחיקת החברות.
  for (const memberId of memberIds) {
    await envRoot(env).collection("users").doc(memberId).set(
      { weddingIds: FieldValue.arrayRemove(weddingId) },
      { merge: true }
    );
  }

  //  מוחקים את הקבצים קודם. כשל באחסון חייב להשאיר את החתונה שלמה כדי
  //  שלא ייווצר מצב שבו הנתונים נעלמו אבל קבצים פרטיים נותרו בבאקט.
  if (hasStorageAssets) {
    await storage.bucket().deleteFiles({ prefix: `${env}/weddings/${weddingId}/` });
  }
  await db.recursiveDelete(root);

  await Promise.all(memberIds.map((memberId) => refreshWeddingClaims(env, memberId)));
  return { ok: true };
});

/* =============================================================================
 *  Passkeys — כניסה עם Face ID / טביעת אצבע
 * -----------------------------------------------------------------------------
 *  WebAuthn מחליף סיסמה במפתח שנוצר במכשיר ולא עוזב אותו. הביומטריה עצמה
 *  לעולם לא מגיעה לשרת — היא רק פותחת את המפתח הפרטי מקומית, והשרת מאמת
 *  חתימה מול המפתח הציבורי ששמור אצלו.
 *
 *  ⚠ המפתח נצמד ל-RP ID, שהוא הדומיין. מפתח שנרשם ב-localhost לא יעבוד
 *    בייצור ולהפך — זו התנהגות מוגדרת של התקן, לא באג.
 *
 *  ⚠ האתגר חייב להישמר בצד השרת ולהיבדק פעם אחת בלבד. בלי זה אפשר
 *    להקליט חתימה ולשחזר אותה (replay).
 * ========================================================================== */

//  הדומיינים שמהם מותר להירשם ולהיכנס. כל מקור אחר נדחה, אחרת אתר זר
//  יכול לבקש חתימה עבור המשתמשים שלנו.
const RP_NAME = "תכנון החתונה שלי";
const ALLOWED_ORIGINS = {
  "https://wedding-planner-web.onrender.com": "wedding-planner-web.onrender.com",
  "https://wedding-planner-vixy.onrender.com": "wedding-planner-vixy.onrender.com",
  "http://localhost:4173": "localhost",
  "http://localhost:5173": "localhost",
  "http://localhost:5174": "localhost",
  "http://localhost:5175": "localhost",
  "http://localhost:5176": "localhost",
  "http://localhost:5177": "localhost",
};

function resolveRp(origin) {
  const rpID = ALLOWED_ORIGINS[String(origin || "")];
  if (!rpID) throw new HttpsError("permission-denied", "מקור לא מורשה.");
  return { rpID, origin };
}

const passkeyCol = (env) => envRoot(env).collection("passkeys");
const challengeCol = (env) => envRoot(env).collection("webauthnChallenges");

const CHALLENGE_TTL_MS = 5 * 60_000;

async function putChallenge(env, key, challenge) {
  await challengeCol(env).doc(key).set({
    challenge,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });
}

/** שולף אתגר ומוחק אותו מיד — שימוש חד-פעמי בלבד. */
async function takeChallenge(env, key) {
  const ref = challengeCol(env).doc(key);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "האתגר פג. נסו שוב.");
  await ref.delete();
  const data = snap.data();
  if (!data.expiresAt || data.expiresAt < Date.now()) {
    throw new HttpsError("failed-precondition", "האתגר פג. נסו שוב.");
  }
  return data.challenge;
}

exports.passkeyRegisterOptions = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const env = envOf(request.data);
  const { rpID } = resolveRp(request.data && request.data.origin);

  const user = await auth.getUser(uid);
  const existing = await passkeyCol(env).where("userId", "==", uid).get();

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: Buffer.from(uid, "utf8"),
    userName: user.email || uid,
    userDisplayName: user.email || uid,
    attestationType: "none",
    //  מונע רישום כפול של אותו מכשיר.
    excludeCredentials: existing.docs.map((d) => ({ id: d.id })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
  });

  await putChallenge(env, `reg_${uid}`, options.challenge);
  return options;
});

exports.passkeyRegisterVerify = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const env = envOf(request.data);
  const { rpID, origin } = resolveRp(request.data && request.data.origin);
  const expectedChallenge = await takeChallenge(env, `reg_${uid}`);

  const verification = await verifyRegistrationResponse({
    response: request.data.credential,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new HttpsError("invalid-argument", "אימות המכשיר נכשל.");
  }

  const { credential } = verification.registrationInfo;
  const user = await auth.getUser(uid);

  await passkeyCol(env).doc(credential.id).set({
    userId: uid,
    emailLower: String(user.email || "").toLowerCase(),
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter || 0,
    transports: credential.transports || [],
    label: String((request.data && request.data.label) || "המכשיר שלי").slice(0, 60),
    createdAt: FieldValue.serverTimestamp(),
    lastUsedAt: null,
  });

  return { ok: true, credentialId: credential.id };
});

/*  minInstances: 1 — הפונקציה היחידה שיושבת על המסלול הקריטי של חוויית
    המשתמש. היא נקראת לפני שיש זהות, ולכן אי אפשר להקדים אותה בשום דרך
    אחרת, וקר-סטארט של דקה ראשונה גרם ללחיצה על "כניסה מהירה" להיראות
    תקועה. מופע חם אחד מבטל את ההמתנה הזו לגמרי. שאר הפונקציות נקראות
    כשהמשתמש כבר בפנים ועומס ההמתנה שם נסבל, ולכן הן נשארות ב-0.  */
exports.passkeyLoginOptions = onCall({ region: REGION, minInstances: 1 }, async (request) => {
  const env = envOf(request.data);
  const { rpID } = resolveRp(request.data && request.data.origin);
  const email = normalizeEmail(request.data && request.data.email);

  //  בלי מייל נשענים על discoverable credentials: המכשיר עצמו מציע את
  //  החשבונות ששמורים בו, וזו החוויה של "להצמיד אצבע ולהיכנס".
  let allowCredentials;
  if (email) {
    const snap = await passkeyCol(env).where("emailLower", "==", email).get();
    allowCredentials = snap.docs.map((d) => ({
      id: d.id,
      transports: d.get("transports") || undefined,
    }));
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    ...(allowCredentials && allowCredentials.length ? { allowCredentials } : {}),
  });

  //  מפתח האתגר אינו יכול להישען על זהות (עוד אין), ולכן הוא מוחזר ללקוח
  //  ומוחזר בבקשת האימות. הוא אקראי, חד-פעמי ובעל תוקף קצר.
  const key = `auth_${randomBytes(16).toString("hex")}`;
  await putChallenge(env, key, options.challenge);
  return { options, challengeKey: key };
});

exports.passkeyLoginVerify = onCall({ region: REGION }, async (request) => {
  const env = envOf(request.data);
  const { rpID, origin } = resolveRp(request.data && request.data.origin);
  const key = String((request.data && request.data.challengeKey) || "");
  if (!key.startsWith("auth_")) throw new HttpsError("invalid-argument", "בקשה לא תקינה.");

  const expectedChallenge = await takeChallenge(env, key);
  const credentialId = String(request.data.credential && request.data.credential.id);
  const snap = await passkeyCol(env).doc(credentialId).get();
  if (!snap.exists) throw new HttpsError("not-found", "המכשיר אינו רשום.");

  const stored = snap.data();
  const verification = await verifyAuthenticationResponse({
    response: request.data.credential,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: credentialId,
      publicKey: Buffer.from(stored.publicKey, "base64url"),
      counter: stored.counter || 0,
      transports: stored.transports || undefined,
    },
  });

  if (!verification.verified) {
    throw new HttpsError("permission-denied", "האימות נכשל.");
  }

  //  מונה עולה מגלה שכפול של מפתח. שמירה שלו היא חלק מהתקן.
  await snap.ref.update({
    counter: verification.authenticationInfo.newCounter,
    lastUsedAt: FieldValue.serverTimestamp(),
  });

  return { token: await auth.createCustomToken(stored.userId) };
});

exports.passkeyList = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const env = envOf(request.data);
  const snap = await passkeyCol(env).where("userId", "==", uid).get();
  return {
    passkeys: snap.docs.map((d) => ({
      id: d.id,
      label: d.get("label") || "",
      createdAt: d.get("createdAt") ? d.get("createdAt").toDate().toISOString() : null,
      lastUsedAt: d.get("lastUsedAt") ? d.get("lastUsedAt").toDate().toISOString() : null,
    })),
  };
});

exports.passkeyDelete = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const env = envOf(request.data);
  const id = String((request.data && request.data.credentialId) || "");
  const ref = passkeyCol(env).doc(id);
  const snap = await ref.get();
  //  מחיקה רק של מפתח ששייך לפונה. בלי הבדיקה כל משתמש היה יכול למחוק
  //  את הכניסה המהירה של אחרים.
  if (!snap.exists || snap.get("userId") !== uid) {
    throw new HttpsError("not-found", "המכשיר לא נמצא.");
  }
  await ref.delete();
  return { ok: true };
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

  if (!created && !partner.emailVerified) {
    throw new HttpsError("failed-precondition", "partner_email_unverified");
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
  const scopes = normalizeScopes(data.scopes);
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

  const inviteRef = found.docs[0].ref;
  const user = await auth.getUser(uid);
  const acceptance = await db.runTransaction(async (tx) => {
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists || inviteSnap.get("tokenHash") !== hashToken(token)) {
      throw new HttpsError("not-found", "ההזמנה אינה קיימת.");
    }
    const invite = inviteSnap.data();
    if (invite.acceptedAt) throw new HttpsError("failed-precondition", "ההזמנה כבר מומשה.");
    if (invite.expiresAt && invite.expiresAt.toDate() < new Date()) {
      throw new HttpsError("deadline-exceeded", "תוקף ההזמנה פג.");
    }
    if (invite.email) {
      if (!user.email || user.email.toLowerCase() !== invite.email) {
        throw new HttpsError("permission-denied", "ההזמנה הונפקה לכתובת מייל אחרת.");
      }
      if (!user.emailVerified) {
        throw new HttpsError("failed-precondition", "invite_email_unverified");
      }
    }

    const weddingDoc = weddingRef(env, invite.weddingId);
    const memberDoc = weddingDoc.collection("members").doc(uid);
    const userDoc = envRoot(env).collection("users").doc(uid);
    const [wedding, membership] = await Promise.all([
      tx.get(weddingDoc),
      tx.get(memberDoc),
    ]);
    if (!wedding.exists) throw new HttpsError("not-found", "החתונה לא נמצאה.");
    if (membership.exists) {
      throw new HttpsError("already-exists", "אתם כבר חברים בחתונה הזו.");
    }

    tx.set(memberDoc, {
      userId: uid,
      email: user.email || "",
      ownerId: wedding.get("ownerId"),
      role: invite.role,
      scopes: normalizeScopes(invite.scopes),
      createdAt: FieldValue.serverTimestamp(),
      lastSeenAt: null,
    });
    tx.set(userDoc, {
      id: uid,
      email: user.email || "",
      emailLower: String(user.email || "").toLowerCase(),
      weddingIds: FieldValue.arrayUnion(invite.weddingId),
    }, { merge: true });
    tx.update(inviteRef, { acceptedAt: FieldValue.serverTimestamp() });
    return { weddingId: invite.weddingId };
  });

  await refreshWeddingClaims(env, uid);
  return acceptance;
});
