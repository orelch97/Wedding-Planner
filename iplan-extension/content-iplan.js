// content-iplan.js — רץ אוטומטית בתוך לשונית app.iplan.co.il (Same-Origin).
// 1. מושך את קובץ הייצוא (export.xls) ישירות מתוך ההקשר של הדף (כך שעוגיות SameSite=Lax נשלחות תמיד).
// 2. סורק במקביל גם את טבלת ה-DOM החיה על המסך (כך שכל שינוי או סינון נקלט מיד).
// 3. מאזין לשינויים בטבלה (MutationObserver / change) ומסנכרן אוטומטית כל עדכון אישור הגעה.

(function initIplanAutoSync() {
  if (!location.hostname.includes("iplan.co.il")) return;
  if (location.pathname.includes("sign_in")) return;

  // מניעת טעינה כפולה בעת הזרקה חוזרת
  if (window.__wpIplanContentScriptLoaded) {
    if (typeof window.__wpIplanTriggerSync === "function") {
      window.__wpIplanTriggerSync(true);
    }
    return;
  }
  window.__wpIplanContentScriptLoaded = true;

  let badge = document.getElementById("wp-iplan-sync-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "wp-iplan-sync-badge";
    badge.dir = "rtl";
    Object.assign(badge.style, {
      position: "fixed",
      bottom: "20px",
      left: "20px",
      zIndex: "999999",
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "10px 16px",
      borderRadius: "14px",
      background: "#1e293b",
      color: "#ffffff",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: "13px",
      fontWeight: "600",
      boxShadow: "0 10px 25px rgba(15, 23, 42, 0.25)",
      transition: "all 0.25s ease",
      cursor: "pointer",
    });
    document.body.appendChild(badge);
  }

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

    // בדיקת שדות קלט/בחירה אם השורה במצב עריכה
    const input = cell.querySelector('input[type="number"], input[type="text"], select');
    const rawText = [
      cell.innerText || cell.textContent || "",
      input ? input.value : "",
    ]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!rawText) {
      return { rsvp: "pending", attendingCount: 0, hasResponse: false, rawStatus: "unanswered" };
    }

    if (/לא מגיע|לא יגיע|סירב/i.test(rawText)) {
      return { rsvp: "declined", attendingCount: 0, hasResponse: true, rawStatus: "declined" };
    }
    if (/מתלבט|לא החליט|אולי/i.test(rawText)) {
      return { rsvp: "pending", attendingCount: 0, hasResponse: true, rawStatus: "considering" };
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
      if (!tableText.includes("הזמנה עבור") && !tableText.includes("פרטי התקשרות") && !tableText.includes("אישור הגעה")) {
        continue;
      }

      const trs = Array.from(table.querySelectorAll("tr"));
      for (const tr of trs) {
        if (tr.querySelector("th")) continue;
        const tds = Array.from(tr.querySelectorAll("td"));
        if (tds.length < 4) continue;

        const texts = tds.map((td) => (td.innerText || td.textContent || "").replace(/\s+/g, " ").trim());
        // ב-iPlan: td[0] הוא תיבת סימון, td[1] הוא שם ההזמנה ("הזמנה עבור"), td[2] הוא מספר המוזמנים
        let name = texts[1] || "";
        let invited = Number(texts[2]?.replace(/[^\d]/g, "")) || 1;
        if (!name && texts[0] && !/^\d+$/.test(texts[0])) {
          name = texts[0];
          invited = Number(texts[1]?.replace(/[^\d]/g, "")) || 1;
        }
        if (!name || /^(הזמנה עבור|שם פרטי|סה"כ|סיכום)$/i.test(name)) continue;

        // חיפוש תא הטלפון ותא אישור ההגעה בשורה
        let phone = "";
        for (let i = 2; i < tds.length; i++) {
          const candidate = normalizePhone(texts[i]);
          if (/^0[2345789][\d-]{7,10}$/.test(candidate)) {
            phone = candidate;
            break;
          }
        }

        // תא אישור ההגעה נמצא לרוב באינדקס 7 (או התא שמכיל "מגיעים"/"מתלבטים"/"לא מגיעים")
        let rsvpCell = null;
        for (let i = 3; i < tds.length; i++) {
          if (/מגיע|מתלבט|סירב|אישר/i.test(texts[i])) {
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
          attendingCount: status.rsvp === "confirmed" ? Math.max(1, status.attendingCount || invited) : 0,
          hasResponse: status.hasResponse,
          rawStatus: status.rawStatus,
        });
      }
    }

    return domRows;
  }

  function isSearchFilterActiveOnPage() {
    const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"]'));
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

  async function fetchExportBase64SameOrigin() {
    // 1. מציאת קישור הייצוא המדויק מהדף (או ברירת המחדל של האירוע)
    const linkEl = document.querySelector('a[href*="export.xls"], a[href*="invitations/export"]');
    const eventMatch = location.pathname.match(/\/events\/(\d+)/);
    const eventId = eventMatch ? eventMatch[1] : "284821";
    const exportUrl = linkEl?.href || `${location.origin}/he-IL/client/events/${eventId}/invitations/export.xls`;

    try {
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
      const isOle2 = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
      const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
      if (!isOle2 && !isZip) {
        return null;
      }
      return arrayBufferToBase64(buffer);
    } catch {
      return null;
    }
  }

  async function collectPageData() {
    const domRows = scrapeDomInvitationsTable();
    const exportBase64 = await fetchExportBase64SameOrigin();
    const filterActive = isSearchFilterActiveOnPage();
    return { domRows, exportBase64, filterActive };
  }

  let syncInProgress = false;

  async function runSync(force = false, source = "iplan-visit") {
    if (syncInProgress) return;
    syncInProgress = true;
    badge.style.background = "#1e293b";
    badge.textContent = "מסנכרן עם מערכת החתונה...";

    try {
      const { domRows, exportBase64, filterActive } = await collectPageData();
      const res = await chrome.runtime.sendMessage({
        type: "IPLAN_INGEST_FROM_PAGE",
        force,
        source,
        domRows,
        exportBase64,
        filterActive,
      });

      if (res && res.ok) {
        badge.style.background = "#059669";
        if (filterActive && res.exportedCount && res.exportedCount < 50) {
          badge.textContent = `סונכרן בהצלחה ✓ (${res.rowCount || 0} הזמנות — לסנכרון מלא נקו את תיבת החיפוש)`;
        } else {
          badge.textContent = `סונכרן בהצלחה ✓ (${res.rowCount || 0} הזמנות — מוכן לאישור במערכת)`;
        }
      } else {
        badge.style.background = "#e11d48";
        badge.textContent = `שגיאת סנכרון: ${res?.error || "לחצו לניסיון חוזר"}`;
      }
    } catch {
      badge.style.background = "#e11d48";
      badge.textContent = "שגיאת תקשורת עם תוסף החתונה — רעננו את הדף";
    } finally {
      syncInProgress = false;
    }
  }

  window.__wpIplanTriggerSync = runSync;
  badge.addEventListener("click", () => runSync(true, "badge-click"));

  // האזנה לבקשות משיכה מה-Service Worker של התוסף
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "IPLAN_PAGE_COLLECT") {
      collectPageData()
        .then((data) => sendResponse({ ok: true, ...data }))
        .catch((err) => sendResponse({ ok: false, error: err?.message }));
      return true;
    }
    return false;
  });

  // סנכרון אוטומטי בעת שינוי אישור הגעה בטבלה של iPlan
  let debounceTimer = null;
  function scheduleTableSync() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      runSync(true, "iplan-dom-change");
    }, 1200);
  }

  document.addEventListener("change", () => scheduleTableSync(), true);
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (badge.contains(m.target)) continue;
      if (
        m.target &&
        m.target.closest &&
        (m.target.closest("table") || m.target.closest("form"))
      ) {
        scheduleTableSync();
        break;
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // הפעלה ראשונית מיד עם פתיחת הדף
  runSync(true, "iplan-visit");
})();
