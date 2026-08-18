/* =========================================================================
 *  excelExport.js — ייצוא כל נתוני החתונה לקובץ Excel רב-גיליונות
 * -------------------------------------------------------------------------
 *  בניית הנתונים (`buildSheets`) מופרדת בכוונה מהכתיבה לקובץ (`exportWeddingWorkbook`):
 *  הראשונה היא פונקציה טהורה בלי DOM ובלי ספריות, ולכן אפשר לבדוק אותה
 *  בסקריפט Node (scripts/excel-test.mjs) ולוודא שכל עמודה וכל ערך יורדים נכון.
 *
 *  כותרות גיליון המוזמנים זהות לשמות שמייבא `handleFile` ב-App.jsx, כך
 *  שקובץ שיוצא מהמערכת ניתן לייבוא בחזרה אליה.
 *
 *  ExcelJS נטען ב-import דינמי — הוא כבד, ואין סיבה שכל מי שפותח את
 *  האפליקציה ישלם עליו בטעינה הראשונה.
 * ====================================================================== */

const RSVP_LABELS = {
  confirmed: "אישרו הגעה",
  pending: "ממתין",
  declined: "לא מגיעים",
};

const TASK_LABELS = {
  todo: "לביצוע",
  inprogress: "בתהליך",
  done: "הושלם",
};

const TABLE_TYPE_LABELS = {
  knight: "שולחן אבירים",
  standard: "שולחן רגיל",
};

const UNASSIGNED = "ללא שיבוץ";

const yesNo = (v) => (v ? "כן" : "לא");
const num = (v) => Math.round(Number(v) || 0);
const text = (v) => (v == null ? "" : String(v));

const tableCapacity = (type) => (type === "knight" ? 24 : 12);
const guestSeats = (g) => Math.max(1, num(g?.seats) || 1);

/**
 * מחזיר את הגדרות כל הגיליונות: שם, עמודות (כותרת + מפתח + רוחב) ושורות.
 * טהורה לחלוטין — אותו קלט תמיד מחזיר אותו פלט.
 */
export function buildSheets({
  guests = [],
  tables = [],
  vendors = [],
  budget = [],
  budgetGoal = 0,
} = {}) {
  const guestById = new Map(guests.map((g) => [g.id, g]));

  //  שיבוץ הפוך: לכל מוזמן, באיזה שולחן הוא יושב. מוזמן שהופיע בטעות
  //  בשני שולחנות ייחשב לראשון בלבד, בדיוק כמו שהמסך מציג אותו.
  const tableOfGuest = new Map();
  for (const t of tables) {
    for (const gid of t.guestIds || []) {
      if (!tableOfGuest.has(gid)) tableOfGuest.set(gid, t);
    }
  }

  /* ── גיליון 1: מוזמנים ─────────────────────────────────────────────── */
  const guestsSheet = {
    name: "מוזמנים",
    columns: [
      { header: "מס׳", key: "id", width: 8 },
      { header: "שם", key: "name", width: 26 },
      { header: "נייד", key: "phone", width: 16 },
      { header: "קטגוריה", key: "category", width: 28 },
      { header: "מקור", key: "source", width: 12 },
      { header: "כיסאות", key: "seats", width: 10 },
      { header: "אישור הגעה", key: "rsvp", width: 14 },
      { header: "כמה אישרו", key: "attendingCount", width: 12 },
      { header: "כנראה יבוא", key: "probablyComing", width: 12 },
      { header: "לשקול", key: "considering", width: 10 },
      { header: "גלאט", key: "glatt", width: 8 },
      { header: "שותים", key: "drinkers", width: 10 },
      { header: "מתנה", key: "gift", width: 12, numFmt: "#,##0" },
      { header: "שולחן", key: "table", width: 18 },
      { header: "אזכור", key: "mention", width: 30 },
    ],
    rows: guests.map((g) => {
      const seats = guestSeats(g);
      return {
        id: num(g.id),
        name: text(g.name),
        phone: text(g.phone),
        category: text(g.category),
        source: text(g.source),
        seats,
        rsvp: RSVP_LABELS[g.rsvp] || RSVP_LABELS.pending,
        //  בדיוק כמו במסך: כשאין ערך מפורש, כל הכיסאות נחשבים מאושרים,
        //  והערך אף פעם לא גדול ממספר הכיסאות.
        attendingCount:
          g.attendingCount != null ? Math.min(num(g.attendingCount), seats) : seats,
        probablyComing: yesNo(g.probablyComing),
        considering: yesNo(g.considering),
        glatt: yesNo(g.glatt),
        //  מספר ולא כן/לא: רשומה אחת יכולה להיות משפחה שבה חלק שותים.
        drinkers: Math.min(seats, num(g.drinkers)),
        gift: num(g.gift),
        table: tableOfGuest.get(g.id)?.name || UNASSIGNED,
        mention: text(g.mention),
      };
    }),
  };

  /* ── גיליון 2: ספקים ──────────────────────────────────────────────── */
  const vendorsSheet = {
    name: "ספקים",
    columns: [
      { header: "מס׳", key: "id", width: 8 },
      { header: "שם הספק", key: "name", width: 26 },
      { header: "סוג", key: "type", width: 20 },
      { header: "טלפון", key: "phone", width: 16 },
      { header: "אימייל", key: "email", width: 26 },
      { header: "עלות בחוזה", key: "contractCost", width: 14, numFmt: "#,##0" },
      { header: "מקדמה ששולמה", key: "deposit", width: 14, numFmt: "#,##0" },
      { header: "יתרה לתשלום", key: "balance", width: 14, numFmt: "#,##0" },
      { header: "משימות שהושלמו", key: "tasksDone", width: 14 },
      { header: "סה״כ משימות", key: "tasksTotal", width: 12 },
      { header: "פירוט המשימות", key: "tasks", width: 46, wrap: true },
      { header: "הערות", key: "notes", width: 46, wrap: true },
    ],
    rows: vendors.map((v) => {
      const tasks = Array.isArray(v.tasks) ? v.tasks : [];
      return {
        id: num(v.id),
        name: text(v.name),
        type: text(v.type),
        phone: text(v.phone),
        email: text(v.email),
        contractCost: num(v.contractCost),
        deposit: num(v.deposit),
        balance: num(v.contractCost) - num(v.deposit),
        tasksDone: tasks.filter((t) => t.status === "done").length,
        tasksTotal: tasks.length,
        //  המשימות מקוננות בתוך הספק. במקום גיליון נפרד הן יורדות כשורות
        //  טקסט בתא אחד, כך שאף משימה לא הולכת לאיבוד.
        tasks: tasks
          .map((t) => `[${TASK_LABELS[t.status] || TASK_LABELS.todo}] ${text(t.title)}`)
          .join("\n"),
        notes: text(v.notes),
      };
    }),
  };

  /* ── גיליון 3: סדר הושבה ──────────────────────────────────────────── */
  //  שורה לכל צירוף שולחן-מוזמן, כדי שאפשר יהיה למיין ולסנן באקסל.
  //  שולחן ריק מקבל שורה אחת בלי מוזמן, ובסוף מגיעים כל מי שעדיין לא שובצו.
  const seatingRows = [];
  for (const t of tables) {
    const ids = Array.isArray(t.guestIds) ? t.guestIds : [];
    const seated = ids.map((id) => guestById.get(id)).filter(Boolean);
    const used = seated.reduce((s, g) => s + guestSeats(g), 0);
    const capacity = tableCapacity(t.type);
    const base = {
      tableId: num(t.id),
      tableName: text(t.name),
      tableType: TABLE_TYPE_LABELS[t.type] || TABLE_TYPE_LABELS.standard,
      capacity,
      used,
      free: capacity - used,
    };
    if (!seated.length) {
      seatingRows.push({
        ...base,
        guestName: "",
        guestPhone: "",
        guestCategory: "",
        guestSeats: 0,
        guestRsvp: "",
      });
      continue;
    }
    for (const g of seated) {
      seatingRows.push({
        ...base,
        guestName: text(g.name),
        guestPhone: text(g.phone),
        guestCategory: text(g.category),
        guestSeats: guestSeats(g),
        guestRsvp: RSVP_LABELS[g.rsvp] || RSVP_LABELS.pending,
      });
    }
  }
  for (const g of guests) {
    if (tableOfGuest.has(g.id)) continue;
    seatingRows.push({
      tableId: 0,
      tableName: UNASSIGNED,
      tableType: "",
      capacity: 0,
      used: 0,
      free: 0,
      guestName: text(g.name),
      guestPhone: text(g.phone),
      guestCategory: text(g.category),
      guestSeats: guestSeats(g),
      guestRsvp: RSVP_LABELS[g.rsvp] || RSVP_LABELS.pending,
    });
  }

  const seatingSheet = {
    name: "סדר הושבה",
    columns: [
      { header: "מס׳ שולחן", key: "tableId", width: 10 },
      { header: "שם השולחן", key: "tableName", width: 20 },
      { header: "סוג השולחן", key: "tableType", width: 16 },
      { header: "קיבולת", key: "capacity", width: 10 },
      { header: "מקומות בשימוש", key: "used", width: 14 },
      { header: "מקומות פנויים", key: "free", width: 14 },
      { header: "שם המוזמן", key: "guestName", width: 26 },
      { header: "נייד", key: "guestPhone", width: 16 },
      { header: "קטגוריה", key: "guestCategory", width: 28 },
      { header: "כיסאות", key: "guestSeats", width: 10 },
      { header: "אישור הגעה", key: "guestRsvp", width: 14 },
    ],
    rows: seatingRows,
  };

  /* ── גיליון 4: ניהול תקציב ────────────────────────────────────────── */
  const expectedTotal = budget.reduce((s, b) => s + num(b.expected), 0);
  const actualTotal = budget.reduce((s, b) => s + num(b.actual), 0);
  const paidTotal = budget.reduce((s, b) => s + num(b.paid), 0);
  const income = guests.reduce((s, g) => s + num(g.gift), 0);

  const budgetSheet = {
    name: "ניהול תקציב",
    columns: [
      { header: "מס׳", key: "id", width: 8 },
      { header: "סעיף", key: "category", width: 32 },
      { header: "הוצאה צפויה", key: "expected", width: 14, numFmt: "#,##0" },
      { header: "הוצאה בפועל", key: "actual", width: 14, numFmt: "#,##0" },
      { header: "סה״כ שולם", key: "paid", width: 14, numFmt: "#,##0" },
      { header: "נותר לשלם", key: "remaining", width: 14, numFmt: "#,##0" },
      { header: "פער", key: "diff", width: 14, numFmt: "#,##0" },
    ],
    rows: budget.map((b) => ({
      id: num(b.id),
      category: text(b.category),
      expected: num(b.expected),
      actual: num(b.actual),
      paid: num(b.paid),
      //  אותו חישוב כמו במסך: תשלום יתר אינו "נותר לשלם" שלילי.
      remaining: Math.max(0, num(b.actual) - num(b.paid)),
      //  אותו חישוב כמו במסך: חיובי = חריגה מהצפוי.
      diff: num(b.actual) - num(b.expected),
    })),
    //  שורות סיכום מתחת לטבלה, עם שורה ריקה מפרידה.
    summary: [
      { label: "סכום הסעיפים הצפוי", value: expectedTotal },
      { label: "סה״כ נדרש לשלם", value: actualTotal },
      { label: "סה״כ שולם", value: paidTotal },
      { label: "נותר לשלם", value: Math.max(0, actualTotal - paidTotal) },
      { label: "הכנסות (מתנות)", value: income },
      { label: "מאזן סופי", value: income - actualTotal },
      { label: "יעד התקציב הכולל", value: num(budgetGoal) },
    ],
  };

  return [guestsSheet, vendorsSheet, seatingSheet, budgetSheet];
}

/** שם קובץ בטוח: בלי תווים שאסורים במערכות קבצים ובלי רווחים כפולים. */
export function workbookFileName(weddingName) {
  const clean = String(weddingName || "החתונה שלי")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `${clean || "החתונה שלי"} - ${new Date().toISOString().slice(0, 10)}.xlsx`;
}

/* =========================================================================
 *  גיליון השחזור
 * -------------------------------------------------------------------------
 *  ארבעת הגיליונות שלמעלה נועדו לקריאה אנושית, ולכן הם מאבדים מידע: סדר
 *  ההושבה משכפל מוזמנים, משימות הספק נדחסות לתא טקסט אחד, ואין בהם בכלל
 *  יעד תקציב, תוויות או קטגוריות. שחזור מהם היה יוצר חתונה דומה — לא זהה.
 *
 *  לכן נוסף גיליון חמישי שמכיל את בדיוק אותו payload של גיבוי ה-JSON,
 *  מקודד ב-base64 ומפוצל לשורות. התוצאה: קובץ אחד שגם נקרא בעיניים וגם
 *  משחזר ב-100%. הקידוד (ולא JSON גולמי) נבחר כדי שהתא יכיל אך ורק תווי
 *  base64 — בלי רווחים שאקסל עלול לגזום ובלי תו פתיחה שנראה כמו נוסחה.
 * ====================================================================== */

export const BACKUP_SHEET_NAME = "גיבוי לשחזור";

const BACKUP_SHEET_NOTE =
  "אל תמחקו ואל תערכו את הגיליון הזה — הוא מה שמאפשר לשחזר את החתונה מהקובץ.";

//  מתחת למגבלת 32,767 התווים לתא, עם מרווח ביטחון.
const BACKUP_CHUNK_SIZE = 20000;

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  //  apply על מערך ענק חורג ממגבלת הארגומנטים ומפיל את הלשונית.
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
  }
  return btoa(binary);
}

function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** מקודד payload של גיבוי למערך מחרוזות, שורה לכל תא בגיליון. טהורה. */
export function encodeBackupChunks(payload) {
  const encoded = toBase64(JSON.stringify(payload));
  const chunks = [];
  for (let i = 0; i < encoded.length; i += BACKUP_CHUNK_SIZE) {
    chunks.push(encoded.slice(i, i + BACKUP_CHUNK_SIZE));
  }
  return chunks;
}

/** מחזיר את ה-payload מתוך מערך המחרוזות. זורק Error עם code בכשל. טהורה. */
export function decodeBackupChunks(chunks) {
  const joined = (Array.isArray(chunks) ? chunks : []).join("");
  if (!joined) throw Object.assign(new Error("empty backup"), { code: "no_backup_sheet" });
  let payload;
  try {
    payload = JSON.parse(fromBase64(joined));
  } catch {
    throw Object.assign(new Error("corrupt backup"), { code: "corrupt_backup" });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw Object.assign(new Error("corrupt backup"), { code: "corrupt_backup" });
  }
  return payload;
}

/**
 * קורא את גיליון השחזור מקובץ אקסל שהמשתמש בחר ומחזיר את ה-payload.
 * @param {File|Blob} file
 */
export async function readWorkbookBackup(file) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    throw Object.assign(new Error("unreadable"), { code: "unreadable_file" });
  }

  const ws = wb.getWorksheet(BACKUP_SHEET_NAME);
  if (!ws) throw Object.assign(new Error("missing sheet"), { code: "no_backup_sheet" });

  //  קוראים לפי מספר השורה ולא לפי סדר האיטרציה, כדי ששורה שנמחקה או
  //  מיון שבוצע בטעות ייתפסו כקובץ פגום במקום להרכיב JSON מעורבב.
  const chunks = [];
  let expected = 1;
  for (let r = 1; r <= ws.rowCount; r++) {
    const index = Number(ws.getRow(r).getCell(1).value);
    if (!Number.isInteger(index) || index <= 0) continue;
    if (index !== expected) {
      throw Object.assign(new Error("out of order"), { code: "corrupt_backup" });
    }
    const cell = ws.getRow(r).getCell(2).value;
    chunks.push(typeof cell === "string" ? cell : String(cell?.text ?? cell ?? ""));
    expected += 1;
  }
  return decodeBackupChunks(chunks);
}

/** בונה חוברת ExcelJS מהגדרות הגיליונות ומחזיר Buffer/ArrayBuffer. */
export async function buildWorkbookBuffer(data) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "תכנון החתונה שלי";
  wb.created = new Date();

  for (const sheet of buildSheets(data)) {
    //  views.rightToLeft — בלעדיו אקסל פותח גיליון עברי משמאל לימין.
    const ws = wb.addWorksheet(sheet.name, {
      views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
    });
    ws.columns = sheet.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width,
    }));

    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF3E7C9" },
    };

    sheet.rows.forEach((r) => ws.addRow(r));

    sheet.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c.numFmt) col.numFmt = c.numFmt;
      if (c.wrap) col.alignment = { wrapText: true, vertical: "top" };
    });

    if (sheet.summary?.length) {
      ws.addRow({});
      for (const s of sheet.summary) {
        const row = ws.addRow({ category: s.label, expected: s.value });
        row.font = { bold: true };
      }
    }

    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columns.length },
    };
  }

  //  גיליון השחזור נכתב אחרון, אחרי הגיליונות שהמשתמש בא לקרוא.
  if (data?.backup && typeof data.backup === "object") {
    const ws = wb.addWorksheet(BACKUP_SHEET_NAME, {
      views: [{ rightToLeft: true }],
    });
    ws.columns = [
      { header: "מס׳", key: "index", width: 8 },
      { header: BACKUP_SHEET_NOTE, key: "chunk", width: 90 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF3E7C9" },
    };
    encodeBackupChunks(data.backup).forEach((chunk, i) => {
      ws.addRow({ index: i + 1, chunk });
    });
  }

  return wb.xlsx.writeBuffer();
}

/** בונה את החוברת ומוריד אותה בדפדפן. */
export async function exportWeddingWorkbook(data, weddingName) {
  const buffer = await buildWorkbookBuffer(data);
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = workbookFileName(weddingName);
  a.click();
  URL.revokeObjectURL(url);
}
