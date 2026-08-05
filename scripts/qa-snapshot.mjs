/*  כלי QA: קורא ישירות מה-DATABASE כדי לוודא ששינוי שנעשה מהנייד באמת נשמר
 *  בענן ולא נשאר רק ב-localStorage.
 *  שימוש:
 *    node scripts/qa-snapshot.mjs counts
 *    node scripts/qa-snapshot.mjs settings
 *    node scripts/qa-snapshot.mjs guests "אבא"
 *    node scripts/qa-snapshot.mjs vendors|budget|tables [חיפוש]                */
import { loadEnv } from "../server/env.mjs";
loadEnv();
const { withAdmin, closePool } = await import("../server/db.js");

const WID = process.env.QA_WEDDING_ID || "ef9e96b1-e593-43e4-8df9-883dd15a7acc";
const what = process.argv[2] || "counts";
const needle = process.argv[3];

const SPEC = {
  guests: {
    table: "guests",
    label: "name",
    cols: "name, category, seats, probably_coming, considering, glatt, rsvp, gift",
  },
  tables: { table: "seating_tables", label: "name", cols: "name, type, guest_ids" },
  vendors: {
    table: "vendors",
    label: "name",
    cols: "name, type, phone, email, contract_cost, deposit, tasks",
  },
  budget: { table: "budget_items", label: "category", cols: "category, expected, actual" },
};

const rows = await withAdmin(async (q) => {
  if (what === "counts") {
    return (
      await q(
        `SELECT
           (SELECT count(*) FROM public.guests         WHERE wedding_id=$1 AND deleted_at IS NULL) AS guests,
           (SELECT count(*) FROM public.seating_tables WHERE wedding_id=$1 AND deleted_at IS NULL) AS tables,
           (SELECT count(*) FROM public.vendors        WHERE wedding_id=$1 AND deleted_at IS NULL) AS vendors,
           (SELECT count(*) FROM public.budget_items   WHERE wedding_id=$1 AND deleted_at IS NULL) AS budget`,
        [WID]
      )
    ).rows;
  }
  if (what === "settings") {
    return (
      await q(
        `SELECT w.name, w.wedding_date, s.data
           FROM public.weddings w
           LEFT JOIN public.wedding_settings s ON s.wedding_id = w.id
          WHERE w.id = $1`,
        [WID]
      )
    ).rows;
  }
  const spec = SPEC[what];
  if (!spec) throw new Error("unknown: " + what);
  return (
    await q(
      `SELECT ${spec.cols}, updated_at FROM public.${spec.table}
        WHERE wedding_id = $1 AND deleted_at IS NULL
          ${needle ? `AND ${spec.label} ILIKE '%' || $2 || '%'` : ""}
        ORDER BY updated_at DESC LIMIT 6`,
      needle ? [WID, needle] : [WID]
    )
  ).rows;
});

console.log(JSON.stringify(rows, null, 1));
await closePool();
