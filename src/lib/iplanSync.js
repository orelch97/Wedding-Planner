/* =========================================================================
 *  iplanSync.js — התאמת אישורי הגעה מקובץ/ייצוא iPlan לרשומות המוזמנים שלנו
 * -------------------------------------------------------------------------
 *  מודול טהור לחלוטין (בלי DOM ובלי Firebase) כדי שניתן יהיה לבדוק אותו
 *  ב-Node (npm run test:iplan) ולהריץ את אותו מנוע בדיוק גם בצד הלקוח
 *  (תצוגה מקדימה ואישור ידני של המשתמש) וגם ב-Cloud Functions.
 *
 *  כלל ברזל:
 *  השדה היחיד שמותר לעדכן ברשומת מוזמן הוא סטטוס אישור ההגעה:
 *    - rsvp: "pending" | "maybe" | "confirmed" | "declined"
 *    - attendingCount: מספר האנשים שיגיעו (עבור "confirmed"), או 0 אחרת.
 *  שום שדה אחר ברשומה (שם, טלפון, כיסאות, קטגוריה, הערות וכו') לא משתנה!
 * ====================================================================== */

import { phoneDigits } from "./guestDuplicates.js";
import { decodeText, parseDelimited, normalizePhone, ImportError, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "./guestImport.js";

/**
 * מפתח השוואה אחיד למספר טלפון ישראלי:
 * מסיר תווי עיצוב, קידומת בינלאומית (972 / 00972) ואפס מוביל,
 * ומשווה לפי 9 הספרות האחרונות (או 8 לקווי) כך ש:
 * "050-697-0046", "0506970046", "506970046" ו-"+972-50-697-0046"
 * מתמפים כולם לאותו מפתח: "506970046".
 */
export function phoneKey(value) {
  const keys = phoneKeys(value);
  return keys[0] || "";
}

/**
 * מחלץ את כל מפתחות הטלפון מרשומה (תומך גם ברשומות עם שני טלפונים מופרדים ב-"/" או פסיק,
 * כגון "050-6970046 / 054-5666710" אצל "שי ושקד אלעזרי").
 */
export function phoneKeys(value) {
  if (value == null || typeof value === "boolean") return [];
  const rawStr = String(value).trim();
  if (!rawStr) return [];

  const parts = rawStr.split(/[/,;|\n]+/).map((p) => p.trim()).filter(Boolean);
  const keys = [];
  for (const part of parts) {
    let digits = phoneDigits(part);
    if (!digits) continue;
    if (digits.startsWith("00972") && digits.length >= 12) {
      digits = digits.slice(5);
    } else if (digits.startsWith("972") && digits.length >= 10) {
      digits = digits.slice(3);
    }
    while (digits.startsWith("0") && digits.length >= 9) {
      digits = digits.slice(1);
    }
    if (digits.length > 9) {
      digits = digits.slice(-9);
    }
    if (digits.length >= 8 && !keys.includes(digits)) {
      keys.push(digits);
    }
  }
  return keys;
}

/**
 * מפתח השוואה אחיד לשם מוזמן (עבור רשומות שחסר בהן טלפון או שהטלפון שונה):
 * מסיר ניקוד, גרשיים/מקפים ורווחים כפולים.
 */
export function normalizeGuestName(name) {
  return String(name ?? "")
    .trim()
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/["'״׳`\-–—.,()?]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * מפתח שם משני המסיר הערות בסוגריים (כגון "אורטל אלעזר(הבת של עופרה)" -> "אורטל אלעזר").
 */
export function normalizeGuestNameWithoutParens(name) {
  return normalizeGuestName(String(name ?? "").replace(/\([^)]*\)/g, " "));
}

const HEADER_ALIASES = {
  name: ["הזמנה לכבוד", "הזמנה עבור", "שם מוזמן", "שם מלא", "שם האורח", "שם", "name"],
  invited: ["מס אורחים שהוזמנו", "מספר אורחים שהוזמנו", "מוזמנים", "כמות מוזמנים", "כיסאות", "כסאות", "invited", "seats"],
  phone: ["סלולרי", "פרטי התקשרות", "טלפון נייד", "נייד", "פלאפון", "טלפון", "mobile", "phone"],
  landline: ["טלפון רגיל", "טלפון נוסף", "טלפון בבית", "landline"],
  confirmed: ["אישרו שיגיעו", "אישרו הגעה", "יגיעו בוודאות", "יגיעו", "כמה אישרו", "מאושרים", "confirmed"],
  considering: ["מתלבטים", "אולי יגיעו", "considering"],
  declined: ["לא יגיעו", "לא מגיעים", "סירבו", "declined"],
  status: ["סטטוס", "אישור הגעה", "מצב", "status", "rsvp"],
};

function cleanHeaderCell(cell) {
  return String(cell ?? "")
    .replace(/[״"'׳`']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildIplanHeaderIndex(cells) {
  const norm = (cells || []).map(cleanHeaderCell);
  const idx = {};
  const taken = new Set();

  for (const pass of ["exact", "partial"]) {
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (idx[key] != null) continue;
      const found = norm.findIndex((c, i) => {
        if (taken.has(i) || !c) return false;
        return aliases.some((alias) => {
          const a = cleanHeaderCell(alias);
          return pass === "exact" ? c === a : c.includes(a);
        });
      });
      if (found >= 0) {
        idx[key] = found;
        taken.add(found);
      }
    }
  }
  return idx;
}

function parseStatusFromCells({ confirmedRaw, consideringRaw, declinedRaw, statusRaw, invited }) {
  const confText = String(confirmedRaw ?? "").trim();
  const consText = String(consideringRaw ?? "").trim();
  const declText = String(declinedRaw ?? "").trim();
  const statText = String(statusRaw ?? "").trim();

  // 1. בדיקת עמודת "מתלבטים" תחילה במקרה שיש בה ערך מפורש (> 0 או טקסט התלבטות),
  //    כדי שאם ב-iPlan עמודת "אישרו שיגיעו" מכילה "0" בזמן שעמודת "מתלבטים" מכילה "2",
  //    הרשומה תסווג כ-"maybe" ("מתלבטים") ולא כ-"declined" ("לא מגיעים").
  if (consText !== "") {
    const num = Number(consText.replace(/[,\s]/g, ""));
    if (
      (Number.isFinite(num) && num > 0) ||
      /^(כן|מתלבט|מתלבטים|לא החליט|לא החליטו|אולי|maybe|considering|v|✓|yes|true|\?)$/i.test(consText)
    ) {
      return { rsvp: "maybe", attendingCount: 0, hasResponse: true, rawStatus: "considering" };
    }
  }

  // 2. עמודת "אישרו שיגיעו" בייצוא של iPlan:
  //    - מספר חיובי (> 0) = אישרו הגעה עם כמות המגיעים
  //    - טקסט "מתלבטים" / "לא החליטו" = מתלבטים ("maybe")
  //    - "0" מפורש או טקסט סירוב = לא מגיעים
  //    - תא ריק = טרם השיבו (אלא אם כן סומן ב"מתלבטים" או ב"לא יגיעו")
  if (confText !== "") {
    if (/מתלבט|לא החליט|אולי|maybe|considering|\?/i.test(confText)) {
      return { rsvp: "maybe", attendingCount: 0, hasResponse: true, rawStatus: "considering" };
    }
    if (/^(0|לא|לא יגיעו|לא מגיעים|לא מגיע|סירבו?|declined|no)$/i.test(confText)) {
      return { rsvp: "declined", attendingCount: 0, hasResponse: true, rawStatus: "declined" };
    }
    const num = Number(confText.replace(/[,\s]/g, ""));
    if (Number.isFinite(num)) {
      if (num > 0) {
        return { rsvp: "confirmed", attendingCount: Math.round(num), hasResponse: true, rawStatus: "confirmed" };
      }
      if (num === 0) {
        return { rsvp: "declined", attendingCount: 0, hasResponse: true, rawStatus: "declined" };
      }
    }
    const leadingNum = confText.match(/^(\d+)\s*מגיע/);
    if (leadingNum) {
      const n = Number(leadingNum[1]);
      if (n > 0) {
        return { rsvp: "confirmed", attendingCount: n, hasResponse: true, rawStatus: "confirmed" };
      }
      return { rsvp: "declined", attendingCount: 0, hasResponse: true, rawStatus: "declined" };
    }
    if (/^(כן|אישר|אישרו|יגיעו|מגיע|מגיעים|confirmed|yes|v|✓)$/i.test(confText)) {
      return {
        rsvp: "confirmed",
        attendingCount: Math.max(1, Number(invited) || 1),
        hasResponse: true,
        rawStatus: "confirmed",
      };
    }
  }

  // 3. עמודת "לא יגיעו" נפרדת (אם קיימת)
  if (declText !== "") {
    const num = Number(declText.replace(/[,\s]/g, ""));
    if ((Number.isFinite(num) && num > 0) || /^(כן|לא יגיעו|לא מגיעים|v|✓|yes|true)$/i.test(declText)) {
      return { rsvp: "declined", attendingCount: 0, hasResponse: true, rawStatus: "declined" };
    }
  }

  // 4. עמודת סטטוס טקסטואלית כללית (אם קיימת)
  if (statText !== "") {
    if (/מתלבט|לא החליט|אולי|maybe|considering|\?/i.test(statText)) {
      return { rsvp: "maybe", attendingCount: 0, hasResponse: true, rawStatus: "considering" };
    }
    if (/לא יגיע|לא מגיע|סירב|declin|^no$|^לא$/i.test(statText)) {
      return { rsvp: "declined", attendingCount: 0, hasResponse: true, rawStatus: "declined" };
    }
    const statCountMatch = statText.match(/(\d+)\s*מגיע/);
    if (statCountMatch) {
      const n = Number(statCountMatch[1]);
      if (n > 0) {
        return { rsvp: "confirmed", attendingCount: n, hasResponse: true, rawStatus: "confirmed" };
      }
      return { rsvp: "declined", attendingCount: 0, hasResponse: true, rawStatus: "declined" };
    }
    if (/אישר|יגיעו|מגיע|confirm|^yes$|^כן$|✓/i.test(statText)) {
      return {
        rsvp: "confirmed",
        attendingCount: Math.max(1, Number(invited) || 1),
        hasResponse: true,
        rawStatus: "confirmed",
      };
    }
    if (/ממתין|טרם|pending/i.test(statText)) {
      return { rsvp: "pending", attendingCount: 0, hasResponse: false, rawStatus: "pending" };
    }
  }

  return { rsvp: "pending", attendingCount: 0, hasResponse: false, rawStatus: "unanswered" };
}

/**
 * מפרק מטריצת תאים (כפי שנקראה מקובץ ה-.xls של iPlan) לרשומות מנורמלות.
 * תומך בשורת כותרת כפולה של iPlan (שורה 0 כותרות-על, שורה 1 כותרות עמודות).
 */
export function parseIplanSheetRows(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0) return [];

  const nonEmpty = matrix.filter(
    (row) => Array.isArray(row) && row.some((c) => String(c ?? "").trim() !== "")
  );
  if (!nonEmpty.length) return [];

  // חיפוש שורת הכותרת מבין 5 השורות הראשונות
  let headerRowIndex = -1;
  let headerIdx = null;
  for (let i = 0; i < Math.min(5, nonEmpty.length); i++) {
    const candidate = buildIplanHeaderIndex(nonEmpty[i]);
    const hits = Object.values(candidate).filter((v) => v != null && v >= 0).length;
    if (candidate.name != null && (candidate.phone != null || candidate.confirmed != null) && hits >= 2) {
      headerRowIndex = i;
      headerIdx = candidate;
      break;
    }
  }

  if (headerRowIndex === -1 || !headerIdx) {
    throw new ImportError("לא זוהו עמודות iPlan בקובץ (נדרשות לפחות עמודות 'הזמנה לכבוד' ו'סלולרי'/'אישרו שיגיעו').");
  }

  const getCell = (row, key) => {
    const col = headerIdx[key];
    return col != null && col >= 0 ? String(row[col] ?? "").trim() : "";
  };

  const parsed = [];
  for (let i = headerRowIndex + 1; i < nonEmpty.length; i++) {
    const row = nonEmpty[i];
    const name = getCell(row, "name");
    const phone = normalizePhone(getCell(row, "phone"));
    const landline = normalizePhone(getCell(row, "landline"));

    if (!name && !phone && !landline) continue;
    if (/^(סה"כ|סהכ|סיכום|total)$/i.test(name) && !phone && !landline) continue;

    const invitedRaw = getCell(row, "invited");
    const invitedNum = Number(invitedRaw.replace(/[,\s]/g, ""));
    const invited = Number.isFinite(invitedNum) && invitedNum > 0 ? Math.round(invitedNum) : 1;

    const status = parseStatusFromCells({
      confirmedRaw: getCell(row, "confirmed"),
      consideringRaw: getCell(row, "considering"),
      declinedRaw: getCell(row, "declined"),
      statusRaw: getCell(row, "status"),
      invited,
    });

    parsed.push({
      name,
      phone: phone || landline,
      landline,
      invited,
      rsvp: status.rsvp,
      attendingCount: status.attendingCount,
      hasResponse: status.hasResponse,
      rawStatus: status.rawStatus,
    });
  }

  return parsed;
}

/**
 * מנרמל שורה בודדת שמגיעה כבר כאובייקט (למשל מהתוסף או מבדיקות יחידה).
 */
export function normalizeIplanRow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name ?? raw["הזמנה לכבוד"] ?? "").trim();
  const phone = normalizePhone(raw.phone ?? raw["סלולרי"] ?? "");
  const landline = normalizePhone(raw.landline ?? raw["טלפון רגיל"] ?? "");
  const invitedRaw = raw.invited ?? raw["מס' אורחים שהוזמנו"] ?? raw.seats ?? 1;
  const invited = Math.max(1, Math.round(Number(invitedRaw) || 1));

  if (raw.rsvp && ["confirmed", "declined", "maybe", "pending"].includes(raw.rsvp) && typeof raw.hasResponse === "boolean") {
    // תאימות לאחור לשורות שנשמרו בעבר עם rsvp="pending" ו-rawStatus="considering"
    const normalizedRsvp =
      raw.rsvp === "pending" && raw.rawStatus === "considering" ? "maybe" : raw.rsvp;
    const attendingCount =
      normalizedRsvp === "confirmed"
        ? Math.max(1, Math.round(Number(raw.attendingCount ?? invited) || 1))
        : 0;
    return {
      name,
      phone: phone || landline,
      landline,
      invited,
      rsvp: normalizedRsvp,
      attendingCount,
      hasResponse: raw.hasResponse,
      rawStatus: raw.rawStatus || normalizedRsvp,
    };
  }

  const status = parseStatusFromCells({
    confirmedRaw: raw.confirmed ?? raw["אישרו שיגיעו"] ?? (raw.rsvp === "confirmed" ? (raw.attendingCount ?? invited) : raw.rsvp === "declined" ? 0 : ""),
    consideringRaw: raw.considering ?? raw["מתלבטים"] ?? "",
    declinedRaw: raw.declined ?? raw["לא יגיעו"] ?? "",
    statusRaw: raw.status ?? raw.rsvp ?? "",
    invited,
  });

  return {
    name,
    phone: phone || landline,
    landline,
    invited,
    rsvp: status.rsvp,
    attendingCount: status.attendingCount,
    hasResponse: status.hasResponse,
    rawStatus: status.rawStatus,
  };
}

/**
 * בונה מפה של guestId -> הסטטוס האחרון שנקבע לרשומה דרך סנכרון iPlan (מתוך יומן הפעילות).
 * משמש לזיהוי איפוס ב-iPlan: רק רשומה שהסטטוס הנוכחי שלה הגיע מ-iPlan תחזור ל"ממתין"
 * כאשר היא מאופסת ב-iPlan; סטטוס שהוזן ידנית במערכת שלנו לא ידרס.
 */
export function buildIplanManagedRsvpMap(activity = []) {
  const map = new Map();
  const list = Array.isArray(activity) ? [...activity] : [];
  // מהישן לחדש, כך שהעדכון האחרון של כל רשומה הוא שקובע
  list.sort((a, b) => new Date(a?.at).getTime() - new Date(b?.at).getTime());
  for (const batch of list) {
    for (const c of batch?.changes || []) {
      if (c?.guestId == null || !c.toRsvp) continue;
      map.set(Number(c.guestId), c.toRsvp);
    }
  }
  return map;
}

/**
 * ממזג מערך שורות בסיס מ-iPlan (למשל תמונת המצב המלאה עם 538 ההזמנות מהענן)
 * עם מערך שורות חדשות/מסוננות (למשל משיכה חלקית של 95 שורות מטבלה או מקובץ מסונן),
 * כך שלעולם לא נעלמים עדכונים מרשומות שלא הופיעו במשיכה החלקית.
 * overlayRows נחשבות תמיד לעדכניות יותר: הסטטוס שלהן גובר (כולל איפוס ל"טרם השיבו").
 */
export function mergeIplanRows(baseRows = [], overlayRows = []) {
  if (!Array.isArray(overlayRows) || overlayRows.length === 0) {
    return Array.isArray(baseRows) ? baseRows : [];
  }
  if (!Array.isArray(baseRows) || baseRows.length === 0) {
    return overlayRows;
  }

  const normalizedBase = baseRows.map(normalizeIplanRow).filter(Boolean);
  const normalizedOverlay = overlayRows.map(normalizeIplanRow).filter(Boolean);
  if (!normalizedOverlay.length) return normalizedBase;
  if (!normalizedBase.length) return normalizedOverlay;

  const result = normalizedBase.map((r) => ({ ...r }));
  const indexByPhone = new Map();
  const indexByName = new Map();
  const indexByNameNoParens = new Map();

  result.forEach((r, idx) => {
    for (const pk of phoneKeys(r.phone)) {
      if (pk && !indexByPhone.has(pk)) indexByPhone.set(pk, idx);
    }
    for (const pk of phoneKeys(r.landline)) {
      if (pk && !indexByPhone.has(pk)) indexByPhone.set(pk, idx);
    }
    const nk = normalizeGuestName(r.name);
    if (nk && !indexByName.has(nk)) indexByName.set(nk, idx);
    const npk = normalizeGuestNameWithoutParens(r.name);
    if (npk && !indexByNameNoParens.has(npk)) indexByNameNoParens.set(npk, idx);
  });

  for (const inc of normalizedOverlay) {
    if (!inc) continue;
    const pks = [...phoneKeys(inc.phone), ...phoneKeys(inc.landline)];
    let targetIdx;
    for (const pk of pks) {
      if (pk && indexByPhone.has(pk)) {
        targetIdx = indexByPhone.get(pk);
        break;
      }
    }
    const nk = normalizeGuestName(inc.name);
    if (targetIdx === undefined && nk && indexByName.has(nk)) {
      targetIdx = indexByName.get(nk);
    }
    const npk = normalizeGuestNameWithoutParens(inc.name);
    if (targetIdx === undefined && npk && indexByNameNoParens.has(npk)) {
      targetIdx = indexByNameNoParens.get(npk);
    }

    if (targetIdx !== undefined) {
      const prev = result[targetIdx];
      // השורה החדשה גוברת תמיד — כולל איפוס ב-iPlan חזרה ל"טרם השיבו"
      result[targetIdx] = {
        ...prev,
        name: inc.name || prev.name,
        phone: inc.phone || prev.phone,
        landline: inc.landline || prev.landline,
        invited: inc.invited || prev.invited,
        rsvp: inc.rsvp,
        attendingCount: inc.attendingCount,
        hasResponse: inc.hasResponse,
        rawStatus: inc.rawStatus,
      };
    } else if (inc.name || inc.phone) {
      const newIdx = result.length;
      result.push({ ...inc });
      for (const pk of pks) {
        if (pk && !indexByPhone.has(pk)) indexByPhone.set(pk, newIdx);
      }
      if (nk && !indexByName.has(nk)) indexByName.set(nk, newIdx);
      if (npk && !indexByNameNoParens.has(npk)) indexByNameNoParens.set(npk, newIdx);
    }
  }

  return result;
}

/**
 * מתאים בין רשימת המוזמנים במערכת לבין השורות מ-iPlan.
 *
 * סדר ההתאמה:
 * 1. התאמה ראשית לפי 9 ספרות אחרונות של הטלפון (`phoneKey`).
 * 2. התאמת גיבוי לפי שם מלא מנורמל (`normalizeGuestName`) כאשר באחת המערכות
 *    חסר מספר טלפון לרשומה (למשל ברשומות "חסר נייד" במערכת שלנו כמו "נריה ושילת בחור"),
 *    ובלבד שהשם ייחודי לחלוטין (מופיע פעם אחת בלבד אצלנו ופעם אחת בלבד ב-iPlan).
 */
export function reconcileIplan({
  guests = [],
  rows = [],
  includeUnansweredReset = false,
  iplanManagedRsvp = null,
} = {}) {
  const normalizedRows = (rows || []).map((r) => (Array.isArray(r) ? null : normalizeIplanRow(r))).filter(Boolean);

  // מיפוי מוזמנים שלנו לפי כל מפתחות הטלפון (phoneKeys) ולפי שם מנורמל
  const guestsByKey = new Map();
  const guestsByName = new Map();
  const guestsByNameNoParens = new Map();
  for (const g of guests || []) {
    if (!g) continue;
    for (const key of phoneKeys(g.phone)) {
      const list = guestsByKey.get(key);
      if (list) list.push(g);
      else guestsByKey.set(key, [g]);
    }
    const nameKey = normalizeGuestName(g.name);
    if (nameKey) {
      const nList = guestsByName.get(nameKey);
      if (nList) nList.push(g);
      else guestsByName.set(nameKey, [g]);
    }
    const noParensKey = normalizeGuestNameWithoutParens(g.name);
    if (noParensKey) {
      const npList = guestsByNameNoParens.get(noParensKey);
      if (npList) npList.push(g);
      else guestsByNameNoParens.set(noParensKey, [g]);
    }
  }

  // ספירת הופעות של כל phoneKey ושם ב-iPlan כדי לזהות כפילויות
  const iplanByKey = new Map();
  const iplanByName = new Map();
  const iplanByNameNoParens = new Map();
  for (const row of normalizedRows) {
    const key = phoneKey(row.phone) || phoneKey(row.landline);
    if (key) {
      const list = iplanByKey.get(key);
      if (list) list.push(row);
      else iplanByKey.set(key, [row]);
    }
    const nameKey = normalizeGuestName(row.name);
    if (nameKey) {
      const nList = iplanByName.get(nameKey);
      if (nList) nList.push(row);
      else iplanByName.set(nameKey, [row]);
    }
    const noParensKey = normalizeGuestNameWithoutParens(row.name);
    if (noParensKey) {
      const npList = iplanByNameNoParens.get(noParensKey);
      if (npList) npList.push(row);
      else iplanByNameNoParens.set(noParensKey, [row]);
    }
  }

  const updates = [];
  const unansweredLocals = [];
  const unmatched = [];
  const ambiguous = [];
  const handledAmbiguousKeys = new Set();
  const matchedGuestIds = new Set();
  let unchangedCount = 0;
  let matchedCount = 0;

  for (const row of normalizedRows) {
    const key = phoneKey(row.phone) || phoneKey(row.landline);
    const nameKey = normalizeGuestName(row.name);

    let guest = null;

    if (key) {
      const matchingGuests = guestsByKey.get(key) || [];
      const matchingIplanRows = iplanByKey.get(key) || [];

      if (matchingGuests.length > 1 || matchingIplanRows.length > 1) {
        if (!handledAmbiguousKeys.has(key)) {
          handledAmbiguousKeys.add(key);
          ambiguous.push({
            phoneKey: key,
            phone: row.phone || matchingGuests[0]?.phone || "",
            iplanRows: matchingIplanRows.map((r) => ({
              name: r.name,
              rsvp: r.rsvp,
              attendingCount: r.attendingCount,
            })),
            guests: matchingGuests.map((g) => ({
              id: g.id,
              name: g.name,
              phone: g.phone,
              rsvp: g.rsvp || "pending",
            })),
            reason: matchingGuests.length > 1 ? "duplicate_guest_phone" : "duplicate_iplan_phone",
          });
        }
        continue;
      }

      if (matchingGuests.length === 1) {
        guest = matchingGuests[0];
      }
    }

    // התאמת גיבוי לפי שם ייחודי מדויק כאשר לא נמצאה התאמה לפי טלפון
    if (!guest && nameKey) {
      const byNameGuests = (guestsByName.get(nameKey) || []).filter((g) => !matchedGuestIds.has(g.id));
      const byNameIplan = iplanByName.get(nameKey) || [];

      if (byNameGuests.length === 1 && byNameIplan.length === 1) {
        guest = byNameGuests[0];
      } else if (byNameGuests.length > 1 && (!key || byNameGuests.some((g) => !phoneKey(g.phone)))) {
        const ambKey = `name:${nameKey}`;
        if (!handledAmbiguousKeys.has(ambKey)) {
          handledAmbiguousKeys.add(ambKey);
          ambiguous.push({
            phoneKey: ambKey,
            phone: row.phone || "ללא נייד (שם כפול)",
            iplanRows: byNameIplan.map((r) => ({
              name: r.name,
              rsvp: r.rsvp,
              attendingCount: r.attendingCount,
            })),
            guests: byNameGuests.map((g) => ({
              id: g.id,
              name: g.name,
              phone: g.phone,
              rsvp: g.rsvp || "pending",
            })),
            reason: "duplicate_guest_name",
          });
        }
        continue;
      }

      if (!guest) {
        const noParensKey = normalizeGuestNameWithoutParens(row.name);
        if (noParensKey) {
          const npGuests = (guestsByNameNoParens.get(noParensKey) || []).filter(
            (g) => !matchedGuestIds.has(g.id)
          );
          const npIplan = iplanByNameNoParens.get(noParensKey) || [];
          if (
            npGuests.length === 1 &&
            npIplan.length === 1 &&
            (!phoneKey(npGuests[0].phone) || !key)
          ) {
            guest = npGuests[0];
          }
        }
      }
    }

    if (!guest) {
      unmatched.push({
        name: row.name || "ללא שם",
        phone: row.phone || "",
        rsvp: row.rsvp,
        attendingCount: row.attendingCount,
        hasResponse: row.hasResponse,
        reason: key ? "not_in_guest_list" : "missing_phone",
      });
      continue;
    }

    matchedGuestIds.add(guest.id);
    matchedCount++;

    const seats = Math.max(1, Number(guest.seats) || 1);
    const currentRsvp = guest.rsvp || "pending";
    const currentAttendingCount =
      currentRsvp === "confirmed"
        ? guest.attendingCount != null && Number(guest.attendingCount) > 0
          ? Math.min(Number(guest.attendingCount), seats)
          : seats
        : 0;

    const nextRsvp = row.rsvp;
    const nextAttendingCount =
      nextRsvp === "confirmed"
        ? Math.max(1, Math.min(seats, Number(row.attendingCount) || seats))
        : 0;

    const item = {
      guestId: guest.id,
      guestName: guest.name,
      iplanName: row.name,
      phone: guest.phone || row.phone,
      seats,
      fromRsvp: currentRsvp,
      fromAttendingCount: currentAttendingCount,
      toRsvp: nextRsvp,
      toAttendingCount: nextAttendingCount,
      iplanConfirmedCount: row.attendingCount,
      hasResponse: row.hasResponse,
      rawStatus: row.rawStatus,
    };

    if (!row.hasResponse) {
      if (currentRsvp === "pending") {
        unchangedCount++;
        continue;
      }
      // איפוס ב-iPlan: אם הסטטוס הנוכחי אצלנו הוא בדיוק הסטטוס שהגיע בעבר מ-iPlan (לפי יומן הפעילות),
      // והרשומה ב-iPlan אופסה ל"טרם השיבו" — מחזירים אותה ל"ממתין" כעדכון רגיל.
      // אם הסטטוס הוזן אצלנו ידנית (ולא הגיע מ-iPlan), הוא מוגן ולא יאופס ללא בקשה מפורשת.
      const managedRsvp =
        iplanManagedRsvp && typeof iplanManagedRsvp.get === "function"
          ? iplanManagedRsvp.get(Number(guest.id))
          : undefined;
      const cameFromIplan = managedRsvp != null && managedRsvp === currentRsvp;
      if (cameFromIplan || includeUnansweredReset) {
        updates.push({ ...item, isReset: true });
      } else {
        unansweredLocals.push(item);
      }
      continue;
    }

    const isSame =
      currentRsvp === nextRsvp &&
      (nextRsvp !== "confirmed" || currentAttendingCount === nextAttendingCount);

    if (isSame) {
      unchangedCount++;
    } else {
      updates.push(item);
    }
  }

  return {
    updates,
    unansweredLocals,
    unchangedCount,
    matchedCount,
    totalIplanRows: normalizedRows.length,
    unmatched,
    ambiguous,
  };
}

/**
 * מחיל את עדכוני אישור ההגעה שאושרו על ידי המשתמש על מערך המוזמנים.
 * שומר באופן מוחלט על כל שאר השדות של כל רשומה ללא שום שינוי.
 */
export function applyIplanUpdates(guests, approvedUpdates) {
  if (!Array.isArray(guests) || !Array.isArray(approvedUpdates) || approvedUpdates.length === 0) {
    return { nextGuests: guests || [], changes: [] };
  }

  const updateMap = new Map();
  for (const u of approvedUpdates) {
    if (!u || u.guestId == null) continue;
    if (!["pending", "maybe", "confirmed", "declined"].includes(u.toRsvp)) continue;
    updateMap.set(Number(u.guestId), u);
  }

  const changes = [];
  const nextGuests = guests.map((g) => {
    const u = updateMap.get(Number(g.id));
    if (!u) return g;

    const seats = Math.max(1, Number(g.seats) || 1);
    const currentRsvp = g.rsvp || "pending";
    const currentAttendingCount =
      currentRsvp === "confirmed"
        ? g.attendingCount != null && Number(g.attendingCount) > 0
          ? Math.min(Number(g.attendingCount), seats)
          : seats
        : 0;

    const toRsvp = u.toRsvp;
    const toAttendingCount =
      toRsvp === "confirmed"
        ? Math.max(1, Math.min(seats, Number(u.toAttendingCount) || seats))
        : 0;

    if (
      currentRsvp === toRsvp &&
      (toRsvp !== "confirmed" || currentAttendingCount === toAttendingCount)
    ) {
      return g;
    }

    changes.push({
      guestId: g.id,
      guestName: g.name,
      phone: g.phone || "",
      seats,
      fromRsvp: currentRsvp,
      fromAttendingCount: currentAttendingCount,
      toRsvp,
      toAttendingCount,
    });

    // עדכון אך ורק של rsvp ו-attendingCount — כל שאר השדות נשארים זהים!
    return {
      ...g,
      rsvp: toRsvp,
      attendingCount: toAttendingCount,
    };
  });

  return { nextGuests, changes };
}

/**
 * מפענח קובץ ייצוא של iPlan (תומך ב-.xls בינארי ישן מ-iPlan, .xlsx ו-.csv)
 * ומחזיר את השורות המנורמלות של iPlan.
 */
export async function readIplanBuffer(buffer, filename = "export.xls") {
  if (!buffer) throw new ImportError("לא התקבל קובץ לפענוח");
  const byteLength = buffer.byteLength ?? buffer.length ?? 0;
  if (byteLength > MAX_IMPORT_BYTES) {
    throw new ImportError("הקובץ גדול מדי (מעל 8MB).");
  }

  const bytes = new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) : buffer);
  const isOle2 =
    bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  const isZip =
    bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
  const lower = String(filename || "").toLowerCase();

  let matrix;
  if (isOle2 || isZip || lower.endsWith(".xls") || lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
    const mod = await import("xlsx");
    const XLSX = mod.default || mod;
    const wb = XLSX.read(bytes, { type: "array" });
    const sheetName =
      wb.SheetNames.find((n) => /הזמנות|מוזמנ|אורח|invit|guest/i.test(n)) ||
      wb.SheetNames[0];
    if (!sheetName || !wb.Sheets[sheetName]) {
      throw new ImportError("הקובץ ריק – לא נמצא גיליון הזמנות.");
    }
    matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      defval: "",
      raw: false,
    });
  } else {
    matrix = parseDelimited(decodeText(bytes));
  }

  if (matrix.length > MAX_IMPORT_ROWS) {
    throw new ImportError(`הקובץ מכיל ${matrix.length} שורות – מעל המקסימום (${MAX_IMPORT_ROWS}).`);
  }

  return parseIplanSheetRows(matrix);
}

/**
 * תיאור קריא בעברית של סטטוס אישור הגעה להצגה בפופ-אפ וביומן הפעילות.
 */
export function formatRsvpLabel(rsvp, attendingCount, seats = 1) {
  if (rsvp === "confirmed") {
    const count = attendingCount != null && Number(attendingCount) > 0 ? Number(attendingCount) : seats || 1;
    return `אישרו הגעה (${count})`;
  }
  if (rsvp === "declined") {
    return "לא מגיעים";
  }
  if (rsvp === "maybe") {
    return "מתלבטים";
  }
  return "ממתין";
}
