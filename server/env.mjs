/* =============================================================================
 *  env.mjs — טעינת .env בלי תלות חיצונית
 * -----------------------------------------------------------------------------
 *  משתנה שכבר קיים בסביבה מנצח את מה שבקובץ, כדי שפריסה אמיתית (Render /
 *  Fly / Railway) תוכל להזריק סודות בלי לגעת בקבצים.
 * ========================================================================== */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadEnv(file = ".env") {
  const path = join(ROOT, file);
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;
  }
}
