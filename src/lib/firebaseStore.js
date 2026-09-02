/* =========================================================================
 *  firebaseStore.js — שכבת הנתונים מול Firestore
 *  ------------------------------------------------------------------------
 *  מחליף את cloudStore.js ומייצא **בדיוק את אותם שמות**, כדי ש-App.jsx
 *  לא ישתנה. כל הבדל התנהגותי מתועד במקום שבו הוא קיים.
 *
 *  מבנה: envs/{env}/weddings/{weddingId}/{guests|tables|vendors|budget|
 *        checklist|files|members|settings}
 *
 *  ההרשאות נאכפות ב-firestore.rules, לא כאן. weddingId שנשלח מכאן הוא
 *  נכונות ונוחות — לקוח ששינה אותו בדפדפן פשוט יקבל permission-denied.
 * ====================================================================== */

import {
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  limit,
  writeBatch,
  setDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import {
  db,
  storage,
  auth,
  functions,
  FIREBASE_ENV,
  weddingRef,
  weddingCol,
  settingsRef,
  userRef,
} from "./firebase.js";
//  המיפוי יושב במודול טהור כדי שאפשר יהיה לבדוק אותו בלי דפדפן —
//  scripts/entity-map-test.mjs מריץ אותו מול הנתונים האמיתיים.
export { CHECKLIST_ASSIGNEES, ENTITIES, ENTITY_KEYS } from "./entityMap.js";
import { ENTITIES, ENTITY_KEYS } from "./entityMap.js";

function requireWeddingId(weddingId) {
  if (!weddingId || typeof weddingId !== "string") {
    throw new Error("firebaseStore: weddingId is required");
  }
  return weddingId;
}

function requireAuth() {
  const user = auth?.currentUser;
  if (!user) throw new Error("firebaseStore: not authenticated");
  return user;
}


/* =========================================================================
 *  נתוני החתונה
 * ====================================================================== */

/*  המחיקה נשארת רכה, כמו במסד הישן: deletedAt מקבל חותמת ולא נמחק כלום.
    Firestore לא תומך ב-"!=" יעיל על null בלי אינדקס, ולכן הסינון נעשה
    בזיכרון — כמות הרשומות לחתונה אחת קטנה (מאות), וזה חוסך אינדקס מורכב
    ואת ההפתעה של שאילתה שנופלת בייצור על אינדקס חסר.  */
const isAlive = (data) => !data.deletedAt;

/** מסיר שדות של השכבה עצמה, שאינם הגדרות של המשתמש. */
function stripMeta(data) {
  const clean = { ...data };
  delete clean.updatedAt;
  return clean;
}

/*  Firestore מחזיר Timestamp ולא מחרוזת. ה-UI עושה new Date(…) על הערך,
    ו-Timestamp מבשל את זה ל-Invalid Date. המרה ל-ISO כאן שומרת על אותו
    חוזה שהיה לשרת הקודם.  */
function toIso(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function fetchCollection(weddingId, key) {
  const cfg = ENTITIES[key];
  const snap = await getDocs(weddingCol(weddingId, cfg.col));
  return snap.docs
    .map((d) => d.data())
    .filter(isAlive)
    .map(cfg.fromDoc);
}

/** טוען את כל הנתונים הפעילים של חתונה אחת. */
export async function cloudFetchAll(weddingId) {
  requireWeddingId(weddingId);
  requireAuth();

  const result = {};
  //  במקביל: חמש שאילתות עצמאיות, ואין סיבה לשרשר אותן.
  await Promise.all(
    ENTITY_KEYS.map(async (key) => {
      result[key] = await fetchCollection(weddingId, key);
    })
  );

  const settings = await getDoc(settingsRef(weddingId));
  //  updatedAt הוא מטא של השכבה הזו ולא הגדרה של המשתמש.
  result.settings = stripMeta(settings.exists() ? settings.data() : {});
  return result;
}

/**
 * שומר את הגדרות החתונה. כתיבת מיזוג — רק המפתחות שנשלחו משתנים.
 */
export async function saveWeddingSettings(weddingId, settings) {
  requireWeddingId(weddingId);
  requireAuth();
  await setDoc(
    settingsRef(weddingId),
    { ...(settings || {}), updatedAt: serverTimestamp() },
    { merge: true }
  );
  const snap = await getDoc(settingsRef(weddingId));
  return stripMeta(snap.exists() ? snap.data() : {});
}

export async function uploadCountdownBackground(weddingId, file) {
  requireWeddingId(weddingId);
  requireAuth();
  if (!file?.type?.startsWith("image/")) throw new Error("image_required");
  if (file.size > 8 * 1024 * 1024) throw new Error("file_too_large");

  const path = `${FIREBASE_ENV}/weddings/${weddingId}/countdown-background`;
  await uploadBytes(ref(storage, path), file, { contentType: file.type });
  const url = await getDownloadURL(ref(storage, path));
  await saveWeddingSettings(weddingId, { countdownBackgroundUrl: url });
  return url;
}

/**
 * האם החתונה ריקה לגמרי (כדי לזרוע אותה בפעם הראשונה).
 *
 * מסמך אחד מכל אוסף מספיק, והכול במקביל. הגרסה הקודמת שלפה את כל
 * האוספים במלואם ובטור — כלומר את כל 596 המוזמנים — רק כדי לגלות
 * שהחתונה אינה ריקה, ומיד אחריה cloudFetchAll שלף אותם שוב.
 *
 * שורה שנמחקה מחיקה רכה נחשבת כאן כ"לא ריק" בכוונה: הזריעה נועדה
 * לחתונה חדשה לגמרי, ועדיף להימנע ממנה מאשר לשכפל נתונים קיימים.
 */
export async function cloudIsEmpty(weddingId) {
  requireWeddingId(weddingId);
  requireAuth();

  const probes = await Promise.all(
    ENTITY_KEYS.map((key) =>
      getDocs(query(weddingCol(weddingId, ENTITIES[key].col), limit(1)))
    )
  );
  return probes.every((snap) => snap.empty);
}

//  Firestore מגביל אצווה ל-500 פעולות.
const BATCH_LIMIT = 450;

async function commitInChunks(operations) {
  for (let i = 0; i < operations.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const op of operations.slice(i, i + BATCH_LIMIT)) op(batch);
    await batch.commit();
  }
}

/** זריעה ראשונית – מעלה נתונים מקומיים קיימים לחתונה ריקה. */
export async function cloudSeed(weddingId, datasets) {
  requireWeddingId(weddingId);
  requireAuth();

  const ops = [];
  for (const [key, cfg] of Object.entries(ENTITIES)) {
    for (const row of datasets[key] || []) {
      const data = cfg.toDoc(row);
      ops.push((batch) =>
        batch.set(doc(weddingCol(weddingId, cfg.col), String(data.id)), {
          ...data,
          deletedAt: null,
          updatedAt: serverTimestamp(),
        })
      );
    }
  }
  await commitInChunks(ops);
}

/**
 * מסנכרן dataset בודד:
 *   • upsert לכל הרשומות הנוכחיות,
 *   • soft-delete לרשומות שהוסרו.
 * מחזיר Set של ה-ids הנוכחיים לצורך ההשוואה הבאה.
 */
export async function cloudSyncDataset(weddingId, key, rows, prevIds) {
  requireWeddingId(weddingId);
  requireAuth();
  const cfg = ENTITIES[key];
  if (!cfg) throw new Error(`firebaseStore: unknown dataset '${key}'`);

  const currentIds = new Set(rows.map((r) => Number(r.id)));
  const removedIds = [...prevIds].filter((id) => !currentIds.has(Number(id)));

  const ops = [];
  for (const row of rows) {
    const data = cfg.toDoc(row);
    ops.push((batch) =>
      batch.set(
        doc(weddingCol(weddingId, cfg.col), String(data.id)),
        { ...data, deletedAt: null, updatedAt: serverTimestamp() },
        { merge: true }
      )
    );
  }
  for (const id of removedIds) {
    ops.push((batch) =>
      batch.set(
        doc(weddingCol(weddingId, cfg.col), String(id)),
        { deletedAt: serverTimestamp(), updatedAt: serverTimestamp() },
        { merge: true }
      )
    );
  }

  if (ops.length) await commitInChunks(ops);
  return currentIds;
}

/**
 *  מאזין לשינויים בזמן אמת באוסף של חתונה. מחזיר פונקצית ניתוק.
 *
 *  משמש את פורטל הספקים: עדכון שספק עושה מהטלפון מופיע בדאשבורד
 *  מיד, בלי רענון. הצרכן אחראי להתעלם מעדכון זהה למה שאצלו — אחרת
 *  הכתיבה המושהית וההאזנה יזינו זו את זו בלולאה.
 */
export function subscribeCollection(weddingId, key, onChange, onError) {
  requireWeddingId(weddingId);
  const cfg = ENTITIES[key];
  if (!cfg) throw new Error(`firebaseStore: unknown dataset '${key}'`);

  return onSnapshot(
    weddingCol(weddingId, cfg.col),
    (snap) => {
      //  שינויים שטרם נכתבו לשרת מגיעים עם hasPendingWrites. אלה השינויים
      //  שלנו עצמנו, והחזרתם ל-state היא בדיוק הלולאה שצריך למנוע.
      if (snap.metadata.hasPendingWrites) return;
      onChange(snap.docs.map((d) => d.data()).filter(isAlive).map(cfg.fromDoc));
    },
    (err) => {
      console.error(`Realtime subscription failed (${key}):`, err);
      onError?.(err);
    }
  );
}

/* =========================================================================
 *  חתונות וחברים
 * ====================================================================== */

function mapWedding(data, membership) {
  return {
    id: data.id,
    name: data.name ?? "",
    weddingDate: data.weddingDate ?? null,
    partnerA: data.partnerA ?? "",
    partnerB: data.partnerB ?? "",
    ownerId: data.ownerId,
    createdAt: data.createdAt ?? null,
    role: membership?.role ?? "viewer",
    scopes: membership?.scopes?.length ? membership.scopes : ["all"],
  };
}

/**
 *  כל החתונות שהמשתמש חבר בהן.
 *
 *  הרשימה נשמרת על מסמך המשתמש (weddingIds) ולא נשלפת ב-collectionGroup.
 *  שתי סיבות: שאילתת collectionGroup דורשת אינדקס ייעודי וגם כלל אבטחה
 *  נפרד (כללים מקוננים אינם חלים על שאילתות קבוצה), והיא סורקת את כל
 *  מסמכי החברות במסד בכל כניסה.
 *
 *  הרשימה היא **רמז בלבד**: מי שיוסיף לעצמו מזהה שרירותי לא ירוויח דבר,
 *  כי קריאת החתונה עצמה עדיין מותנית בקיום מסמך חברות.
 */
export async function listWeddings() {
  const user = requireAuth();

  const me = await getDoc(userRef(user.uid));
  const ids = me.exists() && Array.isArray(me.data().weddingIds) ? me.data().weddingIds : [];

  const out = [];
  await Promise.all(
    ids.map(async (id) => {
      try {
        const [wSnap, mSnap] = await Promise.all([
          getDoc(weddingRef(id)),
          getDoc(doc(weddingCol(id, "members"), user.uid)),
        ]);
        //  חברות שבוטלה משאירה מזהה מיותם ברשימה — פשוט מדלגים.
        if (wSnap.exists() && mSnap.exists()) {
          out.push(mapWedding({ id: wSnap.id, ...wSnap.data() }, mSnap.data()));
        }
      } catch {
        /* אין הרשאה לחתונה הזו — לא מציגים אותה */
      }
    })
  );

  out.sort((a, b) => String(a.name).localeCompare(String(b.name), "he"));
  return out;
}

/** מוסיף מזהה חתונה לרשימה של המשתמש המחובר. */
async function rememberWedding(weddingId) {
  const user = requireAuth();
  await setDoc(userRef(user.uid), { weddingIds: arrayUnion(weddingId) }, { merge: true });
}

/** יוצר חתונה חדשה בבעלות המשתמש המחובר. */
export async function createWedding(name, date) {
  const user = requireAuth();
  const id = crypto.randomUUID();

  const batch = writeBatch(db);
  batch.set(weddingRef(id), {
    id,
    name: String(name || "").trim() || "החתונה שלי",
    weddingDate: date || null,
    partnerA: "",
    partnerB: "",
    ownerId: user.uid,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(weddingCol(id, "members"), user.uid), {
    userId: user.uid,
    email: user.email ?? "",
    ownerId: user.uid,
    role: "owner",
    scopes: ["all"],
    createdAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
  });
  await batch.commit();
  await rememberWedding(id);

  const snap = await getDoc(weddingRef(id));
  return mapWedding({ id, ...snap.data() }, { role: "owner", scopes: ["all"] });
}

/** מעדכן חתונה קיימת. בעלים בלבד (נאכף בכללי האבטחה). */
export async function updateWedding(weddingId, patch = {}) {
  requireWeddingId(weddingId);
  requireAuth();

  const body = {};
  if (patch.name !== undefined) body.name = String(patch.name || "").trim();
  if (patch.date !== undefined) body.weddingDate = patch.date || null;
  if (patch.partnerA !== undefined) body.partnerA = String(patch.partnerA ?? "");
  if (patch.partnerB !== undefined) body.partnerB = String(patch.partnerB ?? "");
  if (!Object.keys(body).length) return null;

  await updateDoc(weddingRef(weddingId), body);
  const snap = await getDoc(weddingRef(weddingId));
  return mapWedding({ id: weddingId, ...snap.data() }, { role: "owner", scopes: ["all"] });
}

/**
 *  חברי החתונה.
 *
 *  המייל נשמר על מסמך החברות עצמו ולא נשלף מאוסף users: כללי האבטחה
 *  מתירים למשתמש לקרוא רק את המסמך של עצמו, אחרת כל בעל חשבון היה
 *  יכול לשלוף את כל כתובות המייל במערכת.
 */
export async function listMembers(weddingId) {
  requireWeddingId(weddingId);
  const me = requireAuth();

  const snap = await getDocs(weddingCol(weddingId, "members"));

  return snap.docs.map((d) => {
    const m = d.data();
    return {
      userId: d.id,
      //  שורות ישנות מלפני הדנורמליזציה עלולות להיות בלי email.
      email: m.email ?? (d.id === me.uid ? me.email : ""),
      role: m.role,
      scopes: m.scopes?.length ? m.scopes : ["all"],
      createdAt: toIso(m.createdAt),
      lastSeenAt: toIso(m.lastSeenAt),
    };
  });
}

export async function updateMember(weddingId, userId, role, scopes) {
  requireWeddingId(weddingId);
  requireAuth();
  if (!userId) throw new Error("firebaseStore: userId is required");
  if (role !== "editor" && role !== "viewer") {
    throw new Error("firebaseStore: role must be 'editor' or 'viewer'");
  }
  await updateDoc(doc(weddingCol(weddingId, "members"), userId), {
    role,
    scopes: Array.isArray(scopes) && scopes.length ? scopes : ["all"],
  });
}

export async function removeMember(weddingId, userId) {
  requireWeddingId(weddingId);
  const me = requireAuth();
  if (!userId) throw new Error("firebaseStore: userId is required");
  await deleteDoc(doc(weddingCol(weddingId, "members"), userId));
  //  עוזב בעצמו — מנקה את הרמז ממסמך המשתמש שלו. הסרת אחרים משאירה
  //  אצלם מזהה מיותם, ו-listWeddings מדלג עליו בשקט.
  if (userId === me.uid) {
    await setDoc(userRef(me.uid), { weddingIds: arrayRemove(weddingId) }, { merge: true });
  }
}

/* =========================================================================
 *  פעולות שדורשות הרשאות אדמין — Cloud Functions
 *  ------------------------------------------------------------------------
 *  שלוש הפעולות האלה לא יכולות לרוץ מהדפדפן: הראשונה יוצרת חשבון
 *  למשתמש אחר, השנייה יוצרת מסמך חברות שכללי האבטחה מתירים לבעלים
 *  בלבד, והשלישית שולחת מייל. ראו functions/index.js.
 * ====================================================================== */

function callable(name) {
  return async (payload) => {
    if (!functions) throw new Error("firebaseStore: Firebase לא מוגדר");
    requireAuth();
    const fn = httpsCallable(functions, name);
    const res = await fn({ ...payload, env: FIREBASE_ENV });
    return res.data;
  };
}

const callAddPartner = callable("addPartner");
const callCreateInvite = callable("createInvite");
const callAcceptInvite = callable("acceptInvite");
const callSyncClaims = callable("syncMyClaims");
const callAdminStats = callable("getAdminStats");

export async function getAdminStats() {
  return callAdminStats({});
}

/**
 *  צירוף בן/בת זוג. לכל אחד סיסמה משלו: החשבון נוצר בלי סיסמה,
 *  ומייד נשלח מייל קביעת סיסמה — גם בעל החתונה אינו יודע אותה.
 */
export async function addPartner(weddingId, email) {
  requireWeddingId(weddingId);
  const clean = String(email || "").trim().toLowerCase();
  if (!clean) throw new Error("firebaseStore: email is required");

  const res = await callAddPartner({ weddingId, email: clean });

  //  Firebase Auth שולח את המייל בעצמו, ולכן אין צורך ב-SMTP בצד השרת.
  //  כישלון שליחה לא מבטל צירוף שכבר נשמר.
  if (res?.needsPasswordSetup) {
    try {
      await sendPartnerSetupEmail(clean);
    } catch {
      /* אפשר לשלוח שוב דרך resendPartnerSetup */
    }
  }
  return res;
}

/**
 *  שולח מחדש קישור לקביעת סיסמה.
 *  sendPasswordResetEmail ניתן לקריאה גם עבור כתובת של מישהו אחר,
 *  ולכן בעל החתונה יכול ליזום אותו בלי פונקציה יעודית.
 */
export async function resendPartnerSetup(weddingId, email) {
  requireWeddingId(weddingId);
  await sendPartnerSetupEmail(String(email || "").trim().toLowerCase());
  return { ok: true };
}

async function sendPartnerSetupEmail(email) {
  const { sendPasswordResetEmail } = await import("firebase/auth");
  await sendPasswordResetEmail(auth, email);
}

/**
 *  מרענן את ה-claim שעליו נשענים כללי ה-Storage, ומושך טוקן חדש.
 *  נכשל בשקט: אם הפונקציות עדיין לא נפרסו, שאר המערכת עובדת כרגיל.
 */
export async function syncStorageClaims() {
  try {
    await callSyncClaims({});
    await auth.currentUser?.getIdToken(true);
  } catch {
    /* לא קריטי */
  }
}

export async function inviteMember(weddingId, email, role, scopes = ["all"]) {
  requireWeddingId(weddingId);
  if (role !== "editor" && role !== "viewer") {
    throw new Error("firebaseStore: role must be 'editor' or 'viewer'");
  }
  const clean = String(email || "").trim().toLowerCase();
  const invite = await callCreateInvite({ weddingId, email: clean || null, role, scopes });
  return {
    ...invite,
    link: `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(invite.token)}`,
  };
}

export async function acceptInvite(token) {
  if (!token) throw new Error("firebaseStore: token is required");
  const data = await callAcceptInvite({ token });
  return data?.weddingId ?? null;
}

/** מסמן נוכחות. נכשל בשקט — זהו שדה תצוגה ואסור שיפיל פעולה אמיתית. */
export async function touchMembership(weddingId) {
  try {
    const user = auth?.currentUser;
    if (!user) return;
    await updateDoc(doc(weddingCol(weddingId, "members"), user.uid), {
      lastSeenAt: serverTimestamp(),
    });
  } catch {
    /* לא קריטי */
  }
}

/* =========================================================================
 *  היקפי שיתוף (scopes)
 * ====================================================================== */

export const SCOPE_OPTIONS = [
  { key: "guests", label: "מוזמנים וסידור הושבה" },
  { key: "vendors", label: "ספקים" },
  { key: "finance", label: "ניהול תקציב" },
  { key: "checklist", label: "צ׳קליסט" },
];

export const ALL_SCOPES = SCOPE_OPTIONS.map((s) => s.key);

export function hasScope(scopes, key) {
  if (!Array.isArray(scopes) || !scopes.length) return true;
  return scopes.includes("all") || scopes.includes(key);
}

export function isFullScope(scopes) {
  return ALL_SCOPES.every((k) => hasScope(scopes, k));
}

/* =========================================================================
 *  קבצים מצורפים לספקים
 * ====================================================================== */

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

const storagePathFor = (env, weddingId, fileId, name) => {
  const dot = String(name || "").lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  return `${env}/weddings/${weddingId}/vendor-files/${fileId}${ext}`;
};

export async function listVendorFiles(weddingId) {
  requireWeddingId(weddingId);
  requireAuth();
  const snap = await getDocs(weddingCol(weddingId, "files"));
  return snap.docs.map((d) => {
    const f = d.data();
    return {
      id: d.id,
      vendorId: f.vendorId == null ? null : Number(f.vendorId),
      name: f.name ?? "",
      mime: f.mime ?? "application/octet-stream",
      size: Number(f.size) || 0,
      storagePath: f.storagePath ?? "",
      createdAt: toIso(f.createdAt),
    };
  });
}

export async function uploadVendorFile(weddingId, vendorId, file) {
  requireWeddingId(weddingId);
  requireAuth();
  if (file.size > MAX_FILE_BYTES) throw new Error("file_too_large");

  const id = crypto.randomUUID();
  const path = storagePathFor(FIREBASE_ENV, weddingId, id, file.name);

  await uploadBytes(ref(storage, path), file, {
    contentType: file.type || "application/octet-stream",
  });

  const record = {
    id,
    vendorId: Number(vendorId),
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
    storagePath: path,
    createdAt: serverTimestamp(),
  };
  await setDoc(doc(weddingCol(weddingId, "files"), id), record);
  return { ...record, createdAt: new Date().toISOString() };
}

export async function deleteVendorFile(weddingId, fileId) {
  requireWeddingId(weddingId);
  requireAuth();

  const snap = await getDoc(doc(weddingCol(weddingId, "files"), fileId));
  const path = snap.exists() ? snap.data().storagePath : null;

  //  קודם המסמך ואז הקובץ: אם המחיקה מ-Storage תיכשל נשארת רק פסולת
  //  שקטה, ולא רשומה שמצביעה לקובץ שכבר לא קיים.
  await deleteDoc(doc(weddingCol(weddingId, "files"), fileId));
  if (path) {
    try {
      await deleteObject(ref(storage, path));
    } catch {
      /* הקובץ כבר לא שם — אין מה לתקן */
    }
  }
}

/**
 *  כתובת הורדה חתומה.
 *
 *  ⚠ הבדל מהגרסה הקודמת: זו פונקציה **אסינכרונית**. בגרסת השרת הכתובת
 *  הייתה נתיב קבוע שהעוגייה אימתה, ולכן אפשר היה לשים אותה ישירות ב-href.
 *  ב-Firebase Storage הכתובת נחתמת מול הטוקן של המשתמש, ולכן חייבים
 *  await. שני מקומות ב-App.jsx שהשתמשו בה בתוך src/href הותאמו.
 */
export async function vendorFileUrl(weddingId, fileId) {
  requireWeddingId(weddingId);
  requireAuth();
  const snap = await getDoc(doc(weddingCol(weddingId, "files"), fileId));
  if (!snap.exists()) throw new Error("file_not_found");
  return getDownloadURL(ref(storage, snap.data().storagePath));
}
