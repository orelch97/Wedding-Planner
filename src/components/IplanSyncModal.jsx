import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  FileSpreadsheet,
  HelpCircle,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import {
  applyIplanUpdates,
  formatRsvpLabel,
  mergeIplanRows,
  readIplanBuffer,
  reconcileIplan,
} from "../lib/iplanSync.js";
import { FIREBASE_ENV } from "../lib/firebase.js";

function RsvpStatusBadge({ rsvp, attendingCount, seats }) {
  if (rsvp === "confirmed") {
    const count =
      attendingCount != null && Number(attendingCount) > 0
        ? Number(attendingCount)
        : seats || 1;
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
        <CheckCircle2 size={13} />
        אישרו הגעה ({count})
      </span>
    );
  }
  if (rsvp === "declined") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
        <XCircle size={13} />
        לא מגיעים
      </span>
    );
  }
  if (rsvp === "maybe") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-200">
        <HelpCircle size={13} />
        מתלבטים
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
      <Clock size={13} />
      ממתין
    </span>
  );
}

/**
 * מודאל "עדכון אישורי הגעה" מ-iPlan:
 * 1. קורא את תמונת המצב האחרונה מ-Firestore (שהתוסף שלח), מתוסף ה-Chrome ישירות,
 *    או מקובץ ייצוא (.xls / .xlsx / .csv) שהמשתמש בוחר ידנית.
 * 2. מציג למשתמש רשימה ברורה של כל המוזמנים שסטטוס אישור ההגעה שלהם השתנה.
 * 3. רק אם המשתמש לוחץ על "כן, עדכן אישורי הגעה" — מעדכן אך ורק את שדה
 *    אישור ההגעה (rsvp + attendingCount) של הרשומות שאושרו.
 */
export function IplanSyncModal({
  open,
  onClose,
  guests = [],
  setGuests,
  cloudSnapshot = null,
  iplanManagedRsvp = null,
  weddingId = null,
  isOwner = false,
  onIssueToken = null,
  onCommitUpdates = null,
  onNotify = null,
}) {
  const fileInputRef = useRef(null);
  const dialogRef = useRef(null);
  const closeBtnRef = useRef(null);

  const [manualRows, setManualRows] = useState(null);
  const [manualSourceLabel, setManualSourceLabel] = useState("");
  const [extensionRows, setExtensionRows] = useState(null);
  const [extensionSyncedAt, setExtensionSyncedAt] = useState(null);
  const [reviewSource, setReviewSource] = useState(null);
  const [newSnapshotAvailable, setNewSnapshotAvailable] = useState(false);
  const reviewSourceRef = useRef(null);
  const manualRefreshPendingRef = useRef(false);
  const manualRefreshTimerRef = useRef(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [fetchingFromExtension, setFetchingFromExtension] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [includeUnansweredReset, setIncludeUnansweredReset] = useState(false);
  const [deselectedGuestIds, setDeselectedGuestIds] = useState(() => new Set());
  const [applying, setApplying] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showTokenSetup, setShowTokenSetup] = useState(false);
  const [issuedTokenInfo, setIssuedTokenInfo] = useState(null);
  const [tokenBusy, setTokenBusy] = useState(false);
  const hasExistingSource =
    (Array.isArray(cloudSnapshot?.rows) && cloudSnapshot.rows.length > 0) ||
    (Array.isArray(extensionRows) && extensionRows.length > 0) ||
    (Array.isArray(manualRows) && manualRows.length > 0);

  const requestClose = React.useCallback(() => {
    if (applying) return;
    onClose?.();
  }, [applying, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setErrorMsg("");
    setDeselectedGuestIds(new Set());
    reviewSourceRef.current = null;
    manualRefreshPendingRef.current = false;
    if (manualRefreshTimerRef.current) clearTimeout(manualRefreshTimerRef.current);
    manualRefreshTimerRef.current = null;
    setReviewSource(null);
    setNewSnapshotAvailable(false);
    closeBtnRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        requestClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, requestClose]);

  useEffect(() => {
    if (!open) return undefined;

    function handleMessage(event) {
      if (event.source !== window || !event.data || typeof event.data !== "object") return;
      if (event.data.type === "WEDDING_PLANNER_IPLAN_ROWS" && Array.isArray(event.data.rows)) {
        setFetchingFromExtension(false);
        if (event.data.rows.length > 0) {
          const receivedAt = event.data.syncedAt || new Date().toISOString();
          const incomingSource = {
            rows: event.data.rows,
            label: "סנכרון חי מתוסף Chrome של iPlan",
            syncedAt: receivedAt,
            kind: "extension-live",
          };
          setExtensionRows(event.data.rows);
          setExtensionSyncedAt(receivedAt);
          setErrorMsg("");
          const previous = reviewSourceRef.current;
          if (manualRefreshPendingRef.current) {
            manualRefreshPendingRef.current = false;
            if (manualRefreshTimerRef.current) clearTimeout(manualRefreshTimerRef.current);
            manualRefreshTimerRef.current = null;
            const mergedRows = previous?.rows?.length
              ? mergeIplanRows(previous.rows, event.data.rows)
              : event.data.rows;
            const refreshedSource = { ...incomingSource, rows: mergedRows, rowCount: mergedRows.length };
            reviewSourceRef.current = refreshedSource;
            setReviewSource(refreshedSource);
            setNewSnapshotAvailable(false);
          } else if (!previous) {
            reviewSourceRef.current = incomingSource;
            setReviewSource(incomingSource);
          } else {
            const mergedRows = mergeIplanRows(previous.rows, event.data.rows);
            if (JSON.stringify(mergedRows) !== JSON.stringify(previous.rows)) {
              setNewSnapshotAvailable(true);
            }
          }
        } else if (event.data.error) {
          setErrorMsg(event.data.error);
        }
      }
    }

    window.addEventListener("message", handleMessage);
    const requestTimer = setTimeout(() => {
      if (!hasExistingSource) {
        setFetchingFromExtension(true);
        window.postMessage({ type: "WEDDING_PLANNER_REQUEST_IPLAN_SYNC" }, "*");
      }
    }, 0);
    const timer = setTimeout(() => {
      if (manualRefreshPendingRef.current) return;
      setFetchingFromExtension(false);
    }, 3500);

    return () => {
      clearTimeout(requestTimer);
      clearTimeout(timer);
      window.removeEventListener("message", handleMessage);
    };
  }, [open, hasExistingSource]);

  const activeSource = useMemo(() => {
    const cloudRows = Array.isArray(cloudSnapshot?.rows) ? cloudSnapshot.rows : [];
    const extRows = Array.isArray(extensionRows) ? extensionRows : [];
    // מיזוג לפי עדכניות: הנתון שסונכרן מאוחר יותר גובר (כולל איפוס ב-iPlan ל"טרם השיבו"),
    // ושורות שמופיעות רק באחד המקורות נשמרות — כך משיכה חלקית לעולם לא מעלימה עדכונים.
    const extIsNewer =
      (new Date(extensionSyncedAt || 0).getTime() || 0) >=
      (new Date(cloudSnapshot?.syncedAt || 0).getTime() || 0);
    const baseAutoRows =
      cloudRows.length > 0 && extRows.length > 0
        ? extIsNewer
          ? mergeIplanRows(cloudRows, extRows)
          : mergeIplanRows(extRows, cloudRows)
        : extRows.length > 0
          ? extRows
          : cloudRows;

    if (Array.isArray(manualRows) && manualRows.length > 0) {
      const mergedManual =
        baseAutoRows.length > manualRows.length
          ? mergeIplanRows(baseAutoRows, manualRows)
          : manualRows;
      return {
        rows: mergedManual,
        label: `קובץ ידני: ${manualSourceLabel}`,
        syncedAt: new Date().toISOString(),
        kind: "manual",
      };
    }
    if (extRows.length > 0 && cloudRows.length > 0) {
      return {
        rows: baseAutoRows,
        label: "סנכרון חי מתוסף Chrome של iPlan",
        syncedAt: extensionSyncedAt || cloudSnapshot?.syncedAt,
        kind: "extension-live",
      };
    }
    if (extRows.length > 0) {
      return {
        rows: extRows,
        label: "סנכרון חי מתוסף Chrome של iPlan",
        syncedAt: extensionSyncedAt,
        kind: "extension-live",
      };
    }
    if (cloudRows.length > 0) {
      return {
        rows: cloudRows,
        label: "סנכרון אוטומטי אחרון מתוסף iPlan",
        syncedAt: cloudSnapshot.syncedAt,
        kind: "cloud",
      };
    }
    return null;
  }, [manualRows, manualSourceLabel, extensionRows, extensionSyncedAt, cloudSnapshot]);

  useEffect(() => {
    if (!open) return;
    const current = reviewSourceRef.current;
    if (!current && activeSource) {
      reviewSourceRef.current = activeSource;
      setReviewSource(activeSource);
      return;
    }
    if (current && activeSource && JSON.stringify(current.rows) !== JSON.stringify(activeSource.rows)) {
      setNewSnapshotAvailable(true);
    }
  }, [open, activeSource]);

  const displayedSource = reviewSource || activeSource;

  const reconciliation = useMemo(() => {
    if (!displayedSource?.rows?.length) return null;
    return reconcileIplan({
      guests,
      rows: displayedSource.rows,
      includeUnansweredReset,
      iplanManagedRsvp,
    });
  }, [guests, displayedSource, includeUnansweredReset, iplanManagedRsvp]);

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
        reviewSourceRef.current = null;
        setReviewSource(null);
        setNewSnapshotAvailable(false);
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

  function requestExtensionSync() {
    manualRefreshPendingRef.current = true;
    setFetchingFromExtension(true);
    window.postMessage({ type: "WEDDING_PLANNER_REQUEST_IPLAN_SYNC" }, "*");
    if (manualRefreshTimerRef.current) clearTimeout(manualRefreshTimerRef.current);
    manualRefreshTimerRef.current = setTimeout(() => {
      setFetchingFromExtension(false);
      manualRefreshPendingRef.current = false;
      manualRefreshTimerRef.current = null;
    }, 10_000);
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
        if (typeof onCommitUpdates !== "function") {
          throw new Error("The iPlan update handler is unavailable.");
        }
        const result = await onCommitUpdates(changes, displayedSource?.kind || "iplan");
        if (!result || result.updatedCount !== changes.length) {
          throw new Error("The server did not commit every approved iPlan update.");
        }
        if (!result?.persistedToCloud) setGuests(nextGuests);
        onNotify?.(`עודכנו אישורי הגעה עבור ${changes.length} רשומות`, { tone: "success" });
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
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 p-2.5 backdrop-blur-sm sm:p-5"
      onClick={requestClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="iplan-sync-modal-title"
        data-testid="iplan-sync-modal"
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-in-up flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white text-right shadow-2xl ring-1 ring-slate-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-l from-gold-50/70 via-white to-sage-50/40 px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-500 to-sage-600 text-white shadow-sm">
              <RefreshCw size={18} className={fetchingFromExtension ? "animate-spin" : ""} />
            </div>
            <div className="min-w-0">
              <h3
                id="iplan-sync-modal-title"
                className="truncate font-display text-base font-bold text-slate-800 sm:text-xl"
              >
                עדכון אישורי הגעה מ-iPlan
              </h3>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                בדיקת הרשומות שהשתנו ואישור מבוקר לפני עדכון
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
        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain p-3.5 sm:space-y-4 sm:p-6">
          {/* Concise 1-line data protection note */}
          <div className="flex items-center gap-2 rounded-2xl border border-sage-200 bg-sage-50/70 px-3 py-2 text-xs text-sage-900">
            <ShieldCheck size={15} className="shrink-0 text-sage-600" />
            <span>
              מעדכן את <strong>סטטוס ההגעה ומספר המגיעים בלבד</strong> — שאר פרטי המוזמן לא ישתנו.
            </span>
          </div>

          {/* Data source & manual file upload bar — Mobile-First stacked layout */}
          <div className="flex flex-col gap-3 rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-200/80 sm:flex-row sm:items-center sm:justify-between">
            <div className="w-full min-w-0 sm:flex-1">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                <FileSpreadsheet size={15} className="shrink-0 text-gold-600" />
                <span className="truncate">
                  {displayedSource
                    ? displayedSource.label
                    : fetchingFromExtension
                      ? "מחפש נתונים מתוסף Chrome של iPlan…"
                      : "טרם נטענו נתונים מ-iPlan"}
                </span>
              </div>
              {displayedSource?.syncedAt && (
                <p className="mt-1 text-[11px] text-slate-500">
                  עודכן:{" "}
                  <span dir="ltr">
                    {new Date(displayedSource.syncedAt).toLocaleString("he-IL", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>{" "}
                  · {reconciliation?.totalIplanRows || 0} הזמנות בקובץ
                </p>
              )}
            </div>

            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:items-center">
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
                className="btn-secondary flex items-center justify-center gap-1.5 whitespace-nowrap px-3 py-2 text-xs"
              >
                {loadingFile ? (
                  <>
                    <Loader2 size={14} className="shrink-0 animate-spin" />
                    <span>קורא קובץ…</span>
                  </>
                ) : (
                  <>
                    <Upload size={14} className="shrink-0" />
                    <span>טעינת אקסל מ-iPlan</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={requestExtensionSync}
                disabled={fetchingFromExtension || applying}
                title="משיכה חיה מתוסף הכרום (אם לשונית iPlan מחוברת)"
                className="btn-secondary flex items-center justify-center gap-1.5 whitespace-nowrap px-3 py-2 text-xs"
              >
                <RefreshCw
                  size={14}
                  className={`shrink-0 ${fetchingFromExtension ? "animate-spin" : ""}`}
                />
                <span>רענון מהתוסף</span>
              </button>
            </div>
          </div>

          {newSnapshotAvailable && (
            <div role="status" className="flex items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
              <span>הגיעו נתונים חדשים מ-iPlan בזמן הבדיקה. הרשימה נשארה כפי שנבדקה.</span>
              <button
                type="button"
                onClick={requestExtensionSync}
                disabled={fetchingFromExtension || applying}
                className="shrink-0 font-semibold text-sky-800 underline underline-offset-2"
              >
                רענון לבדיקה
              </button>
            </div>
          )}

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
            <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
              <div>
                <strong>שימו לב:</strong> הקובץ מכיל {reconciliation.totalIplanRows} הזמנות (מתוך{" "}
                {guests.length} מוזמנים במערכת) — ייתכן שהופעל סינון ב-iPlan. מוזמנים שלא מופיעים לא
                יימחקו ולא ישתנו.
              </div>
            </div>
          )}

          {/* Empty state when no source loaded yet */}
          {!reconciliation && !loadingFile && (
            <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50/50 px-5 py-8 text-center">
              <FileSpreadsheet size={34} className="mx-auto mb-2.5 text-gold-500" />
              <p className="text-sm font-bold text-slate-700">
                טענו קובץ ייצוא מ-iPlan או הפעילו את תוסף ה-Chrome
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                כשאתם נכנסים ל-iPlan עם התוסף הפעיל, הנתונים מסתנכרנים לכאן אוטומטית. לחלופין, אפשר
                לבחור את קובץ ה-Excel (<span dir="ltr">.xls</span>) שהורדתם מ-iPlan.
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
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5">
                <div className="rounded-2xl bg-gold-50/80 p-2.5 text-center ring-1 ring-gold-200/80 sm:p-3">
                  <p className="text-lg font-bold text-gold-800 sm:text-xl">{updates.length}</p>
                  <p className="text-[11px] font-medium text-gold-700">רשומות לעדכון</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-2.5 text-center ring-1 ring-slate-200 sm:p-3">
                  <p className="text-lg font-bold text-slate-700 sm:text-xl">
                    {reconciliation.unchangedCount}
                  </p>
                  <p className="text-[11px] font-medium text-slate-500">ללא שינוי</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-2.5 text-center ring-1 ring-slate-200 sm:p-3">
                  <p className="text-lg font-bold text-slate-700 sm:text-xl">
                    {reconciliation.matchedCount}
                  </p>
                  <p className="text-[11px] font-medium text-slate-500">הותאמו (נייד / שם)</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-2.5 text-center ring-1 ring-slate-200 sm:p-3">
                  <p className="text-lg font-bold text-slate-700 sm:text-xl">
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
                    className="h-4 w-4 shrink-0 rounded border-slate-300 text-gold-600 focus:ring-gold-400"
                  />
                  <span>
                    הצג גם רשומות שכבר סומנו אצלנו ידנית אך ב-iPlan מופיעות כ״טרם השיבו״ (איפוס
                    ל״ממתין״)
                  </span>
                </label>
              )}

              {/* Updates table / list */}
              {updates.length === 0 ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 text-center">
                  <CheckCircle2 size={30} className="mx-auto mb-2 text-emerald-600" />
                  <p className="text-sm font-bold text-emerald-900">
                    לא נמצאו הבדלים בסריקה הנוכחית
                  </p>
                  <p className="mt-1 text-xs text-emerald-700">
                    לא בוצעו שינויים במערכת. כדי לבדוק נתונים חדשים מ-iPlan, לחצו על רענון מהתוסף.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
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
                          className={`flex cursor-pointer flex-col gap-2.5 px-3.5 py-3 transition hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between ${
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
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-bold text-slate-800">
                                {u.guestName}
                              </p>
                              <p className="mt-0.5 text-xs text-slate-500">
                                {u.phone ? <span dir="ltr">{u.phone}</span> : "ללא נייד ברשומה"} ·{" "}
                                {u.seats} כיסאות ברשומה
                                {u.iplanName && u.iplanName !== u.guestName
                                  ? ` · ב-iPlan: ${u.iplanName}`
                                  : ""}
                                {u.isReset ? " · אופס ב-iPlan" : ""}
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-end gap-2 self-end sm:self-auto">
                            <RsvpStatusBadge
                              rsvp={u.fromRsvp}
                              attendingCount={u.fromAttendingCount}
                              seats={u.seats}
                            />
                            <ArrowLeft size={14} className="shrink-0 text-slate-400" />
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
                    className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-right text-xs font-semibold text-slate-700"
                  >
                    <span>
                      פירוט שורות שלא עודכנו ({reconciliation.ambiguous.length} כפולים ·{" "}
                      {reconciliation.unmatched.length} לא ברשימה שלנו)
                    </span>
                    {showDetails ? (
                      <ChevronUp size={16} className="shrink-0" />
                    ) : (
                      <ChevronDown size={16} className="shrink-0" />
                    )}
                  </button>
                  {showDetails && (
                    <div className="max-h-48 space-y-3 overflow-y-auto border-t border-slate-200 px-3.5 py-3 text-xs text-slate-600">
                      {reconciliation.ambiguous.length > 0 && (
                        <div>
                          <p className="mb-1 font-bold text-amber-800">
                            מספרי טלפון או שמות כפולים (דורשים בדיקה ידנית):
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
                            רשומות ב-iPlan ללא התאמה ברשימה שלנו (לידיעה בלבד):
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
                className="flex w-full items-center justify-between px-3.5 py-2.5 text-right text-xs font-semibold text-slate-700"
              >
                <span className="flex items-center gap-2">
                  <KeyRound size={15} className="text-gold-600" />
                  הגדרת סנכרון רקע אוטומטי לתוסף Chrome
                </span>
                {showTokenSetup ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {showTokenSetup && (
                <div className="space-y-2.5 border-t border-slate-200 px-3.5 py-3 text-xs text-slate-600">
                  <p>
                    בלחיצה על הכפתור יונפק מפתח מאובטח לחתונה שלכם ויועבר אוטומטית לתוסף ה-Chrome.
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
                        המפתח הועבר לתוסף! ניתן גם להעתיק ידנית:
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
        <div className="flex items-center justify-between gap-2.5 border-t border-slate-100 bg-white px-4 py-3 sm:px-6 sm:py-3.5">
          <button
            type="button"
            onClick={requestClose}
            disabled={applying}
            className="btn-secondary px-4 py-2 text-xs sm:text-sm"
          >
            ביטול
          </button>
          <button
            type="button"
            data-testid="iplan-approve-btn"
            onClick={handleApproveAndUpdate}
            disabled={applying || selectedCount === 0}
            className="btn-primary px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
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

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * פעמון התראות בבר העליון המציג את היסטוריית עדכוני אישורי ההגעה מ-iPlan:
 * - מציג כל סבב עדכון ככרטיסייה מתקפלת קומפקטית (כך שגם אם עודכנו עשרות רשומות, הרשימה נשארת נקייה).
 * - מאפשר הסתרה של עדכון בודד (X) או ניקוי כל ההתראות בלחיצה אחת ("נקה הכל").
 * - מסתיר אוטומטית עדכונים ישנים מעל 14 יום.
 */
export function ActivityBell({
  activity = [],
  userId = "anon",
  weddingId = "local",
  pendingIplanCount = 0,
  onOpenIplanModal,
}) {
  const [open, setOpen] = useState(false);
  const [expandedBatchIds, setExpandedBatchIds] = useState(() => new Set());
  const menuRef = useRef(null);

  const seenStorageKey = `wp_activity_seen_${userId || "anon"}_${weddingId || "local"}`;
  const dismissedStorageKey = `wp_activity_dismissed_${userId || "anon"}_${weddingId || "local"}`;

  const [seenTimestamp, setSeenTimestamp] = useState(0);
  const [mountNow] = useState(() => Date.now());
  const [dismissedState, setDismissedState] = useState(() => {
    try {
      const raw = localStorage.getItem(dismissedStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          clearedBefore: Number(parsed.clearedBefore) || 0,
          ids: Array.isArray(parsed.ids) ? parsed.ids : [],
        };
      }
    } catch {
      /* ignore */
    }
    return { clearedBefore: 0, ids: [] };
  });

  const lastSeenAt = useMemo(() => {
    try {
      return Math.max(seenTimestamp, Number(localStorage.getItem(seenStorageKey)) || 0);
    } catch {
      return seenTimestamp;
    }
    // activity נמצא בתלויות בכוונה: מרענן את הקריאה מ-localStorage אחרי שהמשתמש עצמו אישר עדכון
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seenStorageKey, seenTimestamp, activity]);

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

  const visibleActivity = useMemo(() => {
    const now = Math.max(mountNow, seenTimestamp, dismissedState.clearedBefore || 0);
    const dismissedSet = new Set(dismissedState.ids || []);
    return (activity || []).filter((item) => {
      const id = item.id || item.batchId;
      if (id && dismissedSet.has(id)) return false;
      const t = new Date(item.at).getTime();
      if (Number.isFinite(t)) {
        if (dismissedState.clearedBefore > 0 && t <= dismissedState.clearedBefore) return false;
        if (now - t > FOURTEEN_DAYS_MS) return false;
      }
      return true;
    });
  }, [activity, dismissedState, mountNow, seenTimestamp]);

  const unreadActivityCount = useMemo(() => {
    return visibleActivity.filter((item) => {
      // פעולה שהמשתמש הנוכחי עצמו ביצע הרגע כבר מוכרת לו ואינה התראה חדשה שלא נקראה
      if (userId && item.byUid && item.byUid === userId) return false;
      const t = new Date(item.at).getTime();
      return Number.isFinite(t) && t > lastSeenAt;
    }).length;
  }, [visibleActivity, lastSeenAt, userId]);

  const badgeCount = unreadActivityCount + (pendingIplanCount > 0 ? pendingIplanCount : 0);

  function saveDismissedState(next) {
    setDismissedState(next);
    try {
      localStorage.setItem(dismissedStorageKey, JSON.stringify(next));
    } catch {
      /* ignore quota */
    }
  }

  function handleDismissBatch(batchId) {
    if (!batchId) return;
    const nextIds = Array.from(new Set([...(dismissedState.ids || []), batchId]));
    saveDismissedState({ ...dismissedState, ids: nextIds });
  }

  function handleClearAll() {
    const now = Date.now();
    const allIds = visibleActivity.map((b) => b.id || b.batchId).filter(Boolean);
    saveDismissedState({
      clearedBefore: now,
      ids: Array.from(new Set([...(dismissedState.ids || []), ...allIds])),
    });
    setExpandedBatchIds(new Set());
  }

  function toggleBatchExpanded(batchId) {
    setExpandedBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  }

  function toggleMenu() {
    const next = !open;
    setOpen(next);
    if (next) {
      const now = Date.now();
      setSeenTimestamp(now);
      try {
        localStorage.setItem(seenStorageKey, String(now));
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
          data-testid="activity-bell-popover"
          className="animate-fade-in-up fixed inset-x-3 top-16 z-50 overflow-hidden rounded-2xl bg-white text-right shadow-2xl ring-1 ring-slate-200 sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-2 sm:w-96"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-3.5 py-2.5">
            <span className="text-xs font-bold text-slate-800">עדכוני אישורי הגעה (iPlan)</span>
            <div className="flex items-center gap-3">
              {visibleActivity.length > 0 && (
                <button
                  type="button"
                  data-testid="activity-clear-all-btn"
                  onClick={handleClearAll}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 transition hover:text-rose-600"
                  title="ניקוי כל ההתראות"
                >
                  <Trash2 size={12} />
                  <span>נקה הכל</span>
                </button>
              )}
            </div>
          </div>

          {onOpenIplanModal && (
            <div className="border-b border-gold-200 bg-gold-50/80 px-3.5 py-2.5">
              <button
                type="button"
                data-testid="activity-open-iplan-btn"
                onClick={() => {
                  setOpen(false);
                  onOpenIplanModal();
                }}
                className="flex w-full items-center justify-between gap-2 text-right text-xs font-semibold text-gold-900"
              >
                <span>
                  {pendingIplanCount > 0
                    ? `ממתינים ${pendingIplanCount} עדכוני אישורי הגעה לאישורכם`
                    : "מקור iPlan זמין לבדיקת עדכונים"}
                </span>
                <span className="shrink-0 rounded-lg bg-gold-500 px-2.5 py-1 text-[11px] text-slate-950">
                  {pendingIplanCount > 0 ? `בדיקה ואישור (${pendingIplanCount})` : "פתיחת הסנכרון"}
                </span>
              </button>
            </div>
          )}

          <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
            {visibleActivity.length === 0 ? (
              <p className="px-4 py-7 text-center text-xs text-slate-400">
                אין התראות חדשות על עדכוני אישורי הגעה.
              </p>
            ) : (
              visibleActivity.map((batch) => {
                const batchId = batch.id || batch.batchId;
                const changes = batch.changes || [];
                const count = batch.updatedCount || changes.length || 0;
                const isExpanded = expandedBatchIds.has(batchId);
                const previewNames = changes
                  .slice(0, 2)
                  .map((c) => c.guestName)
                  .filter(Boolean)
                  .join(", ");
                const extraCount = Math.max(0, changes.length - 2);

                return (
                  <div key={batchId} className="px-3.5 py-2.5 transition hover:bg-slate-50/60">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        data-testid="activity-batch-toggle"
                        onClick={() => toggleBatchExpanded(batchId)}
                        className="min-w-0 flex-1 text-right"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-800">
                            עודכנו {count} רשומות
                          </span>
                          <span className="text-[11px] text-slate-400" dir="ltr">
                            {batch.at
                              ? new Date(batch.at).toLocaleString("he-IL", {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                })
                              : ""}
                          </span>
                        </div>
                        {previewNames && !isExpanded && (
                          <p className="mt-0.5 truncate text-[11px] text-slate-500">
                            {previewNames}
                            {extraCount > 0 ? ` ועוד ${extraCount}…` : ""}
                          </p>
                        )}
                        <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-gold-700">
                          {isExpanded ? (
                            <>
                              הסתר פירוט <ChevronUp size={12} />
                            </>
                          ) : (
                            <>
                              הצג פירוט ({changes.length}) <ChevronDown size={12} />
                            </>
                          )}
                        </span>
                      </button>

                      <button
                        type="button"
                        data-testid="activity-dismiss-batch-btn"
                        onClick={() => handleDismissBatch(batchId)}
                        title="הסתר התראה זו"
                        aria-label="הסתר התראה זו"
                        className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-600"
                      >
                        <X size={13} />
                      </button>
                    </div>

                    {isExpanded && changes.length > 0 && (
                      <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200/70">
                        {changes.map((c, idx) => (
                          <div
                            key={`${c.guestId}-${idx}`}
                            className="flex items-center justify-between gap-2 text-xs text-slate-600"
                          >
                            <span className="truncate font-medium text-slate-800">
                              {c.guestName}
                            </span>
                            <span className="shrink-0 text-[11px] text-slate-500">
                              {formatRsvpLabel(c.fromRsvp, c.fromAttendingCount)} ←{" "}
                              <strong className="text-slate-800">
                                {formatRsvpLabel(c.toRsvp, c.toAttendingCount)}
                              </strong>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
