import * as XLSX from "./vendor/xlsx.mjs";
import { DEFAULT_CONFIG } from "./config.js";

const ALARM_NAME = "iplan-periodic-sync";

async function getConfig() {
  let localFileConfig = {};
  try {
    const mod = await import("./local-config.js");
    if (mod && mod.LOCAL_CONFIG) localFileConfig = mod.LOCAL_CONFIG;
  } catch {
    // local-config.js הוא אופציונלי
  }
  const stored = await chrome.storage.local.get("iplanConfig");
  return {
    ...DEFAULT_CONFIG,
    ...localFileConfig,
    ...(stored.iplanConfig || {}),
  };
}

async function getInitialBaselineRows() {
  try {
    const mod = await import("./initial-rows.js");
    if (mod && Array.isArray(mod.INITIAL_ROWS)) {
      return mod.INITIAL_ROWS;
    }
  } catch {
    // initial-rows.js הוא אופציונלי
  }
  return [];
}

function phoneKey(value) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00972") && digits.length >= 12) digits = digits.slice(5);
  else if (digits.startsWith("972") && digits.length >= 10) digits = digits.slice(3);
  while (digits.startsWith("0") && digits.length >= 9) digits = digits.slice(1);
  if (digits.length > 9) digits = digits.slice(-9);
  if (digits.length < 8) return "";
  return digits;
}

function normalizeName(name) {
  return String(name ?? "")
    .trim()
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/["'״׳`\-–—.,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizePhone(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (!/^\d+$/.test(s)) return s;
  if (s.startsWith("0")) return s;
  if (/^[57]\d{8}$/.test(s)) return "0" + s;
  if (/^[23489]\d{7}$/.test(s)) return "0" + s;
  return s;
}

function parseStatusFromCells({ confirmedRaw, consideringRaw, declinedRaw }) {
  const confText = String(confirmedRaw ?? "").trim();
  const consText = String(consideringRaw ?? "").trim();
  const declText = String(declinedRaw ?? "").trim();

  if (confText !== "") {
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
  }

  if (declText !== "") {
    const num = Number(declText.replace(/[,\s]/g, ""));
    if ((Number.isFinite(num) && num > 0) || /^(כן|לא יגיעו|לא מגיעים|v|✓)$/i.test(declText)) {
      return { rsvp: "declined", attendingCount: 0, hasResponse: true, rawStatus: "declined" };
    }
  }

  if (consText !== "") {
    const num = Number(consText.replace(/[,\s]/g, ""));
    if ((Number.isFinite(num) && num > 0) || /^(כן|מתלבט|מתלבטים|אולי|v|✓)$/i.test(consText)) {
      return { rsvp: "pending", attendingCount: 0, hasResponse: true, rawStatus: "considering" };
    }
  }

  return { rsvp: "pending", attendingCount: 0, hasResponse: false, rawStatus: "unanswered" };
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseExportBytes(bytes) {
  const isOle2 =
    bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  const isZip =
    bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
  if (!isOle2 && !isZip) {
    return [];
  }

  const wb = XLSX.read(bytes, { type: "array" });
  const sheetName =
    wb.SheetNames.find((n) => /הזמנות|מוזמנ|אורח|invit/i.test(n)) || wb.SheetNames[0];
  const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: false,
  });

  const nonEmpty = matrix.filter(
    (r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() !== "")
  );

  let headerRowIdx = 1;
  for (let i = 0; i < Math.min(5, nonEmpty.length); i++) {
    const joined = nonEmpty[i].join(" ");
    if (joined.includes("הזמנה לכבוד") || joined.includes("סלולרי")) {
      headerRowIdx = i;
      break;
    }
  }

  const headers = (nonEmpty[headerRowIdx] || []).map((h) => String(h ?? "").trim());
  const colOf = (pred) => headers.findIndex((h) => pred(h));

  const nameCol = colOf((h) => h.includes("הזמנה לכבוד") || h === "שם");
  const invitedCol = colOf((h) => h.includes("אורחים שהוזמנו") || h.includes("מוזמנים"));
  const phoneCol = colOf((h) => h.includes("סלולרי") || h.includes("נייד"));
  const landlineCol = colOf((h) => h.includes("טלפון רגיל"));
  const confirmedCol = colOf((h) => h.includes("אישרו שיגיעו") || h.includes("אישרו"));
  const consideringCol = colOf((h) => h.includes("מתלבטים"));
  const declinedCol = colOf((h) => h.includes("לא יגיעו") || h.includes("לא מגיעים"));

  const get = (row, col) => (col >= 0 ? String(row[col] ?? "").trim() : "");
  const rows = [];

  for (let i = headerRowIdx + 1; i < nonEmpty.length; i++) {
    const r = nonEmpty[i];
    const name = get(r, nameCol);
    const phone = normalizePhone(get(r, phoneCol));
    const landline = normalizePhone(get(r, landlineCol));
    if (!name && !phone && !landline) continue;

    const invitedNum = Number(get(r, invitedCol).replace(/[,\s]/g, ""));
    const invited = Number.isFinite(invitedNum) && invitedNum > 0 ? Math.round(invitedNum) : 1;

    const status = parseStatusFromCells({
      confirmedRaw: get(r, confirmedCol),
      consideringRaw: get(r, consideringCol),
      declinedRaw: get(r, declinedCol),
      invited,
    });

    rows.push({
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

  return rows;
}

/**
 * ממזג שורות חדשות (מייצוא חלקי או מטבלת ה-DOM) אל תוך מערך כל ההזמנות,
 * כך שגם כאשר המשתמש מסנן ב-iPlan לפי שם בודד (למשל "נריה"), הרשומה מתעדכנת
 * בתוך תמונת המצב המלאה (538 הזמנות) בלי לאבד את שאר ההזמנות.
 */
function mergeRows(baseRows = [], overlayRows = []) {
  if (!overlayRows || overlayRows.length === 0) return baseRows;
  if (!baseRows || baseRows.length === 0) return overlayRows;

  const result = baseRows.map((r) => ({ ...r }));
  const indexByPhone = new Map();
  const indexByName = new Map();

  result.forEach((r, idx) => {
    const pk = phoneKey(r.phone) || phoneKey(r.landline);
    if (pk && !indexByPhone.has(pk)) indexByPhone.set(pk, idx);
    const nk = normalizeName(r.name);
    if (nk && !indexByName.has(nk)) indexByName.set(nk, idx);
  });

  for (const inc of overlayRows) {
    if (!inc) continue;
    const pk = phoneKey(inc.phone) || phoneKey(inc.landline);
    const nk = normalizeName(inc.name);

    let targetIdx = pk && indexByPhone.has(pk) ? indexByPhone.get(pk) : undefined;
    if (targetIdx === undefined && nk && indexByName.has(nk)) {
      targetIdx = indexByName.get(nk);
    }

    if (targetIdx !== undefined) {
      const prev = result[targetIdx];
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
      if (pk) indexByPhone.set(pk, newIdx);
      if (nk) indexByName.set(nk, newIdx);
    }
  }

  return result;
}

async function ensureSeededRows() {
  const stored = await chrome.storage.local.get("lastSyncedRows");
  let current = Array.isArray(stored.lastSyncedRows) ? stored.lastSyncedRows : [];
  const baseline = await getInitialBaselineRows();
  if (baseline.length > 0 && current.length < baseline.length) {
    current = mergeRows(baseline, current);
    await chrome.storage.local.set({ lastSyncedRows: current });
  }
  return current;
}

async function uploadRowsToCloud(rows, source = "extension") {
  const config = await getConfig();
  if (!config.endpointUrl || !config.weddingId || !config.token || !rows.length) {
    return { uploaded: false };
  }

  const cloudRes = await fetch(config.endpointUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      env: config.env || "prod",
      weddingId: config.weddingId,
      token: config.token,
      eventId: config.eventId || "284821",
      source,
      rows,
    }),
  });
  const cloudJson = await cloudRes.json().catch(() => ({}));
  if (!cloudRes.ok || !cloudJson.ok) {
    throw new Error(cloudJson.error || `שגיאת שרת (${cloudRes.status})`);
  }
  return { uploaded: true, rowCount: cloudJson.rowCount };
}

async function ingestFromPage({ exportBase64, domRows = [], filterActive = false, source = "iplan-visit" }) {
  try {
    let currentRows = await ensureSeededRows();
    let exportRows = [];

    if (exportBase64) {
      const bytes = base64ToUint8Array(exportBase64);
      exportRows = parseExportBytes(bytes);
    }

    if (exportRows.length === 0 && (!domRows || domRows.length === 0)) {
      if (currentRows.length > 0) {
        return {
          ok: true,
          rowCount: currentRows.length,
          exportedCount: 0,
          syncedAt: new Date().toISOString(),
          rows: currentRows,
        };
      }
      throw new Error("לא נמצאו רשומות בדף iPlan.");
    }

    // אם הייצוא הוא מלא (>= 500 הזמנות וללא סינון), הוא הופך לבסיס החדש; אחרת ממזגים לתוך הבסיס הקיים
    let merged = currentRows;
    if (exportRows.length >= 450 && !filterActive) {
      merged = mergeRows(exportRows, domRows);
    } else {
      merged = mergeRows(merged, exportRows);
      merged = mergeRows(merged, domRows);
    }

    const syncedAt = new Date().toISOString();
    let uploaded = false;
    try {
      const cloudRes = await uploadRowsToCloud(merged, source);
      uploaded = cloudRes.uploaded;
    } catch (cloudErr) {
      console.warn("Cloud upload warning:", cloudErr);
    }

    const state = {
      ok: true,
      rowCount: merged.length,
      exportedCount: exportRows.length || domRows.length,
      syncedAt,
      uploadedToCloud: uploaded,
      error: null,
    };

    await chrome.storage.local.set({
      lastSyncState: state,
      lastSyncedRows: merged,
    });

    return { ...state, rows: merged };
  } catch (err) {
    const state = {
      ok: false,
      error: err?.message || "הסנכרון מ-iPlan נכשל",
      syncedAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({ lastSyncState: state });
    return state;
  }
}

async function performSync({ force = false, source = "auto" } = {}) {
  // 1. ניסיון ראשון: אם פתוחה לשונית של iPlan בדפדפן, נבקש ממנה לאסוף ב-Same-Origin
  try {
    const tabs = await chrome.tabs.query({
      url: ["https://app.iplan.co.il/*", "https://iplan.co.il/*"],
    });
    for (const tab of tabs) {
      if (!tab.id || (tab.url && tab.url.includes("sign_in"))) continue;
      try {
        const pageRes = await chrome.tabs.sendMessage(tab.id, { type: "IPLAN_PAGE_COLLECT" });
        if (pageRes && pageRes.ok && (pageRes.exportBase64 || (pageRes.domRows && pageRes.domRows.length > 0))) {
          return await ingestFromPage({
            exportBase64: pageRes.exportBase64,
            domRows: pageRes.domRows,
            filterActive: pageRes.filterActive,
            source,
          });
        }
      } catch {
        // אם ה-content script טרם הוזרק ללשונית הפתוחה, נזריק אותו כעת
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content-iplan.js"],
          });
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore tabs query errors
  }

  // 2. גיבוי: שימוש בנתונים השמורים והמוזרעים בתוסף
  const rows = await ensureSeededRows();
  if (rows.length > 0) {
    const syncedAt = new Date().toISOString();
    let uploaded = false;
    if (force) {
      try {
        const res = await uploadRowsToCloud(rows, source);
        uploaded = res.uploaded;
      } catch {
        // ignore
      }
    }
    const state = {
      ok: true,
      rowCount: rows.length,
      syncedAt,
      uploadedToCloud: uploaded,
      error: null,
    };
    await chrome.storage.local.set({ lastSyncState: state, lastSyncedRows: rows });
    return { ...state, rows };
  }

  return {
    ok: false,
    error: "פתחו את לשונית iPlan בדפדפן כדי לסנכרן.",
    syncedAt: new Date().toISOString(),
  };
}

async function injectIntoExistingTabs() {
  try {
    const iplanTabs = await chrome.tabs.query({
      url: ["https://app.iplan.co.il/*", "https://iplan.co.il/*"],
    });
    for (const tab of iplanTabs) {
      if (tab.id) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content-iplan.js"],
        }).catch(() => {});
      }
    }

    const plannerTabs = await chrome.tabs.query({
      url: [
        "http://localhost/*",
        "http://127.0.0.1/*",
        "https://*.onrender.com/*",
        "https://*.web.app/*",
      ],
    });
    for (const tab of plannerTabs) {
      if (tab.id) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content-planner.js"],
        }).catch(() => {});
      }
    }
  } catch {
    // ignore
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureSeededRows();
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 30 });
  await injectIntoExistingTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureSeededRows();
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 30 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await performSync({ force: true, source: "alarm" });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (!message || typeof message !== "object") {
      sendResponse({ ok: false });
      return;
    }

    if (message.type === "IPLAN_INGEST_FROM_PAGE") {
      const result = await ingestFromPage({
        exportBase64: message.exportBase64,
        domRows: message.domRows || [],
        filterActive: Boolean(message.filterActive),
        source: message.source || "iplan-visit",
      });
      sendResponse(result);
      return;
    }

    if (message.type === "IPLAN_TRIGGER_SYNC") {
      const result = await performSync({
        force: Boolean(message.force),
        source: message.source || "visit",
      });
      sendResponse(result);
      return;
    }

    if (message.type === "IPLAN_GET_STATUS") {
      const config = await getConfig();
      const rows = await ensureSeededRows();
      const stored = await chrome.storage.local.get("lastSyncState");
      sendResponse({
        ok: true,
        config,
        lastSyncState: stored.lastSyncState || {
          ok: rows.length > 0,
          rowCount: rows.length,
          syncedAt: new Date().toISOString(),
        },
        rows,
      });
      return;
    }

    if (message.type === "IPLAN_SAVE_CONFIG") {
      const current = await getConfig();
      const next = { ...current, ...(message.config || {}) };
      await chrome.storage.local.set({ iplanConfig: next });
      sendResponse({ ok: true, config: next });
      return;
    }

    sendResponse({ ok: false });
  })();
  return true;
});
