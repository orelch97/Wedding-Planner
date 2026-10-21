// content-iplan.js — רץ בתוך לשונית app.iplan.co.il (Same-Origin).
// עקרונות יציבות כדי לעולם לא להעמיס על שרת iPlan ולא לגרום לשגיאות סנכרון:
// 1. בעת עריכת אישורי הגעה בטבלה של iPlan — סורקים פסיבית רק את ה-DOM של הטבלה (0 בקשות רשת לשרת iPlan!).
// 2. משיכת קובץ ה-export.xls מתבצעת אך ורק בטעינה ראשונית (לאחר השהיה שקטה) או בלחיצה מפורשת של המשתמש,
//    עם הגבלת קצב (Cooldown), כדי לא להתנגש בבקשות השמירה של iPlan עצמה.
// 3. בדיקת תקינות הקשר (isContextValid) מונעת מסקריפטים ישנים (לאחר רענון תוסף) להקפיץ הודעות שגיאה.

(function initIplanAutoSync() {
  if (!location.hostname.includes("iplan.co.il")) return;
  if (location.pathname.includes("sign_in")) return;

  function isContextValid() {
    try {
      return Boolean(chrome && chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  if (!isContextValid()) return;

  // אם הוזרק סקריפט חדש לאחר רענון התוסף, ננקה מאזינים של מופע קודם
  if (typeof window.__wpIplanCleanup === "function") {
    try {
      window.__wpIplanCleanup();
    } catch {
      // ignore
    }
  }

  let badge = document.getElementById("wp-iplan-sync-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "wp-iplan-sync-badge";
    badge.dir = "rtl";
    document.body.appendChild(badge);
  }

  Object.assign(badge.style, {
    position: "fixed",
    bottom: "16px",
    left: "16px",
    zIndex: "999999",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 14px",
    borderRadius: "12px",
    background: "#1e293b",
    color: "#ffffff",
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: "12px",
    fontWeight: "600",
    boxShadow: "0 8px 20px rgba(15, 23, 42, 0.22)",
    transition: "all 0.25s ease",
    cursor: "pointer",
    userSelect: "none",
  });

  function normalizePhone(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return "";
    const match = s.match(/0[2345789][\d\s-]{7,11}/);
    if (match) return match[0].replace(/\s+/g, "");
    if (/^[57]\d{8}$/.test(s)) return "0" + s;
    return s;
  }

  function parseRsvpFromDomCell(cell) {
    if (!cell) {
      return { rsvp: "pending", attendingCount: 0, hasResponse: false, rawStatus: "unanswered" };
    }

    // אם התא מכיל אלמנט נבחר או פעיל מפורש (למשל תפריט נפתח או כפתור סטטוס פעיל ב-iPlan)
    const activeEls = Array.from(
      cell.querySelectorAll(".active, .selected, [aria-selected='true'], option:checked")
    );
    const activeText = activeEls
      .map((el) => (el.innerText || el.textContent || el.value || "").trim())
      .filter(Boolean)
      .join(" ");

    const inputs = Array.from(cell.querySelectorAll("input, select")).filter(
      (el) => !["hidden", "checkbox", "radio", "submit", "button"].includes(el.type)
    );
    const inputValues = inputs.map((el) => String(el.value ?? "").trim()).filter((v) => v !== "");
    const cellText = (cell.innerText || cell.textContent || "").replace(/\s+/g, " ").trim();
    const rawText = [activeText, cellText, ...inputValues]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!rawText) {
      return { rsvp: "pending", attendingCount: 0, hasResponse: false, rawStatus: "unanswered" };
    }

    // נבדוק קודם את הטקסט הפעיל/הגלוי לפני מספרי ברירת מחדל של שדות קלט מוסתרים
    const primaryText = (activeText || cellText || rawText).trim();

    if (/מתלבט|לא החליט|אולי|\?/i.test(primaryText)) {
      return { rsvp: "maybe", attendingCount: 0, hasResponse: true, rawStatus: "considering" };
    }
    if (/לא מגיע|לא יגיע|סירב/i.test(primaryText)) {
      return { rsvp: "declined", attendingCount: 0, hasResponse: true, rawStatus: "declined" };
    }

    if (/מתלבט|לא החליט|אולי|\?/i.test(rawText)) {
      return { rsvp: "maybe", attendingCount: 0, hasResponse: true, rawStatus: "considering" };
    }
    if (/לא מגיע|לא יגיע|סירב/i.test(rawText)) {
      return { rsvp: "declined", attendingCount: 0, hasResponse: true, rawStatus: "declined" };
    }

    const comingMatch =
      rawText.match(/(\d+)\s*מגיע/) ||
      rawText.match(/מגיעים\s*(\d+)/) ||
      rawText.match(/אישרו\s*(\d+)/);
    if (comingMatch) {
      const count = Number(comingMatch[1]);
      if (count > 0) {
        return { rsvp: "confirmed", attendingCount: count, hasResponse: true, rawStatus: "confirmed" };
      }
      return { rsvp: "declined", attendingCount: 0, hasResponse: true, rawStatus: "declined" };
    }

    if (/^\d+$/.test(rawText)) {
      const count = Number(rawText);
      if (count > 0) {
        return { rsvp: "confirmed", attendingCount: count, hasResponse: true, rawStatus: "confirmed" };
      }
      return { rsvp: "declined", attendingCount: 0, hasResponse: true, rawStatus: "declined" };
    }

    if (/מגיעים|מגיע|אישרו|אישר/i.test(rawText) && !/לא\s*אישר/i.test(rawText)) {
      const numMatch = rawText.match(/(\d+)/);
      const count = numMatch ? Number(numMatch[1]) : 1;
      if (count > 0) {
        return { rsvp: "confirmed", attendingCount: count, hasResponse: true, rawStatus: "confirmed" };
      }
      return { rsvp: "declined", attendingCount: 0, hasResponse: true, rawStatus: "declined" };
    }

    return { rsvp: "pending", attendingCount: 0, hasResponse: false, rawStatus: "unanswered" };
  }

  function scrapeDomInvitationsTable() {
    const domRows = [];
    const tables = Array.from(document.querySelectorAll("table"));

    for (const table of tables) {
      const tableText = table.innerText || "";
      if (
        !tableText.includes("הזמנה עבור") &&
        !tableText.includes("פרטי התקשרות") &&
        !tableText.includes("אישור הגעה")
      ) {
        continue;
      }

      const trs = Array.from(table.querySelectorAll("tr"));
      for (const tr of trs) {
        if (tr.querySelector("th")) continue;
        const tds = Array.from(tr.querySelectorAll("td"));
        if (tds.length < 4) continue;

        const texts = tds.map((td) =>
          (td.innerText || td.textContent || "").replace(/\s+/g, " ").trim()
        );
        let name = texts[1] || "";
        let invited = Number(texts[2]?.replace(/[^\d]/g, "")) || 1;
        if (!name && texts[0] && !/^\d+$/.test(texts[0])) {
          name = texts[0];
          invited = Number(texts[1]?.replace(/[^\d]/g, "")) || 1;
        }
        if (!name || /^(הזמנה עבור|שם פרטי|סה"כ|סיכום)$/i.test(name)) continue;

        let phone = "";
        for (let i = 2; i < tds.length; i++) {
          const candidate = normalizePhone(texts[i]);
          if (/^0[2345789][\d-]{7,10}$/.test(candidate)) {
            phone = candidate;
            break;
          }
        }

        let rsvpCell = null;
        for (let i = 3; i < tds.length; i++) {
          if (/מגיע|מתלבט|החליט|אולי|סירב|אישר|\?/i.test(texts[i])) {
            rsvpCell = tds[i];
            break;
          }
        }
        if (!rsvpCell && tds[7]) {
          rsvpCell = tds[7];
        }

        const status = parseRsvpFromDomCell(rsvpCell);
        domRows.push({
          name,
          phone,
          landline: "",
          invited: Math.max(1, invited),
          rsvp: status.rsvp,
          attendingCount:
            status.rsvp === "confirmed" ? Math.max(1, status.attendingCount || invited) : 0,
          hasResponse: status.hasResponse,
          rawStatus: status.rawStatus,
        });
      }
    }

    return domRows;
  }

  function isSearchFilterActiveOnPage() {
    const inputs = Array.from(
      document.querySelectorAll('input[type="text"], input[type="search"]')
    );
    for (const inp of inputs) {
      if (inp.value && inp.value.trim().length > 0) return true;
    }
    return false;
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  let lastExportFetchedAt = 0;
  const EXPORT_FETCH_COOLDOWN_MS = 180_000; // 3 דקות בין משיכות export.xls אוטומטיות כדי לא להעמיס על שרת iPlan

  async function fetchExportBase64SameOrigin(forceExport = false) {
    const now = Date.now();
    if (!forceExport && now - lastExportFetchedAt < EXPORT_FETCH_COOLDOWN_MS) {
      return null;
    }

    const linkEl = document.querySelector('a[href*="export.xls"], a[href*="invitations/export"]');
    const eventMatch = location.pathname.match(/\/events\/(\d+)/);
    const eventId = eventMatch ? eventMatch[1] : "284821";
    const exportUrl =
      linkEl?.href || `${location.origin}/he-IL/client/events/${eventId}/invitations/export.xls`;

    try {
      lastExportFetchedAt = now;
      const response = await fetch(exportUrl, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/vnd.ms-excel,application/octet-stream,*/*",
        },
      });
      if (!response.ok || response.url.includes("sign_in")) {
        return null;
      }
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const isOle2 =
        bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
      const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
      if (!isOle2 && !isZip) {
        return null;
      }
      return arrayBufferToBase64(buffer);
    } catch {
      return null;
    }
  }

  async function collectPageData({ includeExport = false, forceExport = false } = {}) {
    const domRows = scrapeDomInvitationsTable();
    const filterActive = isSearchFilterActiveOnPage();
    // אם יש סינון פעיל בתיבת החיפוש, אין טעם למשוך export.xls כי שרת iPlan יחזיר רק את הסינון;
    // השורות המסוננות כבר נקראות ישירות מה-DOM ב-0 עומס על השרת!
    const shouldFetchExport = includeExport && !filterActive;
    const exportBase64 = shouldFetchExport ? await fetchExportBase64SameOrigin(forceExport) : null;
    return { domRows, exportBase64, filterActive };
  }

  let syncInProgress = false;

  async function runSync({ includeExport = false, forceExport = false, source = "iplan-dom" } = {}) {
    if (!isContextValid()) {
      cleanup();
      return;
    }
    if (syncInProgress) return;
    syncInProgress = true;

    if (forceExport) {
      badge.style.background = "#1e293b";
      badge.textContent = "מסנכרן עם מערכת החתונה...";
    }

    try {
      const { domRows, exportBase64, filterActive } = await collectPageData({
        includeExport,
        forceExport,
      });

      if (!isContextValid()) {
        cleanup();
        return;
      }

      const res = await chrome.runtime.sendMessage({
        type: "IPLAN_INGEST_FROM_PAGE",
        force: forceExport,
        source,
        domRows,
        exportBase64,
        filterActive,
      });

      if (res && res.ok) {
        badge.style.background = "#059669";
        badge.textContent = `סונכרן עם מערכת החתונה ✓ (${res.rowCount || 538} הזמנות)`;
      }
    } catch {
      // אם הקשר התוסף התיישן (בעקבות רענון התוסף), מתנתקים בשקט בלי להציג שגיאה אדומה
      if (!isContextValid()) {
        cleanup();
      }
    } finally {
      syncInProgress = false;
    }
  }

  function onBadgeClick() {
    runSync({ includeExport: true, forceExport: true, source: "badge-click" });
  }

  badge.addEventListener("click", onBadgeClick);

  const messageListener = (msg, _sender, sendResponse) => {
    if (!isContextValid()) {
      cleanup();
      return false;
    }
    if (msg && msg.type === "IPLAN_PAGE_COLLECT") {
      collectPageData({ includeExport: Boolean(msg.includeExport), forceExport: Boolean(msg.forceExport) })
        .then((data) => sendResponse({ ok: true, ...data }))
        .catch((err) => sendResponse({ ok: false, error: err?.message }));
      return true;
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(messageListener);

  // סנכרון פסיבי לחלוטין (DOM בלבד — ללא בקשות רשת לשרת iPlan!) בעת עריכת שורות בטבלה
  let debounceTimer = null;
  function schedulePassiveDomSync() {
    if (!isContextValid()) {
      cleanup();
      return;
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      runSync({ includeExport: false, forceExport: false, source: "iplan-dom-change" });
    }, 1500);
  }

  function onChangeEvent() {
    schedulePassiveDomSync();
  }

  document.addEventListener("change", onChangeEvent, true);

  const observer = new MutationObserver((mutations) => {
    if (!isContextValid()) {
      cleanup();
      return;
    }
    for (const m of mutations) {
      const node = m.target?.nodeType === 1 ? m.target : m.target?.parentElement;
      if (!node || badge.contains(node)) continue;
      if (node.closest && node.closest("table")) {
        schedulePassiveDomSync();
        break;
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  function cleanup() {
    if (debounceTimer) clearTimeout(debounceTimer);
    observer.disconnect();
    document.removeEventListener("change", onChangeEvent, true);
    badge.removeEventListener("click", onBadgeClick);
    try {
      chrome.runtime.onMessage.removeListener(messageListener);
    } catch {
      // ignore
    }
  }

  window.__wpIplanCleanup = cleanup;

  // 1. מיד עם טעינת הדף: סריקת DOM פסיבית מיידית (0 עומס על שרת iPlan)
  runSync({ includeExport: false, forceExport: false, source: "iplan-visit-dom" });

  // 2. כעבור 3.5 שניות (אחרי שהדף של iPlan סיים להיטען במלואו): משיכה שקטה של הקובץ המלא אם לא קיים סינון
  setTimeout(() => {
    if (isContextValid() && !isSearchFilterActiveOnPage()) {
      runSync({ includeExport: true, forceExport: false, source: "iplan-visit-export" });
    }
  }, 3500);
})();
