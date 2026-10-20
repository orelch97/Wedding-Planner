/* =========================================================================
 *  IplanSyncModal.jsx — פופ-אפ תצוגה מקדימה ואישור לעדכון אישורי הגעה מ-iPlan
 *                       + פעמון יומן עדכונים בבר העליון
 * -------------------------------------------------------------------------
 *  כלל ברזל:
 *  שום רשומה לא מתעדכנת אוטומטית מאחורי הקלעים. המשתמש לוחץ על
 *  "עדכון אישורי הגעה", רואה בדיוק אילו רשומות ישתנו (מאיזה סטטוס לאיזה סטטוס),
 *  ורק בלחיצה על "כן, עדכן אישורי הגעה" מתעדכן אך ורק שדה אישור ההגעה
 *  (rsvp + attendingCount) של הרשומות שאושרו.
 * ====================================================================== */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  RefreshCw,
  Upload,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  X,
  Check,
  Bell,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Copy,
  Loader2,
  Sparkles,
  FileSpreadsheet,
  ArrowLeft,
} from "lucide-react";
import { useAccessibleModal } from "../hooks/useAccessibleModal.js";
import {
  reconcileIplan,
  applyIplanUpdates,
  readIplanBuffer,
  formatRsvpLabel,
} from "../lib/iplanSync.js";
import { FIREBASE_ENV } from "../lib/firebase.js";

function RsvpStatusBadge({ rsvp, attendingCount, seats }) {
  const label = formatRsvpLabel(rsvp, attendingCount, seats);
  if (rsvp === "confirmed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
        <CheckCircle2 size={13} className="shrink-0" />
        {label}
      </span>
    );
  }
  if (rsvp === "declined") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
        <XCircle size={13} className="shrink-0" />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
      <Clock size={13} className="shrink-0" />
      {label}
    </span>
  );
}

export function IplanSyncModal({
  open,
  onClose,
  guests,
  setGuests,
  cloudSnapshot = null,
  weddingId = null,
  isOwner = false,
  onIssueToken = null,
  onCommitActivity = null,
  onNotify = null,
}) {
  const dialogRef = useRef(null);
  const closeBtnRef = useRef(null);
  const fileInputRef = useRef(null);

  const [manualRows, setManualRows] = useState(null);
  const [manualSourceLabel, setManualSourceLabel] = useState("");
  const [extensionRows, setExtensionRows] = useState(null);
  const [extensionSyncedAt, setExtensionSyncedAt] = useState(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [fetchingFromExtension, setFetchingFromExtension] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [includeUnansweredReset, setIncludeUnansweredReset] = useState(false);
  const [deselectedGuestIds, setDeselectedGuestIds] = useState(() => new Set());
  const [applying, setApplying] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showTokenSetup, setShowTokenSetup] = useState(false);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [issuedTokenInfo, setIssuedTokenInfo] = useState(null);

  const requestClose = useCallback(() => {
    if (applying || loadingFile || tokenBusy) return;
    onClose?.();
  }, [applying, loadingFile, tokenBusy, onClose]);

  useAccessibleModal({
    open,
    containerRef: dialogRef,
    initialFocusRef: closeBtnRef,
    onRequestClose: requestClose,
  });

  // האזנה לתשובה חיה מתוסף הכרום (אם מותקן בדפדפן)
  useEffect(() => {
    if (!open) return undefined;

    function handleMessage(event) {
      if (event.source !== window || !event.data || typeof event.data !== "object") return;
      if (event.data.type === "WEDDING_PLANNER_IPLAN_ROWS") {
        setFetchingFromExtension(false);
        if (Array.isArray(event.data.rows) && event.data.rows.length > 0) {
          setExtensionRows(event.data.rows);
          setExtensionSyncedAt(event.data.syncedAt || new Date().toISOString());
          setErrorMsg("");
        } else if (event.data.error) {
          // אם התוסף דיווח על שגיאה וטרם נטען מקור אחר, מציגים רק אם אין נתוני ענן
          if (!cloudSnapshot?.rows?.length && !manualRows?.length) {
            setErrorMsg(event.data.error);
          }
        }
      }
    }

    window.addEventListener("message", handleMessage);
    window.postMessage({ type: "WEDDING_PLANNER_REQUEST_IPLAN_SYNC" }, "*");
    const timer = setTimeout(() => setFetchingFromExtension(false), 3500);

    return () => {
      window.removeEventListener("message", handleMessage);
      clearTimeout(timer);
    };
  }, [open, cloudSnapshot?.rows?.length, manualRows?.length]);

  // בחירת מקור הנתונים הפעיל: קובץ שהועלה ידנית > נתונים חיים מהתוסף > תמונת מצב אחרונה בענן
  const activeSource = useMemo(() => {
    if (Array.isArray(manualRows) && manualRows.length > 0) {
      return {
        rows: manualRows,
        label: `קובץ שהועלה ידנית (${manualSourceLabel})`,
        syncedAt: new Date().toISOString(),
        kind: "manual",
      };
    }
    if (Array.isArray(extensionRows) && extensionRows.length > 0) {
      return {
        rows: extensionRows,
        label: "סנכרון חי מתוסף Chrome של iPlan",
        syncedAt: extensionSyncedAt,
        kind: "extension-live",
      };
    }
    if (Array.isArray(cloudSnapshot?.rows) && cloudSnapshot.rows.length > 0) {
      return {
        rows: cloudSnapshot.rows,
        label: "סנכרון אוטומטי אחרון מתוסף iPlan",
        syncedAt: cloudSnapshot.syncedAt,
        kind: "cloud",
      };
    }
    return null;
  }, [manualRows, manualSourceLabel, extensionRows, extensionSyncedAt, cloudSnapshot]);

  const reconciliation = useMemo(() => {
    if (!activeSource?.rows?.length) return null;
    return reconcileIplan({
      guests,
      rows: activeSource.rows,
      includeUnansweredReset,
    });
  }, [guests, activeSource, includeUnansweredReset]);

  const selectedGuestIds = useMemo(() => {
    const all = reconciliation?.updates || [];
    return new Set(all.filter((u) => !deselectedGuestIds.has(u.guestId)).map((u) => u.guestId));
  }, [reconciliation, deselectedGuestIds]);

  if (!open) return null;

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setLoadingFile(true);
    setErrorMsg("");
    try {
      const buffer = await file.arrayBuffer();
      const rows = await readIplanBuffer(buffer, file.name);
      if (!rows.length) {
        setErrorMsg("הקובץ נקרא אך לא נמצאו בו שורות מוזמנים מ-iPlan.");
      } else {
        setManualRows(rows);
        setManualSourceLabel(file.name);
        setDeselectedGuestIds(new Set());
      }
    } catch (err) {
      console.error("Failed to read iPlan file:", err);
      setErrorMsg(err?.message || "קריאת הקובץ מ-iPlan נכשלה.");
    } finally {
      setLoadingFile(false);
    }
  }

  function toggleGuestSelection(guestId) {
    setDeselectedGuestIds((prev) => {
      const next = new Set(prev);
      if (next.has(guestId)) next.delete(guestId);
      else next.add(guestId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!reconciliation?.updates?.length) return;
    if (selectedGuestIds.size === reconciliation.updates.length) {
      setDeselectedGuestIds(new Set(reconciliation.updates.map((u) => u.guestId)));
    } else {
      setDeselectedGuestIds(new Set());
    }
  }

  async function handleApproveAndUpdate() {
    if (!reconciliation?.updates?.length) return;
    const approved = reconciliation.updates.filter((u) => selectedGuestIds.has(u.guestId));
    if (!approved.length) return;

    setApplying(true);
    setErrorMsg("");
    try {
      const { nextGuests, changes } = applyIplanUpdates(guests, approved);
      if (changes.length > 0) {
        setGuests(nextGuests);
        onNotify?.(`עודכנו אישורי הגעה עבור ${changes.length} רשומות`, { tone: "success" });
        void onCommitActivity?.(changes, activeSource?.kind || "iplan");
      }
      onClose?.();
    } catch (err) {
      console.error("Failed to apply iPlan RSVP updates:", err);
      setErrorMsg("שמירת העדכונים נכשלה. נסו שוב.");
    } finally {
      setApplying(false);
    }
  }

  async function handleGenerateExtensionToken() {
    if (!onIssueToken || !weddingId) return;
    setTokenBusy(true);
    setErrorMsg("");
    try {
      const res = await onIssueToken(weddingId);
      const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || "wedding-planner-c3d62";
      const endpointUrl = `https://europe-west1-${projectId}.cloudfunctions.net/iplanExtensionSync`;
      const configPayload = {
        env: res.env || FIREBASE_ENV,
        weddingId: res.weddingId || weddingId,
        token: res.token,
        endpointUrl,
        eventId: "284821",
      };
      setIssuedTokenInfo(configPayload);
      // שליחה אוטומטית לתוסף הכרום אם הוא מותקן בדפדפן
      window.postMessage(
        {
          type: "WEDDING_PLANNER_CONFIGURE_EXTENSION",
          config: configPayload,
        },
        "*"
      );
      onNotify?.("מפתח החיבור לתוסף Chrome הופק והוגדר", { tone: "success" });
    } catch (err) {
      console.error("Failed to issue iPlan token:", err);
      setErrorMsg("הפקת מפתח הסנכרון לתוסף נכשלה.");
    } finally {
      setTokenBusy(false);
    }
  }

  const updates = reconciliation?.updates || [];
  const selectedCount = updates.filter((u) => selectedGuestIds.has(u.guestId)).length;
  const isPartialExport =
    reconciliation &&
    reconciliation.totalIplanRows > 0 &&
    guests.length >= 20 &&
    reconciliation.totalIplanRows < guests.length * 0.5;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-sm sm:p-5"
      onClick={requestClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="iplan-sync-modal-title"
        data-testid="iplan-sync-modal"
        className="animate-fade-in-up relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200 sm:max-h-[calc(100dvh-3rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-l from-gold-50/70 via-white to-sage-50/40 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-gold-500 to-sage-500 text-white shadow-sm">
              <RefreshCw size={20} className={fetchingFromExtension ? "animate-spin" : ""} />
            </div>
            <div>
              <h3
                id="iplan-sync-modal-title"
                className="font-display text-lg font-bold text-slate-800 sm:text-xl"
              >
                עדכון אישורי הגעה מ-iPlan
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                בדיקת הרשומות שהשתנו ואישור מבוקר לפני עדכון במערכת
              </p>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={requestClose}
            disabled={applying}
            aria-label="סגירה"
            title="סגירה"
            className="btn-icon shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {/* Strict single-field guarantee banner */}
          <div className="flex items-start gap-2.5 rounded-2xl border border-sage-200 bg-sage-50/70 px-3.5 py-2.5 text-xs leading-relaxed text-sage-900">
            <Sparkles size={16} className="mt-0.5 shrink-0 text-sage-600" />
            <div>
              <strong>הגנה מלאה על הנתונים שלכם:</strong> השדה היחיד שיתעדכן ברשומות שתאשרו הוא{" "}
              <strong>אישור הגעה</strong> (ממתין / אישרו הגעה + מספר מגיעים / לא מגיעים). שום נתון
              אחר ברשומה (שם, טלפון, כיסאות, קטגוריה או הערות) לא ישתנה.
            </div>
          </div>

          {/* Data source & manual file upload bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-200/80">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <FileSpreadsheet size={15} className="shrink-0 text-gold-600" />
                <span>
                  {activeSource
                    ? activeSource.label
                    : fetchingFromExtension
                      ? "מחפש נתונים מתוסף Chrome של iPlan…"
                      : "טרם נטענו נתונים מ-iPlan"}
                </span>
              </div>
              {activeSource?.syncedAt && (
                <p className="mt-0.5 text-[11px] text-slate-500">
                  עודכן:{" "}
                  {new Date(activeSource.syncedAt).toLocaleString("he-IL", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}{" "}
                  · {reconciliation?.totalIplanRows || 0} הזמנות בקובץ
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xls,.xlsx,.xlsm,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="hidden"
                data-testid="iplan-file-input"
                onChange={handleFileSelect}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={loadingFile || applying}
                className="btn-secondary text-xs"
              >
                {loadingFile ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> קורא קובץ…
                  </>
                ) : (
                  <>
                    <Upload size={15} /> טעינת קובץ אקסל מ-iPlan
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setFetchingFromExtension(true);
                  window.postMessage({ type: "WEDDING_PLANNER_REQUEST_IPLAN_SYNC" }, "*");
                  setTimeout(() => setFetchingFromExtension(false), 3500);
                }}
                disabled={fetchingFromExtension || applying}
                title="משיכה חיה מתוסף הכרום (אם לשונית iPlan מחוברת)"
                className="btn-secondary text-xs"
              >
                <RefreshCw size={14} className={fetchingFromExtension ? "animate-spin" : ""} />
                רענון מהתוסף
              </button>
            </div>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700"
            >
              <AlertTriangle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {isPartialExport && (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
              <div>
                <strong>שימו לב:</strong> הקובץ מ-iPlan מכיל רק {reconciliation.totalIplanRows} הזמנות
                (מתוך {guests.length} מוזמנים במערכת) — ייתכן שהופעל סינון ב-iPlan בזמן הייצוא.
                מוזמנים שלא מופיעים בקובץ לא יימחקו ולא ישתנו.
              </div>
            </div>
          )}

          {/* Empty state when no source loaded yet */}
          {!reconciliation && !loadingFile && (
            <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50/50 px-5 py-10 text-center">
              <FileSpreadsheet size={36} className="mx-auto mb-3 text-gold-500" />
              <p className="text-sm font-bold text-slate-700">
                טענו קובץ ייצוא מ-iPlan או הפעילו את תוסף ה-Chrome
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                כשאתם נכנסים ל-iPlan עם התוסף הפעיל, הנתונים מסתנכרנים לכאן אוטומטית. לחלופין, אפשר
                לבחור בכל רגע את קובץ ה-Excel (<span dir="ltr">.xls</span>) שהורדתם מ-iPlan.
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn-primary mx-auto mt-4"
              >
                <Upload size={16} /> בחירת קובץ ייצוא מ-iPlan
              </button>
            </div>
          )}

          {/* Reconciliation results */}
          {reconciliation && (
            <>
              {/* Summary pills */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-2xl bg-gold-50/80 p-3 text-center ring-1 ring-gold-200/80">
                  <p className="text-xl font-bold text-gold-800">{updates.length}</p>
                  <p className="text-[11px] font-medium text-gold-700">רשומות לעדכון</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3 text-center ring-1 ring-slate-200">
                  <p className="text-xl font-bold text-slate-700">{reconciliation.unchangedCount}</p>
                  <p className="text-[11px] font-medium text-slate-500">ללא שינוי</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3 text-center ring-1 ring-slate-200">
                  <p className="text-xl font-bold text-slate-700">{reconciliation.matchedCount}</p>
                  <p className="text-[11px] font-medium text-slate-500">הותאמו לפי נייד</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3 text-center ring-1 ring-slate-200">
                  <p className="text-xl font-bold text-slate-700">
                    {reconciliation.unmatched.length + reconciliation.ambiguous.length}
                  </p>
                  <p className="text-[11px] font-medium text-slate-500">ללא התאמה / כפולים</p>
                </div>
              </div>

              {/* Optional toggle for unanswered local confirmations */}
              {(reconciliation.unansweredLocals.length > 0 || includeUnansweredReset) && (
                <label className="flex cursor-pointer items-center gap-2.5 rounded-2xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={includeUnansweredReset}
                    onChange={(e) => setIncludeUnansweredReset(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-gold-600 focus:ring-gold-400"
                  />
                  <span>
                    הצג גם רשומות שכבר סומנו אצלנו ידנית אך ב-iPlan עדיין מופיעות כ״טרם השיבו״ (איפוס
                    ל״ממתין״)
                  </span>
                </label>
              )}

              {/* Updates table / list */}
              {updates.length === 0 ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6 text-center">
                  <CheckCircle2 size={32} className="mx-auto mb-2 text-emerald-600" />
                  <p className="text-sm font-bold text-emerald-900">
                    כל אישורי ההגעה שלכם מעודכנים!
                  </p>
                  <p className="mt-1 text-xs text-emerald-700">
                    לא נמצאו הבדלים בין סטטוס אישורי ההגעה ב-iPlan לבין הרשומות במערכת.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between px-1">
                    <h4 className="text-xs font-bold text-slate-700">
                      הרשומות שיעודכנו ({selectedCount} מתוך {updates.length} נבחרו):
                    </h4>
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="text-xs font-semibold text-gold-700 hover:underline"
                    >
                      {selectedCount === updates.length ? "נקה בחירה" : "בחר הכל"}
                    </button>
                  </div>

                  <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-2xl border border-slate-200 bg-white">
                    {updates.map((u) => {
                      const checked = selectedGuestIds.has(u.guestId);
                      return (
                        <label
                          key={u.guestId}
                          data-testid={`iplan-update-row-${u.guestId}`}
                          className={`flex cursor-pointer flex-wrap items-center justify-between gap-3 px-4 py-3 transition hover:bg-slate-50 ${
                            checked ? "bg-gold-50/20" : "opacity-60"
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleGuestSelection(u.guestId)}
                              className="h-4 w-4 shrink-0 rounded border-slate-300 text-gold-600 focus:ring-gold-400"
                            />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-slate-800">
                                {u.guestName}
                              </p>
                              <p className="text-xs text-slate-500">
                                <span dir="ltr">{u.phone}</span> · {u.seats} כיסאות ברשומה
                                {u.iplanName && u.iplanName !== u.guestName
                                  ? ` · ב-iPlan: ${u.iplanName}`
                                  : ""}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <RsvpStatusBadge
                              rsvp={u.fromRsvp}
                              attendingCount={u.fromAttendingCount}
                              seats={u.seats}
                            />
                            <ArrowLeft size={15} className="shrink-0 text-slate-400" />
                            <RsvpStatusBadge
                              rsvp={u.toRsvp}
                              attendingCount={u.toAttendingCount}
                              seats={u.seats}
                            />
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Collapsible unmatched / ambiguous info */}
              {(reconciliation.ambiguous.length > 0 || reconciliation.unmatched.length > 0) && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50/70">
                  <button
                    type="button"
                    onClick={() => setShowDetails((v) => !v)}
                    className="flex w-full items-center justify-between px-4 py-3 text-right text-xs font-semibold text-slate-700"
                  >
                    <span>
                      פירוט שורות שלא עודכנו ({reconciliation.ambiguous.length} מספרי טלפון כפולים ·{" "}
                      {reconciliation.unmatched.length} ללא נייד או לא ברשימה שלנו)
                    </span>
                    {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  {showDetails && (
                    <div className="max-h-48 space-y-3 overflow-y-auto border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
                      {reconciliation.ambiguous.length > 0 && (
                        <div>
                          <p className="mb-1 font-bold text-amber-800">
                            מספרי טלפון כפולים (דורשים בדיקה ידנית ולכן לא מתעדכנים אוטומטית):
                          </p>
                          <ul className="space-y-1 pr-3">
                            {reconciliation.ambiguous.map((a) => (
                              <li key={a.phoneKey}>
                                <span dir="ltr">{a.phone}</span> — מופיע אצל:{" "}
                                {a.guests.map((g) => g.name).join(", ")}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {reconciliation.unmatched.length > 0 && (
                        <div>
                          <p className="mb-1 font-bold text-slate-700">
                            רשומות ב-iPlan ללא התאמה ברשימה שלנו (מוצגות לידיעה בלבד ולא מתווספות):
                          </p>
                          <ul className="space-y-1 pr-3">
                            {reconciliation.unmatched.slice(0, 50).map((u, idx) => (
                              <li key={`${u.name}-${idx}`}>
                                {u.name}{" "}
                                {u.phone ? (
                                  <span dir="ltr">({u.phone})</span>
                                ) : (
                                  "(ללא טלפון ב-iPlan)"
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Chrome extension token generator for wedding owner */}
          {weddingId && isOwner && onIssueToken && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70">
              <button
                type="button"
                onClick={() => setShowTokenSetup((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-3 text-right text-xs font-semibold text-slate-700"
              >
                <span className="flex items-center gap-2">
                  <KeyRound size={15} className="text-gold-600" />
                  הגדרת סנכרון רקע אוטומטי לתוסף Chrome
                </span>
                {showTokenSetup ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {showTokenSetup && (
                <div className="space-y-2.5 border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
                  <p>
                    בלחיצה על הכפתור יונפק מפתח מאובטח לחתונה שלכם ויועבר אוטומטית לתוסף ה-Chrome
                    כדי שיוכל לסנכרן ברקע כל 30 דקות גם כשאתם לא באתר.
                  </p>
                  <button
                    type="button"
                    onClick={handleGenerateExtensionToken}
                    disabled={tokenBusy}
                    className="btn-secondary text-xs"
                  >
                    {tokenBusy ? (
                      <>
                        <Loader2 size={14} className="animate-spin" /> מנפיק מפתח…
                      </>
                    ) : (
                      <>
                        <KeyRound size={14} /> הפקה וחיבור אוטומטי לתוסף
                      </>
                    )}
                  </button>
                  {issuedTokenInfo && (
                    <div className="space-y-1.5 rounded-xl bg-white p-2.5 ring-1 ring-slate-200">
                      <p className="font-semibold text-emerald-700">
                        המפתח הועבר לתוסף! ניתן גם להעתיק ידנית להגדרות התוסף:
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          readOnly
                          dir="ltr"
                          value={JSON.stringify(issuedTokenInfo)}
                          onFocus={(e) => e.target.select()}
                          className="w-full rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-700 outline-none ring-1 ring-slate-200"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(JSON.stringify(issuedTokenInfo));
                            onNotify?.("הגדרות התוסף הועתקו", { tone: "success" });
                          }}
                          className="btn-secondary shrink-0 px-2.5 py-1 text-[11px]"
                        >
                          <Copy size={12} /> העתקה
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer — Explicit User Approval */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-slate-100 bg-white px-5 py-3.5 sm:px-6">
          <button
            type="button"
            onClick={requestClose}
            disabled={applying}
            className="btn-secondary"
          >
            ביטול
          </button>
          <button
            type="button"
            data-testid="iplan-approve-btn"
            onClick={handleApproveAndUpdate}
            disabled={applying || selectedCount === 0}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {applying ? (
              <>
                <Loader2 size={16} className="animate-spin" /> מעדכן…
              </>
            ) : (
              <>
                <Check size={16} /> כן, עדכן אישורי הגעה ({selectedCount})
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * פעמון התראות בבר העליון המציג את היסטוריית עדכוני אישורי ההגעה מ-iPlan
 * ומאפשר פתיחה מהירה של פופ-אפ "עדכון אישורי הגעה".
 */
export function ActivityBell({
  activity = [],
  userId = "anon",
  weddingId = "local",
  pendingIplanCount = 0,
  onOpenIplanModal,
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const storageKey = `wp_activity_seen_${userId || "anon"}_${weddingId || "local"}`;

  const [seenTimestamp, setSeenTimestamp] = useState(0);
  const lastSeenAt = useMemo(() => {
    try {
      return Math.max(seenTimestamp, Number(localStorage.getItem(storageKey)) || 0);
    } catch {
      return seenTimestamp;
    }
  }, [storageKey, seenTimestamp]);

  useEffect(() => {
    if (!open) return undefined;
    function handleOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const unreadActivityCount = useMemo(() => {
    return (activity || []).filter((item) => {
      const t = new Date(item.at).getTime();
      return Number.isFinite(t) && t > lastSeenAt;
    }).length;
  }, [activity, lastSeenAt]);

  const badgeCount = unreadActivityCount + (pendingIplanCount > 0 ? pendingIplanCount : 0);

  function toggleMenu() {
    const next = !open;
    setOpen(next);
    if (next) {
      const now = Date.now();
      setSeenTimestamp(now);
      try {
        localStorage.setItem(storageKey, String(now));
      } catch {
        /* ignore storage quota */
      }
    }
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={toggleMenu}
        data-testid="activity-bell-btn"
        title="יומן עדכוני אישורי הגעה מ-iPlan"
        aria-label="יומן עדכוני אישורי הגעה"
        aria-expanded={open}
        className="btn-icon relative"
      >
        <Bell size={19} />
        {badgeCount > 0 && (
          <span
            data-testid="activity-bell-badge"
            className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white ring-2 ring-white"
          >
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="יומן עדכוני אישורי הגעה"
          className="animate-fade-in-up absolute left-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl bg-white text-right shadow-2xl ring-1 ring-slate-200 sm:w-96"
        >
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-3">
            <span className="text-xs font-bold text-slate-800">עדכוני אישורי הגעה (iPlan)</span>
            {onOpenIplanModal && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenIplanModal();
                }}
                className="text-xs font-semibold text-gold-700 hover:underline"
              >
                פתיחת חלון סנכרון
              </button>
            )}
          </div>

          {pendingIplanCount > 0 && onOpenIplanModal && (
            <div className="border-b border-gold-200 bg-gold-50/80 px-4 py-2.5">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenIplanModal();
                }}
                className="flex w-full items-center justify-between text-right text-xs font-semibold text-gold-900"
              >
                <span>ממתינים {pendingIplanCount} עדכוני אישורי הגעה לאישורכם</span>
                <span className="rounded-lg bg-gold-500 px-2 py-1 text-[11px] text-slate-950">
                  בדיקה ואישור
                </span>
              </button>
            </div>
          )}

          <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
            {(!activity || activity.length === 0) ? (
              <p className="px-4 py-8 text-center text-xs text-slate-400">
                עדיין לא בוצעו עדכוני אישורי הגעה מ-iPlan.
              </p>
            ) : (
              activity.map((batch) => (
                <div key={batch.id || batch.batchId} className="space-y-1.5 px-4 py-3">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="font-semibold text-slate-700">
                      עודכנו {batch.updatedCount || batch.changes?.length || 0} רשומות
                    </span>
                    <span>
                      {batch.at
                        ? new Date(batch.at).toLocaleString("he-IL", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })
                        : ""}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {(batch.changes || []).slice(0, 6).map((c, idx) => (
                      <div
                        key={`${c.guestId}-${idx}`}
                        className="flex items-center justify-between gap-2 text-xs text-slate-600"
                      >
                        <span className="truncate font-medium text-slate-800">{c.guestName}</span>
                        <span className="shrink-0 text-[11px] text-slate-500">
                          {formatRsvpLabel(c.fromRsvp, c.fromAttendingCount)} ←{" "}
                          <strong className="text-slate-800">
                            {formatRsvpLabel(c.toRsvp, c.toAttendingCount)}
                          </strong>
                        </span>
                      </div>
                    ))}
                    {(batch.changes || []).length > 6 && (
                      <p className="text-[11px] text-slate-400">
                        ועוד {batch.changes.length - 6} רשומות נוספות…
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
