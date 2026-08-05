import xlsx from "xlsx";
import { writeFileSync } from "fs";

const file = "C:/Users/User/Desktop/\u05d4\u05d7\u05ea\u05d5\u05e0\u05d4 \u05e9\u05dc\u05e0\u05d5/\u05de\u05d5\u05d6\u05de\u05e0\u05d9\u05dd-\u05e6\u05d3 \u05d7\u05ea\u05df \u05d0\u05d5\u05e8\u05d0\u05dc.xlsx";
const wb = xlsx.readFile(file);

const targets = {
  "\u05e2\u05e8\u05d9\u05db\u05d4 - \u05d0\u05d1\u05d0 \u05d5\u05d0\u05de\u05d0": "\u05d4\u05d5\u05e8\u05d9\u05dd",
  "\u05d0\u05d5\u05e8\u05d0\u05dc": "\u05d0\u05d5\u05e8\u05d0\u05dc",
};

const guests = [];
let id = 1;
const categories = new Set();

for (const [sheet, source] of Object.entries(targets)) {
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[sheet], { defval: "" });
  for (const r of rows) {
    const name = String(r["\u05e9\u05dd \u05d5\u05e9\u05dd \u05de\u05e9\u05e4\u05d7\u05d4"] || "").trim();
    if (!name) continue;
    // Skip summary / total rows
    if (/^\u05e1\u05d4["\u05f4\u2033]?\u05db/.test(name)) continue; // סה"כ
    const seats = Number(r["\u05db\u05de\u05d5\u05ea \u05de\u05d5\u05d6\u05de\u05e0\u05d9\u05dd"]) || 1;
    const category =
      String(r["\u05e7\u05d8\u05d2\u05d5\u05e8\u05d9\u05d4"] || "").trim() ||
      "\u05dc\u05dc\u05d0 \u05e7\u05d8\u05d2\u05d5\u05e8\u05d9\u05d4";
    const probablyRaw = String(r["\u05db\u05e0\u05e8\u05d0\u05d4 \u05d9\u05d1\u05d5\u05d0"] || "").trim();
    const inviteRaw = String(r["\u05dc\u05d4\u05d6\u05de\u05d9\u05df?"] || "").trim();
    categories.add(category);
    guests.push({
      id: id++,
      name,
      category,
      seats,
      source,
      probablyComing: /v|\u05db\u05df|yes/i.test(probablyRaw),
      considering: inviteRaw !== "",
      rsvp: "pending",
      gift: 0,
    });
  }
}

const banner = `/* =========================================================================
 *  GUEST DATABASE  \u2013  \u05de\u05e7\u05d5\u05e8 \u05d4\u05e0\u05ea\u05d5\u05e0\u05d9\u05dd
 *  ------------------------------------------------------------------------
 *  \u05d9\u05d5\u05d1\u05d0 \u05d0\u05d5\u05d8\u05d5\u05de\u05d8\u05d9\u05ea \u05de\u05ea\u05d5\u05da \u05d4\u05e7\u05d5\u05d1\u05e5: \u05de\u05d5\u05d6\u05de\u05e0\u05d9\u05dd-\u05e6\u05d3 \u05d7\u05ea\u05df \u05d0\u05d5\u05e8\u05d0\u05dc.xlsx
 *  \u05d2\u05d9\u05dc\u05d9\u05d5\u05e0\u05d5\u05ea: "\u05e2\u05e8\u05d9\u05db\u05d4 - \u05d0\u05d1\u05d0 \u05d5\u05d0\u05de\u05d0" (source: \u05d4\u05d5\u05e8\u05d9\u05dd) \u05d5-"\u05d0\u05d5\u05e8\u05d0\u05dc" (source: \u05d0\u05d5\u05e8\u05d0\u05dc)
 *
 *  \u05de\u05d1\u05e0\u05d4 \u05e8\u05e9\u05d5\u05de\u05d4:
 *    id            \u2013 \u05de\u05d6\u05d4\u05d4 \u05d9\u05d9\u05d7\u05d5\u05d3\u05d9
 *    name          \u2013 \u05e9\u05dd \u05d5\u05e9\u05dd \u05de\u05e9\u05e4\u05d7\u05d4
 *    category      \u2013 \u05e7\u05d8\u05d2\u05d5\u05e8\u05d9\u05d4
 *    seats         \u2013 \u05db\u05de\u05d5\u05ea \u05de\u05d5\u05d6\u05de\u05e0\u05d9\u05dd
 *    source        \u2013 \u05de\u05e7\u05d5\u05e8 \u05d4\u05e8\u05e9\u05d9\u05de\u05d4 (\u05d4\u05d5\u05e8\u05d9\u05dd / \u05d0\u05d5\u05e8\u05d0\u05dc)
 *    probablyComing\u2013 "\u05db\u05e0\u05e8\u05d0\u05d4 \u05d9\u05d1\u05d5\u05d0" \u2013 \u05d4\u05e2\u05e8\u05db\u05d4 \u05e8\u05d0\u05e9\u05d5\u05e0\u05d9\u05ea \u05dc\u05e4\u05e0\u05d9 \u05d0\u05d9\u05e9\u05d5\u05e8\u05d9 \u05d4\u05d2\u05e2\u05d4
 *    considering   \u2013 "\u05dc\u05d4\u05d6\u05de\u05d9\u05df?" \u2013 \u05e2\u05d3\u05d9\u05d9\u05df \u05dc\u05d0 \u05d1\u05d8\u05d5\u05d7 \u05d0\u05dd \u05dc\u05d4\u05d6\u05de\u05d9\u05df
 *    rsvp          \u2013 \u05e1\u05d8\u05d8\u05d5\u05e1 \u05d0\u05d9\u05e9\u05d5\u05e8 \u05d4\u05d2\u05e2\u05d4 (pending / confirmed / declined)
 *    gift          \u2013 \u05e1\u05db\u05d5\u05dd \u05de\u05ea\u05e0\u05d4
 *
 *  \u05e0\u05d9\u05ea\u05df \u05dc\u05e2\u05e8\u05d5\u05da \u05d9\u05d3\u05e0\u05d9\u05ea \u05d0\u05d5 \u05dc\u05d4\u05d7\u05dc\u05d9\u05e3 \u05d1\u05e2\u05ea\u05d9\u05d3 \u05d1\u05e9\u05dc\u05d9\u05e4\u05d4 \u05de\u05d1\u05e1\u05d9\u05e1 \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd (Firebase / Supabase).
 * ====================================================================== */\n\n`;

const js =
  banner +
  "export const GUEST_CATEGORIES = " +
  JSON.stringify([...categories], null, 2) +
  ";\n\nexport const GUEST_SOURCES = [\"\u05d4\u05d5\u05e8\u05d9\u05dd\", \"\u05d0\u05d5\u05e8\u05d0\u05dc\"];\n\nexport const SEED_GUESTS = " +
  JSON.stringify(guests, null, 2) +
  ";\n";

writeFileSync("./src/data/guestsData.js", js, "utf8");
console.log("Wrote", guests.length, "guests | categories:", [...categories].length);
