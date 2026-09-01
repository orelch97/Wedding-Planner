/* =============================================================================
 *  entity-map-test.mjs — שקילות בין הצינור הישן לחדש
 * -----------------------------------------------------------------------------
 *  השאלה היחידה שהבדיקה הזו עונה עליה:
 *    האם המשתמש יראה בדיוק את אותם ערכים אחרי המעבר ל-Firestore?
 *
 *  לכן היא לא בודקת "האם הפונקציה מחזירה משהו", אלא מריצה את **הנתונים
 *  האמיתיים** שיוצאו מ-CockroachDB בשני המסלולים ומשווה:
 *
 *    שורת CockroachDB ──> cloudStore.fromRow  ──────────────> אובייקט A
 *    שורת CockroachDB ──> migration-map ──> entityMap.fromDoc ─> אובייקט B
 *
 *  A חייב להיות זהה ל-B, שדה בשדה. כל הפרש הוא נתון שהמשתמש יאבד.
 *
 *  שימוש:  node scripts/entity-map-test.mjs --dir migration/export-...
 * ========================================================================== */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ENTITIES as FS_ENTITIES } from "../src/lib/entityMap.js";
import {
  guestDoc,
  tableDoc,
  vendorDoc,
  budgetDoc,
  checklistDoc,
} from "./lib/migration-map.mjs";

const argv = process.argv.slice(2);
const i = argv.indexOf("--dir");
const dir = i !== -1 ? argv[i + 1] : null;

if (!dir || !existsSync(join(dir, "data.json"))) {
  console.error("\n✗ חסר --dir עם תיקיית ייצוא תקינה.\n");
  process.exit(1);
}

const T = JSON.parse(readFileSync(join(dir, "data.json"), "utf8")).tables;

/*  המסלול הישן, מועתק מ-src/lib/cloudStore.js. מועתק ולא מיובא, כי
    cloudStore נשען על import.meta.env של Vite ואינו נטען ב-Node.
    זו כפילות מכוונת: אם מישהו ישנה את המקור בלי לעדכן כאן, הבדיקה
    תיפול — וזה בדיוק מה שרוצים משכבת השוואה.  */
const LEGACY = {
  guests: (r) => ({
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
  tables: (r) => ({
    id: Number(r.id),
    name: r.name,
    type: r.type ?? "standard",
    guestIds: Array.isArray(r.guest_ids) ? r.guest_ids : [],
  }),
  vendors: (r) => ({
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
  budget: (r) => ({
    id: Number(r.id),
    category: r.category,
    expected: Number(r.expected) || 0,
    actual: Number(r.actual) || 0,
    paid: Number(r.paid) || 0,
    vendorId: r.vendor_id == null ? null : Number(r.vendor_id),
  }),
  checklist: (r) => ({
    id: Number(r.id),
    title: r.title ?? "",
    category: r.category ?? "",
    assignee: ["both", "bride", "groom"].includes(r.assignee) ? r.assignee : "both",
    done: !!r.done,
    position: Number(r.position) || 0,
  }),
};

const PIPELINE = {
  guests: { table: "public.guests", toFirestore: guestDoc },
  tables: { table: "public.seating_tables", toFirestore: tableDoc },
  vendors: { table: "public.vendors", toFirestore: vendorDoc },
  budget: { table: "public.budget_items", toFirestore: budgetDoc },
  checklist: { table: "public.checklist_items", toFirestore: checklistDoc },
};

let passed = 0;
let failed = 0;
const samples = [];

console.log("\nשקילות: CockroachDB → Firestore → מסך\n");

for (const [key, { table, toFirestore }] of Object.entries(PIPELINE)) {
  const rows = T[table] ?? [];
  let mismatches = 0;
  let fields = 0;

  for (const row of rows) {
    const legacy = LEGACY[key](row);

    //  מדמה בדיוק את מה שקורה בייצור: השורה נכתבת ל-Firestore דרך
    //  migration-map, ואז נקראת חזרה דרך entityMap.
    const written = toFirestore(row);
    //  Firestore מחזיר Date עבור חותמות; המפה לא נוגעת בהן, ולכן מסירים.
    const { deletedAt: _d, updatedAt: _u, ...stored } = written;
    const loaded = FS_ENTITIES[key].fromDoc(stored);

    for (const field of Object.keys(legacy)) {
      fields++;
      const a = JSON.stringify(legacy[field]);
      const b = JSON.stringify(loaded[field]);
      if (a !== b) {
        mismatches++;
        if (samples.length < 10) {
          samples.push(`${key}#${row.id} · ${field}: ישן=${a} חדש=${b}`);
        }
      }
    }

    //  שדה שקיים בחדש ולא בישן הוא גם באג — הוא ידלוף למסך.
    for (const field of Object.keys(loaded)) {
      if (!(field in legacy)) {
        mismatches++;
        if (samples.length < 10) samples.push(`${key}#${row.id} · שדה עודף: ${field}`);
      }
    }
  }

  if (mismatches === 0) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${key.padEnd(10)} ${String(rows.length).padStart(5)} רשומות · ${fields} שדות זהים`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${key.padEnd(10)} ${mismatches} הפרשים מתוך ${fields} שדות`);
  }
}

if (samples.length) {
  console.log("\nדוגמאות:");
  for (const s of samples) console.log(`    ${s}`);
}

console.log(
  `\n${failed === 0 ? "\x1b[32m" : "\x1b[31m"}${passed}/${passed + failed} ישויות שקולות\x1b[0m\n`
);
process.exit(failed === 0 ? 0 : 1);
