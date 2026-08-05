/* =============================================================================
 *  migrate.mjs — הרצת קובצי ה-SQL על CockroachDB
 * -----------------------------------------------------------------------------
 *      npm run db:migrate
 *
 *  קורא את DATABASE_URL מ-.env. מריץ כל הצהרה בנפרד (CockroachDB לא תומך
 *  בכמה שינויי סכימה בטרנזקציה אחת), ומדלג בשקט על הצהרות אידמפוטנטיות.
 * ========================================================================== */

import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { splitSql } from "./splitSql.mjs";
import { loadEnv } from "../server/env.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "\x1b[31mחסר DATABASE_URL.\x1b[0m צור קובץ .env בשורש הפרויקט עם:\n" +
      "  DATABASE_URL=postgresql://<user>:<password>@<host>:26257/defaultdb?sslmode=verify-full\n"
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const { rows: who } = await client.query(
  "select current_user as u, current_database() as db, version() as v"
);
console.log(`מחובר כ-${who[0].u} אל ${who[0].db}`);
console.log(who[0].v.split(" (")[0]);

const files = (await readdir(HERE)).filter((f) => /^\d+.*\.sql$/.test(f)).sort();

for (const file of files) {
  console.log(`\n\x1b[1m${file}\x1b[0m`);
  const statements = splitSql(await readFile(join(HERE, file), "utf8"));
  let done = 0;

  for (const stmt of statements) {
    try {
      await client.query(stmt);
      done++;
    } catch (err) {
      console.error(`\n\x1b[31mנכשל:\x1b[0m ${stmt.slice(0, 160)}…`);
      console.error(`  ${err.message}`);
      await client.end();
      process.exit(1);
    }
  }
  console.log(`  \x1b[32m✓\x1b[0m ${done} הצהרות`);
}

//  ה-admin חייב להיות חבר ב-app_user כדי שיוכל לבצע SET ROLE app_user.
await client.query(`GRANT app_user TO "${who[0].u}"`);
console.log(`\n\x1b[32m✓\x1b[0m ${who[0].u} יכול כעת לבצע SET ROLE app_user`);

await client.end();
console.log("\n\x1b[32mהמיגרציה הושלמה.\x1b[0m");
