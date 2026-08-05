// =============================================================================
//  db/reset.mjs — מוחק את כל הסכימה ומאפשר הרצה נקייה של המיגרציה.
// -----------------------------------------------------------------------------
//  ⚠ הרסני. מוחק את כל נתוני האפליקציה במסד שאליו מצביע DATABASE_URL.
//    דורש דגל --yes מפורש כדי שלא ירוץ בטעות.
// =============================================================================

import pg from "pg";
import { loadEnv } from "../server/env.mjs";

loadEnv();

if (!process.argv.includes("--yes")) {
  console.error("סירוב לרוץ. זו פעולה הרסנית — הריצו: node db/reset.mjs --yes");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("חסר DATABASE_URL בקובץ .env");
  process.exit(1);
}

const STATEMENTS = [
  "DROP TABLE IF EXISTS public.budget_items CASCADE",
  "DROP TABLE IF EXISTS public.vendors CASCADE",
  "DROP TABLE IF EXISTS public.seating_tables CASCADE",
  "DROP TABLE IF EXISTS public.guests CASCADE",
  "DROP TABLE IF EXISTS public.wedding_invites CASCADE",
  "DROP TABLE IF EXISTS public.wedding_members CASCADE",
  "DROP TABLE IF EXISTS public.weddings CASCADE",
  "DROP SCHEMA IF EXISTS app CASCADE",
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  for (const sql of STATEMENTS) {
    await client.query(sql);
    console.log("✓ " + sql);
  }
  console.log("\nהסכימה נמחקה. הריצו כעת: npm run db:migrate");
} finally {
  await client.end();
}
