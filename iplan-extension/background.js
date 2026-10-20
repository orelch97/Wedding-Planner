import * as XLSX from "./vendor/xlsx.mjs";
import { DEFAULT_CONFIG } from "./config.js";

const ALARM_NAME = "iplan-periodic-sync";
const SYNC_COOLDOWN_MS = 20_000;
let lastSyncStartedAt = 0;

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

function normalizePhone(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (!/^\d+$/.test(s)) return s;
  if (s.startsWith("0")) return s;
  if (/^[57]\d{8}$/.test(s)) return "0" + s;
  if (/^[23489]\d{7}$/.test(s)) return "0" + s;
  return s;
}

function parseStatusFromCells({ confirmedRaw, consideringRaw, declinedRaw, invited }) {
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

function parseExportBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  // וידוא שמדובר בקובץ XLS בינארי של iPlan ולא בדף HTML של התחברות
  const isOle2 =
    bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  const isZip =
    bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
  if (!isOle2 && !isZip) {
    throw new Error("לא מחוברים ל-iPlan בדפדפן זה (נדרשת כניסה ל-app.iplan.co.il).");
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

  // בייצוא של iPlan שורה 0 היא כותרות-על ושורה 1 היא כותרות העמודות
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

async function performSync({ force = false, source = "auto" } = {}) {
  const now = Date.now();
  if (!force && now - lastSyncStartedAt < SYNC_COOLDOWN_MS) {
    const cached = await chrome.storage.local.get("lastSyncState");
    return cached.lastSyncState || { ok: true, skipped: true };
  }
  lastSyncStartedAt = now;

  const config = await getConfig();
  const exportUrl = `https://app.iplan.co.il/he-IL/client/events/${encodeURIComponent(
    config.eventId || "284821"
  )}/invitations/export.xls`;

  try {
    const response = await fetch(exportUrl, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });

    if (!response.ok || response.url.includes("sign_in")) {
      throw new Error("נדרשת התחברות פעילה ל-iPlan בדפדפן.");
    }

    const buffer = await response.arrayBuffer();
    const rows = parseExportBuffer(buffer);
    const syncedAt = new Date().toISOString();

    let cloudResult = { uploaded: false };
    if (config.endpointUrl && config.weddingId && config.token) {
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
      cloudResult = { uploaded: true, rowCount: cloudJson.rowCount };
    }

    const state = {
      ok: true,
      rowCount: rows.length,
      syncedAt,
      uploadedToCloud: cloudResult.uploaded,
      error: null,
    };

    await chrome.storage.local.set({
      lastSyncState: state,
      lastSyncedRows: rows,
    });

    return { ...state, rows };
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

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 30 });
});

chrome.runtime.onStartup.addListener(async () => {
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
      const stored = await chrome.storage.local.get(["lastSyncState", "lastSyncedRows"]);
      sendResponse({
        ok: true,
        config,
        lastSyncState: stored.lastSyncState || null,
        rows: stored.lastSyncedRows || [],
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

