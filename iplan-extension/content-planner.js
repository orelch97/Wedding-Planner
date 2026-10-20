// content-planner.js — גשר תקשורת דו-כיווני בזמן אמת בין מערכת החתונה (כולל localhost:5177) לבין תוסף ה-Chrome.
// 1. דוחף אוטומטית את רשומות iPlan למערכת החתונה מיד עם טעינת הדף.
// 2. מאזין ל-chrome.storage.onChanged ודוחף למערכת החתונה כל עדכון חדש מ-iPlan בזמן אמת (ללא צורך ברענון הדף).
// 3. מאפשר לפופ-אפ "עדכון אישורי הגעה" לבקש משיכה חיה מ-iPlan בלחיצת כפתור.

(function initPlannerBridge() {
  async function pushLatestRowsToPage() {
    try {
      const statusRes = await chrome.runtime.sendMessage({ type: "IPLAN_GET_STATUS" });
      if (statusRes && Array.isArray(statusRes.rows) && statusRes.rows.length > 0) {
        window.postMessage(
          {
            type: "WEDDING_PLANNER_IPLAN_ROWS",
            rows: statusRes.rows,
            syncedAt: statusRes.lastSyncState?.syncedAt || new Date().toISOString(),
          },
          "*"
        );
      }
    } catch {
      // ignore if extension context invalidated
    }
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window || !event.data || typeof event.data !== "object") return;

    if (event.data.type === "WEDDING_PLANNER_REQUEST_IPLAN_ROWS") {
      await pushLatestRowsToPage();
      return;
    }

    if (event.data.type === "WEDDING_PLANNER_REQUEST_IPLAN_SYNC") {
      try {
        const syncRes = await chrome.runtime.sendMessage({
          type: "IPLAN_TRIGGER_SYNC",
          force: true,
          source: "planner-modal",
        });

        if (syncRes && syncRes.ok && Array.isArray(syncRes.rows) && syncRes.rows.length > 0) {
          window.postMessage(
            {
              type: "WEDDING_PLANNER_IPLAN_ROWS",
              rows: syncRes.rows,
              syncedAt: syncRes.syncedAt,
            },
            "*"
          );
          return;
        }

        await pushLatestRowsToPage();
      } catch {
        // ignore
      }
    }

    if (event.data.type === "WEDDING_PLANNER_CONFIGURE_EXTENSION" && event.data.config) {
      try {
        await chrome.runtime.sendMessage({
          type: "IPLAN_SAVE_CONFIG",
          config: event.data.config,
        });
        await chrome.runtime.sendMessage({
          type: "IPLAN_TRIGGER_SYNC",
          force: true,
          source: "config-updated",
        });
        await pushLatestRowsToPage();
      } catch {
        // ignore
      }
    }
  });

  // דחיפה בזמן אמת בכל פעם שנתוני iPlan מתעדכנים בתוסף (למשל מלשונית iPlan פתוחה)
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes.lastSyncedRows?.newValue) {
        window.postMessage(
          {
            type: "WEDDING_PLANNER_IPLAN_ROWS",
            rows: changes.lastSyncedRows.newValue,
            syncedAt: changes.lastSyncState?.newValue?.syncedAt || new Date().toISOString(),
          },
          "*"
        );
      }
    });
  } catch {
    // ignore
  }

  // דחיפה ראשונית מיד עם הטעינה
  pushLatestRowsToPage();
})();
