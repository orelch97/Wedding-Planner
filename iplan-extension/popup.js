const statusBox = document.getElementById("statusBox");
const syncNowBtn = document.getElementById("syncNowBtn");
const eventIdInput = document.getElementById("eventIdInput");
const weddingIdInput = document.getElementById("weddingIdInput");
const tokenInput = document.getElementById("tokenInput");
const saveConfigBtn = document.getElementById("saveConfigBtn");

function renderState(lastSyncState) {
  if (!lastSyncState) {
    statusBox.className = "status-box";
    statusBox.textContent = "טרם בוצע סנכרון. פתחו את iPlan או לחצו על הכפתור למטה.";
    return;
  }
  if (lastSyncState.ok) {
    const timeStr = lastSyncState.syncedAt
      ? new Date(lastSyncState.syncedAt).toLocaleTimeString("he-IL", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    statusBox.className = "status-box ok";
    statusBox.textContent = `סונכרן בהצלחה ✓ (${lastSyncState.rowCount || 0} הזמנות ב-${timeStr})`;
  } else {
    statusBox.className = "status-box err";
    statusBox.textContent = lastSyncState.error || "הסנכרון נכשל";
  }
}

async function initPopup() {
  const res = await chrome.runtime.sendMessage({ type: "IPLAN_GET_STATUS" });
  if (res && res.config) {
    eventIdInput.value = res.config.eventId || "284821";
    weddingIdInput.value = res.config.weddingId || "";
    tokenInput.value = res.config.token || "";
  }
  renderState(res?.lastSyncState);
}

syncNowBtn.addEventListener("click", async () => {
  syncNowBtn.disabled = true;
  statusBox.className = "status-box";
  statusBox.textContent = "מסנכרן מול iPlan...";
  try {
    const res = await chrome.runtime.sendMessage({
      type: "IPLAN_TRIGGER_SYNC",
      force: true,
      source: "popup",
    });
    renderState(res);
  } finally {
    syncNowBtn.disabled = false;
  }
});

saveConfigBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({
    type: "IPLAN_SAVE_CONFIG",
    config: {
      eventId: eventIdInput.value.trim() || "284821",
      weddingId: weddingIdInput.value.trim(),
      token: tokenInput.value.trim(),
    },
  });
  statusBox.className = "status-box ok";
  statusBox.textContent = "ההגדרות נשמרו בהצלחה ✓";
});

initPopup();

