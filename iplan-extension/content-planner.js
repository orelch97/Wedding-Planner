// content-planner.js — גשר תקשורת בין אפליקציית תכנון החתונה לבין תוסף הכרום.
// מאפשר לפופ-אפ "עדכון אישורי הגעה" באפליקציה לבקש משיכה חיה מ-iPlan בלחיצת כפתור,
// וכן להגדיר את מפתח החיבור לתוסף בלחיצה אחת מתוך האפליקציה.

window.addEventListener("message", async (event) => {
  if (event.source !== window || !event.data || typeof event.data !== "object") return;

  if (event.data.type === "WEDDING_PLANNER_REQUEST_IPLAN_SYNC") {
    try {
      const syncRes = await chrome.runtime.sendMessage({
        type: "IPLAN_TRIGGER_SYNC",
        force: true,
        source: "planner-modal",
      });

      if (syncRes && syncRes.ok && Array.isArray(syncRes.rows)) {
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

      // אם כרגע לשונית iPlan אינה מחוברת, נבדוק אם יש שורות שמורות מהסנכרון האחרון בתוסף
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
      } else if (syncRes?.error) {
        window.postMessage(
          {
            type: "WEDDING_PLANNER_IPLAN_ROWS",
            rows: [],
            error: syncRes.error,
          },
          "*"
        );
      }
    } catch {
      // ignore if extension context invalidated
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
    } catch {
      // ignore
    }
  }
});

