/* =========================================================================
 *  guestImport.js — קריאת קובץ מוזמנים (Excel או CSV) והמרתו לרשומות
 * -------------------------------------------------------------------------
 *  הקובץ מופרד מ-App.jsx בכוונה: הפירוק לשורות וההמרה לרשומות הן פונקציות
 *  טהורות בלי DOM, ולכן אפשר להריץ עליהן בדיקות ב-Node (scripts/import-test.mjs)
 *  ולוודא ששום שדה לא הולך לאיבוד בדרך מהקובץ למסך.
 *
 *  שלושה דברים שנשברו בפועל בייבוא הישן, ולכן מטופלים כאן במפורש:
 *  1. Excel בעברית על Windows שומר CSV בקידוד windows-1255 בלי BOM. פענוח
 *     כ-UTF-8 מחזיר ג׳יבריש, ולכן מזהים את הכשל ומפענחים מחדש.
 *  2. פיצול נאיבי לפי פסיק הרס כל שדה שמכיל פסיק בתוך מרכאות ("כהן, ישראל").
 *  3. Excel הופך "0501234567" למספר ומוחק את האפס המוביל, והטלפון יצא שגוי.
 * ====================================================================== */

/*  שמות העמודות שהמערכת מכירה. ההתאמה היא לפי שם הכותרת ולא לפי מיקום,
    כדי שסדר העמודות בקובץ של המשתמש לא יהיה משנה.  */
const ALIASES = {
  name: ["שם", "שם מלא", "שם האורח", "name", "guest"],
  phone: ["נייד", "טלפון", "פלאפון", "מספר טלפון", "phone", "mobile"],
  category: ["קטגוריה", "שיוך", "category"],
  mention: ["אזכור", "הערה", "הערות", "mention", "note", "notes"],
  seats: ["כיסאות", "כסאות", "מספר אנשים", "כמות", "seats"],
  source: ["מקור", "source"],
  glatt: ["גלאט", "glatt", "kosher"],
  probablyComing: ["כנראה", "probably"],
  considering: ["לשקול", "considering"],
  rsvp: ["אישור הגעה", "אישורי הגעה", "סטטוס", "rsvp", "status"],
  attendingCount: ["כמה אישרו", "מאושרים", "attending"],
  gift: ["מתנה", "מתנות", "gift"],
};

/*  סדר קנוני לקבצים בלי שורת כותרת.  */
const POSITIONAL = [
  "name",
  "phone",
  "category",
  "mention",
  "seats",
  "source",
  "glatt",
  "probablyComing",
  "considering",
  "rsvp",
  "attendingCount",
  "gift",
];

export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;

export class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = "ImportError";
  }
}

/* ---------------------------------------------------------------- decoding */

/*  פענוח טקסט לפי מה שהקובץ באמת מכיל ולא לפי הנחה.
    Excel בעברית מייצא ב-windows-1255, ו"Unicode Text" מייצא ב-UTF-16.  */
export function decodeText(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));

  const utf8 = new TextDecoder("utf-8").decode(bytes);
  //  U+FFFD מופיע כשהבתים אינם UTF-8 תקין — סימן מובהק לקידוד עברי ישן.
  if (!utf8.includes("\uFFFD")) return utf8.replace(/^\uFEFF/, "");
  try {
    return new TextDecoder("windows-1255").decode(bytes);
  } catch {
    return utf8;
  }
}

/* ----------------------------------------------------------------- parsing */

/*  בחירת התו המפריד לפי השורה הראשונה. קבצים שנשמרו כ-Unicode Text מופרדים
    בטאב, וב-Excel של אירופה המפריד הוא נקודה-פסיק.  */
function detectDelimiter(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== "") || "";
  let best = ",";
  let bestCount = 0;
  for (const d of [",", "\t", ";"]) {
    let count = 0;
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/*  פירוק CSV לפי RFC 4180: מרכאות עוטפות שדה, ומרכאות כפולות בתוכו הן תו
    מרכאות ממשי. בלי זה כל שם עם פסיק נשבר לשתי עמודות.  */
export function parseDelimited(text) {
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\r") continue;
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  rows.push(row);

  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ""));
}

/* ------------------------------------------------------------- field logic */

/*  Excel שומר טלפון שהוקלד כספרות בלבד כמספר, והאפס המוביל נמחק.
    משחזרים אותו רק כשהערך הוא ספרות בלבד — מחרוזת שהמשתמש עיצב בעצמו
    ("050-123-4567", "+972…") נשארת בדיוק כפי שהיא.  */
export function normalizePhone(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (!/^\d+$/.test(s)) return s;
  if (s.startsWith("0")) return s;
  if (/^[57]\d{8}$/.test(s)) return "0" + s; // נייד / מספרי VOIP
  if (/^[23489]\d{7}$/.test(s)) return "0" + s; // קווי
  return s;
}

const truthy = (s) =>
  /^(v|✓|כן|yes|y|1|true|כנראה)$/i.test(String(s ?? "").trim());

function parseRsvp(s) {
  const t = String(s ?? "").trim();
  if (!t) return "pending";
  if (/לא מגיע|לא יגיע|declin|^no$|^לא$/i.test(t)) return "declined";
  if (/אישר|מגיע|confirm|✓|^כן$|^yes$/i.test(t)) return "confirmed";
  return "pending";
}

/*  מספרים שמגיעים מ-Excel עשויים לכלול רווחים או פסיקי אלפים.  */
function toNumber(raw) {
  const s = String(raw ?? "").replace(/[,\s₪]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function buildIndex(headerCells) {
  const norm = headerCells.map((c) =>
    String(c ?? "")
      .replace(/[״"'׳]/g, "")
      .trim()
      .toLowerCase()
  );
  const idx = {};
  const taken = new Set();
  //  קודם התאמה מדויקת ורק אחריה התאמה חלקית, אחרת כותרת כמו "שם הספק"
  //  הייתה יכולה לחטוף את העמודה של "שם".
  for (const pass of ["exact", "partial"]) {
    for (const [key, names] of Object.entries(ALIASES)) {
      if (idx[key] != null) continue;
      const found = norm.findIndex((c, i) => {
        if (taken.has(i) || !c) return false;
        return names.some((n) => {
          const a = n.toLowerCase();
          return pass === "exact" ? c === a : c.includes(a);
        });
      });
      if (found >= 0) {
        idx[key] = found;
        taken.add(found);
      }
    }
  }
  for (const key of Object.keys(ALIASES)) if (idx[key] == null) idx[key] = -1;
  return idx;
}

/*  האם השורה הראשונה היא כותרת ולא מוזמן. בודקים שיש בה לפחות שתי עמודות
    מזוהות, כדי שרשומה של אדם בשם "שם" לא תיבלע בטעות.  */
function looksLikeHeader(cells) {
  const idx = buildIndex(cells);
  const hits = Object.values(idx).filter((v) => v >= 0).length;
  return idx.name >= 0 && hits >= 2;
}

/**
 * המרת מטריצת תאים לרשומות מוזמנים.
 * @param {string[][]} rows
 * @param {{categories?: string[]}} options
 * @returns {{guests: object[], newCategories: string[], skipped: number, hasHeader: boolean}}
 */
export function rowsToGuests(rows, { categories = [] } = {}) {
  const clean = (rows || []).filter(
    (r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() !== "")
  );
  if (!clean.length)
    return { guests: [], newCategories: [], skipped: 0, hasHeader: false };

  const hasHeader = looksLikeHeader(clean[0]);
  const idx = hasHeader
    ? buildIndex(clean[0])
    : Object.fromEntries(POSITIONAL.map((k, i) => [k, i]));
  for (const key of Object.keys(ALIASES)) if (idx[key] == null) idx[key] = -1;

  const dataRows = hasHeader ? clean.slice(1) : clean;
  const get = (cells, key) =>
    idx[key] >= 0 ? String(cells[idx[key]] ?? "").trim() : "";

  const guests = [];
  let skipped = 0;

  for (const cells of dataRows) {
    const name = get(cells, "name");
    const phone = normalizePhone(get(cells, "phone"));
    const category = get(cells, "category");
    const mention = get(cells, "mention");
    const source = get(cells, "source");

    //  שורה בלי שם ובלי טלפון היא שארית של הקובץ (סיכומים, שורות ריקות
    //  עם עיצוב), ולא מוזמן. אין טעם ליצור ממנה "אורח 7" ריק.
    if (!name && !phone) {
      skipped++;
      continue;
    }

    const seats = Math.max(1, Math.round(toNumber(get(cells, "seats"))) || 1);
    const rsvp = parseRsvp(get(cells, "rsvp"));
    let attendingCount = 0;
    if (rsvp === "confirmed") {
      const raw = get(cells, "attendingCount");
      const n = raw !== "" ? Math.round(toNumber(raw)) : seats;
      attendingCount = Math.max(0, Math.min(seats, n));
    }

    guests.push({
      name: name || `אורח ${guests.length + 1}`,
      phone,
      category,
      mention,
      seats,
      source,
      glatt: truthy(get(cells, "glatt")),
      probablyComing: truthy(get(cells, "probablyComing")),
      considering: truthy(get(cells, "considering")),
      rsvp,
      attendingCount,
      gift: Math.max(0, Math.round(toNumber(get(cells, "gift")))),
    });
  }

  //  קטגוריה שהגיעה מהקובץ ואינה ברשימה חייבת להצטרף אליה, אחרת ה-select
  //  של השורה מוצג ריק והערך נמחק בעריכה הבאה.
  const known = new Set(categories);
  const newCategories = [];
  for (const g of guests) {
    if (g.category && !known.has(g.category)) {
      known.add(g.category);
      newCategories.push(g.category);
    }
  }

  return { guests, newCategories, skipped, hasHeader };
}

/* ------------------------------------------------------------ file reading */

function cellText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toLocaleDateString("he-IL");
  if (Array.isArray(v.richText))
    return v.richText.map((t) => t.text || "").join("").trim();
  if (v.error) return "";
  if (v.result != null) return cellText(v.result);
  if (v.formula != null) return "";
  if (v.text != null) return cellText(v.text);
  return String(v).trim();
}

/*  גיליון המוזמנים אינו בהכרח הראשון: קובץ שיוצא מהמערכת מכיל גם ספקים,
    תקציב ושולחנות. מחפשים לפי שם, ורק אם אין מתאים לוקחים את הראשון.  */
function pickSheet(workbook) {
  const sheets = workbook.worksheets.filter((ws) => ws.rowCount > 0);
  if (!sheets.length) return null;
  return (
    sheets.find((ws) => /מוזמנ|אורח|guest/i.test(ws.name || "")) || sheets[0]
  );
}

async function readWorkbookRows(buffer) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = pickSheet(wb);
  if (!ws) throw new ImportError("הקובץ ריק – לא נמצא גיליון עם נתונים");

  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cells[col - 1] = cellText(cell.value);
    });
    for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = "";
    if (cells.some((c) => c !== "")) rows.push(cells);
  });
  return rows;
}

/**
 * קריאת קובץ מוזמנים שהמשתמש בחר, בכל אחד מהפורמטים הנתמכים.
 * @param {File} file
 * @returns {Promise<string[][]>}
 */
export async function readGuestRows(file) {
  if (!file) throw new ImportError("לא נבחר קובץ");
  if (file.size > MAX_IMPORT_BYTES)
    throw new ImportError("הקובץ גדול מדי (מעל 8MB). פצלו אותו לקבצים קטנים יותר.");

  const name = (file.name || "").toLowerCase();
  const buffer = await file.arrayBuffer();

  //  .xls הישן הוא פורמט בינארי אחר לגמרי; עדיף להגיד את זה במפורש
  //  מאשר להציג "הקובץ פגום" אחרי ניסיון פענוח.
  if (name.endsWith(".xls"))
    throw new ImportError(
      'קובץ בפורמט הישן (.xls) אינו נתמך. פתחו אותו ושמרו כ-Excel (.xlsx) או כ-CSV.'
    );

  const bytes = new Uint8Array(buffer.slice(0, 4));
  const isZip =
    bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);

  const rows =
    name.endsWith(".xlsx") || name.endsWith(".xlsm") || isZip
      ? await readWorkbookRows(buffer)
      : parseDelimited(decodeText(buffer));

  if (rows.length > MAX_IMPORT_ROWS)
    throw new ImportError(
      `הקובץ מכיל ${rows.length} שורות – מעל המקסימום (${MAX_IMPORT_ROWS}).`
    );
  return rows;
}
