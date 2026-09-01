/* =============================================================================
 *  migration-map.mjs — מיפוי עמודות CockroachDB → שדות Firestore
 * -----------------------------------------------------------------------------
 *  מקור אמת אחד, שגם הייבוא וגם האימות קוראים ממנו. זו הנקודה שבה נתונים
 *  יכולים ללכת לאיבוד בשקט, ולכן כל עמודה במסד חייבת להופיע כאן במפורש:
 *  או עם שם השדה שאליו היא הולכת, או כ-null עם סיבה כתובה.
 *
 *  scripts/migration-verify.mjs מצליב את המפה הזו מול information_schema
 *  ונכשל אם התווספה עמודה שאיש לא החליט עליה.
 * ========================================================================== */

export const ts = (value) => (value ? new Date(value) : null);
export const num = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

/*  null = לא עובר, עם סיבה. המפתח הוא שם העמודה במסד.
    'wedding_id' יורד בכל תת-אוסף כי הוא מקודד בנתיב המסמך עצמו.  */
const PATH_ENCODED = null;

export const COLUMN_MAP = {
  "app.users": {
    id: "id",
    email: "email",
    email_lower: "emailLower",
    created_at: "createdAt",
    //  לא עובר: חסר ערך אחרי המעבר ל-Firebase Auth, ומסוכן במסד שהלקוח קורא.
    password_hash: PATH_ENCODED,
  },
  "public.weddings": {
    id: "id",
    name: "name",
    wedding_date: "weddingDate",
    owner_id: "ownerId",
    created_at: "createdAt",
    partner_a: "partnerA",
    partner_b: "partnerB",
  },
  "public.wedding_members": {
    wedding_id: PATH_ENCODED,
    user_id: "userId",
    owner_id: "ownerId",
    role: "role",
    scopes: "scopes",
    created_at: "createdAt",
    last_seen_at: "lastSeenAt",
  },
  "public.wedding_invites": {
    id: "id",
    wedding_id: "weddingId",
    email: "email",
    role: "role",
    scopes: "scopes",
    expires_at: "expiresAt",
    accepted_at: "acceptedAt",
    created_by: "createdBy",
    created_at: "createdAt",
    //  לא עובר: טוקן הזמנה. ההזמנות הפתוחות מסומנות needsReissue ומונפקות מחדש.
    token_hash: PATH_ENCODED,
  },
  "public.wedding_settings": {
    wedding_id: PATH_ENCODED,
    data: "(פרוס לשדות המסמך settings/main)",
    updated_at: "updatedAt",
  },
  "public.guests": {
    wedding_id: PATH_ENCODED,
    id: "id",
    name: "name",
    phone: "phone",
    category: "category",
    seats: "seats",
    mention: "mention",
    source: "source",
    probably_coming: "probablyComing",
    considering: "considering",
    glatt: "glatt",
    drinkers: "drinkers",
    rsvp: "rsvp",
    gift: "gift",
    deleted_at: "deletedAt",
    updated_at: "updatedAt",
  },
  "public.seating_tables": {
    wedding_id: PATH_ENCODED,
    id: "id",
    name: "name",
    type: "type",
    guest_ids: "guestIds",
    deleted_at: "deletedAt",
    updated_at: "updatedAt",
  },
  "public.vendors": {
    wedding_id: PATH_ENCODED,
    id: "id",
    name: "name",
    type: "type",
    phone: "phone",
    email: "email",
    contract_cost: "contractCost",
    deposit: "deposit",
    notes: "notes",
    tasks: "tasks",
    deleted_at: "deletedAt",
    updated_at: "updatedAt",
  },
  "public.budget_items": {
    wedding_id: PATH_ENCODED,
    id: "id",
    category: "category",
    expected: "expected",
    actual: "actual",
    paid: "paid",
    vendor_id: "vendorId",
    deleted_at: "deletedAt",
    updated_at: "updatedAt",
  },
  "public.checklist_items": {
    wedding_id: PATH_ENCODED,
    id: "id",
    title: "title",
    category: "category",
    assignee: "assignee",
    done: "done",
    position: "position",
    deleted_at: "deletedAt",
    updated_at: "updatedAt",
  },
  "public.vendor_files": {
    wedding_id: PATH_ENCODED,
    id: "id",
    vendor_id: "vendorId",
    name: "name",
    mime: "mime",
    size: "size",
    created_at: "createdAt",
    //  לא עובר כשדה: התוכן הבינארי עולה ל-Firebase Storage, ובמסמך נשמר
    //  storagePath + sha256. מסמך Firestore חסום ב-1 MiB ושני קבצים חורגים.
    data: PATH_ENCODED,
  },
};

/* ── ממירי שורה → מסמך ──────────────────────────────────────────────────── */

export const guestDoc = (r) => ({
  id: r.id,
  name: r.name ?? "",
  phone: r.phone ?? "",
  category: r.category ?? "",
  seats: num(r.seats, 1),
  mention: r.mention ?? "",
  source: r.source ?? "",
  probablyComing: !!r.probably_coming,
  considering: !!r.considering,
  glatt: !!r.glatt,
  drinkers: num(r.drinkers, 0),
  rsvp: r.rsvp ?? "pending",
  gift: num(r.gift, 0),
  deletedAt: ts(r.deleted_at),
  updatedAt: ts(r.updated_at),
});

export const tableDoc = (r) => ({
  id: r.id,
  name: r.name ?? "",
  type: r.type ?? "standard",
  //  סדר המושבים הוא מידע — נשמר כמערך ולא כקבוצה.
  guestIds: Array.isArray(r.guest_ids) ? r.guest_ids : [],
  deletedAt: ts(r.deleted_at),
  updatedAt: ts(r.updated_at),
});

export const vendorDoc = (r) => ({
  id: r.id,
  name: r.name ?? "",
  type: r.type ?? "",
  phone: r.phone ?? "",
  email: r.email ?? "",
  contractCost: num(r.contract_cost, 0),
  deposit: num(r.deposit, 0),
  notes: r.notes ?? "",
  //  המשימות יושבות על הספק, כמו במסד. אוסף נפרד היה שובר את הקשר.
  tasks: Array.isArray(r.tasks) ? r.tasks : [],
  deletedAt: ts(r.deleted_at),
  updatedAt: ts(r.updated_at),
});

export const budgetDoc = (r) => ({
  id: r.id,
  category: r.category ?? "",
  expected: num(r.expected, 0),
  actual: num(r.actual, 0),
  paid: num(r.paid, 0),
  vendorId: r.vendor_id ?? null,
  deletedAt: ts(r.deleted_at),
  updatedAt: ts(r.updated_at),
});

export const checklistDoc = (r) => ({
  id: r.id,
  title: r.title ?? "",
  category: r.category ?? "",
  assignee: r.assignee ?? "both",
  done: !!r.done,
  position: num(r.position, 0),
  deletedAt: ts(r.deleted_at),
  updatedAt: ts(r.updated_at),
});

export const COLLECTIONS = {
  guests: { table: "public.guests", map: guestDoc },
  tables: { table: "public.seating_tables", map: tableDoc },
  vendors: { table: "public.vendors", map: vendorDoc },
  budget: { table: "public.budget_items", map: budgetDoc },
  checklist: { table: "public.checklist_items", map: checklistDoc },
};
