// content-iplan.js — רץ אוטומטית כשפותחים את app.iplan.co.il
// מושך ברקע את קובץ ההזמנות המלא ומציג חיווי צף אלגנטי בעברית.

(function initIplanAutoSync() {
  if (!location.hostname.includes("iplan.co.il")) return;
  if (location.pathname.includes("sign_in")) return;

  const badge = document.createElement("div");
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
  badge.textContent = "מסנכרן עם מערכת החתונה...";
  document.body.appendChild(badge);

  async function runSync(force = false) {
    badge.style.background = "#1e293b";
    badge.textContent = "מסנכרן עם מערכת החתונה...";
    try {
      const res = await chrome.runtime.sendMessage({
        type: "IPLAN_TRIGGER_SYNC",
        force,
        source: "iplan-visit",
      });
      if (res && res.ok) {
        badge.style.background = "#059669";
        badge.textContent = `סונכרן בהצלחה ✓ (${res.rowCount || 0} הזמנות — מוכן לאישור במערכת)`;
      } else {
        badge.style.background = "#e11d48";
        badge.textContent = `שגיאת סנכרון: ${res?.error || "נסו שוב"}`;
      }
    } catch {
      badge.style.background = "#e11d48";
      badge.textContent = "שגיאת תקשורת עם תוסף החתונה";
    }
  }

  badge.addEventListener("click", () => runSync(true));
  runSync(false);
})();

