import { apiFetch, isCloudConfigured, API_BASE } from "./api.js";

/* =========================================================================
 *  CLOUD STORE  –  שכבת גישה לנתונים מול שרת ה-API (CockroachDB)
 *  ------------------------------------------------------------------------
 *  ממפה בין מבנה האובייקטים באפליקציה (camelCase) לעמודות ב-DB (snake_case),
 *  ומיישם "מחיקה רכה" (soft delete) כך ששום דבר לא נמחק לצמיתות.
 *
 *  רב-דיירות (multi-tenancy): כל שורה שייכת ל-wedding_id. הגבול האמיתי הוא
 *  מדיניות ה-RLS ב-CockroachDB (ראו db/001_init.sql); ה-weddingId שנשלח כאן
 *  הוא נוחות ונכונות, לא אבטחה — גם אם ישונה בדפדפן, המסד לא ייתן לגשת
 *  לחתונה שהמשתמש אינו חבר בה.
 * ====================================================================== */

function requireWeddingId(weddingId) {
  if (!weddingId || typeof weddingId !== "string") {
    throw new Error("cloudStore: weddingId is required");
  }
  return weddingId;
}

function requireCloud() {
  if (!isCloudConfigured) throw new Error("cloudStore: cloud sync is not configured");
}

/** הגדרת כל ישות: המפתח הלוגי + ממירים לשני הכיוונים. */
//  מי אחראי על משימה בצ׳קליסט. רשימה סגורה — העמודה במסד היא TEXT.
export const CHECKLIST_ASSIGNEES = ["both", "bride", "groom"];

export const ENTITIES = {
  guests: {
    toRow: (g) => ({
      id: g.id,
      name: g.name,
      phone: g.phone ?? null,
      category: g.category ?? null,
      seats: Number(g.seats) || 1,
      mention: g.mention ?? null,
      source: g.source ?? null,
      probably_coming: !!g.probablyComing,
      considering: !!g.considering,
      glatt: !!g.glatt,
      drinkers: Math.max(0, Number(g.drinkers) || 0),
      rsvp: g.rsvp ?? "pending",
      gift: Number(g.gift) || 0,
    }),
    fromRow: (r) => ({
      id: Number(r.id),
      name: r.name,
      phone: r.phone ?? "",
      category: r.category ?? "",
      seats: Number(r.seats) || 1,
      mention: r.mention ?? "",
      source: r.source ?? "",
      probablyComing: !!r.probably_coming,
      considering: !!r.considering,
      glatt: !!r.glatt,
      drinkers: Math.max(0, Number(r.drinkers) || 0),
      rsvp: r.rsvp ?? "pending",
      gift: Number(r.gift) || 0,
    }),
  },
  tables: {
    toRow: (t) => ({
      id: t.id,
      name: t.name,
      type: t.type ?? "standard",
      // עמודת JSONB — השרת הוא שאחראי לסדרול, כאן נשלח מערך רגיל.
      guest_ids: Array.isArray(t.guestIds) ? t.guestIds : [],
    }),
    fromRow: (r) => ({
      id: Number(r.id),
      name: r.name,
      type: r.type ?? "standard",
      guestIds: Array.isArray(r.guest_ids) ? r.guest_ids : [],
    }),
  },
  vendors: {
    toRow: (v) => ({
      id: v.id,
      name: v.name,
      type: v.type ?? null,
      phone: v.phone ?? null,
      email: v.email ?? null,
      contract_cost: Number(v.contractCost) || 0,
      deposit: Number(v.deposit) || 0,
      notes: v.notes ?? null,
      tasks: Array.isArray(v.tasks) ? v.tasks : [],
    }),
    fromRow: (r) => ({
      id: Number(r.id),
      name: r.name,
      type: r.type ?? "",
      phone: r.phone ?? "",
      email: r.email ?? "",
      contractCost: Number(r.contract_cost) || 0,
      deposit: Number(r.deposit) || 0,
      notes: r.notes ?? "",
      tasks: Array.isArray(r.tasks) ? r.tasks : [],
    }),
  },
  budget: {
    toRow: (b) => ({
      id: b.id,
      category: b.category,
      expected: Number(b.expected) || 0,
      actual: Number(b.actual) || 0,
      paid: Number(b.paid) || 0,
      //  סעיף שנוצר מספק שומר את מזהה הספק; סעיף ידני שומר NULL.
      //  Number(null) הוא 0, ולכן חייבים לבדוק ריקנות במפורש.
      vendor_id: b.vendorId == null ? null : Number(b.vendorId),
    }),
    fromRow: (r) => ({
      id: Number(r.id),
      category: r.category,
      expected: Number(r.expected) || 0,
      actual: Number(r.actual) || 0,
      paid: Number(r.paid) || 0,
      vendorId: r.vendor_id == null ? null : Number(r.vendor_id),
    }),
  },
  checklist: {
    toRow: (c) => ({
      id: c.id,
      title: String(c.title ?? ""),
      category: String(c.category ?? ""),
      //  רשימה לבנה: העמודה היא TEXT ולא ENUM, ולכן הנרמול נעשה כאן.
      assignee: CHECKLIST_ASSIGNEES.includes(c.assignee) ? c.assignee : "both",
      done: !!c.done,
      position: Number(c.position) || 0,
    }),
    fromRow: (r) => ({
      id: Number(r.id),
      title: r.title ?? "",
      category: r.category ?? "",
      assignee: CHECKLIST_ASSIGNEES.includes(r.assignee) ? r.assignee : "both",
      done: !!r.done,
      position: Number(r.position) || 0,
    }),
  },
};

export const ENTITY_KEYS = Object.keys(ENTITIES);

/* =========================================================================
 *  נתוני החתונה
 * ====================================================================== */

/** טוען את כל הנתונים הפעילים (deleted_at is null) של חתונה אחת. */
export async function cloudFetchAll(weddingId) {
  requireWeddingId(weddingId);
  requireCloud();
  const data = await apiFetch(`/weddings/${weddingId}/data`);

  const result = {};
  for (const [key, cfg] of Object.entries(ENTITIES)) {
    result[key] = (data?.[key] || []).map(cfg.fromRow);
  }
  //  הגדרות החתונה מגיעות באותה בקשה. השרת כבר סינן אותן, ולכן מספיק להגן
  //  מפני תשובה ריקה.
  result.settings = data?.settings && typeof data.settings === "object" ? data.settings : {};
  return result;
}

/**
 * שומר את הגדרות החתונה (יעד תקציב, קטגוריות מוזמנים, כותרות מסך התקציב).
 * מותר לכל מי שיש לו הרשאת עריכה, לא רק לבעלים.
 * זו כתיבת מיזוג — נשלחים רק המפתחות שרוצים לשנות, והשאר נשאר כפי שהוא.
 */
export async function saveWeddingSettings(weddingId, settings) {
  requireWeddingId(weddingId);
  requireCloud();
  const data = await apiFetch(`/weddings/${weddingId}/settings`, {
    method: "PUT",
    body: { settings: settings || {} },
  });
  return data?.settings || {};
}

/** בודק האם החתונה ריקה לגמרי (כדי לזרוע אותה בפעם הראשונה). */
export async function cloudIsEmpty(weddingId) {
  requireWeddingId(weddingId);
  requireCloud();
  const data = await apiFetch(`/weddings/${weddingId}/empty`);
  return !!data?.empty;
}

/** זריעה ראשונית – מעלה נתונים מקומיים קיימים לחתונה ריקה. */
export async function cloudSeed(weddingId, datasets) {
  requireWeddingId(weddingId);
  requireCloud();

  const payload = {};
  for (const [key, cfg] of Object.entries(ENTITIES)) {
    payload[key] = (datasets[key] || []).map(cfg.toRow);
  }

  await apiFetch(`/weddings/${weddingId}/seed`, {
    method: "POST",
    body: { datasets: payload },
  });
}

/**
 * מסנכרן dataset בודד ל-DB:
 *   • upsert לכל הרשומות הנוכחיות,
 *   • soft-delete לרשומות שהוסרו (היו קודם ואינן כעת).
 * מחזיר Set של ה-ids הנוכחיים לצורך ההשוואה הבאה.
 */
export async function cloudSyncDataset(weddingId, key, rows, prevIds) {
  requireWeddingId(weddingId);
  requireCloud();
  const cfg = ENTITIES[key];
  if (!cfg) throw new Error(`cloudStore: unknown dataset '${key}'`);

  const currentIds = new Set(rows.map((r) => r.id));
  const removedIds = [...prevIds].filter((id) => !currentIds.has(id));

  if (rows.length || removedIds.length) {
    await apiFetch(`/weddings/${weddingId}/sync`, {
      method: "POST",
      body: { key, rows: rows.map(cfg.toRow), removedIds },
    });
  }

  return currentIds;
}

/* =========================================================================
 *  חתונות, חברים והזמנות
 * ====================================================================== */

/** כל החתונות שהמשתמש הנוכחי בעליהן או חבר בהן. */
export async function listWeddings() {
  requireCloud();
  const list = await apiFetch("/weddings");
  return Array.isArray(list) ? list : [];
}

/** יוצר חתונה חדשה בבעלות המשתמש המחובר. */
export async function createWedding(name, date) {
  requireCloud();
  return apiFetch("/weddings", {
    method: "POST",
    body: { name: String(name || "").trim(), date: date || null },
  });
}

/**
 * מעדכן חתונה קיימת. בעלים בלבד (נאכף ב-RLS).
 * העדכון חלקי: שולחים רק את השדות שרוצים לשנות
 * (`name`, `date`, `partnerA`, `partnerB`).
 */
export async function updateWedding(weddingId, patch = {}) {
  requireWeddingId(weddingId);
  requireCloud();
  const body = {};
  if (patch.name !== undefined) body.name = String(patch.name || "").trim();
  if (patch.date !== undefined) body.date = patch.date || null;
  if (patch.partnerA !== undefined) body.partnerA = String(patch.partnerA ?? "");
  if (patch.partnerB !== undefined) body.partnerB = String(patch.partnerB ?? "");
  return apiFetch(`/weddings/${weddingId}`, { method: "PATCH", body });
}

/**
 *  יוצר הזמנה ומחזיר אותה יחד עם קישור מוכן לשליחה.
 *
 *  `email` הוא רשות. כשהוא נמסר ההזמנה נצמדת אליו ורק בעליו יוכל לממש
 *  אותה; כשהוא ריק נוצרת הזמנת קישור — חד-פעמית, בתוקף לשבוע — שמתאימה
 *  לשליחה בוואטסאפ בלי לדעת את כתובת המייל של הנמען.
 */
export async function inviteMember(weddingId, email, role, scopes = ["all"]) {
  requireWeddingId(weddingId);
  requireCloud();
  const clean = String(email || "").trim().toLowerCase();
  if (role !== "editor" && role !== "viewer") {
    throw new Error("cloudStore: role must be 'editor' or 'viewer'");
  }

  const invite = await apiFetch(`/weddings/${weddingId}/invites`, {
    method: "POST",
    body: { email: clean || null, role, scopes },
  });

  // הטוקן מוחזר פעם אחת בלבד — במסד נשמר רק ה-hash שלו, ולכן אי אפשר
  // לשחזר את הקישור מאוחר יותר; צריך להנפיק הזמנה חדשה.
  return {
    ...invite,
    link: `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(invite.token)}`,
  };
}

/** קבלת הזמנה. מחזיר את מזהה החתונה שאליה צורף המשתמש. */
export async function acceptInvite(token) {
  requireCloud();
  if (!token) throw new Error("cloudStore: token is required");
  const data = await apiFetch("/invites/accept", { method: "POST", body: { token } });
  return data?.weddingId ?? null;
}

/** רשימת חברי החתונה כולל אימייל. */
export async function listMembers(weddingId) {
  requireWeddingId(weddingId);
  requireCloud();
  const list = await apiFetch(`/weddings/${weddingId}/members`);
  return Array.isArray(list) ? list : [];
}

/** הסרת חבר מהחתונה (בעלים בלבד, או המשתמש את עצמו). */
export async function removeMember(weddingId, userId) {
  requireWeddingId(weddingId);
  requireCloud();
  if (!userId) throw new Error("cloudStore: userId is required");
  await apiFetch(`/weddings/${weddingId}/members/${userId}`, { method: "DELETE" });
}

/** עדכון הרשאות של חבר קיים – תפקיד ומסכים (בעלים בלבד). */
export async function updateMember(weddingId, userId, role, scopes) {
  requireWeddingId(weddingId);
  requireCloud();
  if (!userId) throw new Error("cloudStore: userId is required");
  await apiFetch(`/weddings/${weddingId}/members/${userId}`, {
    method: "PATCH",
    body: { role, scopes },
  });
}

/**
 *  צירוף בן/בת זוג (בעלים בלבד). להבדיל מהזמנה, אין כאן קישור למסירה:
 *  השרת פותח לכתובת חשבון עם אותה סיסמה וגישה מלאה, ושולח לשם מייל יידוע.
 *  @returns {Promise<{userId:string,email:string,created:boolean,alreadyMember:boolean}>}
 */
export async function addPartner(weddingId, email) {
  requireWeddingId(weddingId);
  requireCloud();
  const clean = String(email || "").trim().toLowerCase();
  if (!clean) throw new Error("cloudStore: email is required");
  return apiFetch(`/weddings/${weddingId}/partner`, {
    method: "POST",
    body: { email: clean },
  });
}

/* =========================================================================
 *  היקפי שיתוף (scopes)
 *  ------------------------------------------------------------------------
 *  היקף = מסך. הרשימה כאן משמשת את ה-UI בלבד; האכיפה היא ב-RLS.
 * ====================================================================== */

export const SCOPE_OPTIONS = [
  //  היקף אחד שפותח שני מסכים — הרשימה וההושבה יושבות על אותם נתונים.
  { key: "guests", label: "מוזמנים וסידור הושבה" },
  { key: "vendors", label: "ספקים" },
  { key: "finance", label: "ניהול תקציב" },
  { key: "checklist", label: "צ׳קליסט" },
];

export const ALL_SCOPES = SCOPE_OPTIONS.map((s) => s.key);

/** האם ההיקף הנתון כולל מסך מסוים? */
export function hasScope(scopes, key) {
  if (!Array.isArray(scopes) || !scopes.length) return true; // ברירת מחדל: הכול
  return scopes.includes("all") || scopes.includes(key);
}

/** האם ההיקף מלא (כל המסכים)? רק אז מוצג הדאשבורד הראשי. */
export function isFullScope(scopes) {
  return ALL_SCOPES.every((k) => hasScope(scopes, k));
}

/* =========================================================================
 *  קבצים מצורפים לספקים
 * ====================================================================== */

/** מגבלת הגודל — זהה לזו של השרת, כדי להיכשל מוקדם ובעברית. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** רשימת כל הקבצים של החתונה (מטא-דאטה בלבד, בלי התוכן). */
export async function listVendorFiles(weddingId) {
  requireWeddingId(weddingId);
  requireCloud();
  const list = await apiFetch(`/weddings/${weddingId}/files`);
  return Array.isArray(list) ? list : [];
}

/** קורא File של הדפדפן ומחזיר base64 נקי (בלי הקידומת data:). */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** מעלה קובץ אחד לספק. מחזיר את רשומת המטא-דאטה שנוצרה. */
export async function uploadVendorFile(weddingId, vendorId, file) {
  requireWeddingId(weddingId);
  requireCloud();
  if (file.size > MAX_FILE_BYTES) throw new Error("file_too_large");

  const data = await fileToBase64(file);
  return apiFetch(`/weddings/${weddingId}/vendors/${vendorId}/files`, {
    method: "POST",
    body: {
      name: file.name,
      mime: file.type || "application/octet-stream",
      data,
    },
  });
}

export async function deleteVendorFile(weddingId, fileId) {
  requireWeddingId(weddingId);
  requireCloud();
  await apiFetch(`/weddings/${weddingId}/files/${fileId}`, { method: "DELETE" });
}

/** כתובת ההורדה. אינה ציבורית — נדרשת עוגיית סשן תקפה. */
export function vendorFileUrl(weddingId, fileId, { download = false } = {}) {
  return `${API_BASE}/weddings/${weddingId}/files/${fileId}${download ? "?download=1" : ""}`;
}
