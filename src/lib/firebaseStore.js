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
  deleteField,
  arrayUnion,
  runTransaction,
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

/** Wait until Firebase has restored its persisted user before using Firestore. */
export async function waitForAuthContext(expectedUid) {
  if (!auth) throw new Error("firebaseStore: Firebase Auth is not configured");
  if (typeof auth.authStateReady === "function") await auth.authStateReady();
  const user = requireAuth();
  if (expectedUid && user.uid !== expectedUid) {
    const error = new Error("firebaseStore: Auth user does not match the active app session");
    error.code = "auth_context_mismatch";
    throw error;
  }
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
  let snap;
  try {
    snap = await getDocs(weddingCol(weddingId, cfg.col));
  } catch (error) {
    console.error("Firestore initial collection fetch failed:", {
      weddingId,
      collection: cfg.col,
      code: error?.code,
      error,
    });
    throw error;
  }
  return snap.docs
    .map((d) => d.data())
    .filter(isAlive)
    .map((data) => ({ ...cfg.fromDoc(data), _version: Number(data.revision) || 0 }));
}

const scopedSettingsRef = (weddingId, key) => doc(weddingCol(weddingId, "settings"), key);

/** טוען את כל הנתונים הפעילים של חתונה אחת. */
export async function cloudFetchAll(weddingId, { scopes = ["all"], isOwner = false } = {}) {
  requireWeddingId(weddingId);
  await waitForAuthContext();

  try {
  const result = {};
  const hasScope = (scope) => scopes.includes("all") || scopes.includes(scope);
  const visibleKeys = ENTITY_KEYS.filter((key) => {
    const scope = key === "tables" ? "guests" : key === "budget" ? "finance" : key;
    return isOwner || hasScope(scope);
  });
  await Promise.all(visibleKeys.map(async (key) => {
    result[key] = await fetchCollection(weddingId, key);
  }));
  for (const key of ENTITY_KEYS) result[key] ||= [];

  const reads = [];
  if (isOwner) reads.push(["legacy", getDoc(settingsRef(weddingId))]);
  if (isOwner || hasScope("finance")) {
    reads.push(["finance", getDoc(scopedSettingsRef(weddingId, "finance"))]);
  }
  if (isOwner || hasScope("guests")) {
    reads.push(["guests", getDoc(scopedSettingsRef(weddingId, "guests"))]);
  }
  if (isOwner) reads.push(["owner", getDoc(scopedSettingsRef(weddingId, "owner"))]);

  const scopedSettings = {};
  const snapshots = await Promise.all(reads.map(([, promise]) => promise));
  for (let index = 0; index < reads.length; index++) {
    const [key] = reads[index];
    const snapshot = snapshots[index];
    if (key !== "legacy" && snapshot.exists()) {
      Object.assign(scopedSettings, stripMeta(snapshot.data()));
    }
  }

  let legacySettings = {};
  // Owners can read the legacy combined document; migrate only missing keys.
  if (isOwner) {
    const legacyIndex = reads.findIndex(([key]) => key === "legacy");
    const legacy = legacyIndex >= 0 ? snapshots[legacyIndex] : null;
    if (legacy?.exists()) {
      legacySettings = stripMeta(legacy.data());
      const missing = Object.fromEntries(
        Object.entries(legacySettings).filter(([key]) => !(key in scopedSettings))
      );
      if (Object.keys(missing).length) await saveWeddingSettings(weddingId, missing);
    }
  }
  result.settings = { ...legacySettings, ...scopedSettings };
  return result;
  } catch (error) {
    console.error("Firestore initial wedding data fetch failed:", {
      weddingId,
      isOwner,
      scopes,
      code: error?.code,
      error,
    });
    throw error;
  }
}

/**
 * שומר את הגדרות החתונה. כתיבת מיזוג — רק המפתחות שנשלחו משתנים.
 */
export async function saveWeddingSettings(weddingId, settings) {
  requireWeddingId(weddingId);
  requireAuth();
  const patch = settings || {};
  const groups = {
    finance: Object.fromEntries(
      ["budgetGoal", "financeLabels"].filter((key) => key in patch).map((key) => [key, patch[key]])
    ),
    guests: Object.fromEntries(
      ["categories"].filter((key) => key in patch).map((key) => [key, patch[key]])
    ),
    owner: Object.fromEntries(
      ["countdownBackgroundUrl"].filter((key) => key in patch).map((key) => [key, patch[key]])
    ),
  };
  await Promise.all(
    Object.entries(groups)
      .filter(([, values]) => Object.keys(values).length)
      .map(([key, values]) => setDoc(
        scopedSettingsRef(weddingId, key),
        { ...values, updatedAt: serverTimestamp() },
        { merge: true }
      ))
  );
  return { ...patch };
}

export async function uploadCountdownBackground(weddingId, file) {
  requireWeddingId(weddingId);
  requireAuth();
  if (!file?.type?.startsWith("image/")) throw new Error("image_required");
  if (file.size > 8 * 1024 * 1024) throw new Error("file_too_large");

  await syncStorageClaims();
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
  const isUuid = (value) =>
    typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const normalized = {
    ...(datasets || {}),
    vendors: (datasets?.vendors || []).map((vendor) => ({
      ...vendor,
      id: isUuid(vendor.id) ? vendor.id : crypto.randomUUID(),
      ...(isUuid(vendor.id) || vendor.id == null ? {} : { legacyId: String(vendor.id) }),
    })),
  };
  const vendorIds = new Map();
  normalized.vendors.forEach((vendor, index) => {
    vendorIds.set(String((datasets?.vendors || [])[index]?.id), vendor.id);
    if (vendor.legacyId != null) vendorIds.set(String(vendor.legacyId), vendor.id);
  });
  normalized.budget = (datasets?.budget || []).map((row) => ({
    ...row,
    vendorId: row.vendorId == null
      ? null
      : (vendorIds.get(String(row.vendorId)) || String(row.vendorId)),
  }));

  if (!(await cloudIsEmpty(weddingId))) {
    const remote = await cloudFetchAll(weddingId, { scopes: ["all"], isOwner: true });
    for (const key of ENTITY_KEYS) {
      const remoteRows = remote[key] || [];
      const rowsById = new Map(remoteRows.map((row) => [row.id, row]));
      for (const row of normalized[key] || []) rowsById.set(row.id, row);
      await cloudSyncDataset(
        weddingId,
        key,
        [...rowsById.values()],
        new Set(remoteRows.map((row) => row.id)),
        new Map(remoteRows.map((row) => [row.id, row]))
      );
    }
    return normalized;
  }

  for (const [key, cfg] of Object.entries(ENTITIES)) {
    for (const row of normalized[key] || []) {
      const data = cfg.toDoc(row);
      ops.push((batch) =>
        batch.set(doc(weddingCol(weddingId, cfg.col), String(data.id)), {
          ...data,
          revision: 1,
          deletedAt: null,
          updatedAt: serverTimestamp(),
        })
      );
    }
  }
  await commitInChunks(ops);
  return normalized;
}

/**
 * מסנכרן רק רשומות ששונו, תוך השוואת revision בתוך טרנזקציה.
 * שינויים מרוחקים בשדות אחרים מתמזגים; אותו שדה מתנגש ונשמר מקומית.
 * מחזיר Set של ה-ids הנוכחיים לצורך ההשוואה הבאה.
 */
export async function cloudSyncDataset(
  weddingId,
  key,
  rows,
  prevIds,
  baseline = new Map(),
  { allowRestore = false } = {}
) {
  requireWeddingId(weddingId);
  requireAuth();
  const cfg = ENTITIES[key];
  if (!cfg) throw new Error(`firebaseStore: unknown dataset '${key}'`);

  const normalizeId = (id) => key === "vendors" ? String(id) : Number(id);
  const currentIds = new Set(rows.map((row) => normalizeId(row.id)));
  const removedIds = [...prevIds].filter((id) => !currentIds.has(normalizeId(id)));

  for (const row of rows) {
    const data = cfg.toDoc(row);
    const base = baseline.get(data.id);
    const baseData = base ? cfg.toDoc(base) : null;
    const localChanges = baseData
      ? Object.keys(data).filter((field) => JSON.stringify(data[field]) !== JSON.stringify(baseData[field]))
      : Object.keys(data);
    if (!localChanges.length) continue;

    const recordRef = doc(weddingCol(weddingId, cfg.col), String(data.id));
    const revision = await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(recordRef);
      const remote = snapshot.exists() ? snapshot.data() : null;
      if (!remote && base && !allowRestore) {
        throw Object.assign(new Error(`Record ${key}/${data.id} was removed remotely.`), { code: "sync_conflict" });
      }
      if (remote && !base && !allowRestore) {
        throw Object.assign(new Error(`Record ${key}/${data.id} already exists remotely.`), { code: "sync_conflict" });
      }
      if (remote?.deletedAt && !allowRestore) {
        throw Object.assign(new Error(`Record ${key}/${data.id} was deleted remotely.`), { code: "sync_conflict" });
      }

      const actualVersion = Number(remote?.revision) || 0;
      const expectedVersion = Number(base?._version) || 0;
      if (remote && actualVersion !== expectedVersion && !allowRestore) {
        throw Object.assign(
          new Error(`Stale revision for ${key}/${data.id}.`),
          { code: "sync_conflict" }
        );
      }

      const nextVersion = actualVersion + 1;
      transaction.set(recordRef, {
        ...data,
        revision: nextVersion,
        deletedAt: null,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      return nextVersion;
    });
    baseline.set(data.id, { ...row, _version: revision });
  }

  for (const id of removedIds) {
    const base = baseline.get(normalizeId(id));
    const recordRef = doc(weddingCol(weddingId, cfg.col), String(id));
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(recordRef);
      if ((!snapshot.exists() || snapshot.get("deletedAt")) && !allowRestore) return;
      const actualVersion = Number(snapshot.get("revision")) || 0;
      const expectedVersion = Number(base?._version) || 0;
      if ((!base || actualVersion !== expectedVersion) && !allowRestore) {
        throw Object.assign(new Error(`Cannot delete stale ${key}/${id}.`), { code: "sync_conflict" });
      }
      transaction.set(recordRef, {
        deletedAt: serverTimestamp(),
        revision: actualVersion + 1,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    });
    baseline.delete(normalizeId(id));
  }

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
  requireAuth();
  const cfg = ENTITIES[key];
  if (!cfg) throw new Error(`firebaseStore: unknown dataset '${key}'`);

  return onSnapshot(
    weddingCol(weddingId, cfg.col),
    (snap) => {
      //  שינויים שטרם נכתבו לשרת מגיעים עם hasPendingWrites. אלה השינויים
      //  שלנו עצמנו, והחזרתם ל-state היא בדיוק הלולאה שצריך למנוע.
      if (snap.metadata.hasPendingWrites) return;
      const allRows = snap.docs.map((document) => ({
        ...cfg.fromDoc(document.data()),
        _version: Number(document.get("revision")) || 0,
        _deleted: !isAlive(document.data()),
      }));
      onChange(allRows.filter((row) => !row._deleted), {
        tombstones: allRows.filter((row) => row._deleted),
      });
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
  const user = await waitForAuthContext();

  try {
    const result = await callListMyWeddings({});
    const weddings = Array.isArray(result?.weddings) ? result.weddings : [];
    weddings.sort((a, b) => String(a.name).localeCompare(String(b.name), "he"));
    return weddings;
  } catch (error) {
    console.error("Callable wedding list failed; trying membership fallback:", {
      userId: user.uid,
      code: error?.code,
      error,
    });
    //  בזמן פיתוח מקומי או פריסה מדורגת הפונקציה עדיין עשויה לא להיות זמינה
    //  (הדפדפן מדווח עליה לעתים כ-CORS/internal). כניסה למערכת אינה תלויה
    //  בשיפור הזה, ולכן תמיד נופלים בחזרה לרשימת הרמזים הקיימת.
  }

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

/**
 * יוצר חתונה חדשה בבעלות המשתמש המחובר.
 *
 * הכתיבה הראשית אטומית ב-Cloud Function; בפיתוח בלבד, כשהאמולטור אינו רץ,
 * נשמרת כוונת יצירה לפני כתיבות Firestore ניתנות להמשך.
 */
export async function createWedding(name, date) {
  requireAuth();
  try {
    const wedding = await callCreateWedding({ name, weddingDate: date });
    await auth.currentUser?.getIdToken(true);
    return mapWedding(wedding, { role: "owner", scopes: ["all"] });
  } catch (err) {
    if (!import.meta.env.DEV || err?.code !== "functions/unavailable") throw err;
    return ensureMyWeddingLocally(date, name, false);
  }
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
export async function listMembers(weddingId, isOwner = false) {
  requireWeddingId(weddingId);
  const me = requireAuth();

  //  פרטיות: רק לבעלים מותר לסרוק את כל האוסף. חבר רגיל קורא אך ורק את
  //  מסמך החברות של עצמו — שליפת כל האוסף הייתה נדחית בכלל האבטחה.
  if (!isOwner) {
    const selfSnap = await getDoc(doc(weddingCol(weddingId, "members"), me.uid));
    if (!selfSnap.exists()) return [];
    const m = selfSnap.data();
    return [{
      userId: me.uid,
      email: m.email ?? me.email ?? "",
      role: m.role,
      scopes: m.scopes?.length ? m.scopes : ["all"],
      createdAt: toIso(m.createdAt),
      lastSeenAt: toIso(m.lastSeenAt),
    }];
  }

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
  await callUpdateWeddingMember({
    weddingId,
    userId,
    role,
    scopes: Array.isArray(scopes) && scopes.length ? scopes : ["all"],
  });
}

export async function removeMember(weddingId, userId) {
  requireWeddingId(weddingId);
  requireAuth();
  if (!userId) throw new Error("firebaseStore: userId is required");
  await callRemoveWeddingMember({ weddingId, userId });
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
    await waitForAuthContext();
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
const callAdminActivity = callable("getAdminActivity");
const callListMyWeddings = callable("listMyWeddings");
const callDeleteWedding = callable("deleteWedding");
const callCreateWedding = callable("createWedding");
const callMigrateVendorIds = callable("migrateVendorIds");
const callEnsureMyWedding = callable("ensureMyWedding");
const callUpdateWeddingMember = callable("updateWeddingMember");
const callRemoveWeddingMember = callable("removeWeddingMember");

export async function ensureMyWedding(weddingDate = null) {
  try {
    const result = await callEnsureMyWedding({ weddingDate });
    await auth.currentUser?.getIdToken(true);
    return result;
  } catch (err) {
    if (!import.meta.env.DEV || err?.code !== "functions/unavailable") throw err;
    return ensureMyWeddingLocally(weddingDate);
  }
}

export async function migrateVendorIds(weddingId) {
  requireWeddingId(weddingId);
  return callMigrateVendorIds({ weddingId });
}

async function ensureMyWeddingLocally(
  weddingDate = null,
  name = "החתונה שלי",
  returnExisting = true
) {
  const user = requireAuth();
  const userDocument = userRef(user.uid);
  const snapshot = await getDoc(userDocument);
  const existingIds = snapshot.exists() && Array.isArray(snapshot.get("weddingIds"))
    ? snapshot.get("weddingIds")
    : [];

  if (returnExisting && !snapshot.get("pendingWeddingSetup")?.id) {
    for (const id of existingIds) {
      const [wedding, member] = await Promise.all([
        getDoc(weddingRef(id)),
        getDoc(doc(weddingCol(id, "members"), user.uid)),
      ]);
      if (wedding.exists() && member.exists()) {
        return mapWedding({ id, ...wedding.data() }, member.data());
      }
    }
  }

  const candidateId = crypto.randomUUID();
  const pending = await runTransaction(db, async (transaction) => {
    const current = await transaction.get(userDocument);
    const saved = current.exists() ? current.get("pendingWeddingSetup") : null;
    if (saved?.id) return saved;
    const setup = {
      id: candidateId,
      name: String(name || "החתונה שלי").trim() || "החתונה שלי",
      weddingDate: weddingDate || null,
    };
    transaction.set(userDocument, { pendingWeddingSetup: setup }, { merge: true });
    return setup;
  });

  const weddingDocument = weddingRef(pending.id);
  if (!(await getDoc(weddingDocument)).exists()) {
    await setDoc(weddingDocument, {
      id: pending.id,
      name: pending.name,
      weddingDate: pending.weddingDate,
      partnerA: "",
      partnerB: "",
      ownerId: user.uid,
      createdAt: serverTimestamp(),
    });
  }

  const memberDocument = doc(weddingCol(pending.id, "members"), user.uid);
  if (!(await getDoc(memberDocument)).exists()) {
    await setDoc(memberDocument, {
      userId: user.uid,
      email: user.email || "",
      ownerId: user.uid,
      role: "owner",
      scopes: ["all"],
      createdAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    });
  }

  await setDoc(userDocument, {
    id: user.uid,
    email: user.email || "",
    emailLower: String(user.email || "").toLowerCase(),
    weddingIds: arrayUnion(pending.id),
    setupComplete: true,
    pendingWeddingSetup: deleteField(),
  }, { merge: true });

  const wedding = await getDoc(weddingDocument);
  return mapWedding({ id: pending.id, ...wedding.data() }, { role: "owner", scopes: ["all"] });
}

export async function getAdminStats() {
  return callAdminStats({});
}

export async function getAdminActivity() {
  await waitForAuthContext();
  const result = await callAdminActivity({});
  return Array.isArray(result?.rows) ? result.rows : [];
}

/** מוחק לצמיתות חתונה שבבעלות המשתמש, את נתוניה ואת קבציה. */
export async function deleteWedding(weddingId, confirmationName) {
  requireWeddingId(weddingId);
  return callDeleteWedding({ weddingId, confirmationName: String(confirmationName || "").trim() });
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
  // Email verification can update the user profile before the cached ID token
  // carries the new email_verified claim. Refresh before the transaction.
  if (auth?.currentUser) await auth.currentUser.getIdToken(true);
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
  } catch (error) {
    console.error("Failed to update membership lastSeenAt:", {
      weddingId,
      code: error?.code,
      error,
    });
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
  return snap.docs
    .map((d) => d.data())
    .filter(isAlive)
    .map((f) => {
      return {
        id: f.id,
        vendorId: f.vendorId == null ? null : String(f.vendorId),
        name: f.name ?? "",
        mime: f.mime ?? "application/octet-stream",
        size: Number(f.size) || 0,
        storagePath: f.storagePath ?? "",
        createdAt: toIso(f.createdAt),
      };
    });
}

export async function listDeletedVendorFiles(weddingId) {
  requireWeddingId(weddingId);
  requireAuth();
  const snap = await getDocs(weddingCol(weddingId, "files"));
  return snap.docs
    .map((d) => d.data())
    .filter((file) => !isAlive(file))
    .map((file) => ({
      id: file.id,
      vendorId: file.vendorId == null ? null : String(file.vendorId),
      name: file.name ?? "",
      mime: file.mime ?? "application/octet-stream",
      size: Number(file.size) || 0,
      storagePath: file.storagePath ?? "",
      createdAt: toIso(file.createdAt),
      deletedAt: toIso(file.deletedAt),
    }));
}

export async function uploadVendorFile(weddingId, vendorId, file) {
  requireWeddingId(weddingId);
  requireAuth();
  if (file.size > MAX_FILE_BYTES) throw new Error("file_too_large");

  await syncStorageClaims();
  const id = crypto.randomUUID();
  const path = storagePathFor(FIREBASE_ENV, weddingId, id, file.name);

  await uploadBytes(ref(storage, path), file, {
    contentType: file.type || "application/octet-stream",
  });

  const record = {
    id,
    vendorId: String(vendorId),
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
    storagePath: path,
    createdAt: serverTimestamp(),
  };
  try {
    await setDoc(doc(weddingCol(weddingId, "files"), id), record);
  } catch (error) {
    try {
      await deleteObject(ref(storage, path));
    } catch (cleanupError) {
      console.error("Orphaned vendor upload cleanup failed:", cleanupError);
    }
    throw error;
  }
  return { ...record, createdAt: new Date().toISOString() };
}

/**
 * מחיקה רכה בלבד — הקובץ עצמו נשאר ב-Storage.
 *
 * קודם המחיקה הייתה קשה ובלתי הפיכה: מחיקת ספק מחקה את כל
 * החוזים שלו מהאחסון, בעוד הספק עצמו נמחק רכה וניתן לשחזור.
 * לבוקט אין גרסאות, ולכן לא הייתה שום דרך חזרה.
 */
export async function deleteVendorFile(weddingId, fileId) {
  requireWeddingId(weddingId);
  requireAuth();
  await updateDoc(doc(weddingCol(weddingId, "files"), fileId), {
    deletedAt: serverTimestamp(),
  });
}

/** מבטל מחיקה של קובץ. */
export async function restoreVendorFile(weddingId, fileId) {
  requireWeddingId(weddingId);
  requireAuth();
  await updateDoc(doc(weddingCol(weddingId, "files"), fileId), {
    deletedAt: deleteField(),
  });
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
