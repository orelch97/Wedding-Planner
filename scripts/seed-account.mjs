/* =========================================================================
 *  יצירת חשבון וזריעת כל נתוני החתונה דרך ה-API.
 *
 *  שימוש:
 *    node scripts/seed-account.mjs <email> <password> [שם החתונה] [YYYY-MM-DD]
 *
 *  הסקריפט עובר דרך אותם נתיבי API שהדפדפן משתמש בהם, ולכן גם ה-RLS
 *  והוולידציות נבדקים בדרך. אם החשבון כבר קיים — פשוט מתחברים אליו.
 *  אם כבר יש לו חתונה — משתמשים בה במקום ליצור חדשה.
 * ====================================================================== */

import { SEED_GUESTS } from "../src/data/guestsData.js";
import { SEED_TABLES, SEED_VENDORS, SEED_BUDGET } from "../src/data/seedData.js";

const BASE = process.env.API_BASE || "http://localhost:3001/api";

const [, , emailArg, passwordArg, nameArg, dateArg] = process.argv;
if (!emailArg || !passwordArg) {
  console.error(
    "שימוש: node scripts/seed-account.mjs <email> <password> [שם החתונה] [YYYY-MM-DD]"
  );
  process.exit(1);
}

const WEDDING_NAME = nameArg || "החתונה של אוראל ומיתר";
const WEDDING_DATE = dateArg || "2027-01-06";

//  עוגיית הסשן נשמרת ידנית — ל-fetch של node אין cookie jar.
let cookie = "";

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/*  ה-DB מקבל שמות עמודות snake_case — בדיוק כמו ENTITIES ב-cloudStore.js.  */
const toRow = {
  guests: (g) => ({
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
    rsvp: g.rsvp ?? "pending",
    gift: Number(g.gift) || 0,
  }),
  tables: (t) => ({
    id: t.id,
    name: t.name,
    type: t.type ?? "standard",
    guest_ids: Array.isArray(t.guestIds) ? t.guestIds : [],
  }),
  vendors: (v) => ({
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
  budget: (b) => ({
    id: b.id,
    category: b.category,
    expected: Number(b.expected) || 0,
    actual: Number(b.actual) || 0,
  }),
};

async function main() {
  // 1. חשבון
  try {
    await api("/auth/register", {
      method: "POST",
      body: { email: emailArg, password: passwordArg },
    });
    console.log(`✓ נוצר חשבון חדש: ${emailArg}`);
  } catch (err) {
    if (err.message !== "email_taken") throw err;
    await api("/auth/login", {
      method: "POST",
      body: { email: emailArg, password: passwordArg },
    });
    console.log(`✓ החשבון כבר היה קיים – התחברנו: ${emailArg}`);
  }

  // 2. חתונה. אם כבר קיימת אחת — מעדכנים לה שם ותאריך במקום ליצור עוד אחת.
  const existing = await api("/weddings");
  let wedding = existing.find((w) => w.role === "owner");
  if (wedding) {
    wedding = await api(`/weddings/${wedding.id}`, {
      method: "PATCH",
      body: { name: WEDDING_NAME, date: WEDDING_DATE },
    });
    console.log(`✓ עודכנה החתונה הקיימת: ${wedding.name} (${WEDDING_DATE})`);
  } else {
    wedding = await api("/weddings", {
      method: "POST",
      body: { name: WEDDING_NAME, date: WEDDING_DATE },
    });
    console.log(`✓ נוצרה חתונה: ${wedding.name} (${WEDDING_DATE})`);
  }

  // 3. נתונים. sync ולא seed — כך אפשר להריץ שוב על חתונה שכבר יש בה משהו.
  const datasets = {
    guests: SEED_GUESTS,
    tables: SEED_TABLES,
    vendors: SEED_VENDORS,
    budget: SEED_BUDGET,
  };

  for (const [key, rows] of Object.entries(datasets)) {
    await api(`/weddings/${wedding.id}/sync`, {
      method: "POST",
      body: { key, rows: rows.map(toRow[key]), removedIds: [] },
    });
    console.log(`  · ${key}: ${rows.length} רשומות`);
  }

  // 4. אימות – קוראים בחזרה מה-DB
  const back = await api(`/weddings/${wedding.id}/data`);
  console.log("\n✓ נשמר ואומת מול ה-DB:");
  for (const key of Object.keys(datasets)) {
    console.log(`  · ${key}: ${(back[key] || []).length}`);
  }
  console.log(`\nמזהה חתונה: ${wedding.id}`);
}

main().catch((err) => {
  console.error(`\n✖ נכשל: ${err.message}`);
  process.exit(1);
});
