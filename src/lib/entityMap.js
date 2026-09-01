/* =========================================================================
 *  entityMap.js — המרה בין מסמכי Firestore לאובייקטים של האפליקציה
 *  ------------------------------------------------------------------------
 *  מודול טהור, בלי שום import. זה מכוון: אלה הפונקציות שקובעות מה המשתמש
 *  רואה בכל שדה בכל מסך, והן חייבות להיות ניתנות לבדיקה בלי דפדפן ובלי
 *  חיבור ל-Firebase. scripts/entity-map-test.mjs מריץ אותן מול הנתונים
 *  האמיתיים שיוצאו מ-CockroachDB.
 * ====================================================================== */

export const CHECKLIST_ASSIGNEES = ["both", "bride", "groom"];

export const ENTITIES = {
  guests: {
    col: "guests",
    toDoc: (g) => ({
      id: Number(g.id),
      name: String(g.name ?? ""),
      phone: g.phone ?? "",
      category: g.category ?? "",
      seats: Number(g.seats) || 1,
      mention: g.mention ?? "",
      source: g.source ?? "",
      probablyComing: !!g.probablyComing,
      considering: !!g.considering,
      glatt: !!g.glatt,
      drinkers: Math.max(0, Number(g.drinkers) || 0),
      rsvp: g.rsvp ?? "pending",
      gift: Number(g.gift) || 0,
    }),
    fromDoc: (r) => ({
      id: Number(r.id),
      name: r.name ?? "",
      phone: r.phone ?? "",
      category: r.category ?? "",
      seats: Number(r.seats) || 1,
      mention: r.mention ?? "",
      source: r.source ?? "",
      probablyComing: !!r.probablyComing,
      considering: !!r.considering,
      glatt: !!r.glatt,
      drinkers: Math.max(0, Number(r.drinkers) || 0),
      rsvp: r.rsvp ?? "pending",
      gift: Number(r.gift) || 0,
    }),
  },
  tables: {
    col: "tables",
    toDoc: (t) => ({
      id: Number(t.id),
      name: String(t.name ?? ""),
      type: t.type ?? "standard",
      guestIds: Array.isArray(t.guestIds) ? t.guestIds.map(Number) : [],
    }),
    fromDoc: (r) => ({
      id: Number(r.id),
      name: r.name ?? "",
      type: r.type ?? "standard",
      guestIds: Array.isArray(r.guestIds) ? r.guestIds.map(Number) : [],
    }),
  },
  vendors: {
    col: "vendors",
    toDoc: (v) => ({
      id: Number(v.id),
      name: String(v.name ?? ""),
      type: v.type ?? "",
      phone: v.phone ?? "",
      email: v.email ?? "",
      contractCost: Number(v.contractCost) || 0,
      deposit: Number(v.deposit) || 0,
      notes: v.notes ?? "",
      tasks: Array.isArray(v.tasks) ? v.tasks : [],
    }),
    fromDoc: (r) => ({
      id: Number(r.id),
      name: r.name ?? "",
      type: r.type ?? "",
      phone: r.phone ?? "",
      email: r.email ?? "",
      contractCost: Number(r.contractCost) || 0,
      deposit: Number(r.deposit) || 0,
      notes: r.notes ?? "",
      tasks: Array.isArray(r.tasks) ? r.tasks : [],
    }),
  },
  budget: {
    col: "budget",
    toDoc: (b) => ({
      id: Number(b.id),
      category: String(b.category ?? ""),
      expected: Number(b.expected) || 0,
      actual: Number(b.actual) || 0,
      paid: Number(b.paid) || 0,
      //  Number(null) הוא 0, ולכן ריקנות נבדקת במפורש: סעיף ידני שומר null.
      vendorId: b.vendorId == null ? null : Number(b.vendorId),
    }),
    fromDoc: (r) => ({
      id: Number(r.id),
      category: r.category ?? "",
      expected: Number(r.expected) || 0,
      actual: Number(r.actual) || 0,
      paid: Number(r.paid) || 0,
      vendorId: r.vendorId == null ? null : Number(r.vendorId),
    }),
  },
  checklist: {
    col: "checklist",
    toDoc: (c) => ({
      id: Number(c.id),
      title: String(c.title ?? ""),
      category: String(c.category ?? ""),
      assignee: CHECKLIST_ASSIGNEES.includes(c.assignee) ? c.assignee : "both",
      done: !!c.done,
      position: Number(c.position) || 0,
    }),
    fromDoc: (r) => ({
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
