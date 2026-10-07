import { Component, useCallback, useEffect, useMemo, useRef, useState, memo, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import {
  LayoutDashboard,
  Users,
  Briefcase,
  Wallet,
  Smartphone,
  Heart,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock,
  Plus,
  Upload,
  Download,
  Trash2,
  Phone,
  Mail,
  FileText,
  Gift,
  UserCheck,
  ChevronLeft,
  X,
  Crown,
  Armchair,
  Sparkles,
  Link2,
  PiggyBank,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  AlertTriangle,
  ListTodo,
  Save,
  Settings2,
  Menu,
  MoreHorizontal,
  CheckCheck,
  Search,
  Columns3,
  Star,
  HelpCircle,
  MapPin,
  Filter,
  UtensilsCrossed,
  Cloud,
  CloudOff,
  LogOut,
  Lock,
  Loader2,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Tag,
  GripVertical,
  Share2,
  UserPlus,
  Copy,
  Eye,
  KeyRound,
  Paperclip,
  ExternalLink,
  MessageCircle,
  FileSpreadsheet,
  Wine,
  Minus,
  Droplets,
  ShoppingCart,
  ListChecks,
  Fingerprint,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { SEED_GUESTS, GUEST_CATEGORIES } from "./data/guestsData";
import { SEED_TABLES, SEED_VENDORS, SEED_BUDGET, CHECKLIST_TEMPLATE, CHECKLIST_CATEGORIES } from "./data/seedData";
import {
  authTourSteps,
  appTourSteps,
  markGuideSeen,
} from "./data/guide";
import { Tour } from "./components/Guide";
import { firebaseConfigured as isCloudConfigured } from "./lib/firebase";
import {
  loadSession,
  onAuthChange,
  signIn,
  signUp,
  signOut,
  authErrorMessage,
  requestPasswordReset,
  verifyPasswordResetCode,
  resetPassword,
  requestEmailVerification,
  verifyEmailActionCode,
} from "./lib/firebaseAuth";
import {
  passkeySupported,
  platformAuthenticatorAvailable,
  registerPasskey,
  signInWithPasskey,
  listPasskeys,
  deletePasskey,
  rememberedPasskeyEmail,
  passkeyErrorMessage,
  preparePasskeyLogin,
  passkeyLoginWarm,
} from "./lib/passkeys";
import {
  cloudFetchAll,
  waitForAuthContext,
  cloudIsEmpty,
  cloudSeed,
  cloudSyncDataset,
  listWeddings,
  createWedding,
  updateWedding,
  saveWeddingSettings,
  inviteMember,
  addPartner,
  acceptInvite,
  listMembers,
  removeMember,
  updateMember,
  hasScope,
  isFullScope,
  SCOPE_OPTIONS,
  ALL_SCOPES,
  listVendorFiles,
  listDeletedVendorFiles,
  uploadVendorFile,
  deleteVendorFile,
  restoreVendorFile,
  vendorFileUrl,
  uploadCountdownBackground,
  deleteWedding,
  ensureMyWedding,
  migrateVendorIds,
  subscribeCollection,
  touchMembership,
  MAX_FILE_BYTES,
} from "./lib/firebaseStore";
import AdminDashboard from "./components/AdminDashboard.jsx";
import ChecklistOptionsManager from "./components/ChecklistOptionsManager.jsx";
import { isAdminEmail } from "./lib/adminConfig.js";
import { findDuplicatePhones, describeDuplicates } from "./lib/guestDuplicates.js";
import {
  encryptBackup,
  decryptBackup,
  isEncryptedBackup,
  validateEncryptedBackup,
  isCryptoAvailable,
} from "./lib/backupCrypto";
import { exportWeddingWorkbook, readWorkbookBackup } from "./lib/excelExport";
import { ENTITIES } from "./lib/entityMap";
import { summarizeDrinkPurchase } from "./lib/alcoholCalculator";
import { readGuestRows, rowsToGuests, ImportError } from "./lib/guestImport";
import { useAccessibleModal } from "./hooks/useAccessibleModal";
import logoUrl from "./assets/logo.jpg";

/* =========================================================================
 *  LOGO
 *  ------------------------------------------------------------------------
 *  אותו קובץ שמשמש כאייקון של האפליקציה במסך הבית, כדי שהזיהוי יהיה זהה
 *  בין האייקון לבין המסך שנפתח. הרקע של הציור הוא נייר בז' ולא שקוף,
 *  ולכן יש רקע תואם מתחתיו - אחרת נראית מסגרת לבנה בפינות המעוגלות.
 * ====================================================================== */

function Logo({ className = "h-14 w-14", rounded = "rounded-2xl" }) {
  return (
    <img
      src={logoUrl}
      alt=""
      aria-hidden="true"
      width={512}
      height={512}
      className={`${className} ${rounded} shrink-0 bg-[#f7f6f2] object-cover shadow-md ring-1 ring-gold-200/60`}
    />
  );
}

/* =========================================================================
 *  DATA LAYER (Mock)
 *  ------------------------------------------------------------------------
 *  All seed data lives here. To connect a real backend (Firebase / Supabase
 *  / Google Sheets), replace these constants with fetched data and swap the
 *  local `useState` setters for async mutations. The component tree only
 *  talks to state + setter props, so the UI stays untouched.
 * ====================================================================== */

//  ברירת מחדל היסטורית בלבד. שמות בני הזוג ניתנים לעריכה מהדאשבורד ונשמרים
//  לכל חתונה בנפרד; במצב ענן חתונה חדשה מתחילה בלי שמות כלל.
const COUPLE = { partnerA: "אוראל", partnerB: "מיתר" };

//  שמות בני הזוג הם מקור האמת היחיד לשם החתונה בכל המסכים (סרגל צד, מחליף
//  חתונות, הזמנת שיתוף, שם קובץ האקסל). שם החתונה השמור ב-DB הוא רק גיבוי
//  לחתונה שעדיין לא מילאו בה שמות.
const coupleToTitle = (couple) =>
  [couple?.partnerA, couple?.partnerB].filter(Boolean).join(" & ");

const weddingLabel = (wedding) =>
  coupleToTitle(wedding) || wedding?.name || "החתונה שלנו";

//  ברירת מחדל היסטורית בלבד. במצב ענן התאריך מגיע מהחתונה עצמה, ומשמש
//  כאן רק כדי שמצב localStorage בלי תאריך לא ייפול.
const WEDDING_DATE = new Date(2027, 0, 6, 19, 0, 0);

const RSVP = {
  confirmed: { label: "אישרו הגעה", color: "sage" },
  pending: { label: "ממתין", color: "gold" },
  declined: { label: "לא מגיעים", color: "rose" },
};

const TASK_COLUMNS = [
  { key: "todo", label: "לביצוע", icon: Circle },
  { key: "inprogress", label: "בתהליך", icon: Clock },
  { key: "done", label: "הושלם", icon: CheckCircle2 },
];

/* =========================================================================
 *  HELPERS
 * ====================================================================== */

const ils = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});
const fmt = (n) => ils.format(n || 0);

const tableCapacity = (type) => (type === "knight" ? 24 : 12);

function useCountdown(targetDate) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const diff = Math.max(0, targetDate.getTime() - now);
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return { days, hours, minutes, seconds };
}

const colorMap = {
  sage: "bg-sage-100 text-sage-600 ring-sage-300/40",
  gold: "bg-gold-100 text-gold-600 ring-gold-300/50",
  rose: "bg-rose-100 text-rose-600 ring-rose-300/40",
  slate: "bg-slate-100 text-slate-600 ring-slate-300/40",
};

/* =========================================================================
 *  TOASTS + CONFIRM DIALOG (styled, replace native alert/confirm)
 * ====================================================================== */

const toastListeners = new Set();
let toastSeq = 0;
function notify(message, opts = {}) {
  const id = ++toastSeq;
  const toast = {
    id,
    message,
    tone: opts.tone || "info", // info | success | error
    duration: opts.duration ?? 4500,
    action: opts.action || null, // { label, onClick }
  };
  toastListeners.forEach((l) => l({ type: "add", toast }));
  if (toast.duration > 0) setTimeout(() => dismissToast(id), toast.duration);
  return id;
}
function dismissToast(id) {
  toastListeners.forEach((l) => l({ type: "remove", id }));
}

function ToastHost() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    const listener = (ev) => {
      if (ev.type === "add")
        setToasts((p) => [...p.filter((t) => t.id !== ev.toast.id), ev.toast].slice(-3));
      else setToasts((p) => p.filter((t) => t.id !== ev.id));
    };
    toastListeners.add(listener);
    return () => toastListeners.delete(listener);
  }, []);
  const toneCls = {
    info: "bg-slate-800 text-white ring-slate-700/60",
    success: "bg-sage-600 text-white ring-sage-500/60",
    error: "bg-rose-600 text-white ring-rose-500/60",
  };
  const toneIcon = { info: CheckCircle2, success: CheckCircle2, error: AlertCircle };
  return (
    //  z גבוה מכל המודלים (105/110): הודעת שגיאה שנפתחת מתוך פופ-אפ נבלעה
    //  מאחוריו, והמשתמש לא ראה למה הפעולה נכשלה.
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[200] flex flex-col items-center gap-2 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      {toasts.map((t) => {
        const Icon = toneIcon[t.tone] || CheckCircle2;
        return (
          <div
            key={t.id}
            className={`animate-fade-in-up pointer-events-auto flex w-full max-w-[min(92vw,36rem)] min-w-0 items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium shadow-xl ring-1 ${
              toneCls[t.tone] || toneCls.info
            }`}
          >
            <Icon size={18} className="shrink-0" />
            <span className="min-w-0 flex-1 whitespace-pre-line break-words">{t.message}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action.onClick();
                  dismissToast(t.id);
                }}
                className="mr-1 rounded-lg bg-white/20 px-3 py-1 text-xs font-bold transition hover:bg-white/30"
              >
                {t.action.label}
              </button>
            )}
            <button
              onClick={() => dismissToast(t.id)}
              aria-label="סגירת ההודעה"
              className="rounded-lg p-1 text-white/70 transition hover:bg-white/20 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

const confirmListeners = new Set();
function confirmDialog(opts) {
  return new Promise((resolve) => {
    if (confirmListeners.size === 0) {
      resolve(window.confirm(opts.message || opts.title || ""));
      return;
    }
    confirmListeners.forEach((l) => l({ ...opts, resolve }));
  });
}

function ConfirmHost() {
  const [req, setReq] = useState(null);
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);
  useEffect(() => {
    const listener = (r) => setReq(r);
    confirmListeners.add(listener);
    return () => confirmListeners.delete(listener);
  }, []);
  const close = (val) => {
    if (!req) return;
    req.resolve(val);
    setReq(null);
  };
  const danger = req?.tone === "danger";
  useAccessibleModal({
    open: !!req,
    containerRef: dialogRef,
    initialFocusRef: danger ? cancelRef : confirmRef,
    onRequestClose: () => close(false),
  });
  if (!req) return null;
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={() => close(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={req.message ? "confirm-dialog-message" : undefined}
        ref={dialogRef}
        className="animate-fade-in-up w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${
              danger ? "bg-rose-100 text-rose-600" : "bg-gold-100 text-gold-600"
            }`}
          >
            {danger ? <Trash2 size={20} /> : <AlertCircle size={20} />}
          </span>
          <div className="flex-1">
            <h3 id="confirm-dialog-title" className="font-display text-lg font-bold text-slate-800">{req.title}</h3>
            {req.message && (
              <p id="confirm-dialog-message" className="mt-1 whitespace-pre-line text-sm text-slate-500">
                {req.message}
              </p>
            )}
          </div>
        </div>
        <div className="mt-6 flex justify-start gap-2">
          <button
            ref={confirmRef}
            onClick={() => close(true)}
            className={danger ? "btn-danger" : "btn-primary"}
          >
            {req.confirmLabel || "אישור"}
          </button>
          <button
            ref={cancelRef}
            onClick={() => close(false)}
            className="btn-secondary"
          >
            {req.cancelLabel || "ביטול"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 *  promptDialog – כמו confirmDialog אבל עם שדה קלט אחד.
 *  משמש לסיסמת הצפנת הגיבוי ולשם חתונה חדשה. מחזיר את הערך או null.
 * ---------------------------------------------------------------------- */
const promptListeners = new Set();
function promptDialog(opts) {
  return new Promise((resolve) => {
    if (promptListeners.size === 0) {
      resolve(window.prompt(opts.message || opts.title || "") ?? null);
      return;
    }
    promptListeners.forEach((l) => l({ ...opts, resolve }));
  });
}

function PromptHost() {
  const [req, setReq] = useState(null);
  const [value, setValue] = useState("");
  const dialogRef = useRef(null);
  useEffect(() => {
    const listener = (r) => {
      setReq(r);
      setValue(r.initialValue || "");
    };
    promptListeners.add(listener);
    return () => promptListeners.delete(listener);
  }, []);
  const close = (val) => {
    if (!req) return;
    req.resolve(val);
    setReq(null);
    setValue("");
  };
  useAccessibleModal({
    open: !!req,
    containerRef: dialogRef,
    onRequestClose: () => close(null),
  });
  if (!req) return null;
  const submit = (e) => {
    e.preventDefault();
    const v = value.trim();
    if (!v && req.required !== false) return;
    close(v);
  };
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={() => close(null)}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-dialog-title"
        aria-describedby={req.message ? "prompt-dialog-message" : undefined}
        ref={dialogRef}
        className="animate-fade-in-up w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold-100 text-gold-600">
            {req.type === "password" ? (
              <KeyRound size={20} />
            ) : req.type === "date" ? (
              <Calendar size={20} />
            ) : (
              <Pencil size={20} />
            )}
          </span>
          <div className="flex-1">
            <h3 id="prompt-dialog-title" className="font-display text-lg font-bold text-slate-800">{req.title}</h3>
            {req.message && (
              <p id="prompt-dialog-message" className="mt-1 whitespace-pre-line text-sm text-slate-500">
                {req.message}
              </p>
            )}
          </div>
        </div>
        <input
          autoFocus
          type={
            req.type === "password" || req.type === "date" ? req.type : "text"
          }
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={req.placeholder || ""}
          dir={req.type === "password" || req.type === "date" ? "ltr" : "rtl"}
          className="mt-5 w-full rounded-xl bg-white px-3 py-2.5 text-sm outline-none ring-1 ring-slate-200 focus:ring-gold-400"
        />
        <div className="mt-6 flex justify-start gap-2">
          <button
            type="submit"
            className="rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-sm transition hover:bg-gold-600"
          >
            {req.confirmLabel || "אישור"}
          </button>
          <button
            type="button"
            onClick={() => close(null)}
            className="btn-secondary"
          >
            {req.cancelLabel || "ביטול"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* =========================================================================
 *  SHARED UI PRIMITIVES
 * ====================================================================== */

function Badge({ color = "slate", children, className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${colorMap[color]} ${className}`}
    >
      {children}
    </span>
  );
}

/* Category tag colors – cool tones for צד חתן, warm tones for צד כלה,
   so the two sides are clearly distinguishable at a glance. */
const GROOM_BADGE_COLORS = [
  "bg-blue-100 text-blue-700 ring-blue-300/60",
  "bg-sky-100 text-sky-700 ring-sky-300/60",
  "bg-cyan-100 text-cyan-700 ring-cyan-300/60",
  "bg-teal-100 text-teal-700 ring-teal-300/60",
  "bg-emerald-100 text-emerald-700 ring-emerald-300/60",
  "bg-green-100 text-green-700 ring-green-300/60",
  "bg-lime-100 text-lime-700 ring-lime-400/60",
  "bg-indigo-100 text-indigo-700 ring-indigo-300/60",
  "bg-blue-200 text-blue-800 ring-blue-400/60",
  "bg-sky-200 text-sky-800 ring-sky-400/60",
  "bg-cyan-200 text-cyan-800 ring-cyan-400/60",
  "bg-teal-200 text-teal-800 ring-teal-400/60",
];
const BRIDE_BADGE_COLORS = [
  "bg-rose-100 text-rose-700 ring-rose-300/60",
  "bg-pink-100 text-pink-700 ring-pink-300/60",
  "bg-fuchsia-100 text-fuchsia-700 ring-fuchsia-300/60",
  "bg-purple-100 text-purple-700 ring-purple-300/60",
  "bg-violet-100 text-violet-700 ring-violet-300/60",
  "bg-red-100 text-red-700 ring-red-300/60",
  "bg-orange-100 text-orange-700 ring-orange-400/60",
  "bg-amber-100 text-amber-700 ring-amber-400/60",
];
const NEUTRAL_BADGE = "bg-slate-100 text-slate-600 ring-slate-300/50";

// Deterministic string hash so user-added categories always get a stable color.
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const ROW_ID_HIGH_WATER_KEY = "wp:v1:row-id-high-water";
let lastGeneratedRowId = 0;

function nextNumericId(list) {
  const maxActiveId = list.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0);
  let persistedHighWater = 0;
  try {
    persistedHighWater = Number(localStorage.getItem(ROW_ID_HIGH_WATER_KEY)) || 0;
  } catch {
    // Private browsing or disabled storage: the in-memory and timestamp guards still apply.
  }

  const nextId = Math.max(Date.now(), maxActiveId + 1, persistedHighWater + 1, lastGeneratedRowId + 1);
  lastGeneratedRowId = nextId;
  try {
    localStorage.setItem(ROW_ID_HIGH_WATER_KEY, String(nextId));
  } catch {
    // The row remains usable in memory if local storage is unavailable.
  }
  return nextId;
}

// Soft-deleted cloud records keep their document IDs, so never reuse an ID
// merely because the highest active row was deleted.
function nextGuestId(list) {
  return nextNumericId(list);
}

function nextRowId(list) {
  return nextNumericId(list);
}

/* ── קישור בין ספק לסעיף תקציב ─────────────────────────────────────────────
 *  כל ספק מקבל סעיף משלו ב"מעקב תקציב מפורט", מסומן ב-vendorId. הסעיף נוצר
 *  ברגע הוספת הספק (גם ב-0 ₪), נגרר אחרי שינויי שם ועלות, ונמחק יחד איתו.
 *  ה-id של הסעיף עצמאי — שני המספרים מגיעים מ-nextRowId על אוספים שונים
 *  ובוודאות יתנגשו, ולכן אסור להשתמש ב-id של הספק כ-id של הסעיף.
 */
function newVendorBudgetRow(vendor, budgetRows) {
  const cost = Number(vendor.contractCost) || 0;
  return {
    id: nextRowId(budgetRows),
    category: vendor.name,
    expected: cost,
    actual: cost,
    //  המקדמה שנרשמה בכרטיס הספק היא בדיוק מה שכבר שולם לו.
    paid: Number(vendor.deposit) || 0,
    vendorId: vendor.id,
  };
}

/*  ניקוי יתומים בטעינת החתונה: סעיף שמצביע על ספק שנמחק במכשיר אחר.
 *
 *  ⚠ בכוונה אין כאן השלמה רטרואקטיבית של סעיף לכל ספק שאינו מקושר: בחתונה
 *  שנוצרה לפני התכונה כבר יש סעיפים שהוקלדו ידנית לאותם ספקים, והשלמה
 *  אוטומטית היתה מכפילה אותם ומנפחת את הסיכומים. סעיף נוצר רק כפעולה
 *  מודעת של המשתמש — הוספת ספק בלשונית ספקים.
 *
 *  מחזיר את המערך המקורי כשאין מה לתקן, כדי לא להפעיל סנכרון ענן מיותר.  */
function reconcileVendorBudgetRows(budgetRows, vendors) {
  //  רשימת ספקים ריקה אינה ראיה לכך שהספקים נמחקו — היא גם המצב של טעינה
  //  חלקית או של חוסר הרשאה. ניקוי יתומים על סמך רשימה ריקה היה מוחק את כל
  //  סעיפי הספקים, ולכן הוא נעשה רק כשיש ספקים בפועל.
  const vendorIds = new Set(vendors.map((v) => v.id));
  if (!vendorIds.size) return budgetRows;
  const kept = budgetRows.filter(
    (b) => b.vendorId == null || vendorIds.has(b.vendorId)
  );
  return kept.length === budgetRows.length ? budgetRows : kept;
}

//  נרמול שורות מקובץ גיבוי: מחיל טרנספורמציה, ומשלים id ייחודי לכל שורה
//  שהגיעה בלי id תקין (id כפול היה גורם למחיקה למחוק שתי שורות).
function withIds(rows, transform) {
  let next = nextRowId(rows.filter((r) => Number(r?.id) > 0));
  const seen = new Set();
  return rows.map((row) => {
    let id = Number(row?.id);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) id = next++;
    seen.add(id);
    return { ...transform(row), id };
  });
}

function SortHeader({ label, sortKey, sort, onSort, center = false, className = "" }) {
  const active = sort.key === sortKey;
  return (
    <th className={`px-2 py-2 font-semibold ${center ? "text-center" : ""} ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title="מיון לפי עמודה זו"
        className={`inline-flex min-h-11 items-center gap-1 transition hover:text-slate-700 ${
          active ? "text-gold-600" : ""
        }`}
      >
        {label}
        {active ? (
          sort.dir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />
        ) : (
          <ChevronsUpDown size={12} className="opacity-40" />
        )}
      </button>
    </th>
  );
}

const categoryBadgeStyles = (() => {
  const map = {};
  let g = 0;
  let b = 0;
  for (const c of GUEST_CATEGORIES) {
    if (c.startsWith("צד כלה")) {
      map[c] = BRIDE_BADGE_COLORS[b % BRIDE_BADGE_COLORS.length];
      b += 1;
    } else if (c.startsWith("צד חתן")) {
      map[c] = GROOM_BADGE_COLORS[g % GROOM_BADGE_COLORS.length];
      g += 1;
    } else {
      map[c] = NEUTRAL_BADGE;
    }
  }
  return map;
})();

// Categories are user-editable at runtime; the seed list is the default value.
const CategoriesContext = createContext(GUEST_CATEGORIES);

/*  הרשאת עריכה. עד כה כל תוכן המסכים ישב בתוך <fieldset disabled> אחד,
    וזה ניטרל גם כפתורים שרק משנים תצוגה — חיפוש, סינון, מיון, מעבר טאבים
    ו"הצג עוד". צופה נשאר תקוע ב-30 המוזמנים הראשונים בלי יכולת לחפש.
    מכאן והלאה כל מסך מסתיר או מנטרל בעצמו רק את מה שכותב.
    זו שכבת UX; הגבול האמיתי הוא ה-RLS וה-403 בשרת.  */
const CanEditContext = createContext(true);
const useCanEdit = () => useContext(CanEditContext);

// Resolve a badge color for any category, including ones added after load.
function categoryStyle(category) {
  if (categoryBadgeStyles[category]) return categoryBadgeStyles[category];
  if (category?.startsWith("צד כלה"))
    return BRIDE_BADGE_COLORS[hashStr(category) % BRIDE_BADGE_COLORS.length];
  if (category?.startsWith("צד חתן"))
    return GROOM_BADGE_COLORS[hashStr(category) % GROOM_BADGE_COLORS.length];
  return NEUTRAL_BADGE;
}

function CategoryBadge({ category }) {
  const isBride = category?.startsWith("צד כלה");
  const isGroom = category?.startsWith("צד חתן");
  const style = categoryStyle(category);
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-inset ${style} ${
        isBride ? "ring-2" : "ring-1"
      }`}
    >
      {isBride ? (
        <Heart size={11} className="fill-current" />
      ) : isGroom ? (
        <Crown size={11} />
      ) : null}
      {category}
    </span>
  );
}

function ProgressBar({ value, max, tone = "gold" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const tones = {
    gold: "from-gold-400 to-gold-600",
    sage: "from-sage-300 to-sage-500",
    rose: "from-rose-300 to-rose-500",
  };
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200/70">
      <div
        className={`h-full rounded-full bg-gradient-to-l ${tones[tone]} transition-all duration-500`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/*  סרגל התקציב. סרגל אחד עם שני מקטעים עונה על שלוש שאלות במבט אחד: כמה כבר
    יצא מהכיס (מלא כהה), כמה עוד מחכה לתשלום (מלא בהיר) וכמה מרווח נשאר עד
    היעד (אפור). סרגל אחוזים רגיל היה מראה רק מספר אחד מתוך השלושה.

    כשהסכום שנדרש לשלם עובר את היעד אין יותר מרווח להציג, ולכן הקנה מידה
    עובר לסכום עצמו והמקטע שטרם שולם נצבע באדום — אחרת המקטעים היו נחתכים
    בקצה והמשתמש לא היה רואה שהוא בחריגה.  */
function BudgetSplitBar({ paid, remaining, max }) {
  const due = Math.max(0, paid) + Math.max(0, remaining);
  const over = max > 0 && due > max;
  const scale = max > 0 ? (over ? due : max) : due;
  const pct = (n) => (scale > 0 ? Math.max(0, (n / scale) * 100) : 0);
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-200/70">
      <div
        style={{ width: `${pct(paid)}%` }}
        className="h-full bg-gradient-to-l from-gold-500 to-gold-600 transition-all duration-500"
      />
      <div
        style={{ width: `${pct(remaining)}%` }}
        className={`h-full transition-all duration-500 ${
          over ? "bg-rose-300" : "bg-gold-200"
        }`}
      />
    </div>
  );
}

/*  סרגל התקציב במסך "ניהול תקציב". הוא עונה על שלוש השאלות של המסך במבט
    אחד: כמה כבר יצא מהכיס, כמה עוד מחכה לתשלום, וכמה מרווח נשאר עד היעד.

    העלות הכוללת שווה תמיד לשולם + נותר לשלם, ולכן הסרגל מתאר סכום אחד
    שמתחלק לשניים — ולא שני קני מידה שונים כמו בגרסה הקודמת. כשהעלויות
    עוברות את היעד הקנה מידה עובר אליהן והעודף נצבע באדום, אחרת החריגה
    הייתה נחתכת בקצה בלי שרואים אותה.  */
function BudgetGoalBar({ goal, cost, paid, remaining }) {
  const free = Math.max(0, goal - cost);
  const overflow = Math.max(0, cost - goal);
  const scale = Math.max(goal, cost, 1);
  const pct = (n) => Math.max(0, Math.min(100, (n / scale) * 100));
  const over = goal > 0 && overflow > 0;

  const segments = [
    { key: "paid", value: paid, bar: "bg-sage-500", dot: "bg-sage-500", label: "שולם" },
    { key: "remaining", value: remaining, bar: "bg-gold-400", dot: "bg-gold-400", label: "נותר לשלם" },
    goal > 0 &&
      (over
        ? { key: "over", value: overflow, bar: "bg-rose-400", dot: "bg-rose-400", label: "חריגה מהיעד" }
        : { key: "free", value: free, bar: "bg-transparent", dot: "bg-slate-300", label: "מרווח עד היעד" }),
  ].filter(Boolean);

  return (
    <div className="space-y-2.5">
      <div
        role="img"
        aria-label={segments.map((s) => `${s.label}: ${fmt(s.value)}`).join(", ")}
        className="flex h-4 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200 sm:h-5"
      >
        {segments.map((s) => (
          <div
            key={s.key}
            style={{ width: `${pct(s.value)}%` }}
            className={`h-full transition-all duration-500 ${s.bar}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {segments.map((s) => (
          <div key={s.key} className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 sm:text-xs">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} />
              <span className="truncate">{s.label}</span>
            </p>
            <p className="mt-0.5 ps-4 text-sm font-bold tabular-nums text-slate-800">
              {fmt(s.value)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/*  מספר מרכזי בכרטיס הסיכום. שלושת אלה הם כל מה שצריך לדעת
    על התקציב לפני שצוללים לסעיפים עצמם.  */
function BudgetFigure({ label, value, tone = "slate" }) {
  const tones = {
    slate: "bg-white/70 ring-slate-200 text-slate-800",
    sage: "bg-sage-50 ring-sage-200 text-sage-800",
    gold: "bg-gold-50 ring-gold-200 text-gold-800",
  };
  return (
    <div className={`min-w-0 rounded-2xl px-2.5 py-2.5 ring-1 ring-inset sm:px-4 sm:py-3 ${tones[tone]}`}>
      <p className="truncate text-[11px] font-medium opacity-80 sm:text-xs">{label}</p>
      <p className="mt-0.5 truncate text-base font-bold tabular-nums sm:text-xl">{value}</p>
    </div>
  );
}

function Card({ children, className = "", tourId, style }) {
  return (
    <div
      data-tour={tourId}
      style={style}
      /*  רווח פנימי קטן יותר בנייד: ב-390px כל כרטיס ביזבז 40px מהרוחב
          ו-40px מהגובה רק על ריפוד, ויש עשרות כרטיסים במסך.  */
      className={`glass rounded-2xl p-3.5 shadow-[0_10px_40px_-15px_rgba(51,65,85,0.25)] sm:rounded-3xl sm:p-5 ${className}`}
    >
      {children}
    </div>
  );
}

// Grid 0fr→1fr animates to the content's real height. Closed = inert, so the fields
// leave the tab order and the screen reader; data-tour sits on the wrapper so the guided tour
// still finds the button while the form is collapsed.
function CollapsibleAdd({ label, open, onToggle, panelId, toggleRef, tourId, className = "", children }) {
  return (
    <div data-tour={tourId} className={className}>
      <button
        ref={toggleRef}
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={`group flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border-2 border-dashed px-3.5 py-2 text-start transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 ${
          open
            ? "border-gold-400 bg-gold-50 text-gold-700"
            : "border-gold-300 bg-gold-50/50 text-gold-700 hover:border-gold-400 hover:bg-gold-50"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gold-500 text-white shadow-sm shadow-gold-500/30 transition group-hover:bg-gold-600">
            <Plus size={16} className={`transition-transform duration-300 ${open ? "rotate-45" : ""}`} />
          </span>
          <span className="truncate text-sm font-bold">{label}</span>
        </span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-gold-600 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        id={panelId}
        inert={!open}
        aria-hidden={!open}
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
      {/*  במובייל הכותרת תופסת שורה שלמה והאקשן יורד מתחתיה. בלי זה הכותרת
          נמעכת לשלוש שורות כדי לפנות מקום לכפתור.  */}
      <div className="flex w-full min-w-0 items-center gap-2.5 sm:w-auto sm:flex-1 sm:gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-gold-400 to-gold-600 text-white shadow-lg shadow-gold-500/30 sm:h-11 sm:w-11 sm:rounded-2xl">
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold text-slate-800 sm:text-2xl">
            {title}
          </h2>
          {subtitle && <p className="text-xs text-slate-500 sm:text-sm">{subtitle}</p>}
        </div>
      </div>
      {action && (
        //  בנייד האקשן חייב לקבל שורה מלאה ולהיות מסוגל להתקפל.
        //  עם `shrink-0` לבדו טופס עם שדה + רשימה + כפתור גלש מחוץ
        //  לכרטיס והכפתור נחתך.
        <div className="w-full min-w-0 sm:w-auto sm:shrink-0">{action}</div>
      )}
    </div>
  );
}

/* =========================================================================
 *  SIDEBAR
 * ====================================================================== */

//  scope = ההיקף שנדרש כדי לראות את המסך. null = דורש היקף מלא (הדאשבורד
//  מציג נתונים מכל הטבלאות, ולכן אין לו משמעות בשיתוף חלקי).
//  hidden = המסך קיים בקוד אבל אינו מוצג. להחזרתו — מחיקת השורה הזו בלבד.
const NAV = [
  { key: "overview", label: "דאשבורד ראשי", icon: LayoutDashboard, scope: null },
  //  הצ׳קליסט יושב ראשון אחרי הדאשבורד: זו השאלה הראשונה
  //  שזוג שואל כשהוא נכנס — “מה עוד נשאר לנו?”
  { key: "checklist", label: "צ׳קליסט", icon: ListChecks, scope: "checklist" },
  { key: "guests", label: "מוזמנים", icon: Users, scope: "guests" },
  { key: "alcohol", label: "חישוב אלכוהול", icon: Wine, scope: "guests" },
  //  ההושבה יושבת על אותו היקף הרשאות כמו המוזמנים (אותה טבלה בפועל),
  //  אבל היא מסך נפרד: היא נפתחת בשלב אחר של התכנון ודורשת מסך מלא.
  { key: "seating", label: "סידור הושבה", icon: Armchair, scope: "guests" },
  { key: "vendors", label: "ספקים", icon: Briefcase, scope: "vendors" },
  { key: "finance", label: "ניהול תקציב", icon: Wallet, scope: "finance" },
  { key: "portal", label: "פורטל ספקים", icon: Smartphone, scope: "vendors", hidden: true },
];

const VISIBLE_NAV = NAV.filter((item) => !item.hidden);

/** מסנן את הניווט לפי ההיקף שהוקצה לחבר. ה-UI בלבד — ה-RLS הוא הגבול. */
function navForScopes(scopes) {
  if (isFullScope(scopes)) return VISIBLE_NAV;
  return VISIBLE_NAV.filter((item) => item.scope && hasScope(scopes, item.scope));
}

/*  מחוות פתיחה למגירת הניווט בטלפון.
 *  המגירה יושבת בקצה הימני (RTL), ולכן החלקה מהקצה הימני שמאלה פותחת
 *  אותה — אותה תנועה שבה היא נכנסת למסך — והחלקה ימינה סוגרת.
 *
 *  המאזינים פסיביים: אנחנו רק מודדים את התנועה ולא מבטלים אותה, אחרת
 *  הגלילה האנכית הרגילה של הדף הייתה נתקעת בכל נגיעה.  */
const EDGE_ZONE = 32; // רוחב הרצועה בקצה שממנה מתחילה פתיחה
const SWIPE_MIN = 60; // מרחק מינימלי כדי שזו תיחשב מחווה ולא נגיעה

function useDrawerSwipe(open, setOpen) {
  useEffect(() => {
    //  ב-lg המגירה היא חלק מהפריסה ואין מה לפתוח.
    const wide = window.matchMedia("(min-width: 1024px)");
    let startX = 0;
    let startY = 0;
    let tracking = false;

    function onStart(e) {
      if (e.touches.length !== 1 || wide.matches) return;
      //  כשמודל פתוח הוא מכסה את המסך; פתיחת המגירה מאחוריו רק מבלבלת.
      //  ConfirmHost משתמש ב-alertdialog ולא ב-dialog, ובלי זה מחווה
      //  בתוך דיאלוג אישור הייתה פותחת את המגירה מאחוריו.
      if (document.querySelector('[role="dialog"],[role="alertdialog"]')) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      //  פתיחה רק מהקצה. בלי ההגבלה הזו כל החלקה אופקית בתוך התוכן
      //  (טבלה שנגללת לצדדים, סרגל טאבים) הייתה פותחת את התפריט.
      tracking = open || startX >= window.innerWidth - EDGE_ZONE;
    }

    function onEnd(e) {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      //  תנועה אנכית דומיננטית היא גלילה, לא מחווה.
      if (Math.abs(dx) < SWIPE_MIN || Math.abs(dy) > Math.abs(dx)) return;
      setOpen(dx < 0);
    }

    function onCancel() {
      tracking = false;
    }

    const opts = { passive: true };
    document.addEventListener("touchstart", onStart, opts);
    document.addEventListener("touchend", onEnd, opts);
    document.addEventListener("touchcancel", onCancel, opts);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onCancel);
    };
  }, [open, setOpen]);
}

function Sidebar({
  active,
  onChange,
  open,
  setOpen,
  modalSuspended = false,
  collapsed,
  setCollapsed,
  navItems = VISIBLE_NAV,
  weddings = [],
  activeWedding = null,
  weddingDate = null,
  coupleTitle = "",
  onSwitchWedding,
  onCreateWedding,
  onOpenMembers,
  onOpenSettings,
}) {
  const drawerRef = useRef(null);
  const drawerCloseRef = useRef(null);
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches
  );
  const mobileOpen = isMobileViewport && open && !modalSuspended;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobileViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useAccessibleModal({
    open: mobileOpen,
    containerRef: drawerRef,
    initialFocusRef: drawerCloseRef,
    onRequestClose: () => setOpen(false),
  });

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/30 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        ref={drawerRef}
        role={mobileOpen ? "dialog" : undefined}
        aria-modal={mobileOpen ? "true" : undefined}
        aria-label={mobileOpen ? "תפריט הניווט" : undefined}
        aria-hidden={isMobileViewport && !open ? "true" : undefined}
        inert={isMobileViewport && !open}
        className={`fixed inset-y-0 right-0 z-40 flex w-72 flex-col gap-2 overflow-y-auto border-l border-white/40 bg-white/70 p-5 backdrop-blur-xl transition-transform duration-300 lg:static ${
          open
            ? "pointer-events-auto translate-x-0"
            : "pointer-events-none translate-x-full lg:pointer-events-auto lg:translate-x-0"
        } ${collapsed ? "lg:hidden" : ""}`}
      >
        <div className="mb-6 flex items-center gap-3 px-2">
          <Logo className="h-12 w-12" />
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold leading-tight text-slate-800">
              תכנון החתונה שלי
            </h1>
            <p className="truncate text-xs text-slate-500">
              {coupleTitle || activeWedding?.name || "החתונה שלנו"}
            </p>
          </div>
          <button
            ref={drawerCloseRef}
            onClick={() => setOpen(false)}
            aria-label="סגירת תפריט הניווט"
            title="סגירת התפריט"
            className="btn-icon mr-auto lg:hidden"
          >
            <X size={19} />
          </button>
          <button
            onClick={() => setCollapsed(true)}
            title="הסתרת התפריט לתצוגה ברוחב מלא"
            aria-label="הסתרת התפריט"
            className="btn-icon mr-auto hidden lg:inline-grid"
          >
            <PanelRightClose size={18} />
          </button>
        </div>

        {activeWedding && (
          <WeddingSwitcher
            weddings={weddings}
            activeWedding={activeWedding}
            onSwitch={onSwitchWedding}
            onCreate={onCreateWedding}
            onOpenMembers={onOpenMembers}
            onOpenSettings={onOpenSettings}
          />
        )}

        <nav className="flex flex-col gap-1.5">
          {navItems.map(({ key, label, icon: Icon }) => {
            const isActive = active === key;
            return (
              <button
                key={key}
                data-tour={`nav-${key}`}
                onClick={() => {
                  onChange(key);
                  setOpen(false);
                }}
                className={`group flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition-all ${
                  isActive
                    ? "bg-gold-500 text-slate-950 shadow-lg shadow-gold-500/30"
                    : "text-slate-600 hover:bg-white hover:text-slate-900"
                }`}
              >
                <Icon
                  size={20}
                  className={isActive ? "" : "text-gold-500"}
                />
                {label}
                {isActive && <ChevronLeft size={16} className="mr-auto" />}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto rounded-2xl bg-gradient-to-br from-sage-100 to-gold-50 p-4 text-center">
          <Sparkles className="mx-auto mb-1 text-gold-500" size={20} />
          <p className="text-xs font-medium text-slate-600">יום החתונה:</p>
          <p className="text-sm font-bold text-slate-800">
            {weddingDate
              ? weddingDate.toLocaleDateString("he-IL", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })
              : "טרם נקבע"}
          </p>
        </div>
        <ShareAppPanel />
      </aside>
    </>
  );
}

function ShareAppPanel() {
  const [installPrompt, setInstallPrompt] = useState(null);

  useEffect(() => {
    const capturePrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", capturePrompt);
    return () => window.removeEventListener("beforeinstallprompt", capturePrompt);
  }, []);

  async function shareApp() {
    const data = {
      title: "תכנון החתונה שלי",
      text: "מערכת נעימה ופשוטה לתכנון חתונה יחד",
      url: window.location.origin,
    };
    try {
      if (navigator.share) {
        await navigator.share(data);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(data.url);
        notify("הקישור הועתק — אפשר לשלוח אותו למי שתרצו", { tone: "success" });
      } else {
        const field = document.createElement("textarea");
        field.value = data.url;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        document.execCommand("copy");
        field.remove();
        notify("הקישור הועתק", { tone: "success" });
      }
    } catch (err) {
      if (err?.name !== "AbortError") notify("שיתוף הקישור נכשל", { tone: "error" });
    }
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  return (
    <div className="rounded-2xl bg-gold-50/70 p-3 ring-1 ring-gold-200">
      <p className="mb-2 text-xs font-semibold text-slate-600">שיתוף והתקנה</p>
      <div className="flex gap-2">
        <button type="button" onClick={shareApp} className="btn-secondary flex-1 px-2 text-xs">
          <Share2 size={14} /> שיתוף האפליקציה
        </button>
        {installPrompt && (
          <button type="button" onClick={installApp} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-gold-500 px-2.5 text-xs font-semibold text-slate-950 transition hover:bg-gold-600">
            <Smartphone size={14} /> התקנה
          </button>
        )}
      </div>
    </div>
  );
}

/* =========================================================================
 *  OVERVIEW MODULE
 * ====================================================================== */

function StatCard({ icon: Icon, label, value, sub, tone = "gold", children }) {
  const ring = {
    gold: "from-gold-400/20 to-gold-600/10",
    sage: "from-sage-300/20 to-sage-500/10",
    rose: "from-rose-300/20 to-rose-500/10",
  };
  return (
    <Card className="relative overflow-hidden">
      <div
        className={`pointer-events-none absolute -left-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br ${ring[tone]} blur-2xl`}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium leading-tight text-slate-500 sm:text-sm">{label}</p>
          {/*  סכומים כמו "‎-139,500 ₪" גלשו מהכרטיס ונחתכו ב-overflow-hidden.
              clamp מקטין את הגופן לפי רוחב המסך במקום לחתוך ספרות.  */}
          <p className="mt-0.5 text-[clamp(1.125rem,2.1vw,1.875rem)] font-extrabold leading-tight tracking-tight text-slate-800 sm:mt-1">
            {value}
          </p>
          {sub && <p className="mt-0.5 text-[11px] leading-tight text-slate-500 sm:mt-1 sm:text-xs">{sub}</p>}
        </div>
        <div
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br sm:h-12 sm:w-12 sm:rounded-2xl ${
            tone === "gold"
              ? "from-gold-400 to-gold-600"
              : tone === "sage"
              ? "from-sage-300 to-sage-500"
              : "from-rose-300 to-rose-500"
          } text-white shadow-lg`}
        >
          <Icon size={18} />
        </div>
      </div>
      {children && <div className="mt-3 sm:mt-4">{children}</div>}
    </Card>
  );
}

const DEFAULT_FINANCE_LABELS = {
  goalTitle: "יעד התקציב",
  goalSubtitle: "כמה הקצבנו לחתונה",
  statCost: "סה״כ עלויות",
  statPaid: "שולם",
  statRemaining: "נותר לשלם",
  statIncome: "הכנסות (מתנות)",
  sectionTitle: "סעיפי התקציב",
  sectionSubtitle: "לכל סעיף: כמה הוא עולה, כמה שולם וכמה נותר לשלם",
  colCategory: "סעיף",
  colCost: "עלות",
  colPaid: "שולם",
  colRemaining: "נותר לשלם",
};

// Inline click-to-edit label. Renders as text with a subtle pencil affordance;
// clicking turns it into an input that commits on blur / Enter (Esc cancels).
function EditableText({
  value,
  onCommit,
  className = "",
  inputClassName = "",
  inputAriaLabel,
  placeholder = "",
  title = "לחצו לעריכת הכותרת",
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const v = draft.trim();
    if (v && v !== value) onCommit(v);
    else setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        aria-label={inputAriaLabel || `עריכת ${value || placeholder}`}
        className={`min-w-0 max-w-full rounded-md border border-gold-300 bg-white px-1.5 py-0.5 text-inherit outline-none focus:border-gold-500 ${inputClassName}`}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={title}
      aria-label={`עריכת ${value || placeholder}`}
      /*  בנייד הכותרות האלה היו מטרות לחיצה בגובה 17px בלבד. `py-2 -my-2`
       *  מגדיל את אזור המגע בלי לשנות את הפריסה החזותית, ובלי לדחוף את
       *  השורות זו מזו.  */
      className={`group -my-2 inline-flex items-center gap-1 py-2 text-right align-baseline transition hover:text-gold-600 sm:my-0 sm:py-0 ${className}`}
    >
      {/*  כשאין עדיין ערך מציגים את ה-placeholder בעמעום, כדי שגם מסך ריק
          לגמרי יזמין את המשתמש להקליד ולא ייראה כמו באג.  */}
      <span
        className={`border-b border-dashed border-transparent group-hover:border-gold-400 ${
          value ? "" : "opacity-60"
        }`}
      >
        {value || placeholder}
      </span>
      {/*  העיפרון היה `opacity-0` עד ריחוף — במסך מגע אין ריחוף, ולכן שום דבר
          לא רמז שהטקסט ניתן לעריכה. עכשיו הוא עמום וגלוי תמיד.  */}
      <Pencil
        size={12}
        className="shrink-0 opacity-40 transition group-hover:opacity-70"
      />
    </button>
  );
}

//  שמות בני הזוג ככותרת הדאשבורד. תצוגה בלבד — העריכה עברה למסך "הגדרות
//  החתונה", כי אלה נתונים שקובעים פעם אחת ולא משנים תוך כדי עבודה.
function CoupleNames({ couple }) {
  const name = (key, placeholder) => {
    const value = couple?.[key] || "";
    return (
      <span className={`min-w-0 break-words ${value ? "" : "opacity-50"}`}>
        {value || placeholder}
      </span>
    );
  };

  //  גריד ולא flex: שתי עמודות שוות ברוחבן משני צדי עמודת ה-"&" מבטיחות
  //  שהסימן יישב בדיוק במרכז הכותרת. ב-flex רוחב השמות שונה, והוא "זז".
  return (
    <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 font-display text-2xl font-bold sm:text-3xl">
      <span className="justify-self-end">{name("partnerA", "בן/בת זוג א׳")}</span>
      <span className="text-gold-300">&amp;</span>
      <span className="justify-self-start">{name("partnerB", "בן/בת זוג ב׳")}</span>
    </div>
  );
}

function Countdown({
  date,
  couple = null,
  canEditSettings = false,
  onOpenSettings,
  backgroundUrl = "",
  onBackgroundChange,
}) {
  const backgroundInputRef = useRef(null);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const { days, hours, minutes, seconds } = useCountdown(date ?? WEDDING_DATE);
  const countItems = [
    { label: "ימים", value: days },
    { label: "שעות", value: hours },
    { label: "דקות", value: minutes },
    { label: "שניות", value: seconds },
  ];
  //  פרטי היסוד של החתונה נקבעים פעם אחת. מציגים קיצור דרך להגדרות רק כל עוד
  //  משהו חסר, כדי שחתונה חדשה לא תהיה מסך ללא מוצא — ואחר כך הוא נעלם.
  const incomplete = !date || !couple?.partnerA || !couple?.partnerB;
  return (
    <Card
      className="relative overflow-hidden bg-gradient-to-br from-slate-800 via-slate-700 to-slate-800 text-white"
      style={backgroundUrl ? {
        // Quoted and escaped: the URL comes from the database and carries a ?alt=media&token= query.
        backgroundImage: `linear-gradient(rgba(15, 23, 42, 0.68), rgba(15, 23, 42, 0.78)), url("${backgroundUrl.replace(/["\\]/g, "\\$&")}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      } : undefined}
    >
      <div className="pointer-events-none absolute -left-10 -top-10 h-40 w-40 rounded-full bg-gold-500/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-10 -right-10 h-40 w-40 rounded-full bg-sage-400/30 blur-3xl" />
      <div className="relative flex flex-col items-center gap-5 py-4 text-center">
        <Badge color="gold" className="!bg-white/15 !text-gold-200 !ring-white/20">
          <Calendar size={14} />{" "}
          {date ? "הספירה לאחור לרגע הגדול" : "עוד לא נקבע תאריך"}
        </Badge>
        <CoupleNames couple={couple} />
        {date ? (
          <div className="grid w-full max-w-md grid-cols-4 gap-2 sm:flex sm:w-auto sm:max-w-none sm:flex-wrap sm:justify-center sm:gap-3">
            {countItems.map((c) => (
              <div
                key={c.label}
                className="rounded-2xl bg-white/10 px-2 py-3 backdrop-blur-md ring-1 ring-white/15 sm:min-w-[78px] sm:px-4"
              >
                <div className="text-2xl font-extrabold tabular-nums text-gold-200 sm:text-3xl">
                  {String(c.value).padStart(2, "0")}
                </div>
                <div className="text-[11px] font-medium text-white/70 sm:text-xs">
                  {c.label}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-white/70">
            קבעו תאריך והספירה לאחור תתחיל
          </p>
        )}
        {canEditSettings && incomplete && (
          //  min-h-11 במסך צר: זהו הקישור שמוביל להשלמת התאריך והשמות, והוא
          //  היה בגובה 16px בלבד — קטן מדי ללחיצה באצבע.
          <button
            onClick={onOpenSettings}
            className="inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-white/70 underline decoration-white/30 underline-offset-4 transition hover:text-white sm:min-h-0"
          >
            <Settings2 size={13} />
            להשלמת פרטי החתונה
          </button>
        )}
        {canEditSettings && onBackgroundChange && (
          <>
            <input
              ref={backgroundInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setBackgroundBusy(true);
                try {
                  await onBackgroundChange(file);
                } finally {
                  setBackgroundBusy(false);
                }
              }}
            />
            <button
              type="button"
              onClick={() => backgroundInputRef.current?.click()}
              disabled={backgroundBusy}
              className="btn-secondary text-xs"
            >
              {backgroundBusy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {backgroundUrl ? "החלפת תמונת רקע" : "הוספת תמונת רקע"}
            </button>
          </>
        )}
      </div>
    </Card>
  );
}

function Overview({
  guests,
  vendors,
  budget,
  checklist = [],
  checklistAssignees = ASSIGNEES,
  weddingDate,
  couple,
  canEditSettings,
  onOpenSettings,
  onOpenVendor,
  canAddVendor = false,
  dataLoading = false,
  dataUnavailable = false,
  backgroundUrl,
  onBackgroundChange,
}) {
  const stats = useMemo(() => {
    const totalExpected = budget.reduce((s, b) => s + b.expected, 0);
    const totalSpent = budget.reduce((s, b) => s + b.actual, 0);
    const totalPaid = budget.reduce((s, b) => s + (b.paid || 0), 0);
    const invited = guests.reduce((s, g) => s + (g.rsvp !== "declined" ? g.seats || 1 : 0), 0);
    const confirmed = guests
      .filter((g) => g.rsvp === "confirmed")
      .reduce((s, g) => {
        const seats = g.seats || 1;
        return s + (g.attendingCount != null ? Math.min(g.attendingCount, seats) : seats);
      }, 0);
    //  מי שסימן “לא מגיע” אינו “כנראה יבוא” גם אם הסימון נשאר מקודם —
    //  אחרת “כנראה יבואו” גדול מ“הוזמנו” וסרגל ההתקדמות נחתך בשקט.
    const probably = guests
      .filter((g) => g.probablyComing && g.rsvp !== "declined")
      .reduce((s, g) => s + (g.seats || 1), 0);
    const considering = guests.filter((g) => g.considering).length;
    const openTasks = vendors.reduce(
      (s, v) => s + v.tasks.filter((t) => t.status !== "done").length,
      0
    );
    const totalTasks = vendors.reduce((s, v) => s + v.tasks.length, 0);
    return {
      totalExpected,
      totalSpent,
      totalPaid,
      totalRemaining: Math.max(0, totalSpent - totalPaid),
      invited,
      confirmed,
      probably,
      considering,
      openTasks,
      totalTasks,
    };
  }, [guests, vendors, budget]);

  //  הצ׳קליסט בדאשבורד עונה על שתי שאלות: כמה נסגר בסך הכול,
  //  ומי משנינו נשאר עם העבודה. בלי הפילוח השני המספר לא מסייע לאיש.
  const checklistStats = useMemo(() => {
    const done = checklist.filter((c) => c.done).length;
    const open = checklistAssignees.map((a) => ({
      label: a.label,
      count: checklist.filter((c) => !c.done && (c.assignee || "both") === a.key).length,
    })).filter((x) => x.count > 0);
    return { done, total: checklist.length, open };
  }, [checklist, checklistAssignees]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Countdown hero */}
      <div data-tour="overview-countdown">
        <Countdown
          date={weddingDate}
          couple={couple}
          canEditSettings={canEditSettings}
          onOpenSettings={onOpenSettings}
          backgroundUrl={backgroundUrl}
          onBackgroundChange={onBackgroundChange}
        />
      </div>

      {/* Summary cards */}
      {/*  שתי עמודות גם בנייד: כרטיס נתון בשורה שלמה מבזבז את מחצית הרוחב.  */}
      <div data-tour="overview-summary" className="grid grid-cols-2 gap-2.5 sm:gap-4 xl:grid-cols-3">
        <StatCard
          icon={Wallet}
          label="כמה כבר שולם"
          value={fmt(stats.totalPaid)}
          sub={`נותר לשלם ${fmt(stats.totalRemaining)} · תכנון ${fmt(stats.totalExpected)}`}
          tone="gold"
        >
          <BudgetSplitBar
            paid={stats.totalPaid}
            remaining={stats.totalRemaining}
            max={stats.totalExpected}
          />
        </StatCard>

        <StatCard
          icon={Star}
          label="כנראה יבואו (כיסאות)"
          value={stats.probably}
          sub={`מתוך ${stats.invited} כיסאות שהוזמנו`}
          tone="sage"
        >
          <ProgressBar value={stats.probably} max={stats.invited} tone="sage" />
        </StatCard>

        <StatCard
          icon={ListTodo}
          label="משימות פתוחות"
          value={stats.openTasks}
          sub={`מתוך ${stats.totalTasks} משימות לכל הספקים`}
          tone="rose"
        >
          <ProgressBar
            value={stats.totalTasks - stats.openTasks}
            max={stats.totalTasks}
            tone="rose"
          />
        </StatCard>

        <StatCard
          icon={ListChecks}
          label="הצ׳קליסט שלנו"
          value={`${checklistStats.done}/${checklistStats.total}`}
          sub={
            checklistStats.total === 0
              ? "עדיין לא נוספו משימות לצ׳קליסט"
              : checklistStats.open.length
              ? `נותרו: ${checklistStats.open.map((x) => `${x.label} ${x.count}`).join(" · ")}`
              : "הכול סגור בצ׳קליסט"
          }
          tone="sage"
        >
          <ProgressBar
            value={checklistStats.done}
            max={checklistStats.total}
            tone="sage"
          />
        </StatCard>
      </div>

      {/* Vendors quick glance */}
      <Card tourId="overview-vendors">
        <SectionTitle
          icon={Briefcase}
          title="הספקים שלנו במבט מהיר"
          subtitle={
            onOpenVendor
              ? "סטטוס משימות ויתרת תשלום · לחצו על ספק לפתיחת הכרטיס המלא שלו"
              : "סטטוס משימות ויתרת תשלום"
          }
        />
        {vendors.length === 0 && dataLoading ? (
          <div role="status" className="space-y-3" aria-label="טוען ספקים">
            <div className="h-14 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-14 animate-pulse rounded-2xl bg-slate-100" />
          </div>
        ) : vendors.length === 0 && dataUnavailable ? (
          <p className="rounded-2xl bg-amber-50 px-4 py-5 text-center text-sm text-amber-800 ring-1 ring-amber-200">
            פרטי הספקים אינם זמינים כרגע. הנתונים לא נמחקו; בדקו את החיבור ונסו שוב.
          </p>
        ) : vendors.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-center">
            <Briefcase size={22} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-semibold text-slate-700">עדיין לא נוספו ספקים</p>
            <p className="mt-1 text-xs text-slate-500">הוסיפו ספק כדי לעקוב אחר משימות, תשלומים וקבצים.</p>
            {canAddVendor && onOpenVendor && (
              <button type="button" onClick={() => onOpenVendor(null)} className="btn-primary mt-3">
                <Plus size={15} /> מעבר להוספת ספק
              </button>
            )}
          </div>
        ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {vendors.map((v) => {
            const done = v.tasks.filter((t) => t.status === "done").length;
            const balance = v.contractCost - v.deposit;
            const content = (
              <>
                <div>
                  <p className="font-semibold text-slate-800">{v.name}</p>
                  <p className="text-xs text-slate-500">{v.type}</p>
                </div>
                <div className="text-left">
                  <Badge color={done === v.tasks.length ? "sage" : "gold"}>
                    {done}/{v.tasks.length} משימות
                  </Badge>
                  <p className="mt-1 text-xs text-slate-500">
                    יתרה: {fmt(balance)}
                  </p>
                </div>
              </>
            );
            /*  כרטיס הספק בדאשבורד הוא הדבר הראשון שמנסים ללחוץ עליו כדי
                לראות פרטים. כשאין הרשאה למסך הספקים אין לאן לנווט, ואז
                הכרטיס נשאר תצוגה בלבד ולא מתחזה לכפתור.  */
            if (!onOpenVendor)
              return (
                <div
                  key={v.id}
                  className="flex items-center justify-between rounded-2xl bg-white/60 p-4 ring-1 ring-slate-200/70"
                >
                  {content}
                </div>
              );
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => onOpenVendor(v.id)}
                title={`מעבר לכרטיס הספק “${v.name}”`}
                className="flex w-full items-center justify-between rounded-2xl border border-sage-300 bg-sage-50 p-4 text-right shadow-sm transition hover:border-gold-400 hover:bg-sage-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
              >
                {content}
              </button>
            );
          })}
        </div>
        )}
      </Card>
    </div>
  );
}

/* =========================================================================
 *  GUESTS + SEATING MODULE
 * ====================================================================== */

/*  סימון “כמה שותים” ברשומה אחת. רשומה של איש אחד מתנהגת כמו תיבת סימון
    רגילה — זה 95% מהמקרים ואין סיבה להטריח שם מונה. רשומה של שניים ומעלה
    מקבלת מונה קטן, כי “משפחת כהן, 4 כיסאות” יכולה להיות 4 שותים או אחד.

    סימון ראשוני מציב את מספר הכיסאות המלא: מי שטרח לסמן מתכוון בדרך כלל
    ל“כולם”, וקל יותר להוריד משם מאשר לטפס מ-1.  */
function DrinkersControl({ guest, canEdit, onChange, compact = false }) {
  const seats = Math.max(1, Number(guest.seats) || 1);
  const value = Math.min(seats, Math.max(0, Number(guest.drinkers) || 0));
  const on = value > 0;

  if (seats === 1) {
    return (
      <label
        title="האם המוזמן שותה אלכוהול"
        className="inline-flex h-11 w-11 cursor-pointer items-center justify-center"
      >
        <input
          type="checkbox"
          checked={on}
          disabled={!canEdit}
          onChange={() => onChange(on ? 0 : 1)}
          aria-label={`${guest.name || "מוזמן"} שותה אלכוהול`}
          className="h-5 w-5 accent-gold-500"
        />
      </label>
    );
  }

  return (
    <span className="inline-flex items-center justify-center gap-1">
      <label className="grid h-11 w-11 cursor-pointer place-items-center">
        <input
          type="checkbox"
          checked={on}
          disabled={!canEdit}
          onChange={() => onChange(on ? 0 : seats)}
          aria-label={`${guest.name || "מוזמן"} — שותים אלכוהול`}
          title="סימון ראשוני מציב את כל הכיסאות ברשומה"
          className="h-5 w-5 accent-gold-500"
        />
      </label>
      {on && (
        <span
          className={`inline-flex items-center rounded-lg bg-white ring-1 ring-slate-200 ${
            compact ? "" : "text-xs"
          }`}
        >
          <button
            type="button"
            disabled={!canEdit || value <= 1}
            onClick={() => onChange(value - 1)}
            aria-label="פחות שותים"
            className="btn-icon"
          >
            <Minus size={13} />
          </button>
          <span className="min-w-8 text-center text-xs font-semibold tabular-nums text-slate-700">
            {value}/{seats}
          </span>
          <button
            type="button"
            disabled={!canEdit || value >= seats}
            onClick={() => onChange(value + 1)}
            aria-label="עוד שותים"
            className="btn-icon"
          >
            <Plus size={13} />
          </button>
        </span>
      )}
    </span>
  );
}

const GUEST_TABLE_COLUMNS = [
  { key: "category", label: "קטגוריה" },
  { key: "mention", label: "אזכור / הערות" },
  { key: "seats", label: "כיסאות" },
  { key: "glatt", label: "גלאט" },
  { key: "drinkers", label: "שותים" },
  { key: "probablyComing", label: "כנראה יבוא" },
  { key: "considering", label: "לשקול" },
  { key: "rsvp", label: "אישור הגעה" },
  { key: "gift", label: "מתנה" },
];

const DEFAULT_GUEST_TABLE_COLUMNS = {
  category: true,
  mention: false,
  seats: true,
  glatt: true,
  drinkers: true,
  probablyComing: false,
  considering: false,
  rsvp: true,
  gift: true,
};

function guestColumnsPopoverPosition(anchor, viewportWidth, viewportHeight) {
  const width = 256;
  const margin = 12;
  const maxHeight = Math.min(320, Math.max(160, viewportHeight - margin * 2));
  const spaceBelow = viewportHeight - anchor.bottom - 8;
  const spaceAbove = anchor.top - 8;
  const openAbove = spaceBelow < maxHeight && spaceAbove > spaceBelow;
  const top = openAbove
    ? Math.max(margin, anchor.top - maxHeight - 8)
    : Math.min(anchor.bottom + 8, viewportHeight - maxHeight - margin);
  const left = Math.max(
    margin,
    Math.min(anchor.right - width, viewportWidth - width - margin)
  );
  return { top, left, maxHeight };
}

const GuestRow = memo(function GuestRow({
  g,
  tableLabel,
  visibleColumns,
  selected,
  duplicateNote,
  onToggleSelect,
  updateName,
  updatePhone,
  updateCategory,
  updateMention,
  updateSeats,
  updateGift,
  updateDrinkers,
  toggleFlag,
  updateRsvp,
  updateAttending,
  removeGuest,
  canEdit = true,
}) {
  // Local draft state for free-text fields so typing stays local to this row
  // (no parent re-render per keystroke). Committed to the store on blur.
  const categories = useContext(CategoriesContext);
  const [name, setName] = useState(g.name || "");
  const [phone, setPhone] = useState(g.phone || "");
  const [mention, setMention] = useState(g.mention || "");
  const [seats, setSeats] = useState(g.seats ?? 1);
  const [gift, setGift] = useState(g.gift ?? 0);
  const [attending, setAttending] = useState(g.attendingCount ?? (g.seats ?? 1));

  useEffect(() => setName(g.name || ""), [g.name]);
  useEffect(() => setPhone(g.phone || ""), [g.phone]);
  useEffect(() => setMention(g.mention || ""), [g.mention]);
  useEffect(() => setSeats(g.seats ?? 1), [g.seats]);
  useEffect(() => setGift(g.gift ?? 0), [g.gift]);
  useEffect(() => setAttending(g.attendingCount ?? (g.seats ?? 1)), [g.attendingCount, g.seats]);

  return (
    <tr className={`border-b border-slate-100 transition ${selected ? "bg-gold-50/60" : "hover:bg-white/60"}`}>
      <td className="px-2 py-3">
        {canEdit && (
          <label className="grid h-11 w-11 cursor-pointer place-items-center">
            <input
              type="checkbox"
              checked={!!selected}
              onChange={() => onToggleSelect(g.id)}
              aria-label={`בחירת ${g.name || "מוזמן"}`}
              className="h-5 w-5 accent-gold-500"
            />
          </label>
        )}
      </td>
      <td className="px-2 py-3">
        <input
          value={name}
          readOnly={!canEdit}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== (g.name || "") && updateName(g.id, name)}
          placeholder="שם"
          className="min-h-11 w-36 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-sm font-semibold text-slate-800 outline-none focus:border-gold-400"
        />
      </td>
      <td className="px-2 py-3">
        {/*  האזהרה מצוירת בתוך השדה ולא לצידו, כדי שרוחב העמודה וגובה השורה
            (שהווירטואליזציה מניחה קבוע) לא ישתנו כשמופיעה כפילות.  */}
        <div className="relative w-28">
          <input
            value={phone}
            readOnly={!canEdit}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => phone !== (g.phone || "") && updatePhone(g.id, phone)}
            placeholder="נייד"
            type="tel"
            dir="ltr"
            title={duplicateNote}
            className={
              "min-h-11 w-28 rounded-lg border px-2 py-1 text-start text-sm tabular-nums outline-none focus:border-gold-400 " +
              (duplicateNote
                ? "border-amber-400 bg-amber-50 pr-7"
                : "border-slate-200 bg-white")
            }
          />
          {duplicateNote && (
            <span
              role="img"
              aria-label={duplicateNote}
              data-duplicate-phone
              className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-amber-600"
            >
              <AlertTriangle size={15} />
            </span>
          )}
        </div>
      </td>
      {visibleColumns.category && <td className="px-2 py-3">
        <select
          value={g.category}
          disabled={!canEdit}
          onChange={(e) => updateCategory(g.id, e.target.value)}
          title="שינוי קטגוריה"
          className={`min-h-11 max-w-[180px] cursor-pointer rounded-full px-2 py-1 text-xs font-semibold ring-inset outline-none transition focus:ring-2 ${
            g.category?.startsWith("צד כלה") ? "ring-2" : "ring-1"
          } ${categoryStyle(g.category)}`}
        >
          {/*  ערך ריק הוא מצב חוקי (מוזמן שיובא בלי קטגוריה, או קטגוריה
              שנמחקה) וחייבת להיות לו אפשרות מפורשת, אחרת ה-select נראה ריק
              והמשתמש לא יכול לבחור בו בחזרה.  */}
          <option value="" className="bg-white text-slate-700">
            ללא קטגוריה
          </option>
          {/*  קטגוריה שנמחקה מהרשימה או הגיעה מייבוא חייבת להישאר גלויה,
              אחרת השדה נראה ריק והנתון נראה כאילו אבד.  */}
          {!!g.category && !categories.includes(g.category) && (
            <option value={g.category} className="bg-white text-slate-700">
              {g.category}
            </option>
          )}
          {categories.map((c) => (
            <option key={c} value={c} className="bg-white text-slate-700">
              {c}
            </option>
          ))}
        </select>
      </td>}
      {visibleColumns.mention && <td className="px-2 py-3">
        <input
          value={mention}
          readOnly={!canEdit}
          onChange={(e) => setMention(e.target.value)}
          onBlur={() => mention !== (g.mention || "") && updateMention(g.id, mention)}
          placeholder="אזכור"
          className="min-h-11 w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-sm outline-none focus:border-gold-400"
        />
      </td>}
      {visibleColumns.seats && <td className="px-2 py-3">
        <input
          value={seats}
          readOnly={!canEdit}
          onChange={(e) => setSeats(e.target.value)}
          onBlur={() => {
            const n = Math.max(1, Number(seats) || 1);
            if (n !== (g.seats || 1)) updateSeats(g.id, n);
            setSeats(n);
          }}
          type="number"
          min="1"
          title="מספר הכיסאות לרשומה זו"
          className="min-h-11 w-14 rounded-lg border border-slate-200 bg-white px-2 py-1 text-center text-sm font-semibold tabular-nums text-slate-700 outline-none focus:border-gold-400"
        />
      </td>}
      {visibleColumns.glatt && <td className="px-2 py-3 text-center">
        <label
          title="נדרש להזמין מנת בד״צ / גלאט"
          className="inline-flex h-11 w-11 cursor-pointer items-center justify-center"
        >
          <input
            type="checkbox"
            checked={!!g.glatt}
            disabled={!canEdit}
            onChange={() => toggleFlag(g.id, "glatt")}
            className="h-5 w-5 accent-gold-500"
          />
        </label>
      </td>}
      {visibleColumns.drinkers && <td className="px-2 py-3 text-center">
        <DrinkersControl
          guest={g}
          canEdit={canEdit}
          onChange={(n) => updateDrinkers(g.id, n)}
        />
      </td>}
      <td className="px-2 py-3">
        {tableLabel ? (
          <Badge color="sage">
            <Armchair size={12} /> {tableLabel}
          </Badge>
        ) : (
          <span className="text-xs text-slate-400">לא משובץ</span>
        )}
      </td>
      {visibleColumns.probablyComing && <td className="px-2 py-3 text-center">
        <button
          onClick={() => toggleFlag(g.id, "probablyComing")}
          disabled={!canEdit}
          aria-label={g.probablyComing ? "מסומן ככנראה יבוא" : "סימון ככנראה יבוא"}
          aria-pressed={!!g.probablyComing}
          title="כנראה יבוא"
          className={`grid h-11 w-11 place-items-center rounded-lg transition focus-visible:ring-2 focus-visible:ring-sage-400 focus-visible:outline-none ${
            g.probablyComing
              ? "bg-sage-100 text-sage-600 ring-1 ring-sage-300"
              : "text-slate-400 hover:bg-slate-100"
          }`}
        >
          {g.probablyComing ? <CheckCircle2 size={18} /> : <Circle size={18} />}
        </button>
      </td>}
      {visibleColumns.considering && <td className="px-2 py-3 text-center">
        <button
          onClick={() => toggleFlag(g.id, "considering")}
          disabled={!canEdit}
          aria-label={g.considering ? "מסומן לשקילה" : "סימון לשקילה"}
          aria-pressed={!!g.considering}
          title="לשקול אם להזמין"
          className={`grid h-11 w-11 place-items-center rounded-lg transition focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none ${
            g.considering
              ? "bg-rose-100 text-rose-600 ring-1 ring-rose-300"
              : "text-slate-400 hover:bg-slate-100"
          }`}
        >
          <HelpCircle size={18} className={g.considering ? "fill-rose-200" : ""} />
        </button>
      </td>}
      {visibleColumns.rsvp && <td className="px-2 py-3">
        <div className="flex flex-col gap-1">
          <select
            value={RSVP[g.rsvp] ? g.rsvp : "pending"}
            disabled={!canEdit}
            onChange={(e) => updateRsvp(g.id, e.target.value)}
            aria-label="אישור הגעה"
            title="שינוי סטטוס אישור הגעה"
            className={`min-h-11 cursor-pointer rounded-full px-2 py-1 text-xs font-semibold ring-1 ring-inset outline-none transition focus:ring-2 ${
              colorMap[RSVP[g.rsvp]?.color ?? "slate"]
            }`}
          >
            <option value="pending">ממתין</option>
            <option value="confirmed">אישרו הגעה</option>
            <option value="declined">לא מגיעים</option>
          </select>
          {g.rsvp === "confirmed" && (
            <div className="flex items-center justify-center gap-1">
              <input
                type="number"
                min="0"
                max={g.seats || 1}
                value={attending}
                readOnly={!canEdit}
                onChange={(e) => setAttending(e.target.value)}
                onBlur={() => {
                  const n = Math.max(0, Math.min(g.seats || 1, Math.round(Number(attending) || 0)));
                  if (n !== (g.attendingCount ?? (g.seats || 1))) updateAttending(g.id, n);
                  setAttending(n);
                }}
                aria-label={`כמה אישרו הגעה מתוך ${g.seats || 1}`}
                title="כמה אנשים אישרו הגעה מתוך הרשומה"
                className="min-h-11 w-12 rounded-lg border border-sage-200 bg-sage-50 px-1.5 py-0.5 text-center text-xs font-bold tabular-nums text-sage-700 outline-none focus:border-sage-400"
              />
              <span className="text-[11px] text-slate-400">/ {g.seats || 1}</span>
            </div>
          )}
        </div>
      </td>}
      {visibleColumns.gift && <td className="px-2 py-3">
        <input
          type="number"
          value={gift}
          readOnly={!canEdit}
          onChange={(e) => setGift(e.target.value)}
          onBlur={() => Number(gift) !== (g.gift || 0) && updateGift(g.id, gift)}
          className="min-h-11 w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm tabular-nums outline-none focus:border-gold-400"
        />
      </td>}
      <td className="px-2 py-3 text-left">
        {canEdit && (
          <button
            onClick={() => removeGuest(g.id)}
            aria-label={`מחיקת ${g.name || "מוזמן"}`}
            title="מחיקת מוזמן"
            className="btn-icon-danger"
          >
            <Trash2 size={16} />
          </button>
        )}
      </td>
    </tr>
  );
});

const GuestCard = memo(function GuestCard({
  g,
  tableLabel,
  selected,
  duplicateNote,
  onToggleSelect,
  updateName,
  updatePhone,
  updateCategory,
  updateMention,
  updateSeats,
  updateGift,
  updateDrinkers,
  toggleFlag,
  updateRsvp,
  updateAttending,
  removeGuest,
  canEdit = true,
}) {
  const categories = useContext(CategoriesContext);
  const [name, setName] = useState(g.name || "");
  const [phone, setPhone] = useState(g.phone || "");
  const [mention, setMention] = useState(g.mention || "");
  const [seats, setSeats] = useState(g.seats ?? 1);
  const [gift, setGift] = useState(g.gift ?? 0);
  const [attending, setAttending] = useState(g.attendingCount ?? (g.seats ?? 1));

  useEffect(() => setName(g.name || ""), [g.name]);
  useEffect(() => setPhone(g.phone || ""), [g.phone]);
  useEffect(() => setMention(g.mention || ""), [g.mention]);
  useEffect(() => setSeats(g.seats ?? 1), [g.seats]);
  useEffect(() => setGift(g.gift ?? 0), [g.gift]);
  useEffect(() => setAttending(g.attendingCount ?? (g.seats ?? 1)), [g.attendingCount, g.seats]);

  const field =
    //  בנייד שדות הקלט חייבים להיות גבוהים מ-44px כדי שאפשר יהיה לדיוק
    //  להקיש עליהם, ו-16px גופן כדי ש-iOS לא יעשה זום אוטומטי בפוקוס.
    "min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-base outline-none focus:border-gold-400 sm:min-h-0 sm:text-sm";

  //  כרטיס פתוח הוא כ-420px. עם 592 מוזמנים זה שני כרטיסים למסך וגלילה
  //  אין-סופית, ולכן ברירת המחדל היא שורת סיכום שנפתחת בלחיצה.
  const [open, setOpen] = useState(false);
  const rsvpKey = RSVP[g.rsvp] ? g.rsvp : "pending";
  const rsvpLabel = RSVP[rsvpKey].label;
  const rsvpDot = { sage: "bg-sage-500", gold: "bg-gold-500", rose: "bg-rose-400" }[
    RSVP[rsvpKey].color
  ];

  return (
    <div
      className={`rounded-2xl border p-3 transition sm:p-4 ${
        selected ? "border-gold-300 bg-gold-50/60" : "border-slate-200 bg-white/70"
      }`}
    >
      <div className={`flex items-center gap-1.5 ${open ? "mb-3" : ""}`}>
        {/*  תיבת הסימון היא 16px ובלתי אפשרית ללחיצה באצבע. עטיפה
            ב-label עם ריפוד מגדילה את אזור הלחיצה ל-44px בלי לשנות
            את המראה ובלי להזיז את שאר השורה.  */}
        <label className="-m-1.5 grid h-11 w-9 shrink-0 cursor-pointer place-items-center">
          {canEdit && (
            <input
              type="checkbox"
              checked={!!selected}
              onChange={() => onToggleSelect(g.id)}
              aria-label={`בחירת ${g.name || "מוזמן"}`}
              className="h-5 w-5 cursor-pointer accent-gold-500"
            />
          )}
        </label>
        <input
          value={name}
          readOnly={!canEdit}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== (g.name || "") && updateName(g.id, name)}
          placeholder="שם האורח"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-base font-semibold text-slate-800 outline-none focus:border-gold-400 sm:min-h-0 sm:text-sm"
        />
        {/*  סיכום בשורה עצמה: מספר הכיסאות ונקודת צבע לסטטוס, כדי
            שלא יהיה צורך לפתוח כרטיס רק כדי לראות אותם.  */}
        {!open && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
            {duplicateNote && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                data-duplicate-phone
                aria-label={duplicateNote}
                title={duplicateNote}
                className="grid h-8 w-8 place-items-center rounded-lg bg-amber-50 text-amber-600 ring-1 ring-amber-300"
              >
                <AlertTriangle size={15} />
              </button>
            )}
            <span className="tabular-nums" title="כיסאות">
              {g.seats ?? 1}
            </span>
            <span
              title={rsvpLabel}
              aria-label={`אישור הגעה: ${rsvpLabel}`}
              className={`h-2 w-2 rounded-full ${rsvpDot}`}
            />
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`${open ? "סגירת" : "פתיחת"} פרטי ${g.name || "מוזמן"}`}
          className="btn-icon w-8"
        >
          <ChevronDown size={18} className={open ? "rotate-180 transition" : "transition"} />
        </button>
        <button
          onClick={() => removeGuest(g.id)}
          aria-label={`מחיקת ${g.name || "מוזמן"}`}
          className={`btn-icon-danger w-8 ${
            canEdit ? "" : "hidden"
          }`}
        >
          <Trash2 size={18} />
        </button>
      </div>

      {open && (
      <>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="col-span-2 text-xs font-medium text-slate-500">
          נייד
          <input
            value={phone}
            readOnly={!canEdit}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => phone !== (g.phone || "") && updatePhone(g.id, phone)}
            placeholder="נייד"
            type="tel"
            dir="ltr"
            className={
              field + " text-start tabular-nums" + (duplicateNote ? " !border-amber-400 !bg-amber-50" : "")
            }
          />
        </label>
        {duplicateNote && (
          <p
            data-duplicate-phone
            className="col-span-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200"
          >
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            {duplicateNote}
          </p>
        )}
        <label className="col-span-2 text-xs font-medium text-slate-500">
          קטגוריה
          <select
            value={g.category}
            disabled={!canEdit}
            onChange={(e) => updateCategory(g.id, e.target.value)}
            className={field}
          >
            <option value="">ללא קטגוריה</option>
            {!!g.category && !categories.includes(g.category) && (
              <option value={g.category}>{g.category}</option>
            )}
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-500">
          כיסאות
          <input
            type="number"
            min="1"
            value={seats}
            readOnly={!canEdit}
            onChange={(e) => setSeats(e.target.value)}
            onBlur={() => {
              //  כמו ב-GuestRow: הטיוטה המקומית חייבת להתיישר לערך שנשמר בפועל,
              //  אחרת הקלדת אפס משאירה את השדה מציג 0 בעוד המאגר מחזיק 1.
              const n = Math.max(1, Number(seats) || 1);
              if (n !== (g.seats ?? 1)) updateSeats(g.id, n);
              setSeats(n);
            }}
            className={`${field} tabular-nums`}
          />
        </label>
        <label className="text-xs font-medium text-slate-500">
          מתנה (₪)
          <input
            type="number"
            value={gift}
            readOnly={!canEdit}
            onChange={(e) => setGift(e.target.value)}
            onBlur={() => Number(gift) !== (g.gift || 0) && updateGift(g.id, gift)}
            className={`${field} tabular-nums`}
          />
        </label>
        <label className="col-span-2 text-xs font-medium text-slate-500">
          אזכור
          <input
            value={mention}
            readOnly={!canEdit}
            onChange={(e) => setMention(e.target.value)}
            onBlur={() => mention !== (g.mention || "") && updateMention(g.id, mention)}
            placeholder="אזכור"
            className={field}
          />
        </label>
        <label className="col-span-2 text-xs font-medium text-slate-500">
          אישור הגעה
          <select
            value={RSVP[g.rsvp] ? g.rsvp : "pending"}
            disabled={!canEdit}
            onChange={(e) => updateRsvp(g.id, e.target.value)}
            className={field}
          >
            <option value="pending">ממתין</option>
            <option value="confirmed">אישרו הגעה</option>
            <option value="declined">לא מגיעים</option>
          </select>
        </label>
        {g.rsvp === "confirmed" && (
          <label className="col-span-2 text-xs font-medium text-sage-600">
            כמה אישרו הגעה (מתוך {g.seats || 1})
            <input
              type="number"
              min="0"
              max={g.seats || 1}
              value={attending}
              readOnly={!canEdit}
              onChange={(e) => setAttending(e.target.value)}
              onBlur={() => {
                const n = Math.max(0, Math.min(g.seats || 1, Math.round(Number(attending) || 0)));
                if (n !== (g.attendingCount ?? (g.seats || 1))) updateAttending(g.id, n);
                setAttending(n);
              }}
              className={`${field} tabular-nums border-sage-200 bg-sage-50 font-semibold text-sage-700`}
            />
          </label>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => toggleFlag(g.id, "probablyComing")}
          disabled={!canEdit}
          aria-pressed={!!g.probablyComing}
          className={`flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition sm:min-h-0 sm:px-2.5 sm:py-1.5 sm:text-xs ${
            g.probablyComing
              ? "bg-sage-100 text-sage-600 ring-1 ring-sage-300"
              : "bg-white text-slate-500 ring-1 ring-slate-200"
          }`}
        >
          {g.probablyComing ? <CheckCircle2 size={16} /> : <Circle size={16} />} כנראה יבוא
        </button>
        <button
          onClick={() => toggleFlag(g.id, "considering")}
          disabled={!canEdit}
          aria-pressed={!!g.considering}
          className={`flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition sm:min-h-0 sm:px-2.5 sm:py-1.5 sm:text-xs ${
            g.considering
              ? "bg-rose-100 text-rose-600 ring-1 ring-rose-300"
              : "bg-white text-slate-500 ring-1 ring-slate-200"
          }`}
        >
          <HelpCircle size={16} className={g.considering ? "fill-rose-200" : ""} /> לשקול
        </button>
        <button
          onClick={() => toggleFlag(g.id, "glatt")}
          disabled={!canEdit}
          aria-pressed={!!g.glatt}
          className={`flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition sm:min-h-0 sm:px-2.5 sm:py-1.5 sm:text-xs ${
            g.glatt
              ? "bg-gold-100 text-gold-600 ring-1 ring-gold-300"
              : "bg-white text-slate-500 ring-1 ring-slate-200"
          }`}
        >
          <UtensilsCrossed size={16} /> גלאט
        </button>
        <span className="flex min-h-11 items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-500 ring-1 ring-slate-200 sm:min-h-0 sm:px-2.5 sm:py-1.5 sm:text-xs">
          <Wine size={16} /> שותים
          <DrinkersControl
            guest={g}
            canEdit={canEdit}
            onChange={(n) => updateDrinkers(g.id, n)}
          />
        </span>
        {tableLabel && (
          <span className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-500">
            <Armchair size={14} /> {tableLabel}
          </span>
        )}
      </div>
      </>
      )}
    </div>
  );
});

function Guests({ guests, setGuests, tables, setTables, categories, setCategories, dataLoading = false, dataUnavailable = false }) {
  const canEdit = useCanEdit();
  const fileRef = useRef(null);
  const addGuestFormRef = useRef(null);
  //  סגור כברירת מחדל: בנייד הטופס תופס מסך שלם, ורוב הביקורים הם בשביל חיפוש ועריכה.
  const [isAddGuestOpen, setIsAddGuestOpen] = useState(false);
  const addGuestToggleRef = useRef(null);
  const addGuestTouched = useRef(false);
  const columnsButtonRef = useRef(null);
  const columnsPopoverRef = useRef(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [columnsPosition, setColumnsPosition] = useState(null);
  const [storedGuestColumns, setStoredGuestColumns] = usePersistentState(
    "guestTableColumns",
    DEFAULT_GUEST_TABLE_COLUMNS
  );
  const visibleColumns = useMemo(
    () => Object.fromEntries(
      GUEST_TABLE_COLUMNS.map(({ key }) => [
        key,
        storedGuestColumns?.[key] ?? DEFAULT_GUEST_TABLE_COLUMNS[key],
      ])
    ),
    [storedGuestColumns]
  );
  const visibleColumnCount = GUEST_TABLE_COLUMNS.filter(({ key }) => visibleColumns[key]).length;
  const tableColumnCount = 5 + visibleColumnCount;
  const [catManagerOpen, setCatManagerOpen] = useState(false);
  //  קריאת קובץ Excel גדול לוקחת זמן מורגש בנייד. בלי חיווי המשתמש
  //  לוחץ שוב ושוב על "ייבוא" וחושב שהכפתור לא עובד.
  const [importing, setImporting] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    category: categories[0] || "",
    seats: 1,
    mention: "",
    glatt: false,
    drinkers: false,
  });
  const [filters, setFilters] = useState({
    search: "",
    category: "all",
    rsvp: "all",
    onlyProbably: false,
    onlyConsidering: false,
    onlyGlatt: false,
    onlyDrinkers: false,
    onlyUnassigned: false,
    onlyDuplicatePhones: false,
  });

  const [sort, setSort] = useState({ key: null, dir: "asc" });

  useEffect(() => {
    if (!columnsOpen) return;
    const closeOnOutsidePointer = (event) => {
      if (
        !columnsPopoverRef.current?.contains(event.target) &&
        !columnsButtonRef.current?.contains(event.target)
      ) {
        setColumnsOpen(false);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setColumnsOpen(false);
        columnsButtonRef.current?.focus();
      }
    };
    const closeOnFocusOutside = (event) => {
      if (
        !columnsPopoverRef.current?.contains(event.target) &&
        !columnsButtonRef.current?.contains(event.target)
      ) {
        setColumnsOpen(false);
      }
    };
    const updatePosition = () => {
      const rect = columnsButtonRef.current?.getBoundingClientRect();
      if (rect) {
        setColumnsPosition(
          guestColumnsPopoverPosition(rect, window.innerWidth, window.innerHeight)
        );
      }
    };
    updatePosition();
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("focusin", closeOnFocusOutside);
    document.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("focusin", closeOnFocusOutside);
      document.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [columnsOpen]);

  const toggleColumnsPopover = () => {
    if (columnsOpen) {
      setColumnsOpen(false);
      return;
    }
    const rect = columnsButtonRef.current?.getBoundingClientRect();
    if (rect) {
      setColumnsPosition(
        guestColumnsPopoverPosition(rect, window.innerWidth, window.innerHeight)
      );
    }
    setColumnsOpen(true);
  };

  const toggleGuestColumn = (key) => {
    setStoredGuestColumns((previous) => ({
      ...DEFAULT_GUEST_TABLE_COLUMNS,
      ...previous,
      [key]: !(previous?.[key] ?? DEFAULT_GUEST_TABLE_COLUMNS[key]),
    }));
  };

  const toggleSort = useCallback((key) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );
  }, []);

  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [mobileLimit, setMobileLimit] = useState(30);

  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Live refs so stable callbacks (memoized rows) can read current data.
  const guestsRef = useRef(guests);
  const tablesRef = useRef(tables);
  useEffect(() => {
    guestsRef.current = guests;
  }, [guests]);
  useEffect(() => {
    tablesRef.current = tables;
  }, [tables]);

  const totals = useMemo(() => {
    const notDeclined = guests.filter((g) => g.rsvp !== "declined");
    //  “כנראה יבוא” נספר רק על מי שלא סירב להגיע, ובאותה ברירת מחדל
    //  של כיסא אחד כמו בשאר המונים, כדי שהמספרים יושווו ביניהם.
    const probablyGuests = notDeclined.filter((g) => g.probablyComing);
    return {
      count: guests.length,
      seatsTotal: notDeclined.reduce((s, g) => s + (g.seats || 0), 0),
      probablySeats: probablyGuests.reduce((s, g) => s + (g.seats || 1), 0),
      probablyCount: probablyGuests.length,
      consideringCount: guests.filter((g) => g.considering).length,
      glattCount: guests.filter((g) => g.glatt).length,
      glattSeats: notDeclined
        .filter((g) => g.glatt)
        .reduce((s, g) => s + (g.seats || 0), 0),
      //  שותים נספרים רק על מי שלא סירב להגיע — מחשבון האלכוהול
      //  צריך לדעת כמה אנשים בפועל יעמדו מול הבר.
      drinkers: notDeclined.reduce(
        (s, g) => s + Math.min(g.seats || 1, Math.max(0, Number(g.drinkers) || 0)),
        0
      ),
      drinkerRecords: guests.filter((g) => (Number(g.drinkers) || 0) > 0).length,
      gifts: guests.reduce((s, g) => s + (g.gift || 0), 0),
      confirmedCount: guests.filter((g) => g.rsvp === "confirmed").length,
      pendingCount: guests.filter((g) => g.rsvp === "pending").length,
      declinedCount: guests.filter((g) => g.rsvp === "declined").length,
      confirmedPeople: guests.reduce((s, g) => {
        if (g.rsvp !== "confirmed") return s;
        const seats = g.seats || 1;
        return s + (g.attendingCount != null ? Math.min(g.attendingCount, seats) : seats);
      }, 0),
      pendingPeople: guests.reduce(
        (s, g) => s + (g.rsvp === "pending" ? g.seats || 1 : 0),
        0
      ),
      declinedPeople: guests.reduce((s, g) => {
        const seats = g.seats || 1;
        if (g.rsvp === "declined") return s + seats;
        if (g.rsvp === "confirmed") {
          const att = g.attendingCount != null ? Math.min(g.attendingCount, seats) : seats;
          return s + (seats - att);
        }
        return s;
      }, 0),
    };
  }, [guests]);

  //  נתון על כל הרשימה ולא על התוצאות המסוננות: כפילות עם רשומה שהסינון מסתיר
  //  היא עדיין כפילות. הערך הוא מחרוזת, כדי ששורות ממוזכרות לא יתרעננו שלא לצורך.
  const duplicatePhoneNotes = useMemo(() => {
    const notes = new Map();
    for (const [id, others] of findDuplicatePhones(guests)) notes.set(id, describeDuplicates(others));
    return notes;
  }, [guests]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const assigned = filters.onlyUnassigned
      ? new Set(tables.flatMap((t) => t.guestIds))
      : null;
    return guests.filter((g) => {
      if (q) {
        const hay = `${g.name || ""} ${g.phone || ""} ${g.mention || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filters.category !== "all" && g.category !== filters.category) return false;
      if (filters.rsvp !== "all" && g.rsvp !== filters.rsvp) return false;
      if (filters.onlyProbably && !g.probablyComing) return false;
      if (filters.onlyConsidering && !g.considering) return false;
      if (filters.onlyGlatt && !g.glatt) return false;
      if (filters.onlyDrinkers && !(g.drinkers > 0)) return false;
      if (filters.onlyDuplicatePhones && !duplicatePhoneNotes.has(g.id)) return false;
      if (assigned && assigned.has(g.id)) return false;
      return true;
    });
  }, [guests, filters, tables, duplicatePhoneNotes]);

  const guestTableMap = useMemo(() => {
    const m = {};
    tables.forEach((t) => t.guestIds.forEach((id) => (m[id] = t.name)));
    return m;
  }, [tables]);

  const sorted = useMemo(() => {
    if (!sort.key) return filtered;
    const dir = sort.dir === "desc" ? -1 : 1;
    const val = (g) => {
      switch (sort.key) {
        case "name": return g.name || "";
        case "phone": return g.phone || "";
        case "category": return g.category || "";
        case "mention": return g.mention || "";
        case "seats": return g.seats || 0;
        case "glatt": return g.glatt ? 1 : 0;
        case "drinkers": return Number(g.drinkers) || 0;
        case "table": return guestTableMap[g.id] || "";
        case "probablyComing": return g.probablyComing ? 1 : 0;
        case "considering": return g.considering ? 1 : 0;
        case "rsvp": return { confirmed: 0, pending: 1, declined: 2 }[g.rsvp] ?? 1;
        case "gift": return g.gift || 0;
        default: return "";
      }
    };
    return [...filtered].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "he") * dir;
    });
  }, [filtered, sort, guestTableMap]);

  const hasActiveFilters = Boolean(
    filters.search.trim() ||
    filters.category !== "all" ||
    filters.rsvp !== "all" ||
    filters.onlyProbably ||
    filters.onlyConsidering ||
    filters.onlyGlatt ||
    filters.onlyDrinkers ||
    filters.onlyUnassigned ||
    filters.onlyDuplicatePhones
  );

  const guestEmptyState = dataLoading ? (
    <div role="status" aria-label="טוען מוזמנים" className="space-y-3 rounded-2xl bg-white/70 p-5 ring-1 ring-slate-200">
      <div className="mx-auto h-5 w-40 animate-pulse rounded bg-slate-100" />
      <div className="mx-auto h-4 w-64 max-w-full animate-pulse rounded bg-slate-100" />
    </div>
  ) : dataUnavailable ? (
    <div role="alert" className="rounded-2xl bg-amber-50 px-4 py-6 text-center ring-1 ring-amber-200">
      <p className="text-sm font-semibold text-amber-900">רשימת המוזמנים אינה זמינה כרגע</p>
      <p className="mt-1 text-xs text-amber-800">הנתונים לא נמחקו. בדקו את החיבור ונסו שוב.</p>
    </div>
  ) : guests.length === 0 ? (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-3xl border border-dashed border-gold-300 bg-gradient-to-b from-gold-50/70 to-white px-5 py-8 text-center sm:px-8 sm:py-10">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white text-gold-500 shadow-sm ring-1 ring-gold-100">
        <Users size={26} />
      </span>
      <div>
        <h3 className="text-base font-bold text-slate-800">רשימת המוזמנים עדיין ריקה</h3>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          הוסיפו את המוזמן הראשון או ייבאו רשימה מקובץ Excel או CSV.
        </p>
      </div>
      {canEdit && (
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button
            type="button"
            onClick={openAddGuest}
            className="btn-primary w-full sm:w-auto"
          >
            <Plus size={17} /> הוספת מוזמן
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="btn-secondary w-full sm:w-auto"
          >
            <Upload size={17} /> ייבוא Excel / CSV
          </button>
        </div>
      )}
    </div>
  ) : (
    <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-8 text-center">
      <Search size={22} className="mx-auto mb-2 text-slate-300" />
      <p className="text-sm font-semibold text-slate-700">לא נמצאו רשומות התואמות לסינון</p>
      <p className="mt-1 text-xs text-slate-500">נסו לשנות את החיפוש או לנקות את הסינונים.</p>
      {hasActiveFilters && (
        <button
          type="button"
          onClick={() => setFilters({
            search: "", category: "all", rsvp: "all", onlyProbably: false,
            onlyConsidering: false, onlyGlatt: false, onlyDrinkers: false, onlyUnassigned: false,
            onlyDuplicatePhones: false,
          })}
          className="btn-secondary mt-3"
        >
          <X size={15} /> ניקוי סינונים
        </button>
      )}
    </div>
  );

  // --- Row virtualization: render only the visible slice of the guests table ---
  const ROW_H = 65;
  const OVERSCAN = 6;
  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(550);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset scroll to top whenever the filter or sort changes the result set
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
    setMobileLimit(30);
  }, [filters, sort]);

  const totalRows = sorted.length;
  //  מחיקה מרובה מקטינה את הרשימה בלי לשנות סינון, ואז scrollTop שבמצב גדול
  //  מהגובה החדש — בלי הקיטום startIndex יוצא מהטווח והטבלה נראית ריקה.
  const clampedTop = Math.min(scrollTop, Math.max(0, totalRows * ROW_H - viewportH));
  const startIndex = Math.max(0, Math.floor(clampedTop / ROW_H) - OVERSCAN);
  const endIndex = Math.min(totalRows, Math.ceil((clampedTop + viewportH) / ROW_H) + OVERSCAN);
  const visibleRows = sorted.slice(startIndex, endIndex);
  const padTop = startIndex * ROW_H;
  const padBottom = Math.max(0, (totalRows - endIndex) * ROW_H);

  //  הקטגוריה שנבחרה בטופס עלולה להימחק או להשתנות בזמן שהטופס פתוח;
  //  בלי הנפילה לראשונה ה-select היה מוצג ריק והרשומה נשמרת עם קטגוריה שאינה קיימת.
  const formCategory = categories.includes(form.category) ? form.category : categories[0] || "";

  useEffect(() => {
    if (!addGuestTouched.current) return;
    if (isAddGuestOpen) addGuestFormRef.current?.querySelector("input")?.focus({ preventScroll: true });
    else addGuestToggleRef.current?.focus();
  }, [isAddGuestOpen]);

  //  גם הכפתור במצב „רשימה ריקה” מגיע לכאן, והוא נמצא רחוק מהטופס.
  function openAddGuest() {
    addGuestTouched.current = true;
    addGuestToggleRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (isAddGuestOpen) addGuestFormRef.current?.querySelector("input")?.focus({ preventScroll: true });
    else setIsAddGuestOpen(true);
  }

  function addGuest(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setGuests((prev) => [
      ...prev,
      {
        id: nextGuestId(prev),
        name: form.name.trim(),
        phone: form.phone.trim(),
        category: formCategory,
        seats: Number(form.seats) || 1,
        mention: form.mention.trim(),
        //  "מקור" הוא שדה חופשי שמגיע מייבוא בלבד; אין רשימה קבועה במערכת.
        source: "",
        probablyComing: false,
        considering: false,
        glatt: form.glatt,
        //  סימון “שותים” בטופס משמעו “כל מי שברשומה הזו׳”; מדרגים ברשימה.
        drinkers: form.drinkers ? Math.max(1, Number(form.seats) || 1) : 0,
        rsvp: "pending",
        gift: 0,
      },
    ]);
    setForm({
      name: "",
      phone: "",
      category: categories[0] || "",
      seats: 1,
      mention: "",
      glatt: false,
      drinkers: false,
    });
    //  נשארים פתוחים: מזינים בדרך כלל כמה מוזמנים ברצף, ולכן חוזרים לשדה השם.
    addGuestFormRef.current?.querySelector("input")?.focus({ preventScroll: true });
  }

  const toggleFlag = useCallback((id, key) => {
    setGuests((prev) =>
      prev.map((g) => (g.id === id ? { ...g, [key]: !g[key] } : g))
    );
  }, [setGuests]);

  const updateGift = useCallback((id, gift) => {
    setGuests((prev) =>
      prev.map((g) => (g.id === id ? { ...g, gift: Number(gift) || 0 } : g))
    );
  }, [setGuests]);

  const addCategory = useCallback((name) => {
    const v = name.trim();
    if (!v) return;
    setCategories((prev) => (prev.includes(v) ? prev : [...prev, v]));
  }, [setCategories]);

  const renameCategory = useCallback((oldName, newName) => {
    const v = newName.trim();
    if (!v || v === oldName) return;
    setCategories((prev) =>
      prev.includes(v) ? prev : prev.map((c) => (c === oldName ? v : c))
    );
    setGuests((prev) =>
      prev.map((g) => (g.category === oldName ? { ...g, category: v } : g))
    );
  }, [setCategories, setGuests]);

  const deleteCategory = useCallback((name, fallback) => {
    setCategories((prev) => prev.filter((c) => c !== name));
    setGuests((prev) =>
      prev.map((g) => (g.category === name ? { ...g, category: fallback } : g))
    );
  }, [setCategories, setGuests]);

  const updateName = useCallback((id, name) => {
    setGuests((prev) =>
      prev.map((g) => (g.id === id ? { ...g, name } : g))
    );
  }, [setGuests]);

  const updatePhone = useCallback((id, phone) => {
    setGuests((prev) =>
      prev.map((g) => (g.id === id ? { ...g, phone } : g))
    );
  }, [setGuests]);

  const updateMention = useCallback((id, mention) => {
    setGuests((prev) =>
      prev.map((g) => (g.id === id ? { ...g, mention } : g))
    );
  }, [setGuests]);

  const updateSeats = useCallback((id, seats) => {
    setGuests((prev) =>
      prev.map((g) => {
        if (g.id !== id) return g;
        const n = Math.max(1, Number(seats) || 1);
        const attendingCount =
          g.attendingCount != null ? Math.min(g.attendingCount, n) : g.attendingCount;
        //  הקטנת מספר הכיסאות חייבת לקטום גם את השותים, אחרת נשארת רשומה
        //  עם 4 שותים ו-2 כיסאות ומחשבון האלכוהול סופר אנשים שלא קיימים.
        const drinkers = Math.min(n, Math.max(0, Number(g.drinkers) || 0));
        return { ...g, seats: n, attendingCount, drinkers };
      })
    );
  }, [setGuests]);

  /*  מספר השותים אף פעם לא גדול ממספר הכיסאות ברשומה — הקיטום כאן ולא רק
      ב-UI, כי הקטנת מספר הכיסאות אחרי הסימון הייתה משאירה ערך גדול מדי.  */
  const updateDrinkers = useCallback((id, n) => {
    setGuests((prev) =>
      prev.map((g) => {
        if (g.id !== id) return g;
        const seats = Math.max(1, Number(g.seats) || 1);
        return { ...g, drinkers: Math.min(seats, Math.max(0, Math.round(Number(n) || 0))) };
      })
    );
  }, [setGuests]);

  const updateRsvp = useCallback((id, rsvp) => {
    setGuests((prev) =>
      prev.map((g) => {
        if (g.id !== id) return g;
        const seats = g.seats || 1;
        const attendingCount =
          rsvp === "confirmed"
            ? g.attendingCount > 0
              ? Math.min(g.attendingCount, seats)
              : seats
            : 0;
        return { ...g, rsvp, attendingCount };
      })
    );
  }, [setGuests]);

  const updateAttending = useCallback((id, n) => {
    setGuests((prev) =>
      prev.map((g) => {
        if (g.id !== id) return g;
        const seats = g.seats || 1;
        const attendingCount = Math.max(0, Math.min(seats, Math.round(Number(n) || 0)));
        return { ...g, attendingCount };
      })
    );
  }, [setGuests]);

  const updateCategory = useCallback((id, category) => {
    setGuests((prev) =>
      prev.map((g) => (g.id === id ? { ...g, category } : g))
    );
  }, [setGuests]);

  const removeGuest = useCallback((id) => {
    const cur = guestsRef.current;
    const idx = cur.findIndex((g) => g.id === id);
    if (idx === -1) return;
    const guest = cur[idx];
    const tableIds = tablesRef.current
      .filter((t) => t.guestIds.includes(id))
      .map((t) => t.id);
    setGuests((prev) => prev.filter((g) => g.id !== id));
    setTables((prev) =>
      prev.map((t) => ({ ...t, guestIds: t.guestIds.filter((gid) => gid !== id) }))
    );
    notify(`הרשומה "${guest.name}" נמחקה`, {
      action: {
        label: "בטל מחיקה",
        onClick: () => {
          setGuests((prev) => {
            if (prev.some((g) => g.id === id)) return prev;
            const arr = [...prev];
            arr.splice(Math.min(idx, arr.length), 0, guest);
            return arr;
          });
          if (tableIds.length)
            setTables((prev) =>
              prev.map((t) =>
                tableIds.includes(t.id) && !t.guestIds.includes(id)
                  ? { ...t, guestIds: [...t.guestIds, id] }
                  : t
              )
            );
        },
      },
    });
  }, [setGuests, setTables]);

  const bulkDelete = useCallback(async () => {
    const ids = new Set(selectedIds);
    if (ids.size === 0) return;
    const ok = await confirmDialog({
      title: "מחיקת רשומות מרובות",
      message: `למחוק ${ids.size} רשומות שנבחרו? פעולה זו תסיר אותן גם מהשולחנות.`,
      confirmLabel: "מחק הכל",
      tone: "danger",
    });
    if (!ok) return;
    setGuests((prev) => prev.filter((g) => !ids.has(g.id)));
    setTables((prev) =>
      prev.map((t) => ({ ...t, guestIds: t.guestIds.filter((gid) => !ids.has(gid)) }))
    );
    setSelectedIds(new Set());
    notify(`${ids.size} רשומות נמחקו`, { tone: "success" });
  }, [selectedIds, setGuests, setTables]);

  const bulkRsvp = useCallback(
    (rsvp) => {
      const ids = new Set(selectedIds);
      if (ids.size === 0) return;
      setGuests((prev) =>
        prev.map((g) => {
          if (!ids.has(g.id)) return g;
          const seats = g.seats || 1;
          const attendingCount =
            rsvp === "confirmed"
              ? g.attendingCount > 0
                ? Math.min(g.attendingCount, seats)
                : seats
              : 0;
          return { ...g, rsvp, attendingCount };
        })
      );
      notify(`עודכן סטטוס עבור ${ids.size} רשומות`, { tone: "success" });
    },
    [selectedIds, setGuests]
  );

  /*  סימון שותים באצווה. ברשימה של מאות רשומות סימון אחד-אחד אינו
      מעשי, ולכן הסימון ההמוני מציב “כל מי שברשומה” (seats) או 0.
      כוונון עדין לשורה בודדת נשאר אפשרי אחר כך דרך ה-stepper שבשורה.  */
  const bulkDrinkers = useCallback(
    (on) => {
      const ids = new Set(selectedIds);
      if (ids.size === 0) return;
      setGuests((prev) =>
        prev.map((g) =>
          ids.has(g.id)
            ? { ...g, drinkers: on ? Math.max(1, Number(g.seats) || 1) : 0 }
            : g
        )
      );
      notify(
        on
          ? `${ids.size} רשומות סומנו כשותים`
          : `סימון השותים הוסר מ-${ids.size} רשומות`,
        { tone: "success" }
      );
    },
    [selectedIds, setGuests]
  );

  /*  ייבוא מוזמנים מקובץ Excel (.xlsx) או CSV/TSV. כל הלוגיקה של פענוח
      הקידוד, פירוק השורות והמרתן לרשומות יושבת ב-lib/guestImport.js כדי
      שאפשר יהיה לבדוק אותה מחוץ לדפדפן (npm run test:import).
      העמודות מזוהות לפי שם הכותרת ולא לפי מיקום:
      שם, נייד, קטגוריה, אזכור, כיסאות, מקור, גלאט, כנראה יבוא, לשקול,
      אישור הגעה, כמה אישרו, מתנה.  */
  async function handleFile(e) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const rows = await readGuestRows(file);
      const {
        guests: parsed,
        newCategories,
        skipped,
        hasHeader,
      } = rowsToGuests(rows, {
        categories,
      });

      /*  בלי שורת כותרת מזוהה העמודות נקראות לפי מיקום, וקובץ מקור אחר
          (רשימה מהאולם, ייצוא מווטסאפ) נכנס עם טלפונים בעמודת הקטגוריה
          ומספרים אקראיים בעמודת הכיסאות. עדיף לעצור ולהפנות לתבנית.  */
      if (!hasHeader) {
        notify(
          "הקובץ אינו תואם לתבנית המוזמנים של המערכת. הורידו את התבנית " +
            "בכפתור “תבנית”, מלאו אותה והעלו שוב.",
          { tone: "error", duration: 9000 }
        );
        return;
      }

      if (!parsed.length) {
        notify("לא נמצאו רשומות תקינות בקובץ – ודאו שיש עמודת שם או טלפון", {
          tone: "error",
        });
        return;
      }

      if (newCategories.length)
        setCategories((prev) => [
          ...prev,
          ...newCategories.filter((c) => !prev.includes(c)),
        ]);

      setGuests((prev) => {
        let id = nextGuestId(prev) - 1;
        return [...prev, ...parsed.map((p) => ({ ...p, id: ++id }))];
      });

      //  מדווחים גם על מה שלא נכנס, אחרת המשתמש סופר שורות בקובץ
      //  ולא מבין למה המספר במסך שונה.
      const extra = [
        newCategories.length ? `${newCategories.length} קטגוריות חדשות` : "",
        skipped ? `${skipped} שורות ריקות דולגו` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      notify(
        `יובאו ${parsed.length} רשומות בהצלחה${extra ? ` (${extra})` : ""}`,
        { tone: "success" }
      );
    } catch (err) {
      notify(
        err instanceof ImportError
          ? err.message
          : "שגיאה בקריאת הקובץ – ודאו שהוא קובץ Excel או CSV תקין",
        { tone: "error" }
      );
    } finally {
      setImporting(false);
      //  איפוס ה-input, אחרת בחירה חוזרת באותו קובץ לא מפעילה onChange.
      input.value = "";
    }
  }

  function downloadTemplate() {
    const header =
      "שם,נייד,קטגוריה,אזכור,כיסאות,גלאט,כנראה יבוא,לשקול,אישור הגעה,כמה אישרו,מתנה";
    const examples = [
      `ישראל ישראלי,050-1234567,${categories[0] || ""},חבר של אבא,2,,V,,אישרו הגעה,2,0`,
      `דנה כהן,052-7654321,${categories[0] || ""},,4,כן,,,אישרו הגעה,3,0`,
      `משפחת לוי,,${categories[0] || ""},,3,,,,ממתין,,0`,
    ];
    const blob = new Blob(["\uFEFF" + header + "\n" + examples.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "תבנית-מוזמנים.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportGuests() {
    if (!sorted.length) {
      notify("אין רשומות לייצוא", { tone: "error" });
      return;
    }
    const header =
      "שם,נייד,קטגוריה,אזכור,כיסאות,גלאט,שיבוץ,כנראה יבוא,לשקול,אישור הגעה,כמה אישרו,מתנה";
    const esc = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = sorted.map((g) => {
      const seats = g.seats ?? 1;
      const attending =
        g.rsvp === "confirmed"
          ? g.attendingCount != null
            ? Math.min(g.attendingCount, seats)
            : seats
          : "";
      return [
        g.name,
        g.phone,
        g.category,
        g.mention,
        seats,
        g.glatt ? "כן" : "",
        guestTableMap[g.id] || "",
        g.probablyComing ? "כן" : "",
        g.considering ? "כן" : "",
        RSVP[g.rsvp]?.label || "",
        attending,
        g.gift || 0,
      ]
        .map(esc)
        .join(",");
    });
    const blob = new Blob(["\uFEFF" + header + "\n" + lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `מוזמנים-${new Date().toLocaleDateString("he-IL")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(`יוצאו ${sorted.length} רשומות לקובץ CSV`, { tone: "success" });
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div data-tour="guests-summary" className="grid grid-cols-2 gap-2.5 sm:gap-4 xl:grid-cols-5">
        <StatCard icon={Users} label="סה״כ רשומות" value={totals.count} tone="gold" />
        <StatCard
          icon={UserCheck}
          label="סה״כ כיסאות"
          value={totals.seatsTotal}
          tone="sage"
        />
        <StatCard
          icon={Star}
          label="כנראה יבואו"
          value={totals.probablySeats}
          sub={`${totals.probablyCount} רשומות מסומנות`}
          tone="sage"
        />
        <StatCard
          icon={UtensilsCrossed}
          label="מנות גלאט להזמין"
          value={totals.glattSeats}
          sub={`${totals.glattCount} רשומות מסומנות`}
          tone="gold"
        />
        <StatCard
          icon={HelpCircle}
          label="לשקול הזמנה"
          value={totals.consideringCount}
          sub="עדיין לא הוחלט"
          tone="rose"
        />
      </div>

      {/* RSVP summary */}
      <Card tourId="guests-rsvp">
        {/*  \u05d1\u05e0\u05d9\u05d9\u05d3 \u05d4\u05db\u05d5\u05ea\u05e8\u05ea \u05d9\u05d5\u05e9\u05d1\u05ea \u05de\u05e2\u05dc \u05d4\u05e6\u05d9\u05e4\u05e1 \u05d5\u05dc\u05d0 \u05dc\u05e6\u05d9\u05d3\u05dd. \u05db\u05e9\u05d4\u05db\u05dc \u05d4\u05d9\u05d4 \u05d1\u05e9\u05d5\u05e8\u05d4
            \u05d0\u05d7\u05ea \u05d4\u05db\u05d5\u05ea\u05e8\u05ea \u05d1\u05dc\u05e2\u05d4 \u05db-140px \u05d5\u05d4\u05e9\u05dc\u05d5\u05e9\u05d4 \u05e0\u05d3\u05d7\u05e7\u05d5 \u05dc\u05e2\u05de\u05d5\u05d3\u05d4 \u05e6\u05e8\u05d4 \u05d1\u05e6\u05d3 \u05d4\u05e9\u05e0\u05d9.  */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <CheckCheck size={18} className="text-sage-500" /> סטטוס אישורי הגעה
          </div>
          <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-1 sm:flex-wrap">
            {[
              { key: "confirmed", label: "אישרו הגעה", value: totals.confirmedPeople, records: totals.confirmedCount, color: "sage" },
              { key: "pending", label: "ממתינים", value: totals.pendingPeople, records: totals.pendingCount, color: "gold" },
              { key: "declined", label: "לא מגיעים", value: totals.declinedPeople, records: totals.declinedCount, color: "rose" },
            ].map((s) => {
              const active = filters.rsvp === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() =>
                    setFilters((f) => ({ ...f, rsvp: active ? "all" : s.key }))
                  }
                  aria-pressed={active}
                  title={`סינון לפי ${s.label}`}
                  className={`flex min-h-11 min-w-0 flex-col items-center gap-1 rounded-2xl border px-2 py-2 text-sm transition sm:min-w-[150px] sm:flex-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:px-4 sm:py-2.5 ${
                    active
                      ? "border-gold-400 bg-gold-50 ring-2 ring-gold-200"
                      : "border-sage-300 bg-sage-50 shadow-sm hover:border-sage-400 hover:bg-sage-100"
                  }`}
                >
                  <span className="flex min-w-0 flex-col text-center sm:text-right">
                    <span className="truncate text-xs font-medium text-slate-600 sm:text-sm">{s.label}</span>
                    <span className="text-[11px] text-slate-400">{s.records} רשומות</span>
                  </span>
                  <span className="flex items-baseline gap-1">
                    <Badge color={s.color}>{s.value}</Badge>
                    <span className="hidden text-[11px] text-slate-400 sm:inline">אנשים</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Add + import */}
      <Card tourId="guests-management">
        <div data-tour="guests-import-tools">
        <SectionTitle
          icon={Users}
          title="ניהול רשימת המוזמנים"
          subtitle={`יובאו ${totals.count} רשומות מהקובץ – הוסיפו, סננו ועדכנו`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,.tsv,.xlsx,.xlsm,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={handleFile}
              />
              {canEdit && (
                <button
                  onClick={() => setCatManagerOpen(true)}
                  title="הוספה, עריכה ומחיקה של קטגוריות מוזמנים"
                  className="btn-secondary"
                >
                  <Tag size={17} /> קטגוריות
                </button>
              )}
              {canEdit && (
                <button
                  onClick={downloadTemplate}
                  title="הורדת קובץ תבנית לייבוא"
                  className="btn-secondary"
                >
                  <FileText size={17} /> תבנית
                </button>
              )}
              <button
                onClick={exportGuests}
                title="ייצוא הרשומות המסוננות לקובץ CSV"
                className="btn-secondary"
              >
                <Download size={17} /> ייצוא
              </button>
              {canEdit && (
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={importing}
                  title="ייבוא מוזמנים מקובץ Excel (.xlsx) או CSV"
                  className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {importing ? (
                    <>
                      <Loader2 size={18} className="animate-spin" /> מייבא…
                    </>
                  ) : (
                    <>
                      <Upload size={18} /> ייבוא Excel / CSV
                    </>
                  )}
                </button>
              )}
            </div>
          }
        />
        </div>

        {canEdit && (
        <CollapsibleAdd
          tourId="guests-add"
          label="הוספת מוזמן חדש"
          open={isAddGuestOpen}
          onToggle={() => {
            addGuestTouched.current = true;
            setIsAddGuestOpen((open) => !open);
          }}
          panelId="guests-add-panel"
          toggleRef={addGuestToggleRef}
          className="mb-4 sm:mb-5"
        >
        <form
          ref={addGuestFormRef}
          onSubmit={addGuest}
          className="mt-2.5 rounded-2xl border border-gold-200 bg-gradient-to-l from-gold-50/70 to-white p-3 sm:p-4"
        >
          {/*  בנייד שתי עמודות ולא אחת. שבעה שדות ברוחב מלא הפכו טופס אחד
              ל-330px של גלילה, ושדות כמו "כיסאות" קיבלו שורה שלמה כדי להציג
              ספרה אחת.  */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 2xl:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto_auto]">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="שם האורח / משפחה"
            aria-label="שם האורח או המשפחה"
            className="col-span-2 min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-200 lg:col-span-1"
          />
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="נייד"
            aria-label="מספר נייד"
            type="tel"
            dir="ltr"
            className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-start text-sm outline-none focus:border-gold-400"
          />
          <select
            value={formCategory}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            aria-label="קטגוריה"
            className="min-w-0 rounded-xl border border-slate-200 bg-white px-2 py-2.5 text-sm outline-none focus:border-gold-400 sm:px-3"
          >
            {/*  חתונה חדשה מתחילה בלי קטגוריות. select ריק נראה כמו תקלה,
                ולכן מסבירים בתוכו לאן ללכת כדי להגדיר אותן.  */}
            {categories.length === 0 && (
              <option value="">ללא קטגוריה — הוסיפו ב״קטגוריות״</option>
            )}
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          {/*  התווית צמודה לשדה ולא מעליו: בעמודה צרה המספר "1" לבדו לא
              אומר כלום, ותווית נפרדת הייתה מוסיפה שורה.  */}
          <label className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 focus-within:border-gold-400">
            <span className="shrink-0 text-xs text-slate-400">כיסאות</span>
            <input
              type="number"
              min="1"
              value={form.seats}
              onChange={(e) => setForm({ ...form, seats: e.target.value })}
              aria-label="מספר כיסאות"
              className="w-full min-w-0 bg-transparent text-sm outline-none"
            />
          </label>
          <input
            value={form.mention}
            onChange={(e) => setForm({ ...form, mention: e.target.value })}
            placeholder="אזכור"
            aria-label="אזכור"
            className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-gold-400"
          />
          <label
            title="נדרש להזמין מנת בד״צ / גלאט עבור מוזמן זה"
            className="flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600 outline-none focus-within:border-gold-400 sm:min-h-0"
          >
            <input
              type="checkbox"
              checked={form.glatt}
              onChange={(e) => setForm({ ...form, glatt: e.target.checked })}
              className="h-5 w-5 accent-gold-500 sm:h-4 sm:w-4"
            />
            גלאט
          </label>
          <label
            title="המוזמנים ברשומה הזו שותים אלכוהול — משמש לחישוב האלכוהול"
            className="flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600 outline-none focus-within:border-gold-400 sm:min-h-0"
          >
            <input
              type="checkbox"
              checked={form.drinkers}
              onChange={(e) => setForm({ ...form, drinkers: e.target.checked })}
              className="h-5 w-5 accent-gold-500 sm:h-4 sm:w-4"
            />
            שותים
          </label>
          <button
            type="submit"
            className="btn-primary col-span-2 lg:col-span-1"
          >
            <Plus size={18} /> הוסף לרשימה
          </button>
          </div>
        </form>
        </CollapsibleAdd>
        )}

        {/* Search & Filters */}
        <div data-tour="guests-filters" className="mb-3 border-y border-slate-200 bg-slate-50/80 p-3 sm:mb-4 sm:p-4">
          <div className="mb-2.5 flex items-center gap-2.5 sm:mb-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sage-100 text-sage-600 sm:h-9 sm:w-9">
              <Filter size={16} />
            </span>
            <div>
              <p className="text-sm font-bold text-slate-800">חיפוש וסינון מוזמנים</p>
              {/*  המשפט המסביר נשבר לשתי שורות בנייד ואינו מוסיף מידע
                  מעבר למה שהשדות עצמם מראים.  */}
              <p className="hidden text-xs text-slate-500 sm:block">אתרו רשומות קיימות לפי שם, קטגוריה או סטטוס</p>
            </div>
          </div>
          {/*  בנייד גריד של שתי עמודות במקום flex-wrap: ה-select הראשון היה
              רחב מדי ודחף את שני האחרים לשורות נפרדות.  */}
          <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
            <div className="relative col-span-2 sm:min-w-[200px] sm:flex-1">
              <Search
                size={18}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                placeholder="חיפוש לפי שם מוזמן..."
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-10 pl-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
            </div>
            <select
              value={filters.category}
              onChange={(e) => setFilters({ ...filters, category: e.target.value })}
              title="סינון לפי קטגוריה"
              aria-label="סינון לפי קטגוריה"
              className={`filter-select sm:w-auto sm:max-w-56 ${filters.category !== "all" ? "filter-select-active" : ""}`}
            >
              <option value="all">כל הקטגוריות</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={filters.rsvp}
              onChange={(e) => setFilters({ ...filters, rsvp: e.target.value })}
              title="סינון לפי אישור הגעה"
              aria-label="סינון לפי אישור הגעה"
              className={`filter-select sm:w-auto ${filters.rsvp !== "all" ? "filter-select-active" : ""}`}
            >
              <option value="all">כל הסטטוסים</option>
              <option value="confirmed">אישרו הגעה</option>
              <option value="pending">ממתין</option>
              <option value="declined">לא מגיעים</option>
            </select>
            <button
              onClick={() =>
                setFilters({ ...filters, onlyProbably: !filters.onlyProbably })
              }
              aria-pressed={filters.onlyProbably}
              className={`filter-chip ${filters.onlyProbably ? "filter-chip-active" : ""}`}
            >
              <Star size={15} /> כנראה יבוא
            </button>
            <button
              onClick={() =>
                setFilters({ ...filters, onlyConsidering: !filters.onlyConsidering })
              }
              aria-pressed={filters.onlyConsidering}
              className={`filter-chip ${filters.onlyConsidering ? "filter-chip-active" : ""}`}
            >
              <HelpCircle size={15} /> לשקול
            </button>
            <button
              onClick={() =>
                setFilters({ ...filters, onlyGlatt: !filters.onlyGlatt })
              }
              aria-pressed={filters.onlyGlatt}
              className={`filter-chip ${filters.onlyGlatt ? "filter-chip-active" : ""}`}
            >
              <UtensilsCrossed size={15} /> גלאט
            </button>
            <button
              onClick={() =>
                setFilters({ ...filters, onlyDrinkers: !filters.onlyDrinkers })
              }
              aria-pressed={filters.onlyDrinkers}
              className={`filter-chip ${filters.onlyDrinkers ? "filter-chip-active" : ""}`}
            >
              <Wine size={15} /> שותים
            </button>
            <button
              onClick={() =>
                setFilters({ ...filters, onlyUnassigned: !filters.onlyUnassigned })
              }
              aria-pressed={filters.onlyUnassigned}
              className={`filter-chip ${filters.onlyUnassigned ? "filter-chip-active" : ""}`}
            >
              <Armchair size={15} /> לא משובץ
            </button>
            {/*  מופיע רק כשיש כפילות (או כשהסינון כבר פעיל), כדי שלא יהיה רעש ויזואלי.  */}
            {(duplicatePhoneNotes.size > 0 || filters.onlyDuplicatePhones) && (
              <button
                onClick={() =>
                  setFilters({ ...filters, onlyDuplicatePhones: !filters.onlyDuplicatePhones })
                }
                aria-pressed={filters.onlyDuplicatePhones}
                title="רשומות שמספר הנייד שלהן מופיע ביותר מרשומה אחת"
                className={
                  "filter-chip " +
                  (filters.onlyDuplicatePhones
                    ? "border-amber-600 bg-amber-500 text-slate-950 hover:bg-amber-600"
                    : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100")
                }
              >
                <AlertTriangle size={15} /> נייד כפול ({duplicatePhoneNotes.size})
              </button>
            )}
            {(filters.search ||
              filters.category !== "all" ||
              filters.rsvp !== "all" ||
              filters.onlyProbably ||
              filters.onlyConsidering ||
              filters.onlyGlatt ||
              filters.onlyDrinkers ||
              filters.onlyUnassigned ||
              filters.onlyDuplicatePhones) && (
              <button
                onClick={() =>
                  setFilters({
                    search: "",
                    category: "all",
                    rsvp: "all",
                    onlyProbably: false,
                    onlyConsidering: false,
                    onlyGlatt: false,
                    onlyDrinkers: false,
                    onlyUnassigned: false,
                    onlyDuplicatePhones: false,
                  })
                }
                title="ניקוי כל הסינונים"
                className="btn-secondary"
              >
                <X size={15} /> נקה
              </button>
            )}
            <div
              className="relative col-span-2 hidden justify-end sm:col-span-1 sm:ml-auto xl:flex"
            >
              <button
                ref={columnsButtonRef}
                type="button"
                onClick={toggleColumnsPopover}
                aria-expanded={columnsOpen}
                aria-controls="guest-columns-popover"
                aria-haspopup="true"
                className="btn-secondary"
              >
                <Columns3 size={17} />
                עמודות
                <span className="text-xs font-medium text-slate-500">
                  {visibleColumnCount}/{GUEST_TABLE_COLUMNS.length}
                </span>
              </button>
            </div>
          </div>
        </div>

        <p data-tour="guests-list" className="mb-3 text-xs text-slate-400">
          מציג {filtered.length} מתוך {guests.length} רשומות · עמודות שהמערכת
          מזהה בקובץ Excel או CSV (בכל סדר): שם, נייד, קטגוריה, אזכור, כיסאות,
          גלאט, שותים, "כנראה יבוא", "לשקול", "אישור הגעה", "כמה אישרו", מתנה
        </p>

        {/* Bulk action bar */}
        {canEdit && selectedIds.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-gold-200 bg-gold-50/70 px-4 py-3">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              <CheckCheck size={16} className="text-gold-600" />
              {selectedIds.size} נבחרו
            </span>
            <div className="mx-1 h-5 w-px bg-gold-200" />
            <span className="text-xs font-medium text-slate-500">סמן כ:</span>
            <button
              onClick={() => bulkRsvp("confirmed")}
              className="btn-secondary px-2.5 text-xs"
            >
              אישרו הגעה
            </button>
            <button
              onClick={() => bulkRsvp("pending")}
              className="btn-secondary px-2.5 text-xs"
            >
              ממתין
            </button>
            <button
              onClick={() => bulkRsvp("declined")}
              className="btn-secondary px-2.5 text-xs"
            >
              לא מגיעים
            </button>
            <div className="mx-1 h-5 w-px bg-gold-200" />
            <span className="text-xs font-medium text-slate-500">שותים:</span>
            <button
              onClick={() => bulkDrinkers(true)}
              className="btn-secondary px-2.5 text-xs"
            >
              <Wine size={14} /> סמן כשותים
            </button>
            <button
              onClick={() => bulkDrinkers(false)}
              className="btn-secondary px-2.5 text-xs"
            >
              בטל סימון
            </button>
            <div className="mx-1 h-5 w-px bg-gold-200" />
            <button
              onClick={bulkDelete}
              className="btn-danger px-2.5 text-xs"
            >
              <Trash2 size={14} /> מחק
            </button>
            <button
              onClick={clearSelection}
              className="btn-ghost mr-auto px-2.5 text-xs"
            >
              <X size={14} /> ביטול בחירה
            </button>
          </div>
        )}

        {/* Table (desktop) */}
        <div
          ref={scrollRef}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          className="hidden max-h-[560px] overflow-auto rounded-2xl ring-1 ring-slate-200/70 xl:block"
        >
          <table className="w-full text-right text-sm">
            <thead className="sticky top-0 z-10 bg-white/95 backdrop-blur">
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="px-2 py-2">
                  {canEdit && (
                    <label className="grid h-11 w-11 cursor-pointer place-items-center">
                      <input
                        type="checkbox"
                        aria-label="בחירת כל הרשומות המסוננות"
                        checked={sorted.length > 0 && sorted.every((g) => selectedIds.has(g.id))}
                        onChange={(e) =>
                          setSelectedIds(
                            e.target.checked ? new Set(sorted.map((g) => g.id)) : new Set()
                          )
                        }
                        className="h-5 w-5 accent-gold-500"
                      />
                    </label>
                  )}
                </th>
                <SortHeader label="שם" sortKey="name" sort={sort} onSort={toggleSort} />
                <SortHeader label="נייד" sortKey="phone" sort={sort} onSort={toggleSort} />
                {visibleColumns.category && <SortHeader label="קטגוריה" sortKey="category" sort={sort} onSort={toggleSort} />}
                {visibleColumns.mention && <SortHeader label="אזכור / הערות" sortKey="mention" sort={sort} onSort={toggleSort} />}
                {visibleColumns.seats && <SortHeader label="כיסאות" sortKey="seats" sort={sort} onSort={toggleSort} />}
                {visibleColumns.glatt && <SortHeader label="גלאט" sortKey="glatt" sort={sort} onSort={toggleSort} center />}
                {visibleColumns.drinkers && <SortHeader label="שותים" sortKey="drinkers" sort={sort} onSort={toggleSort} center />}
                <SortHeader label="שיבוץ" sortKey="table" sort={sort} onSort={toggleSort} />
                {visibleColumns.probablyComing && <SortHeader label="כנראה יבוא" sortKey="probablyComing" sort={sort} onSort={toggleSort} center />}
                {visibleColumns.considering && <SortHeader label="לשקול" sortKey="considering" sort={sort} onSort={toggleSort} center />}
                {visibleColumns.rsvp && <SortHeader label="אישור הגעה" sortKey="rsvp" sort={sort} onSort={toggleSort} />}
                {visibleColumns.gift && <SortHeader label="מתנה (₪)" sortKey="gift" sort={sort} onSort={toggleSort} />}
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {padTop > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={tableColumnCount} className="p-0" style={{ height: padTop }} />
                </tr>
              )}
              {visibleRows.map((g) => (
                <GuestRow
                  key={g.id}
                  g={g}
                  tableLabel={guestTableMap[g.id]}
                  visibleColumns={visibleColumns}
                  selected={selectedIds.has(g.id)}
                  duplicateNote={duplicatePhoneNotes.get(g.id)}
                  onToggleSelect={toggleSelect}
                  updateName={updateName}
                  updatePhone={updatePhone}
                  updateCategory={updateCategory}
                  updateMention={updateMention}
                  updateSeats={updateSeats}
                  updateGift={updateGift}
                  updateDrinkers={updateDrinkers}
                  toggleFlag={toggleFlag}
                  updateRsvp={updateRsvp}
                  updateAttending={updateAttending}
                  removeGuest={removeGuest}
                  canEdit={canEdit}
                />
              ))}
              {padBottom > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={tableColumnCount} className="p-0" style={{ height: padBottom }} />
                </tr>
              )}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={tableColumnCount} className="px-3 py-6">
                    {guestEmptyState}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Cards (mobile) */}
        <div className="space-y-3 xl:hidden">
          {sorted.slice(0, mobileLimit).map((g) => (
            <GuestCard
              key={g.id}
              g={g}
              tableLabel={guestTableMap[g.id]}
              selected={selectedIds.has(g.id)}
              duplicateNote={duplicatePhoneNotes.get(g.id)}
              onToggleSelect={toggleSelect}
              updateName={updateName}
              updatePhone={updatePhone}
              updateCategory={updateCategory}
              updateMention={updateMention}
              updateSeats={updateSeats}
              updateGift={updateGift}
              updateDrinkers={updateDrinkers}
              toggleFlag={toggleFlag}
              updateRsvp={updateRsvp}
              updateAttending={updateAttending}
              removeGuest={removeGuest}
              canEdit={canEdit}
            />
          ))}
          {sorted.length === 0 && (
            guestEmptyState
          )}
          {sorted.length > mobileLimit && (
            <button
              onClick={() => setMobileLimit((n) => n + 30)}
              className="btn-secondary w-full"
            >
              הצג עוד ({sorted.length - mobileLimit} נותרו)
            </button>
          )}
        </div>
      </Card>

      {columnsOpen && columnsPosition && createPortal(
        <div
          id="guest-columns-popover"
          ref={columnsPopoverRef}
          role="group"
          aria-label="בחירת עמודות בטבלת המוזמנים"
          className="fixed z-[130] w-64 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl"
          style={{
            top: columnsPosition.top,
            left: columnsPosition.left,
            maxHeight: columnsPosition.maxHeight,
          }}
        >
          {GUEST_TABLE_COLUMNS.map(({ key, label }) => (
            <label
              key={key}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm text-slate-700 transition hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={visibleColumns[key]}
                onChange={() => toggleGuestColumn(key)}
                className="h-5 w-5 accent-gold-500"
              />
              {label}
            </label>
          ))}
          <div className="mt-1 border-t border-slate-100 pt-1">
            <button
              type="button"
              onClick={() => setStoredGuestColumns(DEFAULT_GUEST_TABLE_COLUMNS)}
              className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              <RotateCcw size={15} /> ברירת מחדל
            </button>
          </div>
        </div>,
        document.body
      )}

      <CategoryManager
        open={catManagerOpen}
        onClose={() => setCatManagerOpen(false)}
        categories={categories}
        guests={guests}
        onAdd={addCategory}
        onRename={renameCategory}
        onDelete={deleteCategory}
      />
    </div>
  );
}

/* ---- Category management modal ---- */
function CategoryManager({ open, onClose, categories, guests, onAdd, onRename, onDelete }) {
  const [draft, setDraft] = useState("");
  const dialogRef = useRef(null);
  const inputRef = useRef(null);

  async function requestClose() {
    if (draft.trim()) {
      const discard = await confirmDialog({
        title: "לסגור בלי להוסיף קטגוריה?",
        message: "שם הקטגוריה שהקלדתם עדיין לא נוסף ויימחק בסגירה.",
        confirmLabel: "סגירה בלי לשמור",
        cancelLabel: "המשך עריכה",
        tone: "danger",
      });
      if (!discard) return;
    }
    setDraft("");
    onClose();
  }

  useAccessibleModal({ open, containerRef: dialogRef, initialFocusRef: inputRef, onRequestClose: requestClose });

  if (!open) return null;

  const counts = {};
  for (const g of guests) counts[g.category] = (counts[g.category] || 0) + 1;

  const submitAdd = (e) => {
    e.preventDefault();
    const v = draft.trim();
    if (!v) return;
    if (categories.includes(v)) {
      notify("הקטגוריה כבר קיימת", { tone: "error" });
      return;
    }
    onAdd(v);
    setDraft("");
    notify("הקטגוריה נוספה", { tone: "success" });
  };

  const handleRename = (oldName, v) => {
    const next = v.trim();
    if (!next || next === oldName) return;
    if (categories.includes(next)) {
      notify("קטגוריה בשם זה כבר קיימת", { tone: "error" });
      return;
    }
    onRename(oldName, next);
  };

  const handleDelete = (name) => {
    const used = counts[name] || 0;
    const remaining = categories.filter((c) => c !== name);
    /*  לאן עוברים המוזמנים ששויכו לקטגוריה. אם זו הקטגוריה האחרונה אין
        לאן, והם נשארים בלי שיוך — צריך להגיד את זה במפורש ולא לרמוז
        על קטגוריה בשם "ללא קטגוריה" שלא קיימת ברשימה.  */
    const fallback = remaining.includes("ללא קטגוריה")
      ? "ללא קטגוריה"
      : remaining[0] ?? "";
    confirmDialog({
      title: used
        ? `שימו לב – לקטגוריה “${name}” משויכות רשומות`
        : `למחוק את הקטגוריה “${name}”?`,
      message: used
        ? `${used} ${used === 1 ? "רשומה משויכת" : "רשומות משויכות"} לקטגוריה הזו.\n` +
          (fallback
            ? `אם תמחקו אותה, ${used === 1 ? "היא תעבור" : "הן יעברו"} לקטגוריה “${fallback}”.`
            : `אם תמחקו אותה, ${used === 1 ? "היא תישאר" : "הן יישארו"} ללא קטגוריה עד שתשייכו אותן מחדש.`) +
          "\nהמוזמנים עצמם והשיבוץ לשולחנות לא יימחקו."
        : "הקטגוריה תוסר מהרשימה. אין רשומות שמשויכות אליה.",
      confirmLabel: used ? "מחק בכל זאת" : "מחק קטגוריה",
      tone: "danger",
    }).then((ok) => ok && onDelete(name, fallback));
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={requestClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-manager-title"
        ref={dialogRef}
        className="animate-fade-in-up flex max-h-[85vh] w-full max-w-lg flex-col rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold-100 text-gold-600">
              <Tag size={20} />
            </span>
            <div>
              <h3 id="category-manager-title" className="font-display text-lg font-bold text-slate-800">
                ניהול קטגוריות מוזמנים
              </h3>
              <p className="text-xs text-slate-500">
                הוסיפו קטגוריה, שנו שם או מחקו – עדכון שם יחול על כל המוזמנים המשויכים
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="סגירה"
            className="btn-icon"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submitAdd} className="mb-4 flex gap-2">
          {/*  min-w-0: בלי זה flex-1 לא מתכווץ מתחת לרוחב הטבעי של input,
              וכפתור ההוספה נדחף אל מחוץ לדיאלוג ב-320px.  */}
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="שם קטגוריה חדשה"
            aria-label="שם קטגוריה חדשה"
            className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-200"
          />
          <button
            type="submit"
            className="btn-primary shrink-0"
          >
            <Plus size={18} /> הוסף
          </button>
        </form>

        <div className="-mx-1 flex-1 overflow-auto px-1">
          <ul className="space-y-1.5">
            {categories.map((c) => (
              <li
                key={c}
                className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5"
              >
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                  <EditableText
                    value={c}
                    onCommit={(v) => handleRename(c, v)}
                    title={`עריכת הקטגוריה ${c}`}
                    inputAriaLabel={`שם הקטגוריה ${c}`}
                    className={`min-h-10 max-w-full rounded-full px-3 text-xs font-semibold ring-1 ring-inset ${categoryStyle(c)}`}
                    inputClassName="w-full max-w-full rounded-xl border border-gold-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-100"
                  />
                  <span className="shrink-0 text-[11px] text-slate-500">
                    {counts[c] || 0} מוזמנים
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleDelete(c)}
                    title="מחיקת קטגוריה"
                    aria-label={`מחיקת הקטגוריה ${c}`}
                    className="rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            ))}
            {categories.length === 0 && (
              <li className="py-6 text-center text-sm text-slate-400">
                אין קטגוריות עדיין – הוסיפו אחת למעלה
              </li>
            )}
          </ul>
        </div>

        <div className="mt-5 flex justify-start">
          <button
            type="button"
            onClick={requestClose}
            className="rounded-xl bg-slate-800 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            סיום
          </button>
        </div>
      </div>
    </div>
  );
}

/* =============================================================================
 *  חישוב אלכוהול
 * -----------------------------------------------------------------------------
 *  המסך עונה על שאלה אחת: מה לקנות, כמה, ובכמה זה יוצא.
 *
 *  אין כאן מכנה משותף נסתר ואין אחוזי תמהיל. שתי השאלות הראשונות מייצרות
 *  יעד אחד בליטרים (“בקבוק ליטר לכל 6 שותים”), והרשימה נמדדת מולו. זוג
 *  לא יודע לומר שרבע מהשתייה תהיה ערק — הוא כן יודע לומר “נקנה 6 בקבוקי
 *  ערק”. לכן הכמות היא קלט ישיר, והיעד הוא רק מד.
 *
 *  הרשימה מתחילה ריקה במכוון: אין „ברירת מחדל” שצריך לכבות. יש הצעות
 *  להוספה מהירה, אבל כל שורה נכנסת רק כי מישהו ביקש אותה — ולכן גם כל
 *  שורה ניתנת למחיקה.
 *
 *  ה-state מקומי במכוון — אלו פרמטרים של חישוב ולא נתון של החתונה.
 *  מה שצריך לשרוד (סכום ההוצאה) עובר לסעיף תקציב אמיתי.
 * ========================================================================== */

//  בעברית “1 אנשים” נראה כמו תקלה, ולכן יש טיפול בצורת היחיד.
const peopleLabel = (n) => (n === 1 ? "אדם אחד" : `${n} אנשים`);

//  עוצמת השתייה, מנוסחת בשפה של בקבוקים. היעד הוא בקבוק ליטר לכל N שותים.
const DRINK_LEVELS = [
  { key: "light", label: "שותים מעט", perBottle: 8, hint: "קהל משפחתי או אירוע קצר" },
  { key: "normal", label: "רגיל", perBottle: 6, hint: "רוב החתונות" },
  { key: "heavy", label: "שותים הרבה", perBottle: 4, hint: "קהל צעיר, רחבה עד הסוף" },
];

//  איך קוראים לאריזה שקונים.
const PACK_KINDS = [
  { key: "bottle", one: "בקבוק", many: "בקבוקים" },
  { key: "case", one: "ארגז", many: "ארגזים" },
  { key: "tray", one: "מגש", many: "מגשים" },
  { key: "unit", one: "יחידה", many: "יחידות" },
];

const PACK_KIND = Object.fromEntries(PACK_KINDS.map((p) => [p.key, p]));

/*  בטופס ההוספה, בקבוק נפתח עם שדה נפח וארגז/מגש עם “כמה יש באריזה”.
    זו רק ברירת מחדל נוחה: אחרי שהשורה נוספה, השדה שנפתח תלוי בהחלטה
    של המשתמש אם היא נספרת ביעד הליטרים — ולא בסוג האריזה.  */
const hasLiters = (packKind) => packKind === "bottle";
const hasPackUnits = (packKind) => packKind === "case" || packKind === "tray";

/*  הצעות להוספה מהירה — ולא רשימת ברירת מחדל. שום דבר מכאן לא נכנס
    לרשימה עד שלוחצים עליו, וכל פריט שנוסף הוא רגיל לחלוטין: אפשר
    לערוך ולמחוק אותו כמו כל שורה אחרת. אין כאן מחירים: הם משתנים בין
    ספק לספק ובין מותג למותג, ומספר מומצא גרוע משדה ריק.  */
const DRINK_SUGGESTIONS = [
  { label: "ערק", packKind: "bottle", unitLiters: 1 },
  { label: "וודקה-גריגוס", packKind: "bottle", unitLiters: 1 },
  { label: "וודקה-בלוגה", packKind: "bottle", unitLiters: 1 },
  { label: "וויסקי-בלאק לייבל", packKind: "bottle", unitLiters: 1 },
  { label: "ואן גוך-טעמים", packKind: "bottle", unitLiters: 1 },
  { label: "ואן גוך-אסאי", packKind: "bottle", unitLiters: 1 },
  { label: "אקסל", packKind: "tray", packUnits: 24 },
  { label: "חמוציות", packKind: "bottle", unitLiters: 1.5, countsInLiters: false },
  { label: "ראשן", packKind: "bottle", unitLiters: 1.5, countsInLiters: false },
];

const toNum = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

//  ליטרים בספרה אחת אחרי הנקודה: “34.2 ליטר” ולא “34.17 ליטר”.
const litersLabel = (value) => String(Number(toNum(value).toFixed(1)));

const ALCOHOL_BUDGET_CATEGORY = "אלכוהול";

//  המחשבון נשמר ב-settings/guests של החתונה, כדי שגם בן/בת הזוג יראו אותו ויערכו אותו.
const ALCOHOL_DEFAULTS = { source: "percent", percent: 80, headcount: "", peoplePerBottle: 6, drinks: [] };

function normalizeAlcohol(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return {
    source: raw.source === "marked" ? "marked" : "percent",
    percent: raw.percent ?? ALCOHOL_DEFAULTS.percent,
    headcount: raw.headcount ?? "",
    peoplePerBottle: raw.peoplePerBottle ?? ALCOHOL_DEFAULTS.peoplePerBottle,
    drinks: Array.isArray(raw.drinks) ? raw.drinks.filter((d) => d && typeof d === "object") : [],
  };
}

//  לפני שהמחשבון נשמר בענן הוא נשמר בדפדפן, בחמישה מפתחות נפרדים. מי שכבר
//  עבד איתו לא מאבד דבר: הנתונים האלה הם נקודת ההתחלה, ומועלים לענן בטעינה.
function readLocalAlcohol(prefix) {
  const value = normalizeAlcohol({
    source: loadStored(prefix, "alcoholCalculatorSource", ALCOHOL_DEFAULTS.source),
    percent: loadStored(prefix, "alcoholCalculatorPercent", ALCOHOL_DEFAULTS.percent),
    headcount: loadStored(prefix, "alcoholCalculatorHeadcount", ALCOHOL_DEFAULTS.headcount),
    peoplePerBottle: loadStored(prefix, "alcoholCalculatorPeoplePerBottle", ALCOHOL_DEFAULTS.peoplePerBottle),
    drinks: loadStored(prefix, "alcoholDrinks", ALCOHOL_DEFAULTS.drinks),
  });
  return JSON.stringify(value) === JSON.stringify(ALCOHOL_DEFAULTS) ? null : value;
}

function getAlcoholStats(guests) {
  const activeGuests = guests.filter((guest) => guest.rsvp !== "declined");
  const drinkers = activeGuests.reduce(
    (sum, guest) => sum + Math.min(guest.seats || 1, Math.max(0, Number(guest.drinkers) || 0)),
    0
  );
  const listedSeats = activeGuests.reduce((sum, guest) => sum + (guest.seats || 0), 0);
  return { drinkers, listedSeats };
}

function AlcoholCalculator({ drinkers, listedSeats, setBudget, alcohol, setAlcohol }) {
  const canEdit = useCanEdit();
  //  כל עוד אף אחד לא סומן ברשימה אין טעם להציג 0 — עוברים אוטומטית
  //  להערכה לפי אחוז מהאורחים, שהיא הדרך שבה רוב הזוגות מתחילים.
  //  האלכוהול נקנה לפני שהאישורים מגיעים, ולכן הבסיס (headcount) הוא מספר שהזוג
  //  קובע ולא מצב ההגעה ברשימה. ריק עד שהוזן — בלי ניחוש שקט מנתוני המוזמנים.
  //  רשימת המשקאות היא מערך אחד: כל שורה היא אובייקט שלם, ולכן הוספה ומחיקה
  //  הן פעולה אחת.
  const { source, percent, headcount, peoplePerBottle, drinks } = alcohol;
  const patchAlcohol = (patch) => {
    if (canEdit) setAlcohol((previous) => ({ ...previous, ...patch }));
  };
  const setSource = (value) => patchAlcohol({ source: value });
  const setPercent = (value) => patchAlcohol({ percent: value });
  const setHeadcount = (value) => patchAlcohol({ headcount: value });
  const setPeoplePerBottle = (value) => patchAlcohol({ peoplePerBottle: value });
  const setDrinks = (updater) => {
    if (!canEdit) return;
    setAlcohol((previous) => ({
      ...previous,
      drinks: typeof updater === "function" ? updater(previous.drinks) : updater,
    }));
  };
  const [newDrink, setNewDrink] = useState({ label: "", packKind: "bottle", packUnits: "24", unitLiters: "1" });
  //  סגור כברירת מחדל: בנייד הטופס תופס מסך שלם, ורוב הזמן רק עורכים שורות קיימות.
  const [isAddDrinkOpen, setIsAddDrinkOpen] = useState(false);
  const addDrinkToggleRef = useRef(null);
  const newDrinkNameRef = useRef(null);
  const addDrinkTouched = useRef(false);

  useEffect(() => {
    if (!addDrinkTouched.current) return;
    (isAddDrinkOpen ? newDrinkNameRef : addDrinkToggleRef).current?.focus();
  }, [isAddDrinkOpen]);

  const base = Math.max(0, Math.round(toNum(headcount)));
  const percentValue = Math.min(100, Math.max(0, toNum(percent)));
  const estimated = Math.round((base * percentValue) / 100);
  //  clamp על כל קלט: שדה ריק או ערך שלילי לא יפיל את החישוב.
  const drinkerCount = Math.max(0, source === "marked" ? drinkers : estimated);

  const perBottle = Math.max(1, toNum(peoplePerBottle) || 1);
  //  היעד כולו: “בקבוק ליטר לכל N שותים”. זה כל החישוב — אין מכנה נסתר.
  const targetLiters = drinkerCount / perBottle;

  const lines = drinks.map((drink) => {
    const packKind = PACK_KIND[drink.packKind] ? drink.packKind : "bottle";
    //  “נספר ביעד” הוא דגל מפורש של המשתמש ולא נגזרת של סוג האריזה —
    //  גם מגש אקסל יכול להיכנס ליעד אם כך החליטו.
    const packUnits = hasPackUnits(packKind) ? Math.max(1, Math.round(toNum(drink.packUnits, 1))) : 1;
    const unitLiters = Math.max(0, toNum(drink.unitLiters));
    const units = Math.max(0, Math.round(toNum(drink.units)));
    const price = Math.max(0, toNum(drink.price));
    const countsInLiters = drink.countsInLiters === true;
    return { ...drink, packKind, packUnits, unitLiters, volumeLiters: unitLiters, units, price, countsInLiters, cost: units * price };
  });

  const totalCost = lines.reduce((s, l) => s + l.cost, 0);
  const { alcoholicLiters: cartLiters, mixerUnits: unitsOutsideLiters } = summarizeDrinkPurchase(lines);
  const targetMet = targetLiters > 0 && cartLiters >= targetLiters;
  const targetProgress = targetLiters > 0 ? Math.min(100, (cartLiters / targetLiters) * 100) : 0;
  //  הצעה שכבר ברשימה היא רעש — מציגים רק את מה שאפשר להוסיף.
  const taken = new Set(drinks.map((drink) => drink.label.trim().toLowerCase()));
  const quickAdd = DRINK_SUGGESTIONS.filter((s) => !taken.has(s.label.toLowerCase()));

  function patchDrink(id, patch) {
    setDrinks((previous) => previous.map((drink) => (drink.id === id ? { ...drink, ...patch } : drink)));
  }

  //  החלפת סוג אריזה נוגעת רק בשדה שלה. ההחלטה אם השורה נספרת ביעד
  //  היא של המשתמש ולא של סוג האריזה, ולכן היא שורדת את ההחלפה.
  function changePackKind(line, packKind) {
    patchDrink(line.id, {
      packKind,
      packUnits: hasPackUnits(packKind) ? Math.max(1, line.packUnits) : 1,
    });
  }

  function removeDrink(id) {
    setDrinks((previous) => previous.filter((drink) => drink.id !== id));
  }

  //  נקודת הכניסה היחידה לרשימה — גם הטופס וגם ההצעות המהירות עוברות בה.
  function createDrink({ label, packKind, packUnits, unitLiters, countsInLiters }) {
    const name = String(label || "").trim();
    if (!name) return false;
    if (drinks.some((drink) => drink.label.trim().toLowerCase() === name.toLowerCase())) {
      notify("משקה בשם הזה כבר נמצא ברשימה", { tone: "error" });
      return false;
    }
    const kind = PACK_KIND[packKind] ? packKind : "bottle";
    const liters = hasLiters(kind) ? Math.max(0, toNum(unitLiters)) : 0;
    setDrinks((previous) => [
      ...previous,
      {
        id: 1 + Math.max(0, ...previous.map((drink) => toNum(drink.id))),
        label: name,
        packKind: kind,
        packUnits: hasPackUnits(kind) ? Math.max(1, Math.round(toNum(packUnits, 1))) : 1,
        unitLiters: liters,
        price: 0,
        units: 1,
        countsInLiters: countsInLiters ?? liters > 0,
      },
    ]);
    return true;
  }

  function submitNewDrink(e) {
    e.preventDefault();
    if (createDrink(newDrink)) {
      setNewDrink({ label: "", packKind: "bottle", packUnits: "24", unitLiters: "1" });
      //  נשארים פתוחים: סוגרים ידנית, וחוזרים לשדה השם להמשך הזנה.
      newDrinkNameRef.current?.focus({ preventScroll: true });
    }
  }

  function pushToBudget() {
    if (!setBudget || totalCost <= 0) return;
    setBudget((prev) => {
      const idx = prev.findIndex((b) => b.category === ALCOHOL_BUDGET_CATEGORY);
      if (idx === -1)
        return [
          ...prev,
          {
            id: nextRowId(prev),
            category: ALCOHOL_BUDGET_CATEGORY,
            expected: totalCost,
            actual: 0,
            paid: 0,
          },
        ];
      //  סעיף קיים: מתעדכנת רק ההוצאה הצפויה. “בפועל” ו“שולם” הם נתוני
      //  אמת שהזוג הקליד, ואסור למחשבון לדרוס אותם.
      const next = [...prev];
      next[idx] = { ...next[idx], expected: totalCost };
      return next;
    });
    notify(`סעיף „${ALCOHOL_BUDGET_CATEGORY}” עודכן ל-${fmt(totalCost)}`, {
      tone: "success",
    });
  }

  const field =
    "min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-gold-400 focus:ring-2 focus:ring-gold-200";
  const fieldLabel = "mb-1 block text-xs font-medium text-slate-500";
  //  שדה עם סימן יחידה צמוד (% או ₪). הסימן בתוך המסגרת ולא לידה, כדי
  //  שלא יישאר ספק מה המספר אומר.
  const suffixBox =
    "flex min-h-11 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 transition";
  const suffixInput =
    "num-plain w-full min-w-0 bg-transparent py-2 text-center text-sm font-semibold tabular-nums text-slate-700 outline-none";

  return (
    <div className="space-y-4">
      {/* ===================== שלב א׳ — כמה צריך ===================== */}
      <Card>
        <SectionTitle
          icon={Wine}
          title="כמה אלכוהול צריך להזמין"
          subtitle="שתי שאלות, ומכאן הכמויות והעלות מחושבות לבד"
        />

        {/*  היעד הוא מספר אחד ולכן מקבל עמודה צרה; שתי השאלות, שיש בהן
            פקדים, מקבלות את הרוחב שנשאר.  */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,.58fr)]">
          {/* שאלה 1 — מי שותה */}
          <div data-tour="alcohol-drinker-estimate" className="rounded-2xl border border-slate-200/80 bg-white/70 p-3.5">
            <p className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-gold-100 text-xs font-bold text-gold-700">1</span>
              כמה מהאורחים שותים?
            </p>

            {/*  שתי דרכים, ולא רשימת רדיו: הבחירה היא בין שני מצבים שלמים,
                ולכן כל מצב מקבל לשונית משלו ומתחתיה רק הפקדים שלו.  */}
            <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-2xl bg-slate-100/80 p-1">
              {[
                { key: "percent", label: "הערכה באחוזים", hint: `${percentValue}% מהאורחים` },
                { key: "marked", label: "לפי רשימת המוזמנים", hint: drinkers > 0 ? `${drinkers} סומנו כשותים` : "אף אחד לא סומן" },
              ].map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setSource(option.key)}
                  disabled={!canEdit}
                  aria-pressed={source === option.key}
                  className={`min-h-12 rounded-xl px-2 py-1.5 text-center transition disabled:cursor-default ${
                    source === option.key
                      ? "bg-gold-500 text-slate-950 shadow-sm ring-1 ring-gold-600"
                      : "bg-sage-50 text-slate-600 ring-1 ring-sage-200 hover:bg-sage-100"
                  }`}
                >
                  <span className="block text-sm font-semibold leading-tight">{option.label}</span>
                  <span className="mt-0.5 block text-[11px] font-normal leading-tight opacity-75">{option.hint}</span>
                </button>
              ))}
            </div>

            {source === "percent" ? (
              <div className="mt-3 rounded-2xl bg-gold-50/80 p-3 ring-1 ring-gold-200/80">
                {/*  המספר הזה הוא ההנחה של הזוג, לא ספירה: האלכוהול נקנה לפני
                    שהאישורים מגיעים, ולכן הוא נקבע ידנית ולא נגזר מהרשימה.  */}
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">כמה אורחים אתם מעריכים שיהיו באירוע?</span>
                  <div className={`${suffixBox} mt-1 border-gold-200 focus-within:border-gold-400 focus-within:ring-2 focus-within:ring-gold-200`}>
                    <input
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={headcount}
                      onChange={(e) => setHeadcount(e.target.value)}
                      onFocus={() => setSource("percent")}
                      disabled={!canEdit}
                      placeholder="לדוגמה 400"
                      aria-label="מספר האורחים המשוער באירוע"
                      className={`${suffixInput} !text-start text-base`}
                    />
                    <span className="shrink-0 text-xs font-semibold text-gold-700">אורחים</span>
                  </div>
                </label>
                {canEdit && listedSeats > 0 && listedSeats !== base && (
                  <button
                    type="button"
                    onClick={() => setHeadcount(String(listedSeats))}
                    className="mt-1.5 min-h-9 text-[11px] font-medium text-gold-700 underline decoration-gold-300 underline-offset-4 transition hover:text-gold-600"
                  >
                    להשתמש במספר המוזמנים ברשימה ({listedSeats})
                  </button>
                )}

                <div className="mt-3 flex items-center gap-3 border-t border-gold-200/70 pt-3">
                  {/*  סימן ה-% יושב בתוך השדה ולא לידו, כדי שלא יהיה אפשר
                      לקרוא את “80” כמספר אנשים. מתחתיו מחוון, שמחזק את זה.  */}
                  <div className="flex h-14 w-28 shrink-0 items-center gap-1 rounded-xl border border-gold-200 bg-white px-3 transition focus-within:border-gold-400 focus-within:ring-2 focus-within:ring-gold-200">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={percent}
                      onChange={(e) => setPercent(e.target.value)}
                      onFocus={() => setSource("percent")}
                      disabled={!canEdit}
                      aria-label="אחוז האורחים ששותים אלכוהול"
                      className="w-full min-w-0 bg-transparent text-2xl font-bold tabular-nums text-slate-800 outline-none"
                    />
                    <span className="shrink-0 text-lg font-bold text-gold-600">%</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-slate-500">מהאורחים שותים אלכוהול</p>
                    <p className="mt-0.5 truncate text-base font-bold text-slate-800">
                      {base > 0 ? `≈ ${peopleLabel(estimated)}` : "ממתין למספר אורחים"}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {base > 0 ? `מתוך ${base} אורחים` : "הזינו למעלה את ההערכה"}
                    </p>
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={percentValue}
                  onChange={(e) => setPercent(e.target.value)}
                  onFocus={() => setSource("percent")}
                  disabled={!canEdit}
                  aria-label="מחוון אחוז השותים"
                  className="mt-3 w-full cursor-pointer accent-gold-600 disabled:cursor-default"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  80% הוא המספר שרוב הזוגות מתחילים ממנו. קהל מבוגר או דתי — פחות, קהל צעיר — יותר.
                </p>
              </div>
            ) : (
              <div className="mt-3 rounded-2xl bg-sage-50/80 p-3 ring-1 ring-sage-200/80">
                <p className="text-2xl font-bold tabular-nums text-slate-800">
                  {drinkers}
                  <span className="ms-1 text-sm font-semibold text-slate-600">אנשים</span>
                </p>
                <p className="mt-0.5 text-xs text-slate-600">
                  {drinkers > 0
                    ? "סכום העמודה „שותים” בכל הרשומות שלא סירבו להגיע"
                    : "עדיין לא סומן אף אחד כשותה"}
                </p>
                <p className="mt-2 text-[11px] text-slate-500">
                  הסימון נעשה במסך המוזמנים — מסמנים שורות ולוחצים „סמן כשותים”.
                </p>
              </div>
            )}
          </div>

          {/* שאלה 2 — עוצמת השתייה, בשפה של בקבוקים */}
          <div data-tour="alcohol-intensity" className="rounded-2xl border border-slate-200/80 bg-white/70 p-3.5 sm:p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-gold-100 text-xs font-bold text-gold-700">2</span>
              כמה שותים אצלכם?
            </p>
            <p className="mt-1 text-xs text-slate-500">
              לכמה אנשים מספיק בקבוק אחד. בוחרים את התיאור הקרוב ביותר.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {DRINK_LEVELS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPeoplePerBottle(p.perBottle)}
                  disabled={!canEdit}
                  title={p.hint}
                  aria-pressed={Number(peoplePerBottle) === p.perBottle}
                  aria-label={`${p.label} — בקבוק לכל ${p.perBottle} אנשים. ${p.hint}`}
                  className={`min-h-16 rounded-xl px-2 py-2 transition ${
                    Number(peoplePerBottle) === p.perBottle
                      ? "bg-gold-500 text-slate-950 shadow-md shadow-gold-500/30"
                      : "bg-sage-100 text-slate-700 shadow-sm ring-1 ring-sage-300 hover:bg-sage-200"
                  }`}
                >
                  <span className="block text-sm font-bold leading-tight">{p.label}</span>
                  <span className="mt-1 block text-[11px] font-medium leading-tight opacity-80">
                    בקבוק לכל {p.perBottle}
                  </span>
                </button>
              ))}
            </div>
            <label className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
              <span className="text-xs font-medium text-slate-500">או בעצמכם: בקבוק אחד לכל</span>
              <input
                type="number"
                min="1"
                value={peoplePerBottle}
                onChange={(e) => setPeoplePerBottle(e.target.value)}
                disabled={!canEdit}
                className="min-h-10 w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-center text-sm font-semibold tabular-nums text-slate-700 outline-none transition focus:border-gold-400 focus:ring-2 focus:ring-gold-200"
                aria-label="כמה אנשים לבקבוק אחד"
              />
              <span className="text-xs text-slate-500">אנשים</span>
            </label>
            <p className="mt-2 text-[11px] text-slate-400">
              ההמלצות כבר כוללות עודף קטן, כדי שהאלכוהול לא ייגמר באמצע הערב.
            </p>
          </div>

          {/* כרטיס היעד ממורכז בכל רוחב: כותרת, המספר הגדול והסבר על אותו ציר. */}
          <div
            data-tour="alcohol-result"
            className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-gradient-to-l from-gold-500 to-sage-500 px-4 py-5 text-center text-white shadow-lg shadow-gold-500/20"
          >
            <p className="text-xs font-semibold tracking-wide text-white/85">היעד שלכם</p>
            <p className="text-4xl font-bold leading-none tabular-nums sm:text-5xl">
              {litersLabel(targetLiters)}
              <span className="ms-1.5 text-lg font-semibold text-white/90">ליטר</span>
            </p>
            <p className="mt-1 max-w-[16rem] text-xs leading-5 text-white/85">
              {peopleLabel(drinkerCount)} ששותים, בקבוק ליטר לכל {perBottle}.
            </p>
          </div>
        </div>
      </Card>

      <Card tourId="alcohol-shopping-list">
        <SectionTitle
          icon={ShoppingCart}
          title="רשימת הקנייה"
          subtitle="מוסיפים את מה שקונים, קובעים כמות ומחיר — והסכום מתעדכן"
        />

        {/*  מי שרק צופה לא מקבל הוספה בכלל, ולכן אין כאן טופס מושבת.  */}
        {canEdit && (
          <CollapsibleAdd
            tourId="alcohol-add-drink"
            label="הוספת משקה חדש"
            open={isAddDrinkOpen}
            onToggle={() => {
              addDrinkTouched.current = true;
              setIsAddDrinkOpen((open) => !open);
            }}
            panelId="alcohol-add-drink-panel"
            toggleRef={addDrinkToggleRef}
            className="mb-3"
          >
            <form onSubmit={submitNewDrink} className="mt-2.5 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 sm:p-3.5">
              <div className="grid min-w-0 grid-cols-2 items-end gap-2.5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,.8fr)_minmax(0,.8fr)_auto]">
                <label className="col-span-2 flex min-w-0 flex-col gap-1 lg:col-span-1">
                  <span className={fieldLabel}>שם המשקה</span>
                  <input
                    ref={newDrinkNameRef}
                    value={newDrink.label}
                    onChange={(event) => setNewDrink((p) => ({ ...p, label: event.target.value }))}
                    maxLength={40}
                    placeholder="למשל: ואן גוך"
                    className={`${field} min-w-0`}
                    aria-label="שם המשקה"
                  />
                </label>
                <label className="flex min-w-0 flex-col gap-1">
                  <span className={fieldLabel}>סוג האריזה</span>
                  <select
                    value={newDrink.packKind}
                    onChange={(event) => setNewDrink((p) => ({ ...p, packKind: event.target.value }))}
                    className={`${field} min-w-0`}
                    aria-label="סוג האריזה"
                  >
                    {PACK_KINDS.map((p) => (
                      <option key={p.key} value={p.key}>{p.one}</option>
                    ))}
                  </select>
                </label>

                {/*  רק השדה שרלוונטי לאריזה שנבחרה. לבקבוק יש נפח, לארגז ולמגש
                    יש כמה יש בפנים, וליחידה בודדת אין אף אחד מהם.  */}
                {hasLiters(newDrink.packKind) && (
                  <label className="flex min-w-0 flex-col gap-1">
                    <span className={fieldLabel}>ליטר לבקבוק</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={newDrink.unitLiters}
                      onChange={(event) => setNewDrink((p) => ({ ...p, unitLiters: event.target.value }))}
                      className={`${field} min-w-0 text-center tabular-nums`}
                      aria-label="ליטר לבקבוק"
                    />
                  </label>
                )}
                {hasPackUnits(newDrink.packKind) && (
                  <label className="flex min-w-0 flex-col gap-1">
                    <span className={fieldLabel}>יחידות באריזה</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={newDrink.packUnits}
                      onChange={(event) => setNewDrink((p) => ({ ...p, packUnits: event.target.value }))}
                      className={`${field} min-w-0 text-center tabular-nums`}
                      aria-label="יחידות באריזה"
                    />
                  </label>
                )}

                <button type="submit" disabled={!newDrink.label.trim()} className="btn-primary col-span-2 w-full lg:col-span-1 lg:w-auto">
                  <Plus size={16} /> הוספה
                </button>
              </div>

              <p className="mt-2.5 text-[11px] leading-5 text-slate-500">
                בקבוק נפתח עם נפח, ארגז או מגש עם „יחידות באריזה”. מחיר, כמות והחלטה אם
                השורה נכנסת ליעד הליטרים נקבעים בשורה עצמה.
              </p>
            </form>
          </CollapsibleAdd>
        )}

        {/*  מד אחד שמחבר את היעד לרשימה. זה כל מה שצריך כדי לדעת אם
            קנינו מספיק — בלי אחוזים ובלי מספרים פנימיים.  */}
        <div data-tour="alcohol-totals" className="mb-3 rounded-2xl border border-slate-200/80 bg-white/70 p-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-sm font-bold text-slate-800">
              <span className="text-xl tabular-nums">{litersLabel(cartLiters)}</span>
              <span className="text-slate-500"> מתוך {litersLabel(targetLiters)} ליטר</span>
            </p>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                targetMet ? "bg-sage-100 text-sage-600" : "bg-amber-100 text-amber-700"
              }`}
            >
              {targetLiters <= 0 ? "אין עדיין יעד" : targetMet ? "היעד הושג" : `חסרים ${litersLabel(targetLiters - cartLiters)} ליטר`}
            </span>
          </div>
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              style={{ width: `${targetProgress}%` }}
              className={`h-full rounded-full transition-[width] duration-300 ${targetMet ? "bg-sage-500" : "bg-gold-500"}`}
            />
          </div>
          {unitsOutsideLiters > 0 && (
            <p className="mt-2 text-[11px] text-slate-500">
              בנוסף {unitsOutsideLiters === 1 ? "יחידה אחת" : `${unitsOutsideLiters} יחידות`} שסימנתם „לא מחושב באלכוהול” — נספרות בעלות בלבד.
            </p>
          )}
        </div>

        {canEdit && quickAdd.length > 0 && (
          //  הצעות, לא ברירת מחדל: הרשימה נשארת ריקה עד שלוחצים.
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-500">הוספה מהירה:</span>
            {quickAdd.map((suggestion) => (
              <button
                key={suggestion.label}
                type="button"
                onClick={() => createDrink(suggestion)}
                disabled={!canEdit}
                className="btn-secondary px-3 text-xs"
              >
                <Plus size={12} /> {suggestion.label}
              </button>
            ))}
          </div>
        )}

        {drinks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white text-gold-600 shadow-sm">
              <ShoppingCart size={22} />
            </div>
            <p className="mt-3 text-sm font-bold text-slate-800">הרשימה עדיין ריקה</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500">
              {canEdit
                ? "הוסיפו רק את המשקאות שאתם באמת מתכננים לקנות. לכל אחד תקבעו כמות ומחיר, והמד למעלה יראה כמה אתם רחוקים מהיעד."
                : "עדיין לא נוספו משקאות לרשימה."}
            </p>
          </div>
        ) : (
          /*  כל מה שיש לדעת על שורה נמצא בשורה עצמה — אין חץ ואין מגירה.
              בדסקטופ זו שורה אחת; בנייד היא נשברת לשלוש קבוצות הגיוניות:
              שם, מה קונים, וכמה. סימני היחידה בתוך השדות משמשים כתוויות.  */
          <ul className="space-y-2">
            {lines.map((l) => {
              const kind = PACK_KIND[l.packKind] || PACK_KIND.unit;
              return (
                <li
                  key={l.id}
                  className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/80 p-2.5 shadow-sm lg:flex-row lg:items-center"
                >
                  {/*  השם הוא שדה ולא טקסט — גבול עדין הוא הרמז היחיד שצריך
                      כדי שיהיה ברור שאפשר פשוט להקליד ולתקן.  */}
                  <input
                    value={l.label}
                    onChange={(e) => patchDrink(l.id, { label: e.target.value })}
                    disabled={!canEdit}
                    maxLength={40}
                    aria-label={`שם המשקה ${l.label}`}
                    className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200/80 bg-white/60 px-2.5 text-sm font-bold text-slate-800 outline-none transition hover:border-slate-300 focus:border-gold-400 focus:bg-white focus:ring-2 focus:ring-gold-200 lg:flex-1"
                  />

                  {/* מה קונים */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      value={l.packKind}
                      onChange={(e) => changePackKind(l, e.target.value)}
                      disabled={!canEdit}
                      aria-label={`סוג האריזה של ${l.label}`}
                      className="min-h-11 w-20 shrink-0 rounded-xl border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none transition focus:border-gold-400 focus:ring-2 focus:ring-gold-200"
                    >
                      {PACK_KINDS.map((p) => (
                        <option key={p.key} value={p.key}>{p.one}</option>
                      ))}
                    </select>

                    {hasPackUnits(l.packKind) && (
                      <span className={`${suffixBox} w-18 shrink-0 px-2 focus-within:border-gold-400 focus-within:ring-2 focus-within:ring-gold-200`}>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={l.packUnits}
                          onChange={(e) => patchDrink(l.id, { packUnits: e.target.value })}
                          disabled={!canEdit}
                          aria-label={`יחידות ב${kind.one} של ${l.label}`}
                          className={suffixInput}
                        />
                        <span className="shrink-0 text-xs font-bold text-slate-400">יח׳</span>
                      </span>
                    )}

                    {/*  הנפח מופיע בדיוק כשהוא משנה משהו — כלומר כששורה
                        סומנה כנספרת ביעד. מגש אקסל שסומן ביעד יקבל אותו גם הוא.  */}
                    {l.countsInLiters && (
                      <span className={`${suffixBox} w-18 shrink-0 px-2 focus-within:border-gold-400 focus-within:ring-2 focus-within:ring-gold-200`}>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={l.unitLiters}
                          onChange={(e) => patchDrink(l.id, { unitLiters: e.target.value })}
                          disabled={!canEdit}
                          aria-label={`ליטר ל${kind.one} של ${l.label}`}
                          className={suffixInput}
                        />
                        <span className="shrink-0 text-xs font-bold text-slate-400">ל׳</span>
                      </span>
                    )}

                    <span className={`${suffixBox} w-20 shrink-0 px-2 focus-within:border-gold-400 focus-within:ring-2 focus-within:ring-gold-200`}>
                      <input
                        type="number"
                        min="0"
                        value={l.price}
                        onChange={(e) => patchDrink(l.id, { price: e.target.value })}
                        disabled={!canEdit}
                        aria-label={`מחיר ל${kind.one} של ${l.label}`}
                        className={suffixInput}
                      />
                      <span className="shrink-0 text-xs font-bold text-slate-400">₪</span>
                    </span>
                  </div>

                  {/* כמה */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="flex min-h-11 shrink-0 items-stretch overflow-hidden rounded-xl border border-slate-200 bg-white focus-within:border-gold-400 focus-within:ring-2 focus-within:ring-gold-200">
                      <button
                        type="button"
                        onClick={() => patchDrink(l.id, { units: l.units - 1 })}
                        disabled={!canEdit || l.units <= 0}
                        aria-label={`הפחתת כמות ${l.label}`}
                        className="grid w-9 shrink-0 place-items-center border-y border-sage-200 bg-sage-100 text-slate-700 transition hover:bg-sage-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 disabled:opacity-40"
                      >
                        <Minus size={15} />
                      </button>
                      <input
                        type="number"
                        min="0"
                        value={l.units}
                        onChange={(e) => patchDrink(l.id, { units: Math.max(0, Math.round(toNum(e.target.value))) })}
                        disabled={!canEdit}
                        aria-label={`כמות ${l.label}`}
                        className="num-plain w-10 min-w-0 border-x border-slate-200 bg-transparent text-center text-base font-bold tabular-nums text-slate-800 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => patchDrink(l.id, { units: l.units + 1 })}
                        disabled={!canEdit}
                        aria-label={`הוספת כמות ${l.label}`}
                        className="grid w-9 shrink-0 place-items-center border-y border-sage-200 bg-sage-100 text-slate-700 transition hover:bg-sage-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 disabled:opacity-40"
                      >
                        <Plus size={15} />
                      </button>
                    </div>

                    <span className="min-w-0 flex-1 text-end text-sm font-bold tabular-nums text-slate-800 lg:w-20 lg:flex-none">
                      {fmt(l.cost)}
                    </span>

                    {/*  המתג והמחיקה נשארים יחד: בנייד, כשהתווית הארוכה לא
                        נכנסת לשורה, עדיף ששניהם ירדו יחד מאשר שהפח יישאר לבד.  */}
                    <div className="flex items-center gap-1.5">
                      {/*  האם השורה מחושבת באלכוהול היא החלטה של המשתמש בכל
                          סוג אריזה — גם מגש אקסל. מצב פעיל = מילוי זהב מלא,
                          כבוי = אפור שקוף, כדי שההבדל ייקרא במבט אחד.  */}
                      <button
                        type="button"
                        onClick={() => patchDrink(l.id, {
                          countsInLiters: !l.countsInLiters,
                          ...(!l.countsInLiters && l.unitLiters <= 0 ? { unitLiters: 1 } : {}),
                        })}
                        disabled={!canEdit}
                        aria-pressed={l.countsInLiters}
                        aria-label={`${l.label} ${l.countsInLiters ? "מחושב באלכוהול" : "לא מחושב באלכוהול"}`}
                        title={l.countsInLiters ? "מחושב באלכוהול — לחצו כדי להוציא מהחישוב" : "לא מחושב באלכוהול — לחצו כדי לכלול בחישוב"}
                        className={`inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-2 text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 disabled:opacity-50 ${
                          l.countsInLiters
                            ? "bg-gold-500 text-slate-950 shadow-sm shadow-gold-500/30 hover:bg-gold-600"
                            : "bg-slate-100 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-200"
                        }`}
                      >
                        <Droplets size={13} className="shrink-0" />
                        {l.countsInLiters ? "מחושב באלכוהול" : "לא מחושב באלכוהול"}
                      </button>

                      <button
                        type="button"
                        onClick={() => removeDrink(l.id)}
                        disabled={!canEdit}
                        aria-label={`מחיקת ${l.label} מהרשימה`}
                        title={`מחיקת ${l.label}`}
                        className="btn-icon-danger w-9"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/*  הסיכום יושב בתחתית אותו כרטיס ולא בכרטיס נפרד: הוא התוצאה של
            הרשימה שמעליו, ולא נושא בפני עצמו.  */}
        <div data-tour="alcohol-budget-transfer" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500">עלות משוערת לכל הרשימה</p>
            <p className="text-2xl font-bold tabular-nums text-slate-800">
              {fmt(totalCost)}
            </p>
          </div>
          {canEdit && setBudget && (
            <button
              onClick={pushToBudget}
              disabled={totalCost <= 0}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Wallet size={16} /> העבר לסעיף תקציב
            </button>
          )}
        </div>

        <p className="mt-2 text-[11px] leading-5 text-slate-400">
          העברה לתקציב יוצרת (או מעדכנת) סעיף בשם „{ALCOHOL_BUDGET_CATEGORY}” בשדה
          „תקציב מתוכנן” בלבד — מה שכבר שילמתם בפועל לא נדרס.
        </p>
      </Card>
    </div>
  );
}

/* ---- Seating arrangements ---- */
function Seating({ guests, tables, setTables }) {
  const canEdit = useCanEdit();
  const categories = useContext(CategoriesContext);
  const [newTable, setNewTable] = useState({ name: "", type: "standard" });
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [pickerTableId, setPickerTableId] = useState(null);
  const pickerDialogRef = useRef(null);
  const pickerSearchRef = useRef(null);

  const guestById = useMemo(
    () => Object.fromEntries(guests.map((g) => [g.id, g])),
    [guests]
  );

  const assignedIds = useMemo(
    () => new Set(tables.flatMap((t) => t.guestIds)),
    [tables]
  );
  const unassigned = guests.filter(
    (g) => g.rsvp !== "declined" && !assignedIds.has(g.id)
  );

  const searchTerm = search.trim();

  //  אורח ששוחזר מגיבוי עלול להגיע בלי seats; בלי ברירת המחדל הוא נחשב כ-0
  //  ומעוות את התפוסה, ובבורר השיבוץ ההשוואה מול undefined מסתירה אותו לגמרי.
  const guestSeats = (g) => Math.max(1, Number(g?.seats) || 1);

  const seatsUsed = (t) =>
    t.guestIds.reduce((s, id) => s + (guestById[id] ? guestSeats(guestById[id]) : 0), 0);

  function addTable(e) {
    e.preventDefault();
    if (!newTable.name.trim()) return;
    setTables((prev) => [
      ...prev,
      { id: nextRowId(prev), name: newTable.name.trim(), type: newTable.type, guestIds: [] },
    ]);
    setNewTable({ name: "", type: "standard" });
  }

  function assign(tableId, guestId) {
    if (!guestId) return;
    const gid = Number(guestId);
    const table = tables.find((t) => t.id === tableId);
    if (!table) return;
    //  הגנה מפני כפילות: id כפול היה נספר פעמיים בתפוסה ונותן מפתח React כפול.
    if (table.guestIds.includes(gid)) return;
    //  בדיקת קיבולת גם כאן ולא רק ברשימת הבחירה: שתי לחיצות מהירות או שני
    //  מכשירים שמשבצים באותו רגע יכולים לחרוג מהקיבולת.
    if (seatsUsed(table) + guestSeats(guestById[gid]) > tableCapacity(table.type)) {
      notify(`אין מספיק מקום פנוי בשולחן “${table.name}”`, { tone: "error" });
      return;
    }
    setTables((prev) =>
      prev.map((t) =>
        t.id === tableId && !t.guestIds.includes(gid)
          ? { ...t, guestIds: [...t.guestIds, gid] }
          : t
      )
    );
  }

  function unassign(tableId, guestId) {
    setTables((prev) =>
      prev.map((t) =>
        t.id === tableId
          ? { ...t, guestIds: t.guestIds.filter((id) => id !== guestId) }
          : t
      )
    );
  }

  function removeTable(tableId) {
    const t = tables.find((x) => x.id === tableId);
    confirmDialog({
      title: `למחוק את השולחן “${t?.name || ""}”?`,
      message: t?.guestIds?.length
        ? `${t.guestIds.length} מוזמנים ישוחררו מהשיבוץ (הרשומות עצמן לא יימחקו).`
        : "פעולה זו אינה הפיכה.",
      confirmLabel: "מחק שולחן",
      tone: "danger",
    }).then((ok) => {
      if (ok) setTables((prev) => prev.filter((t) => t.id !== tableId));
    });
  }

  function openPicker(id) {
    setPickerTableId(id);
    setSearch("");
    setCatFilter("all");
  }
  function closePicker() {
    setPickerTableId(null);
  }

  const pickerOpen = pickerTableId !== null;
  useAccessibleModal({
    open: pickerOpen,
    containerRef: pickerDialogRef,
    initialFocusRef: pickerSearchRef,
    onRequestClose: closePicker,
  });

  const pickerTable = tables.find((t) => t.id === pickerTableId) || null;
  const pickerLeft = pickerTable
    ? tableCapacity(pickerTable.type) - seatsUsed(pickerTable)
    : 0;
  const pickerList = pickerTable
    ? unassigned
        .filter((g) => guestSeats(g) <= pickerLeft)
        .filter((g) => catFilter === "all" || g.category === catFilter)
        .filter((g) => !searchTerm || g.name.includes(searchTerm))
    : [];

  return (
    <Card tourId="seating-tables">
      <SectionTitle
        icon={Armchair}
        title="סידור הושבה"
        subtitle="שולחן רגיל (12) או שולחן אבירים (24) · ניתן לשבץ כל מוזמן שלא סירב להגיע"
        action={
          canEdit ? (
          <form
            data-tour="seating-add-table"
            onSubmit={addTable}
            className="flex w-full flex-wrap items-center gap-2 sm:w-auto"
          >
            <input
              value={newTable.name}
              onChange={(e) => setNewTable({ ...newTable, name: e.target.value })}
              placeholder="שם שולחן"
              aria-label="שם השולחן החדש"
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-base outline-none focus:border-gold-400 sm:min-h-0 sm:w-36 sm:flex-none sm:text-sm"
            />
            <select
              value={newTable.type}
              onChange={(e) => setNewTable({ ...newTable, type: e.target.value })}
              aria-label="סוג השולחן החדש"
              className="filter-select w-auto"
            >
              <option value="standard">רגיל · 12</option>
              <option value="knight">אבירים · 24</option>
            </select>
            <button
              type="submit"
              className="btn-primary min-h-11 shrink-0 sm:min-h-0 sm:px-3"
            >
              <Plus size={16} /> שולחן
            </button>
          </form>
          ) : null
        }
      />

      {unassigned.length > 0 && (
        <div data-tour="seating-unassigned" className="mb-5 rounded-2xl bg-amber-50/70 p-3 text-sm ring-1 ring-amber-200/70">
          <span className="font-semibold text-amber-700">
            <AlertCircle size={14} className="ml-1 inline" />
            {unassigned.length} מוזמנים ללא שיבוץ:
          </span>{" "}
          {/*  רשימת השמות עלולה להיות ארוכה מאוד (מאות מוזמנים). בנייד היא
              נחתכת לשתי שורות כדי שהשולחנות עצמם יישארו מעל קו הקיפול.  */}
          <span className="line-clamp-2 text-amber-600 sm:line-clamp-none sm:inline">
            {unassigned
              .slice(0, 12)
              .map((g) => g.name)
              .join(", ")}
            {unassigned.length > 12 && ` ועוד ${unassigned.length - 12}...`}
          </span>
        </div>
      )}

      <div data-tour="seating-table-cards" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tables.map((t) => {
          const cap = tableCapacity(t.type);
          const used = seatsUsed(t);
          const left = cap - used;
          const isKnight = t.type === "knight";
          return (
            <div
              key={t.id}
              className="rounded-3xl border border-slate-200/70 bg-white/70 p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`grid h-9 w-9 place-items-center rounded-xl text-white ${
                      isKnight
                        ? "bg-gradient-to-br from-gold-500 to-gold-600"
                        : "bg-gradient-to-br from-sage-400 to-sage-500"
                    }`}
                  >
                    {isKnight ? <Crown size={18} /> : <Armchair size={18} />}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800">{t.name}</p>
                    <p className="text-xs text-slate-500">
                      {isKnight ? "שולחן אבירים" : "שולחן רגיל"}
                    </p>
                  </div>
                </div>
                {canEdit && (
                  <button
                    onClick={() => removeTable(t.id)}
                    aria-label={`מחיקת השולחן ${t.name}`}
                    title="מחיקת שולחן"
                    className="btn-icon-danger -m-1.5"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-slate-500">
                  תפוסה: {used}/{cap}
                </span>
                <Badge color={left <= 0 ? "rose" : left <= 3 ? "gold" : "sage"}>
                  {left < 0 ? `חריגה של ${-left} מקומות` : `${left} מקומות פנויים`}
                </Badge>
              </div>
              {/*  חריגה נוצרת כשמגדילים “כיסאות” למוזמן שכבר משובץ. בלי
                  ההודעה הזו השולחן עובר את הקיבולת בשקט ואיש לא שם לב.  */}
              {left < 0 && (
                <p className="mb-2 flex items-start gap-1.5 rounded-xl bg-rose-50 px-2.5 py-1.5 text-right text-[11px] leading-relaxed text-rose-700">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>
                    השולחן חורג מהקיבולת — כנראה עודכן מספר הכיסאות של מוזמן
                    שכבר משובץ כאן. העבירו מוזמנים לשולחן אחר.
                  </span>
                </p>
              )}
              <ProgressBar
                value={used}
                max={cap}
                tone={left <= 0 ? "rose" : "sage"}
              />

              <ul className="mt-3 space-y-1.5">
                {t.guestIds.map((id) => {
                  const g = guestById[id];
                  if (!g) return null;
                  return (
                    <li
                      key={id}
                      className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-1.5 text-sm"
                    >
                      <span className="text-slate-700">
                        {g.name}{" "}
                        <span className="text-xs text-slate-400">
                          ({guestSeats(g)})
                        </span>
                      </span>
                      <button
                        onClick={() => unassign(t.id, id)}
                        aria-label={`הסרת ${g.name} מהשולחן`}
                        title="הסרה מהשולחן"
                        className={`-my-1.5 grid h-11 w-11 shrink-0 place-items-center rounded text-slate-400 transition hover:text-rose-500 focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none ${
                          canEdit ? "" : "hidden"
                        }`}
                      >
                        <X size={16} />
                      </button>
                    </li>
                  );
                })}
              </ul>

              {canEdit && (
                <button
                  onClick={() => openPicker(t.id)}
                  disabled={left <= 0}
                  className="btn-secondary mt-3 w-full px-3"
                >
                  <Plus size={16} /> {left <= 0 ? "השולחן מלא" : "שבץ מוזמן"}
                </button>
              )}
            </div>
          );
        })}
        {tables.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-200 bg-white/50 px-6 py-14 text-center">
            <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400">
              <Armchair size={26} />
            </div>
            <p className="text-base font-semibold text-slate-700">עדיין אין שולחנות</p>
            <p className="mt-1 max-w-sm text-sm text-slate-400">
              {canEdit
                ? "הוסיפו שולחן חדש בעזרת הכפתור למעלה כדי להתחיל לשבץ מוזמנים."
                : "סידור ההושבה עדיין לא נבנה על ידי בעלי החתונה."}
            </p>
          </div>
        )}
      </div>

      {pickerTable && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="seating-picker-title"
        >
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={closePicker}
          />
          <div ref={pickerDialogRef} className="glass relative z-10 flex max-h-[min(80dvh,48rem)] w-full max-w-lg flex-col rounded-3xl p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 id="seating-picker-title" className="font-display text-xl font-bold text-slate-800">
                  שיבוץ ל{pickerTable.name}
                </h3>
                <p className="text-xs text-slate-500">
                  {pickerLeft} מקומות פנויים · {pickerList.length} מוזמנים זמינים
                </p>
              </div>
              <button
                onClick={closePicker}
                title="סגירה"
                aria-label="סגירת חלון השיבוץ"
                className="btn-icon"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mb-3 flex flex-wrap gap-2 border-y border-slate-200 bg-slate-50/80 px-2 py-3">
              <div className="relative min-w-[160px] flex-1">
                <Search
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  ref={pickerSearchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="חיפוש לפי שם..."
                  className="filter-select bg-white pr-9 pl-3"
                />
              </div>
              <select
                value={catFilter}
                onChange={(e) => setCatFilter(e.target.value)}
                aria-label="סינון לפי קטגוריה"
                className={`filter-select sm:w-auto sm:max-w-56 ${catFilter !== "all" ? "filter-select-active" : ""}`}
              >
                <option value="all">כל הקטגוריות</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="-mx-1 flex-1 overflow-auto px-1">
              <ul className="space-y-1.5">
                {pickerList.map((g) => (
                  <li key={g.id}>
                    <button
                      onClick={() => assign(pickerTable.id, g.id)}
                      className="flex min-h-12 w-full items-center justify-between gap-2 rounded-lg border border-sage-300 bg-sage-50 px-3 py-2.5 text-right text-sm shadow-sm transition hover:border-gold-400 hover:bg-gold-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800">{g.name}</span>
                        <CategoryBadge category={g.category} />
                      </span>
                      <span className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="tabular-nums">{g.seats} מק'</span>
                        <Plus size={16} className="text-gold-500" />
                      </span>
                    </button>
                  </li>
                ))}
                {pickerList.length === 0 && (
                  <li className="py-8 text-center text-sm text-slate-400">
                    אין מוזמנים זמינים שתואמים לסינון
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/* =============================================================================
 *  צ׳קליסט החתונה
 * -----------------------------------------------------------------------------
 *  שתי רשימות משימות חיות במערכת, והן לא אותו דבר:
 *    • vendors.tasks  — משימות מול ספק מסוים ("לשלוח לצלם לוח זמנים").
 *    • checklist      — המטלות של הזוג עצמו, רובן לא קשורות לאף ספק.
 *  איחוד שלהן היה הופך את לוח המשימות של הספק לרשימה שאי אפשר לעבוד איתה.
 *
 *  הרשימה המומלצת (45 משימות) אינה נזרעת אוטומטית. חתונה קיימת שכבר מנוהלת
 *  לא אמורה לקבל 45 שורות חדשות בלי שביקשו, ולכן זו פעולה מפורשת במסך.
 * ========================================================================== */

const ASSIGNEES = [
  { key: "both", label: "שניהם", short: "שניהם", icon: Users, badge: "bg-slate-100 text-slate-600 ring-slate-200" },
  { key: "bride", label: "כלה", short: "כלה", icon: Heart, badge: "bg-rose-50 text-rose-600 ring-rose-200" },
  { key: "groom", label: "חתן", short: "חתן", icon: Crown, badge: "bg-sky-50 text-sky-600 ring-sky-200" },
];

const DEFAULT_CHECKLIST_OPTIONS = {
  categories: CHECKLIST_CATEGORIES,
  assignees: ASSIGNEES.map(({ key, label }) => ({ key, label })),
};

function normalizeChecklistOptions(value) {
  const categories = Array.isArray(value?.categories)
    ? [...new Set(value.categories.filter((name) => typeof name === "string" && name.trim()).map((name) => name.trim()))] : [];
  const assignees = Array.isArray(value?.assignees)
    ? value.assignees.filter((option) => typeof option?.key === "string" && option.key && typeof option.label === "string" && option.label.trim()) : [];
  return {
    categories: categories.length ? categories : DEFAULT_CHECKLIST_OPTIONS.categories,
    assignees: assignees.length ? assignees : DEFAULT_CHECKLIST_OPTIONS.assignees,
  };
}

const assigneeOf = (key) => ASSIGNEES.find((a) => a.key === key) || ASSIGNEES[0];

/**  סדר הקטגוריות: קודם אלו שמגיעות מהתבנית ובסדר שלה, ואחריהן קטגוריות
 *   שהזוג המציא. מיון אלפביתי היה מפזר את "ספקים" ו"כללי" באמצע הרשימה.  */
function orderCategories(list) {
  const extra = list.filter((c) => !CHECKLIST_CATEGORIES.includes(c)).sort((a, b) => a.localeCompare(b, "he"));
  return [...CHECKLIST_CATEGORIES.filter((c) => list.includes(c)), ...extra];
}

function AssigneeBadge({ value, options = ASSIGNEES }) {
  const configured = options.find((option) => option.key === value);
  const a = { ...assigneeOf(value), ...configured };
  const Icon = a.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${a.badge}`}
    >
      <Icon size={11} />
      {a.label}
    </span>
  );
}

function ChecklistRow({ item, canEdit, categories, assignees, onToggle, onRename, onAssign, onPatch, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);

  function commit() {
    const clean = draft.trim();
    setEditing(false);
    if (!clean || clean === item.title) {
      setDraft(item.title);
      return;
    }
    onRename(item.id, clean);
  }

  return (
    <li
      className={`grid min-w-0 grid-cols-2 items-center gap-2 rounded-2xl border px-3 py-2 transition lg:grid-cols-[minmax(0,1.6fr)_minmax(0,.8fr)_minmax(0,.7fr)_minmax(0,1.2fr)_auto] ${
        item.done
          ? "border-sage-200/70 bg-sage-50/50"
          : "border-slate-200/70 bg-white/60"
      }`}
    >
      {/*  שטח הלחיצה הוא ה-label כולו ולא רק הריבוע — 44px בגובה, כדי
          שסימון משימה בטלפון לא ידרוש כיוון עדין.  */}
      <label className="col-span-2 flex min-h-11 min-w-0 cursor-pointer items-center gap-2.5 lg:col-span-1">
        <input
          type="checkbox"
          checked={item.done}
          disabled={!canEdit}
          onChange={() => onToggle(item.id)}
          className="h-5 w-5 shrink-0 cursor-pointer accent-sage-500 disabled:cursor-default"
          aria-label={`סימון "${item.title}" כבוצע`}
        />
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setDraft(item.title);
                setEditing(false);
              }
            }}
            className="min-h-11 w-full rounded-lg border border-gold-300 bg-white px-2 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-gold-200"
            aria-label="שם המשימה"
          />
        ) : (
          <span
            onDoubleClick={() => canEdit && setEditing(true)}
            className={`min-w-0 break-words text-sm ${
              item.done ? "text-slate-400 line-through" : "text-slate-700"
            }`}
          >
            {item.title}
          </span>
        )}
      </label>

      <label className="min-w-0 text-xs font-medium text-slate-500">
        קטגוריה
        <select value={item.category || "כללי"} disabled={!canEdit} onChange={(event) => onPatch(item.id, { category: event.target.value })} aria-label={`קטגוריה — ${item.title}`} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-base text-slate-700 outline-none focus:border-gold-400 disabled:bg-slate-50 sm:text-sm">
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
      </label>
      <div className="min-w-0">
        <p className="mb-1 text-xs font-medium text-slate-500">שיוך</p>
        {canEdit ? (
          <select
            value={item.assignee}
            onChange={(e) => onAssign(item.id, e.target.value)}
            className="min-h-11 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-2 text-base text-slate-600 outline-none focus:border-gold-400 sm:text-sm"
            aria-label={`שיוך — ${item.title}`}
          >
            {assignees.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
        ) : (
          <AssigneeBadge value={item.assignee} options={assignees} />
        )}
      </div>
      <div className="col-span-2 min-w-0 space-y-1 lg:col-span-1">
        <p className="text-xs font-medium text-slate-500">הערות</p>
        <BudgetNotes item={item} label={item.title} canEdit={canEdit} onChange={onPatch} />
      </div>
      <div className="col-span-2 flex shrink-0 items-center justify-end gap-1.5 lg:col-span-1">
        {canEdit && (
          <>
            <button
              onClick={() => setEditing(true)}
              title="שינוי שם המשימה"
              aria-label={`שינוי שם המשימה "${item.title}"`}
              className="btn-icon"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={() => onDelete(item.id)}
              title="מחיקת המשימה"
              aria-label={`מחיקת המשימה "${item.title}"`}
              className="btn-icon-danger"
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function Checklist({ items, setItems, options, setOptions }) {
  const canEdit = useCanEdit();
  const [query, setQuery] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [hideDone, setHideDone] = useState(false);
  const [form, setForm] = useState({ title: "", category: options.categories[0], assignee: options.assignees[0].key, notes: "" });
  const [isAddTaskOpen, setIsAddTaskOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const addTaskToggleRef = useRef(null);
  const taskNameRef = useRef(null);
  const addTaskTouched = useRef(false);
  useEffect(() => {
    if (!addTaskTouched.current) return;
    (isAddTaskOpen ? taskNameRef : addTaskToggleRef).current?.focus({ preventScroll: true });
  }, [isAddTaskOpen]);

  const categories = useMemo(
    () => orderCategories([...new Set([...options.categories, ...items.map((item) => item.category || "כללי")])]),
    [items, options.categories]
  );
  const assignees = useMemo(() => {
    const known = new Set(options.assignees.map((option) => option.key));
    const missing = [...new Set(items.map((item) => item.assignee || "both"))].filter((key) => !known.has(key));
    return [...options.assignees, ...missing.map((key) => ({ key, label: ASSIGNEES.find((option) => option.key === key)?.label || key }))];
  }, [items, options.assignees]);
  const formCategory = categories.includes(form.category) ? form.category : categories[0];
  const formAssignee = assignees.some((option) => option.key === form.assignee) ? form.assignee : assignees[0].key;

  const stats = useMemo(() => {
    const per = Object.fromEntries(assignees.map((option) => [option.key, { done: 0, total: 0 }]));
    let done = 0;
    for (const i of items) {
      const bucket = per[i.assignee || "both"];
      bucket.total += 1;
      if (i.done) {
        bucket.done += 1;
        done += 1;
      }
    }
    return { done, total: items.length, per };
  }, [items, assignees]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => {
        if (hideDone && i.done) return false;
        if (assigneeFilter !== "all" && i.assignee !== assigneeFilter) return false;
        if (categoryFilter !== "all" && (i.category || "כללי") !== categoryFilter) return false;
        if (q && !`${i.title} ${i.notes || ""}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
  }, [items, query, assigneeFilter, categoryFilter, hideDone]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const i of visible) {
      const key = i.category || "כללי";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(i);
    }
    return orderCategories([...map.keys()]).map((category) => ({
      category,
      rows: map.get(category),
    }));
  }, [visible]);

  const toggle = useCallback(
    (id) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done: !i.done } : i))),
    [setItems]
  );
  const rename = useCallback(
    (id, title) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, title } : i))),
    [setItems]
  );
  const assign = useCallback(
    (id, assignee) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, assignee } : i))),
    [setItems]
  );
  const patchTask = (id, patch) => {
    if (canEdit) setItems((previous) => previous.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  function addOption(kind, raw) {
    const label = raw.trim();
    const labels = kind === "category" ? categories : assignees.map((option) => option.label);
    if (!label || labels.some((name) => name.toLowerCase() === label.toLowerCase())) {
      notify("האפשרות כבר קיימת או שהשם ריק", { tone: "error" });
      return false;
    }
    setOptions((previous) => kind === "category"
      ? { ...previous, categories: [...categories, label] }
      : { ...previous, assignees: [...assignees, { key: `custom_${crypto.randomUUID()}`, label }] });
    return true;
  }

  function renameOption(kind, key, raw) {
    const label = raw.trim();
    const labels = kind === "category" ? categories.filter((name) => name !== key) : assignees.filter((option) => option.key !== key).map((option) => option.label);
    if (!label || labels.some((name) => name.toLowerCase() === label.toLowerCase())) {
      notify("השם ריק או כבר קיים", { tone: "error" });
      return;
    }
    if (kind === "category") {
      setOptions((previous) => ({ ...previous, categories: categories.map((name) => name === key ? label : name) }));
      setItems((previous) => previous.map((item) => (item.category || "כללי") === key ? { ...item, category: label } : item));
      setForm((previous) => ({ ...previous, category: previous.category === key ? label : previous.category }));
      if (categoryFilter === key) setCategoryFilter(label);
    } else {
      setOptions((previous) => ({ ...previous, assignees: assignees.map((option) => option.key === key ? { ...option, label } : option) }));
    }
  }

  async function deleteOption(kind, key) {
    const remaining = kind === "category" ? categories.filter((name) => name !== key) : assignees.filter((option) => option.key !== key);
    if (!remaining.length) return;
    const fallback = kind === "category" ? remaining[0] : remaining[0].key;
    const label = kind === "category" ? key : assignees.find((option) => option.key === key)?.label;
    const fallbackLabel = kind === "category" ? fallback : remaining[0].label;
    const belongs = (item) => (item[kind] || (kind === "category" ? "כללי" : "both")) === key;
    const used = items.filter(belongs).length;
    const ok = await confirmDialog({ title: `מחיקת ${label}`, message: used ? `${used} משימות יעברו אל „${fallbackLabel}”. המשימות וההערות שלהן לא יימחקו.` : "האפשרות תוסר מהרשימה. המשימות לא יימחקו.", confirmLabel: "מחיקה", tone: "danger" });
    if (!ok) return;
    setOptions((previous) => ({ ...previous, [kind === "category" ? "categories" : "assignees"]: remaining }));
    setItems((previous) => previous.map((item) => belongs(item) ? { ...item, [kind]: fallback } : item));
    setForm((previous) => ({ ...previous, [kind]: previous[kind] === key ? fallback : previous[kind] }));
    if (kind === "category" && categoryFilter === key) setCategoryFilter("all");
    if (kind === "assignee" && assigneeFilter === key) setAssigneeFilter("all");
  }

  async function remove(id) {
    const item = items.find((i) => i.id === id);
    const ok = await confirmDialog({
      title: "מחיקת משימה",
      message: `למחוק את "${item?.title ?? ""}" מהצ׳קליסט?`,
      confirmLabel: "מחיקה",
      tone: "danger",
    });
    if (ok) setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function addItem(e) {
    e.preventDefault();
    const title = form.title.trim();
    if (!title) return;
    setItems((prev) => {
      const position = prev.reduce((m, i) => Math.max(m, Number(i.position) || 0), 0) + 10;
      return [
        ...prev,
        {
          id: nextRowId(prev),
          title,
          category: formCategory,
          assignee: formAssignee,
          notes: form.notes,
          done: false,
          position,
        },
      ];
    });
    setForm((f) => ({ ...f, title: "", notes: "" }));
    taskNameRef.current?.focus({ preventScroll: true });
    notify("המשימה נוספה לצ׳קליסט", { tone: "success" });
  }

  /*  טעינת הרשימה המומלצת. מוסיפה רק משימות שאין להן שם זהה ברשימה, כדי
      שלחיצה שנייה (או זוג שהקליד חלק מהן ידנית) לא תיצור כפילויות.  */
  async function loadTemplate() {
    const existing = new Set(items.map((i) => i.title.trim()));
    const missing = CHECKLIST_TEMPLATE.filter((t) => !existing.has(t.title));
    if (!missing.length) {
      notify("כל המשימות המומלצות כבר קיימות ברשימה", { tone: "info" });
      return;
    }
    const ok = await confirmDialog({
      title: "טעינת הרשימה המומלצת",
      message: `יתווספו ${missing.length} משימות מומלצות לצ׳קליסט. משימות שכבר קיימות לא ישוכפלו, ושום דבר קיים לא יימחק.`,
      confirmLabel: "הוספה",
    });
    if (!ok) return;
    setItems((prev) => {
      let id = nextRowId(prev);
      let position = prev.reduce((m, i) => Math.max(m, Number(i.position) || 0), 0);
      return [
        ...prev,
        ...missing.map((t) => {
          position += 10;
          return { ...t, id: id++, done: false, position, notes: "", category: categories.includes(t.category) ? t.category : categories[0], assignee: assignees.some((option) => option.key === t.assignee) ? t.assignee : assignees[0].key };
        }),
      ];
    });
    notify(`נוספו ${missing.length} משימות`, { tone: "success" });
  }

  const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
  const filterSelect = (active) =>
    `min-h-12 w-full min-w-0 appearance-none rounded-lg border-2 py-2 ps-3 pe-9 text-base font-medium text-slate-700 outline-none transition focus:border-gold-500 focus:ring-2 focus:ring-gold-200 sm:text-sm ${
      active ? "border-gold-400 bg-gold-50" : "border-sage-200 bg-sage-50 hover:border-sage-400"
    }`;
  const activeFilterCount = Number(Boolean(query.trim())) + Number(categoryFilter !== "all") + Number(assigneeFilter !== "all") + Number(hideDone);
  const chip = (on) =>
    `filter-chip text-xs ${on ? "filter-chip-active" : ""}`;

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card tourId="checklist-progress">
        <SectionTitle
          icon={ListChecks}
          title="הצ׳קליסט של החתונה"
          subtitle="כל מה שצריך לסגור עד היום הגדול, במקום אחד"
          action={canEdit && (
            <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
              <button type="button" onClick={() => setManagerOpen(true)} className="btn-primary"><Settings2 size={17} className="shrink-0" /> ניהול קטגוריות ושיוך</button>
            {items.length > 0 && (
              <button
                onClick={loadTemplate}
                className="btn-secondary"
              >
                <Sparkles size={17} className="shrink-0 text-sage-600" />
                הוספת הרשימה המומלצת
              </button>
            )}
            </div>
          )}
        />

        {items.length === 0 ? (
          <div data-tour="checklist-items" className="rounded-2xl border border-dashed border-slate-300 bg-white/50 p-6 text-center">
            <ListChecks className="mx-auto mb-2 text-gold-400" size={28} />
            <p className="text-sm font-semibold text-slate-700">הצ׳קליסט עדיין ריק</p>
            {/*  לצופה אין כפתור טעינה, ולכן גם אין טעם להבטיח לו "אפשר
                להתחיל מרשימה מוכנה" — הוא יחפש כפתור שלא קיים אצלו.  */}
            <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
              {canEdit
                ? `אפשר להתחיל מרשימה מוכנה של ${CHECKLIST_TEMPLATE.length} משימות שרוב הזוגות עוברים דרכן — ולמחוק או להוסיף כל מה שרוצים.`
                : "בעלי החתונה עדיין לא הוסיפו משימות לצ׳קליסט."}
            </p>
            {canEdit && (
              <button onClick={loadTemplate} className="btn-primary mx-auto mt-4">
                <Sparkles size={16} />
                טעינת הרשימה המומלצת
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <p className="text-sm text-slate-500">
                הושלמו{" "}
                <b className="text-lg tabular-nums text-slate-800">{stats.done}</b> מתוך{" "}
                <b className="tabular-nums text-slate-800">{stats.total}</b> משימות
              </p>
              <p className="text-lg font-bold tabular-nums text-gold-600">{pct}%</p>
            </div>
            <div className="mt-2">
              <ProgressBar value={stats.done} max={stats.total} tone="sage" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {assignees.map((a) => {
                const s = stats.per[a.key];
                const Icon = ASSIGNEES.find((option) => option.key === a.key)?.icon || Users;
                return (
                  <div key={a.key} className="rounded-xl bg-white/60 px-3 py-2 text-center ring-1 ring-slate-200/70">
                    <p className="flex items-center justify-center gap-1 text-[11px] font-medium text-slate-500">
                      <Icon size={12} />
                      {a.label}
                    </p>
                    <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-700">
                      {s.done}/{s.total}
                    </p>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {(items.length > 0 || canEdit) && (
        <Card tourId="checklist-workspace">
          {canEdit && (
            <CollapsibleAdd tourId="checklist-add" label="הוספה" open={isAddTaskOpen} onToggle={() => { addTaskTouched.current = true; setIsAddTaskOpen((open) => !open); }} panelId="checklist-add-panel" toggleRef={addTaskToggleRef} className="mb-4">
            <form onSubmit={addItem} className="mt-2.5 grid min-w-0 grid-cols-2 items-end gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <label className="col-span-2 min-w-0 space-y-1 lg:col-span-1">
                <span className="text-xs font-medium text-slate-500">משימה חדשה</span>
              <input
                ref={taskNameRef}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="משימה חדשה…"
                className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-700 outline-none transition focus:border-gold-400 focus:ring-2 focus:ring-gold-200 sm:text-sm"
                aria-label="שם המשימה החדשה"
              />
              </label>
              <label className="min-w-0 space-y-1">
                <span className="text-xs font-medium text-slate-500">קטגוריה</span>
              <select
                value={formCategory}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-700 outline-none focus:border-gold-400 sm:text-sm"
                aria-label="קטגוריה"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              </label>
              <label className="min-w-0 space-y-1">
                <span className="text-xs font-medium text-slate-500">שיוך</span>
              <select
                value={formAssignee}
                onChange={(e) => setForm((f) => ({ ...f, assignee: e.target.value }))}
                className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-700 outline-none focus:border-gold-400 sm:text-sm"
                aria-label="שיוך"
              >
                {assignees.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </select>
              </label>
              <button
                type="submit"
                className="btn-primary col-span-2 lg:col-span-1"
              >
                <Plus size={16} />
                הוספה
              </button>
              <label className="col-span-2 min-w-0 space-y-1 lg:col-span-4">
                <span className="text-xs font-medium text-slate-500">הערות</span>
                <textarea value={form.notes} onChange={(event) => setForm((previous) => ({ ...previous, notes: event.target.value }))} rows={2} aria-label="הערות למשימה החדשה" className="block w-full min-w-0 resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-base text-slate-700 outline-none focus:border-gold-400 sm:text-sm" />
              </label>
            </form>
            </CollapsibleAdd>
          )}

          <div data-tour="checklist-filters" className="mb-4 border-y border-slate-200 bg-slate-50/80 px-3 py-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-bold text-slate-700"><Filter size={16} className="text-sage-600" /> חיפוש וסינון</p>
              {activeFilterCount > 0 && <span className="rounded-full bg-gold-100 px-2.5 py-1 text-xs font-semibold text-gold-700">{activeFilterCount === 1 ? "מסנן פעיל" : `${activeFilterCount} מסננים פעילים`}</span>}
            </div>
            <div className="grid grid-cols-2 items-end gap-2 lg:flex lg:flex-wrap">
            <div className="relative col-span-2 min-w-0 lg:flex-1">
              <Search size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="חיפוש משימה…"
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-white py-2 pr-9 pl-3 text-sm text-slate-700 outline-none transition focus:border-gold-400 focus:ring-2 focus:ring-gold-200"
                aria-label="חיפוש משימה"
              />
            </div>
            <label className="min-w-0 space-y-1">
              <span className="text-xs font-semibold text-slate-600">קטגוריה</span>
              <span className="relative block lg:w-44">
              <select aria-label="סינון לפי קטגוריה" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className={filterSelect(categoryFilter !== "all")}>
                <option value="all">כל הקטגוריות</option>
                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
              <ChevronDown size={17} className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${categoryFilter !== "all" ? "text-gold-700" : "text-sage-600"}`} />
              </span>
            </label>
            <label className="min-w-0 space-y-1">
              <span className="text-xs font-semibold text-slate-600">שיוך</span>
              <span className="relative block lg:w-36">
              <select aria-label="סינון לפי שיוך" value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)} className={filterSelect(assigneeFilter !== "all")}>
                <option value="all">כל השיוכים</option>
                {assignees.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
              <ChevronDown size={17} className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${assigneeFilter !== "all" ? "text-gold-700" : "text-sage-600"}`} />
              </span>
            </label>
            <button onClick={() => setHideDone((v) => !v)} aria-pressed={hideDone} className={chip(hideDone)}>
              <CheckCheck size={13} className="ml-1 inline" />
              הסתרת שהושלמו
            </button>
            {(query || categoryFilter !== "all" || assigneeFilter !== "all" || hideDone) && (
              <button type="button" className="btn-secondary" onClick={() => { setQuery(""); setCategoryFilter("all"); setAssigneeFilter("all"); setHideDone(false); }}><X size={14} /> ניקוי סינונים</button>
            )}
            </div>
          </div>

          {grouped.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              אין משימות שמתאימות לסינון הנוכחי.
            </p>
          ) : (
            <div data-tour="checklist-items" className="space-y-5">
              {grouped.map(({ category, rows }) => {
                const total = items.filter((i) => (i.category || "כללי") === category);
                const done = total.filter((i) => i.done).length;
                return (
                  <div key={category}>
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <h3 className="text-sm font-bold text-slate-700">{category}</h3>
                      {/*  המונה סופר תמיד את כל הקטגוריה ולא רק את מה שהסינון
                          הותיר על המסך. בלי ההבהרה בסוגריים נוצר רושם שחלק
                          מהמשימות נעלמו — ולכן היא מופיעה רק כשבאמת מסתירים.  */}
                      <span
                        className="text-xs tabular-nums text-slate-400"
                        title="הושלמו מתוך כלל המשימות בקטגוריה"
                      >
                        {done}/{total.length}
                        {rows.length !== total.length && ` · מוצגות ${rows.length}`}
                      </span>
                    </div>
                    <ul className="space-y-1.5">
                      {rows.map((item) => (
                        <ChecklistRow
                          key={item.id}
                          item={item}
                          canEdit={canEdit}
                          categories={categories}
                          assignees={assignees}
                          onToggle={toggle}
                          onRename={rename}
                          onAssign={assign}
                          onPatch={patchTask}
                          onDelete={remove}
                        />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
      {canEdit && managerOpen && (
        <ChecklistOptionsManager categories={categories} assignees={assignees} onAdd={addOption} onRename={renameOption} onDelete={deleteOption} onClose={() => setManagerOpen(false)} />
      )}
    </div>
  );
}

/* =========================================================================
 *  VENDORS + TASK MANAGEMENT MODULE
 * ====================================================================== */

function Vendors({
  vendors,
  setVendors,
  budget = [],
  setBudget = null,
  weddingId = null,
  canEdit = true,
  focusId = null,
}) {
  //  focusId מגיע מלחיצה על ספק בדאשבורד. תוכן הלשונית נבנה מחדש בכל מעבר
  //  מסך, ולכן די בערך ההתחלתי — אין צורך ב-effect שידרוס את הבחירה של
  //  המשתמש אחרי שנכנס.
  const [openId, setOpenId] = useState(
    () =>
      (focusId != null && vendors.some((v) => v.id === focusId)
        ? focusId
        : vendors[0]?.id) ?? null
  );
  const [taskInput, setTaskInput] = useState("");

  //  כל הקבצים של החתונה נטענים פעם אחת (מטא-דאטה בלבד) ומסוננים לפי ספק.
  const [files, setFiles] = useState([]);
  const [filesStatus, setFilesStatus] = useState("loading");
  const [deletedFiles, setDeletedFiles] = useState([]);
  const [showDeletedFiles, setShowDeletedFiles] = useState(false);

  const reloadFiles = useCallback(async () => {
    if (!weddingId) return;
    setFilesStatus((status) => (status === "ready" ? "refreshing" : "loading"));
    try {
      const [activeFiles, deleted] = await Promise.all([
        listVendorFiles(weddingId),
        listDeletedVendorFiles(weddingId),
      ]);
      setFiles(activeFiles);
      setDeletedFiles(deleted);
      setFilesStatus("ready");
    } catch (err) {
      console.error("Failed to load vendor files:", err);
      setFilesStatus("error");
    }
  }, [weddingId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reloadFiles();
  }, [reloadFiles]);

  function updateVendor(id, patch) {
    const before = vendors.find((v) => v.id === id);
    setVendors((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));

    if (!setBudget || !before) return;
    const nameChanged = patch.name !== undefined && patch.name !== before.name;
    const costChanged =
      patch.contractCost !== undefined && patch.contractCost !== before.contractCost;
    const depositChanged =
      patch.deposit !== undefined && patch.deposit !== before.deposit;
    if (!nameChanged && !costChanged && !depositChanged) return;

    setBudget((prev) =>
      prev.map((b) => {
        if (b.vendorId !== id) return b;
        const next = { ...b };
        if (nameChanged) next.category = patch.name;
        //  הסכומים נגררים אחרי החוזה רק כל עוד לא נגעו בהם במסך
        //  התקציב. מי שערך שם סכום אחר התכוון לכך, ודריסה שקטה שלו
        //  היא איבוד נתונים. במקום זה הפער מסומן באדום במסך התקציב.
        if (costChanged) {
          if (b.expected === before.contractCost) next.expected = patch.contractCost;
          if (b.actual === before.contractCost) next.actual = patch.contractCost;
        }
        //  המקדמה בכרטיס הספק היא תשלום שבוצע — אותו דבר בדיוק
        //  כמו “סה״כ שולם” בתקציב, ולכן היא נגררת לשם באותו תנאי.
        if (depositChanged && b.paid === before.deposit) next.paid = patch.deposit;
        return next;
      })
    );
  }

  function addTask(vendorId) {
    if (!taskInput.trim()) return;
    setVendors((prev) =>
      prev.map((v) =>
        v.id === vendorId
          ? {
              ...v,
              tasks: [
                ...v.tasks,
                { id: nextRowId(v.tasks), title: taskInput.trim(), status: "todo" },
              ],
            }
          : v
      )
    );
    setTaskInput("");
  }

  function moveTask(vendorId, taskId, status) {
    setVendors((prev) =>
      prev.map((v) =>
        v.id === vendorId
          ? {
              ...v,
              tasks: v.tasks.map((t) =>
                t.id === taskId ? { ...t, status } : t
              ),
            }
          : v
      )
    );
  }

  function removeTask(vendorId, taskId) {
    const vendor = vendors.find((v) => v.id === vendorId);
    const idx = vendor ? vendor.tasks.findIndex((t) => t.id === taskId) : -1;
    const task = idx >= 0 ? vendor.tasks[idx] : null;
    setVendors((prev) =>
      prev.map((v) =>
        v.id === vendorId
          ? { ...v, tasks: v.tasks.filter((t) => t.id !== taskId) }
          : v
      )
    );
    if (task)
      notify(`המשימה “${task.title}” נמחקה`, {
        action: {
          label: "בטל",
          onClick: () =>
            setVendors((prev) =>
              prev.map((v) => {
                if (v.id !== vendorId) return v;
                if (v.tasks.some((t) => t.id === taskId)) return v;
                const arr = [...v.tasks];
                arr.splice(Math.min(idx, arr.length), 0, task);
                return { ...v, tasks: arr };
              })
            ),
        },
      });
  }

  function removeVendor(id) {
    const vendor = vendors.find((v) => v.id === id);
    if (!vendor) return;
    const vendorIndex = vendors.findIndex((item) => item.id === id);
    const attached = files.filter((f) => f.vendorId === id);
    const linkedBudget = setBudget
      ? budget.map((item, index) => ({ item, index })).filter(({ item }) => item.vendorId === id)
      : [];
    confirmDialog({
      title: `למחוק את הספק “${vendor?.name || ""}”?`,
      message:
        "הספק יוסר מהרשימה. אפשר יהיה לבטל את הפעולה מההודעה שתופיע." +
        (attached.length
          ? `\n\n${attached.length} קבצים מצורפים יועברו לאזור הקבצים שנמחקו וניתן יהיה לשחזר אותם.`
          : "") +
        (setBudget
          ? "\n\nגם סעיף התקציב המקושר יוסר ויהיה ניתן לשחזרו בביטול."
          : ""),
      confirmLabel: "מחק ספק",
      tone: "danger",
    }).then(async (ok) => {
      if (!ok) return;
      //  הקבצים חייבים להימחק לפני הספק: ה-id של הספק ממוחזר (nextRowId),
      //  ובלי זה קבצים ישנים היו צצים אצל ספק חדש שקיבל את אותו מספר.
      for (const f of attached) {
        try {
          await deleteVendorFile(weddingId, f.id);
        } catch (err) {
          console.error("Failed to delete vendor file:", err);
        }
      }
      if (attached.length) reloadFiles();

      //  setOpenId מחושב מראש ולא מתוך ה-updater של setVendors: עדכון state
      //  של קומפוננטה אחת בתוך updater של אחרת מפיק אזהרת React ועלול
      //  להישבר בגרסאות עתידיות.
      const remaining = vendors.filter((v) => v.id !== id);
      setVendors(remaining);
      setOpenId((cur) => (cur === id ? remaining[0]?.id ?? null : cur));
      //  אותו שיקול של מיחזור מזהים: סעיף שנשאר מאחוריו היה נראה
      //  כשייך לספק הבא שיקבל את אותו מספר.
      if (setBudget) setBudget((prev) => prev.filter((b) => b.vendorId !== id));
      notify(`הספק “${vendor.name}” הוסר`, {
        tone: "success",
        duration: 8000,
        action: {
          label: "בטל מחיקה",
          onClick: async () => {
            setVendors((prev) => {
              if (prev.some((item) => item.id === id)) return prev;
              const next = [...prev];
              next.splice(Math.min(vendorIndex, next.length), 0, vendor);
              return next;
            });
            setOpenId(id);
            if (setBudget && linkedBudget.length) {
              setBudget((prev) => {
                const restored = [...prev];
                linkedBudget.forEach(({ item, index }) => {
                  if (restored.some((existing) => existing.id === item.id)) return;
                  restored.splice(Math.min(index, restored.length), 0, item);
                });
                return restored;
              });
            }
            if (weddingId && attached.length) {
              const results = await Promise.allSettled(
                attached.map((file) => restoreVendorFile(weddingId, file.id))
              );
              const failed = results.filter((result) => result.status === "rejected").length;
              await reloadFiles();
              if (failed) {
                notify("הספק שוחזר, אך חלק מהקבצים לא שוחזרו. אפשר לשחזר אותם מאזור הקבצים שנמחקו.", {
                  tone: "error",
                  duration: 8000,
                });
              }
            }
          },
        },
      });
    });
  }

  function addVendor() {
    //  ה-id הוא גם המפתח הראשי ב-DB, ומשמש לקישור הקבצים המצורפים.
    //  nextRowId מבטיח ייחודיות גם כשנוספים שני ספקים באותה מילישנייה.
    const id = crypto.randomUUID();
    const vendor = {
      id,
      name: "ספק חדש",
      type: "כללי",
      phone: "",
      email: "",
      contractCost: 0,
      deposit: 0,
      notes: "",
      tasks: [],
    };
    setVendors((prev) => [...prev, vendor]);
    setOpenId(id);

    if (setBudget) {
      setBudget((prev) => [...prev, newVendorBudgetRow(vendor, prev)]);
      notify(
        `“${vendor.name}” נוסף גם למעקב התקציב. מילוי “עלות בחוזה” יעדכן שם את הסכום.`,
        { tone: "success", duration: 6000 }
      );
    }
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card tourId="vendors-selector">
        <SectionTitle
          icon={Briefcase}
          title="ניהול ספקים"
          subtitle="פרטים, תשלומים, סיכומי פגישות ולוח משימות"
          action={
            canEdit ? (
              <button
                onClick={addVendor}
                className="btn-primary"
              >
                <Plus size={18} /> ספק חדש
              </button>
            ) : null
          }
        />

        <div className="flex flex-wrap gap-2">
          {vendors.map((v) => (
            <button
              key={v.id}
              onClick={() => setOpenId(v.id)}
              aria-pressed={openId === v.id}
              className={`filter-chip ${
                openId === v.id
                  ? "filter-chip-active"
                  : ""
              }`}
            >
              {v.name}
            </button>
          ))}
        </div>
      </Card>

      {vendors.length === 0 && (
        <Card tourId="vendors-empty">
          <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
            <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400">
              <Briefcase size={26} />
            </div>
            <p className="text-base font-semibold text-slate-700">עדיין אין ספקים</p>
            <p className="mt-1 max-w-sm text-sm text-slate-400">
              {canEdit
                ? "הוסיפו ספק חדש בעזרת הכפתור למעלה כדי לנהל פרטים, תשלומים ומשימות."
                : "רשימת הספקים עדיין ריקה."}
            </p>
            {canEdit && (
              <button
                onClick={addVendor}
                className="btn-primary mt-4"
              >
                <Plus size={18} /> הוספת ספק ראשון
              </button>
            )}
          </div>
        </Card>
      )}

      {vendors
        .filter((v) => v.id === openId)
        .map((v) => {
          const balance = v.contractCost - v.deposit;
          //  grid-cols-1 מפורש: בלעדיו העמודה המשתמעת היא auto, שאינה יורדת
          //  מתחת ל-min-content, והכרטיס גלש אל מחוץ למסך ב-320px.
          return (
            <div key={v.id} className="grid grid-cols-1 gap-6 xl:grid-cols-3">
              {/*  כרטיס הספק כולו הוא טופס עריכה, ואין בו פקד שמשנה רק תצוגה.
                  לכן לצופה מנטרלים אותו במלואו. הקבצים להורדה הם קישורי <a>
                  ואינם מושפעים מ-fieldset מושבת.  */}
              <fieldset disabled={!canEdit} className="contents">
              {/* Details + finance */}
              <Card tourId="vendors-details" className="xl:col-span-1">
                <div className="space-y-4">
                  {/*  min-w-0: פריט flex לא מתכווץ מתחת לרוחב הטבעי של input,
                      ובלעדיו כרטיס הספק גלש אל מחוץ למסך ב-320px.  */}
                  <div className="flex items-center gap-2">
                    <input
                      value={v.name}
                      onChange={(e) => updateVendor(v.id, { name: e.target.value })}
                      aria-label="שם הספק"
                      className="min-h-11 w-full min-w-0 bg-transparent text-xl font-bold text-slate-800 outline-none sm:min-h-0"
                    />
                    <button
                      onClick={() => removeVendor(v.id)}
                      aria-label="מחיקת ספק"
                      title="מחיקת ספק"
                      className="btn-icon-danger"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                  <input
                    value={v.type}
                    onChange={(e) => updateVendor(v.id, { type: e.target.value })}
                    className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-base outline-none focus:border-gold-400 sm:min-h-0 sm:text-sm"
                    placeholder="סוג ספק"
                  />
                  {/*  עטיפה ב-label ולא ב-div: בנייד השדה עצמו היה 22px בלבד,
                      ולחיצה על המסגרת סביבו לא עשתה כלום. עכשיו כל השורה
                      ממקדת את הקלט.  */}
                  <label className="flex min-h-11 items-center gap-2 rounded-xl bg-white/60 px-3 py-2 ring-1 ring-slate-200 sm:min-h-0">
                    <Phone size={16} className="shrink-0 text-sage-500" />
                    <input
                      value={v.phone}
                      onChange={(e) => updateVendor(v.id, { phone: e.target.value })}
                      placeholder="טלפון"
                      type="tel"
                      className="w-full bg-transparent text-base outline-none sm:text-sm"
                    />
                  </label>
                  <label className="flex min-h-11 items-center gap-2 rounded-xl bg-white/60 px-3 py-2 ring-1 ring-slate-200 sm:min-h-0">
                    <Mail size={16} className="shrink-0 text-sage-500" />
                    <input
                      value={v.email}
                      onChange={(e) => updateVendor(v.id, { email: e.target.value })}
                      placeholder="אימייל"
                      type="email"
                      className="w-full bg-transparent text-base outline-none sm:text-sm"
                      dir="ltr"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-500">
                        עלות בחוזה
                        <input
                          type="number"
                          value={v.contractCost}
                          onChange={(e) =>
                            updateVendor(v.id, {
                              contractCost: Number(e.target.value) || 0,
                            })
                          }
                          className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-base tabular-nums outline-none focus:border-gold-400 sm:min-h-0 sm:text-sm"
                        />
                      </label>
                      {setBudget && (
                        <p className="mt-1 text-xs text-slate-400">
                          מסונכרן לסעיף של הספק במעקב התקציב
                        </p>
                      )}
                    </div>
                    <label className="text-xs font-semibold text-slate-500">
                      מקדמה ששולמה
                      <input
                        type="number"
                        value={v.deposit}
                        onChange={(e) =>
                          updateVendor(v.id, { deposit: Number(e.target.value) || 0 })
                        }
                        className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-base tabular-nums outline-none focus:border-gold-400 sm:min-h-0 sm:text-sm"
                      />
                    </label>
                  </div>

                  <div className="rounded-2xl bg-gradient-to-l from-gold-50 to-sage-50 p-3 text-center ring-1 ring-gold-200/60">
                    <p className="text-xs text-slate-500">יתרה לתשלום</p>
                    <p className="text-2xl font-extrabold text-slate-800">
                      {fmt(balance)}
                    </p>
                  </div>
                </div>
              </Card>

              {/* Notes */}
              <Card tourId="vendors-notes-tasks" className="xl:col-span-2">
                <div className="mb-3 flex items-center gap-2">
                  <FileText size={18} className="text-gold-500" />
                  <h3 className="font-semibold text-slate-800">
                    סיכומי פגישות והחלטות
                  </h3>
                </div>
                <textarea
                  value={v.notes}
                  onChange={(e) => updateVendor(v.id, { notes: e.target.value })}
                  rows={5}
                  placeholder="כתבו כאן את כל ההסכמות וההחלטות מהפגישות עם הספק..."
                  className="w-full resize-none rounded-2xl border border-slate-200 bg-white/60 p-4 text-sm leading-relaxed outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-100"
                />
                <p className="mt-2 flex items-center gap-1 text-xs text-slate-400">
                  <Save size={12} /> נשמר אוטומטית
                </p>

                {/* Task board */}
                <div data-tour="vendors-task-board" className="mt-6">
                  {/*  flex-wrap + שדה ברוחב מלא בנייד: הכותרת והטופס יחד
                      דורשים ~350px, ולכן ב-320px הטופס נדחף אל מחוץ למסך.  */}
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 font-semibold text-slate-800">
                      <ListTodo size={18} className="text-gold-500" /> לוח משימות
                    </h3>
                    <div className="flex w-full items-center gap-2 sm:w-auto">
                      <input
                        value={taskInput}
                        onChange={(e) => setTaskInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addTask(v.id)}
                        placeholder="משימה חדשה..."
                        className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-base outline-none focus:border-gold-400 sm:min-h-0 sm:w-44 sm:text-sm"
                      />
                      <button
                        onClick={() => addTask(v.id)}
                        title="הוספת משימה"
                        aria-label="הוספת משימה"
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gold-500 text-white transition hover:bg-gold-600"
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  </div>

                  {/*  לוח ריק היה שלוש עמודות שכל אחת אומרת "ריק" — כחצי מסך
                      של כלום בטלפון, כפול מספר הספקים. העמודות מופיעות רק
                      כשיש מה לשים בהן; עד אז שורה אחת שמפנה לשדה ההוספה.  */}
                  {v.tasks.length === 0 ? (
                    <p className="rounded-2xl bg-slate-50/80 px-4 py-2.5 text-center text-xs text-slate-400 ring-1 ring-slate-200/70">
                      אין עדיין משימות לספק הזה — הוסיפו אחת בשדה שלמעלה.
                    </p>
                  ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {TASK_COLUMNS.map((col) => {
                      const items = v.tasks.filter((t) => t.status === col.key);
                      const ColIcon = col.icon;
                      return (
                        <div
                          key={col.key}
                          className="rounded-2xl bg-slate-50/80 p-3 ring-1 ring-slate-200/70"
                        >
                          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-600">
                            <ColIcon size={15} /> {col.label}
                            <span className="mr-auto text-xs text-slate-400">
                              {items.length}
                            </span>
                          </div>
                          <div className="space-y-2">
                            {items.map((t) => (
                              <div
                                key={t.id}
                                className="group rounded-xl bg-white p-2.5 text-sm shadow-sm ring-1 ring-slate-200"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <span
                                    className={
                                      t.status === "done"
                                        ? "text-slate-400 line-through"
                                        : "text-slate-700"
                                    }
                                  >
                                    {t.title}
                                  </span>
                                  {/*  הכפתור היה `opacity-0` עד ריחוף. במסך מגע אין
                                      ריחוף כלל, ולכן אי אפשר היה למחוק משימה
                                      מהטלפון. עכשיו הוא תמיד גלוי, רק עמום יותר.  */}
                                  <button
                                    onClick={() => removeTask(v.id, t.id)}
                                    title="מחיקת משימה"
                                    aria-label={`מחיקת המשימה ${t.title}`}
                                    className="btn-icon-danger -m-1"
                                  >
                                    <X size={16} />
                                  </button>
                                </div>
                                <div className="mt-2 flex min-w-0 items-center gap-2">
                                  <label className="sr-only" htmlFor={`vendor-task-status-${v.id}-${t.id}`}>
                                    סטטוס המשימה {t.title}
                                  </label>
                                  <select
                                    id={`vendor-task-status-${v.id}-${t.id}`}
                                    value={t.status || "todo"}
                                    onChange={(event) => moveTask(v.id, t.id, event.target.value)}
                                    aria-label={`סטטוס המשימה ${t.title}`}
                                    className={`min-h-11 min-w-0 flex-1 cursor-pointer rounded-xl border px-3 py-2 text-xs font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-gold-400 sm:min-h-10 ${
                                      t.status === "done"
                                        ? "border-sage-200 bg-sage-50 text-sage-700"
                                        : t.status === "inprogress"
                                          ? "border-gold-200 bg-gold-50 text-gold-800"
                                          : "border-slate-200 bg-white text-slate-600"
                                    }`}
                                  >
                                    {TASK_COLUMNS.map((column) => (
                                      <option key={column.key} value={column.key}>{column.label}</option>
                                    ))}
                                  </select>
                                  <span className="shrink-0 text-[11px] text-slate-400">סטטוס</span>
                                </div>
                              </div>
                            ))}
                            {items.length === 0 && (
                              <p className="py-2 text-center text-xs text-slate-400">
                                ריק
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  )}
                </div>
              </Card>

              {/* Attachments */}
              <Card tourId="vendors-files" className="min-w-0 xl:col-span-3">
                <VendorFiles
                  weddingId={weddingId}
                  vendorId={v.id}
                  files={files.filter((f) => f.vendorId === v.id)}
                  filesStatus={filesStatus}
                  deletedFiles={deletedFiles.filter((f) => f.vendorId === v.id)}
                  showDeletedFiles={showDeletedFiles}
                  setShowDeletedFiles={setShowDeletedFiles}
                  canEdit={canEdit}
                  onChanged={reloadFiles}
                />
              </Card>
              </fieldset>
            </div>
          );
        })}
    </div>
  );
}

/* =========================================================================
 *  VENDOR ATTACHMENTS — חוזים, הצעות מחיר ותמונות
 *  ------------------------------------------------------------------------
 *  הקבצים נשמרים במסד תחת אותה מדיניות RLS כמו שאר נתוני החתונה, ואינם
 *  נגישים ב-URL ציבורי. ההורדה עוברת בנתיב מאומת עם עוגיית הסשן.
 * ====================================================================== */

const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  //  ללא שבר מיותר כשהמספר עגול ("5 MB" ולא "5.0 MB")
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

function VendorFiles({
  weddingId,
  vendorId,
  files,
  filesStatus = "ready",
  deletedFiles = [],
  showDeletedFiles,
  setShowDeletedFiles,
  canEdit,
  onChanged,
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(null);
  /*  ב-Firebase Storage כתובת ההורדה נחתמת מול הטוקן ולכן נשלפת
      ב-await. קודם זה היה נתיב קבוע שהעוגייה אימתה, ואפשר היה לשים
      אותו ישירות ב-src/href.  */
  const [urls, setUrls] = useState({});

  const fileIds = files.map((f) => f.id).join(",");
  useEffect(() => {
    let alive = true;
    if (!weddingId || !files.length) return undefined;

    (async () => {
      const resolved = {};
      for (const f of files) {
        try {
          resolved[f.id] = await vendorFileUrl(weddingId, f.id);
        } catch {
          //  קובץ שנמחק מ-Storage או חסר הרשאה — מוצגת אייקונה במקום תמונה.
        }
      }
      if (alive) setUrls(resolved);
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weddingId, fileIds]);

  if (!weddingId) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Paperclip size={18} className="text-gold-500" />
        צירוף קבצים זמין רק כשהמערכת מחוברת לענן.
      </div>
    );
  }

  async function handleFiles(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    if (!picked.length) return;

    setBusy(true);
    let uploaded = 0;
    for (const file of picked) {
      if (file.size > MAX_FILE_BYTES) {
        notify(`“${file.name}” גדול מדי (מקסימום ${formatBytes(MAX_FILE_BYTES)})`, {
          tone: "error",
        });
        continue;
      }
      try {
        await uploadVendorFile(weddingId, vendorId, file);
        uploaded++;
      } catch (err) {
        console.error("Upload failed:", err);
        notify(
          err?.code === "vendor_not_synced"
            ? "הספק עדיין נשמר בענן — נסו שוב בעוד רגע"
            : `העלאת “${file.name}” נכשלה`,
          { tone: "error" }
        );
      }
    }
    setBusy(false);
    if (uploaded) {
      notify(uploaded === 1 ? "הקובץ צורף" : `${uploaded} קבצים צורפו`, {
        tone: "success",
      });
      onChanged();
    }
  }

  /*  ההורדה עוברת דרך fetch ולא דרך <a href> ישיר. קישור ישיר מנווט את
      הלשונית עצמה אל הקובץ, ובטלפון הדפדפן מציג את ה-PDF במציג המובנה
      שלו — האפליקציה נעלמת מהמסך ואין כפתור חזרה שמחזיר אליה. משיכת
      הקובץ ל-blob מקומי מורידה אותו בלי לעזוב את הכרטיס של הספק.  */
  async function download(file) {
    setDownloading(file.id);
    try {
      const res = await fetch(await vendorFileUrl(weddingId, file.id));
      if (!res.ok) throw new Error(`status ${res.status}`);

      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      //  חלק מהדפדפנים מתעלמים מלחיצה על עוגן שאינו מחובר ל-DOM.
      document.body.appendChild(a);
      a.click();
      a.remove();
      //  שחרור מיידי קוטע את ההורדה בחלק מהדפדפנים בנייד.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      console.error("Download failed:", err);
      notify("הורדת הקובץ נכשלה — נסו שוב", { tone: "error" });
    } finally {
      setDownloading(null);
    }
  }

  async function remove(file) {
    const ok = await confirmDialog({
      title: `למחוק את “${file.name}”?`,
      message: "הקובץ יימחק לצמיתות ולא ניתן יהיה לשחזר אותו.",
      confirmLabel: "מחיקה",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteVendorFile(weddingId, file.id);
      notify("הקובץ נמחק", { tone: "success" });
      onChanged();
    } catch (err) {
      console.error(err);
      notify("מחיקת הקובץ נכשלה", { tone: "error" });
    }
  }

  async function restore(file) {
    try {
      await restoreVendorFile(weddingId, file.id);
      notify("הקובץ שוחזר", { tone: "success" });
      onChanged();
    } catch (err) {
      console.error("Failed to restore vendor file:", err);
      notify("שחזור הקובץ נכשל", { tone: "error" });
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold text-slate-800">
          <Paperclip size={18} className="text-gold-500" /> חוזים וקבצים
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
            {files.length}
          </span>
        </h3>
        {canEdit && deletedFiles.length > 0 && (
          <button
            type="button"
            onClick={() => setShowDeletedFiles((shown) => !shown)}
            aria-expanded={showDeletedFiles}
            className="min-h-10 rounded-xl px-3 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50"
          >
            {showDeletedFiles ? "הסתרת" : "שחזור"} קבצים שנמחקו ({deletedFiles.length})
          </button>
        )}
        {canEdit && (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFiles}
            />
            <button
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="btn-primary disabled:opacity-60"
            >
              {busy ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Upload size={18} />
              )}
              צירוף קובץ
            </button>
          </>
        )}
      </div>

      {/*  מצב ריק בגובה של אזור גרירה שלם, עם כפתור שכפול של "צירוף קובץ"
          שכבר יושב בכותרת, הכריח גלילה ארוכה על כל ספק בלי קבצים. שורה
          אחת מספרת את אותו הדבר.  */}
      {filesStatus === "error" && files.length > 0 && (
        <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
          <span>רענון רשימת הקבצים נכשל. הקבצים שכבר הוצגו נשארים זמינים.</span>
          <button type="button" onClick={onChanged} className="btn-secondary">
            ניסיון חוזר
          </button>
        </div>
      )}
      {(filesStatus === "loading" || filesStatus === "refreshing") && files.length === 0 ? (
        <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500 ring-1 ring-slate-200">
          <Loader2 size={17} className="animate-spin" /> טוען קבצים מצורפים…
        </div>
      ) : filesStatus === "error" && files.length === 0 ? (
        <div role="alert" className="rounded-2xl bg-rose-50 px-4 py-4 text-center ring-1 ring-rose-200">
          <p className="text-sm font-semibold text-rose-800">לא ניתן לטעון את הקבצים כרגע</p>
          <p className="mt-1 text-xs text-rose-700">הקבצים לא נמחקו. בדקו את החיבור ונסו שוב.</p>
          <button type="button" onClick={onChanged} className="btn-secondary mt-3">
            <RotateCcw size={15} /> ניסיון חוזר
          </button>
        </div>
      ) : files.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-2.5 text-center text-xs text-slate-400">
          עדיין לא צורפו קבצים — חוזה, הצעת מחיר או תמונה, עד{" "}
          {formatBytes(MAX_FILE_BYTES)} לקובץ.
        </p>
      ) : (
        /*  `grid` בלי הגדרת עמודות יוצר עמודה ברוחב auto, והיא נמדדת לפי
            max-content של השורה — כלומר לפי שם הקובץ המלא, שהוא שורה אחת
            בלי מקום לשבור בה. מספיק היה שם ארוך אחד כדי למתוח את הכרטיס
            (ואיתו את כל טור הכרטיסים) הרבה מעבר לרוחב המסך, והמסך נחתך.
            grid-cols-1 של Tailwind הוא minmax(0,1fr) — מינימום אפס, ולכן
            העמודה נצמדת לרוחב הזמין והשם מתקצר עם שלוש נקודות.  */
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {files.map((f) => {
            const isImage = IMAGE_MIME.has(f.mime);
            return (
              <li
                key={f.id}
                className="flex min-w-0 items-center gap-1 rounded-2xl bg-white/70 p-2.5 ring-1 ring-slate-200 transition hover:ring-gold-300 sm:gap-2"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-100 text-slate-400 ring-1 ring-slate-200">
                  {isImage && urls[f.id] ? (
                    <img
                      src={urls[f.id]}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <FileText size={20} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    title={f.name}
                    className="block truncate text-sm font-medium text-slate-700"
                  >
                    {f.name}
                  </span>
                  {/*  bdi מבדד כל פרט לכיוון שלו, אחרת "14 B" והתאריך
                      מתערבבים בשורה עברית והסדר נשבר  */}
                  <span className="block truncate text-xs text-slate-400">
                    <bdi>{formatBytes(f.size)}</bdi>
                    {" · "}
                    <bdi>{new Date(f.createdAt).toLocaleDateString("he-IL")}</bdi>
                  </span>
                </span>
                {isImage && urls[f.id] && (
                  <a
                    href={urls[f.id]}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="פתיחה בכרטיסייה חדשה"
                    aria-label={`פתיחת ${f.name}`}
                    className="btn-icon"
                  >
                    <ExternalLink size={16} />
                  </a>
                )}
                <button
                  onClick={() => download(f)}
                  disabled={downloading === f.id}
                  title="הורדה"
                  aria-label={`הורדת ${f.name}`}
                  className="btn-icon"
                >
                  {downloading === f.id ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Download size={16} />
                  )}
                </button>
                {canEdit && (
                  <button
                    onClick={() => remove(f)}
                    title="מחיקת הקובץ"
                    aria-label={`מחיקת ${f.name}`}
                    className="btn-icon-danger"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {showDeletedFiles && deletedFiles.length > 0 && (
        <section className="mt-4 rounded-2xl bg-amber-50/70 p-3 ring-1 ring-amber-200" aria-label="קבצים שנמחקו">
          <h4 className="mb-2 flex items-center gap-2 text-xs font-bold text-amber-800">
            <RotateCcw size={14} /> קבצים שנמחקו — אפשר לשחזר
          </h4>
          <ul className="space-y-2">
            {deletedFiles.map((file) => (
              <li key={file.id} className="flex min-w-0 items-center gap-2 rounded-xl bg-white/80 p-2 ring-1 ring-amber-100">
                <FileText size={16} className="shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate text-xs text-slate-700" title={file.name}>{file.name}</span>
                {canEdit && (
                  <button type="button" onClick={() => restore(file)} className="btn-secondary shrink-0 px-3 text-xs">
                    שחזור
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* =========================================================================
 *  FINANCE MODULE
 * ====================================================================== */

/*  תגית מקור לסעיף תקציב. בלעדיה שורה שנוצרה לבד נראית כמו
    שורה שמישהו הקליד, ואז מוחקים אותה או מוסיפים לידה עוד אחת.  */
function VendorSourceTag({ vendorName }) {
  return (
    <span
      title={`הסעיף נוצר אוטומטית מהספק “${vendorName}” בלשונית ספקים`}
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-sage-100 px-2 py-0.5 text-[11px] font-semibold text-sage-700 ring-1 ring-inset ring-sage-300"
    >
      <Briefcase size={11} />
      מלשונית ספקים
    </span>
  );
}

/*  מזיז פריט אחד למקומו של פריט אחר, בלי לשנות את סדר שאר הפריטים.
    מחזיר את אותה רשימה כשאין מה לשנות, כדי לא לגרום רינדור מיותר.  */
function moveBefore(list, id, targetId) {
  const from = list.findIndex((b) => b.id === id);
  const to = list.findIndex((b) => b.id === targetId);
  if (from < 0 || to < 0 || from === to) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/*  העלות של סעיף תקציב. ההוצאה בפועל גוברת כשנרשמה, ואחרת נשארת
    ההקצבה המתוכננת — כך סעיף שהגיע ממחשבון האלכוהול (שכותב תכנון בלבד)
    וסעיף שעודכן ידנית מוצגים באותה עמודה בלי לאבד נתון.  */
const budgetCostOf = (b) => Number(b?.actual) || Number(b?.expected) || 0;

const BUDGET_PAYMENT_METHODS = ["Bit", "Credit Card", "Cash", "Other"];
const BUDGET_PAYMENT_LABELS = { Bit: "ביט", "Credit Card": "אשראי", Cash: "מזומן", Other: "אחר" };

function BudgetNotes({ item, canEdit, onChange, label = item.category }) {
  const [expanded, setExpanded] = useState(false);
  const notes = item.notes || "";
  if (!canEdit) {
    return notes ? (
      <details className="min-w-0 text-sm text-slate-600" title={notes}>
        <summary className="cursor-pointer rounded-lg p-2 outline-none focus-visible:ring-2 focus-visible:ring-gold-400" aria-label={`הערות — ${label}`}>
          <span className="line-clamp-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{notes}</span>
        </summary>
        <p className="whitespace-pre-wrap p-2 [overflow-wrap:anywhere]">{notes}</p>
      </details>
    ) : <span className="text-sm text-slate-400">אין הערות</span>;
  }
  return (
    <textarea
      value={notes}
      onChange={(event) => onChange(item.id, { notes: event.target.value })}
      onFocus={() => setExpanded(true)}
      onBlur={() => setExpanded(false)}
      rows={expanded ? 5 : 2}
      aria-label={`הערות — ${label}`}
      title={notes || undefined}
      placeholder="הערות"
      className="block min-h-11 w-full min-w-0 resize-y rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-base leading-5 text-slate-700 outline-none transition focus:border-gold-400 focus:ring-2 focus:ring-gold-100 [overflow-wrap:anywhere] sm:text-sm"
    />
  );
}

function Finance({ budget, setBudget, vendors = [], guests, budgetGoal, setBudgetGoal, financeLabels, setFinanceLabels }) {
  const canEdit = useCanEdit();
  const [form, setForm] = useState({ category: "", cost: "", paid: "" });
  const [isAddBudgetOpen, setIsAddBudgetOpen] = useState(false);
  const budgetToggleRef = useRef(null);
  const budgetNameRef = useRef(null);
  const budgetToggleTouched = useRef(false);

  useEffect(() => {
    if (!budgetToggleTouched.current) return;
    (isAddBudgetOpen ? budgetNameRef : budgetToggleRef).current?.focus({ preventScroll: true });
  }, [isAddBudgetOpen]);

  const [goalDraft, setGoalDraft] = useState(budgetGoal);
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  /*  גרירה במגע. HTML5 drag-and-drop פשוט לא קיים בדפדפני נייד, ולכן
      בתצוגת הכרטיסים הסידור נעשה ב-Pointer Events: אוחזים בידית,
      הכרטיס עוקב אחרי האצבע, והיעד מסומן. הסידור מבוצע רק בשחרור —
      כך סדר ה-DOM לא משתנה באמצע הגרירה ומאבד את לכידת המצביע.  */
  const [touchDrag, setTouchDrag] = useState(null);
  const cardRefs = useRef(new Map());
  const dragRef = useRef(null);
  const touchDragId = touchDrag?.id ?? null;

  useEffect(() => {
    if (touchDragId == null) return undefined;

    function onMove(e) {
      let overId = null;
      for (const [id, el] of cardRefs.current) {
        if (id === touchDragId) continue;
        const rect = el.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          overId = id;
          break;
        }
      }
      if (dragRef.current) dragRef.current.overId = overId;
      setTouchDrag({
        id: touchDragId,
        overId,
        dy: e.clientY - (dragRef.current?.startY ?? e.clientY),
      });
    }

    function onEnd() {
      const drag = dragRef.current;
      dragRef.current = null;
      setTouchDrag(null);
      if (drag?.overId != null) {
        setBudget((prev) => moveBefore(prev, drag.id, drag.overId));
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  }, [touchDragId, setBudget]);

  /*  סעיף שנוצר מספק מחזיק סכומים משלו, ולכן הוא עשוי להיפרד
      מהעלות בחוזה — בין אם ערכו אותו כאן ובין אם החוזה התעדכן
      בלשונית ספקים. הפער מוצג ולא נסתם: שני המספרים אמיתיים.  */
  const vendorById = useMemo(
    () => new Map(vendors.map((v) => [v.id, v])),
    [vendors]
  );

  //  שיוך לספק שכבר אינו קיים (מחיקה במכשיר אחר, או חוסר הרשאה
  //  ללשונית ספקים) מוצג כסעיף רגיל במקום להפיל את המסך.
  const vendorOf = (b) =>
    b.vendorId == null ? null : vendorById.get(b.vendorId) ?? null;

  const contractOf = (v) => Number(v.contractCost) || 0;

  const L = { ...DEFAULT_FINANCE_LABELS, ...financeLabels };
  const updateLabel = (key, val) =>
    setFinanceLabels((prev) => ({ ...prev, [key]: val }));

  useEffect(() => setGoalDraft(budgetGoal), [budgetGoal]);

  const goal = Number(budgetGoal) || 0;

  function commitGoal() {
    const n = Math.max(0, Math.round(Number(goalDraft) || 0));
    if (n !== budgetGoal) setBudgetGoal(n);
    setGoalDraft(n);
  }

  const totals = useMemo(() => {
    let cost = 0;
    let paid = 0;
    let remaining = 0;
    for (const b of budget) {
      const rowCost = budgetCostOf(b);
      const rowPaid = Number(b.paid) || 0;
      cost += rowCost;
      paid += rowPaid;
      //  מי ששילם יותר מהעלות לא “נותר לשלם” סכום שלילי.
      remaining += Math.max(0, rowCost - rowPaid);
    }
    const income = guests.reduce((s, g) => s + (g.gift || 0), 0);
    return { cost, paid, remaining, income, balance: income - cost };
  }, [budget, guests]);

  function addItem(e) {
    e.preventDefault();
    if (!form.category.trim()) return;
    const cost = Number(form.cost) || 0;
    setBudget((prev) => [
      ...prev,
      {
        id: nextRowId(prev),
        category: form.category.trim(),
        //  שני השדות נשמרים זהים: המסך מציג עמודת עלות אחת, והתאימות
        //  לגיבויים, לייצוא ולסנכרון הספקים נשמרת.
        expected: cost,
        actual: cost,
        paid: Number(form.paid) || 0,
        paymentMethod: "",
        notes: "",
      },
    ]);
    setForm({ category: "", cost: "", paid: "" });
    budgetNameRef.current?.focus({ preventScroll: true });
  }

  function updateCost(id, value) {
    const cost = Number(value) || 0;
    setBudget((prev) =>
      prev.map((b) => (b.id === id ? { ...b, expected: cost, actual: cost } : b))
    );
  }

  function updatePaid(id, value) {
    setBudget((prev) =>
      prev.map((b) => (b.id === id ? { ...b, paid: Number(value) || 0 } : b))
    );
  }

  function updateMetadata(id, patch) {
    if (!canEdit) return;
    setBudget((previous) => previous.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  /*  שם הסעיף נערך במקום, בדיוק כמו הסכומים שלצדו. סעיף שנוצר מספק אינו
      נערך כאן — השם שלו נגרר אחרי שם הספק, ועריכה כאן הייתה נמחקת בשינוי
      השם הבא בלשונית ספקים.  */
  function renameItem(id, value) {
    setBudget((prev) =>
      prev.map((b) => (b.id === id ? { ...b, category: value } : b))
    );
  }

  // Reorder budget rows – the array order IS the display order (persisted).
  function moveItem(id, dir) {
    setBudget((prev) => {
      const i = prev.findIndex((b) => b.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function handleDrop(targetId) {
    setDragOverId(null);
    if (dragId != null && dragId !== targetId) {
      setBudget((prev) => moveBefore(prev, dragId, targetId));
    }
    setDragId(null);
  }

  function removeItem(id) {
    const b = budget.find((x) => x.id === id);
    const vendor = b ? vendorOf(b) : null;
    //  מחיקה כאן הייתה מתבטלת מעצמה: הסעיף נוצר מחדש בטעינה הבאה
    //  כל עוד הספק קיים, והמשתמש היה חווה את זה כתקלה.
    if (vendor) {
      notify(
        `“${b.category}” הוא סעיף של ספק. כדי להסיר אותו, מחקו את הספק בלשונית “ספקים”. כדי שלא ייספר בתקציב, אפסו את הסכומים.`,
        { tone: "error", duration: 7000 }
      );
      return;
    }
    confirmDialog({
      title: `למחוק את הסעיף “${b?.category || ""}”?`,
      message: "סעיף התקציב יוסר לצמיתות.",
      confirmLabel: "מחק סעיף",
      tone: "danger",
    }).then((ok) => {
      if (ok) setBudget((prev) => prev.filter((b) => b.id !== id));
    });
  }

  //  יישור הפער בלחיצה אחת, לפי העלות שרשומה בכרטיס הספק.
  function matchVendor(id, cost) {
    setBudget((prev) =>
      prev.map((b) => (b.id === id ? { ...b, expected: cost, actual: cost } : b))
    );
  }

  return (
    /*  מסך התקציב כולו הוא עריכה — אין בו חיפוש, סינון או מיון —
        ולכן הניטרול הגורף לצופה אינו פוגע בשום פעולת צפייה.  */
    <fieldset disabled={!canEdit} className="contents">
    <div className="space-y-4 sm:space-y-6">
      <Card tourId="finance-goal">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-gold-100 text-gold-600">
              <Wallet size={22} />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700">
                <EditableText
                  value={L.goalTitle}
                  onCommit={(v) => updateLabel("goalTitle", v)}
                />
              </p>
              <p className="text-xs text-slate-400">
                <EditableText
                  value={L.goalSubtitle}
                  onCommit={(v) => updateLabel("goalSubtitle", v)}
                />
              </p>
            </div>
          </div>
          <div className="relative w-full sm:w-52">
            <input
              type="number"
              min="0"
              value={goalDraft}
              onChange={(e) => setGoalDraft(e.target.value)}
              onBlur={commitGoal}
              aria-label="יעד תקציב כולל"
              className="w-full rounded-xl border border-gold-300 bg-white px-3 py-2.5 pe-9 text-lg font-bold tabular-nums text-slate-800 outline-none focus:border-gold-500"
            />
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">
              ₪
            </span>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          {/*  שלושת המספרים של המסך, בסדר שבו שואלים אותם: כמה הכול עולה,
              כמה כבר שולם, וכמה עוד צריך לשלם.  */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <BudgetFigure
              label={<EditableText value={L.statCost} onCommit={(v) => updateLabel("statCost", v)} />}
              value={fmt(totals.cost)}
            />
            <BudgetFigure
              label={<EditableText value={L.statPaid} onCommit={(v) => updateLabel("statPaid", v)} />}
              value={fmt(totals.paid)}
              tone="sage"
            />
            <BudgetFigure
              label={<EditableText value={L.statRemaining} onCommit={(v) => updateLabel("statRemaining", v)} />}
              value={fmt(totals.remaining)}
              tone="gold"
            />
          </div>

          {/*  יעד 0 = עוד לא נקבע יעד. אין טעם להציג "חריגה" באדום על יעד
              שהמשתמש מעולם לא הגדיר — זה מבהיל בלי סיבה.  */}
          {goal <= 0 ? (
            <p className="rounded-xl bg-gold-50 px-3 py-2.5 text-xs leading-5 text-slate-600 ring-1 ring-gold-200">
              {canEdit
                ? "עוד לא הוגדר יעד תקציב. הזינו סכום למעלה כדי לראות כמה מרווח נשאר."
                : "עוד לא הוגדר יעד תקציב לחתונה הזו."}
            </p>
          ) : (
            <>
              <BudgetGoalBar
                goal={goal}
                cost={totals.cost}
                paid={totals.paid}
                remaining={totals.remaining}
              />
              <p
                className={`rounded-xl px-3 py-2 text-xs font-semibold ${
                  totals.cost > goal
                    ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                    : "bg-sage-50 text-sage-700 ring-1 ring-sage-200"
                }`}
              >
                {totals.cost > goal
                  ? `העלויות חורגות מהיעד ב-${fmt(totals.cost - goal)}`
                  : `נשאר מרווח של ${fmt(goal - totals.cost)} עד היעד`}
              </p>
            </>
          )}

          {/*  מתנות אינן חלק מניהול ההוצאות, ולכן הן שורה משנית ולא כרטיס
              נתון משלהן — הן מופיעות רק כשבאמת נרשמו.  */}
          {totals.income > 0 && (
            <p className="text-xs text-slate-500">
              <EditableText value={L.statIncome} onCommit={(v) => updateLabel("statIncome", v)} />
              :{" "}
              <b className="tabular-nums text-slate-700">{fmt(totals.income)}</b>
              {" · "}
              {totals.balance >= 0 ? "יתרה אחרי מתנות: " : "חסר אחרי מתנות: "}
              <b className="tabular-nums text-slate-700">{fmt(Math.abs(totals.balance))}</b>
            </p>
          )}
        </div>
      </Card>

      <Card tourId="finance-items">
        <SectionTitle
          icon={PiggyBank}
          title={
            <EditableText
              value={L.sectionTitle}
              onCommit={(v) => updateLabel("sectionTitle", v)}
            />
          }
          subtitle={
            <EditableText
              value={L.sectionSubtitle}
              onCommit={(v) => updateLabel("sectionSubtitle", v)}
            />
          }
        />

        {budget.some((b) => vendorOf(b)) && (
          <p className="mb-3 flex items-start gap-2 rounded-xl bg-sage-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-sage-200 sm:mb-4">
            <Briefcase size={14} className="mt-0.5 shrink-0 text-sage-600" />
            <span>
              סעיפים שמסומנים “מלשונית ספקים” נוצרים אוטומטית מכרטיסי הספקים.
              עדכון “עלות בחוזה” שם מעדכן גם את הסעיף כאן, ומחיקת הספק מסירה אותו.
            </span>
          </p>
        )}

        {canEdit && (
        <CollapsibleAdd
          tourId="finance-add-item"
          label="הוספת סעיף"
          open={isAddBudgetOpen}
          onToggle={() => {
            budgetToggleTouched.current = true;
            setIsAddBudgetOpen((open) => !open);
          }}
          panelId="finance-add-item-panel"
          toggleRef={budgetToggleRef}
          className="mb-4 sm:mb-5"
        >
        <form
          onSubmit={addItem}
          className="mt-2.5 grid grid-cols-2 gap-2 rounded-2xl bg-white/50 p-3 ring-1 ring-slate-200/70 sm:gap-3 sm:p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
        >
          <label className="col-span-2 min-w-0 space-y-1 sm:col-span-1">
            <span className="px-1 text-xs font-semibold text-slate-500">שם הסעיף</span>
            <input
              ref={budgetNameRef}
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              aria-label="שם הסעיף"
              className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-100"
            />
          </label>
          <label className="min-w-0 space-y-1">
            <span className="px-1 text-xs font-semibold text-slate-500">עלות</span>
            <input
              type="number"
              value={form.cost}
              onChange={(e) => setForm({ ...form, cost: e.target.value })}
              aria-label="עלות"
              className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-100"
            />
          </label>
          <label className="min-w-0 space-y-1">
            <span className="px-1 text-xs font-semibold text-slate-500">שולם</span>
            <input
              type="number"
              value={form.paid}
              onChange={(e) => setForm({ ...form, paid: e.target.value })}
              aria-label="שולם"
              className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-100"
            />
          </label>
          <button
            type="submit"
            className="btn-primary col-span-2 self-end sm:col-span-1"
          >
            <Plus size={18} /> הוסף
          </button>
        </form>
        </CollapsibleAdd>
        )}

        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[980px] text-right text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="w-8 px-2 py-2"></th>
                <th className="px-3 py-2 font-semibold">
                  <EditableText
                    value={L.colCategory}
                    onCommit={(v) => updateLabel("colCategory", v)}
                  />
                </th>
                <th className="px-3 py-2 font-semibold">
                  <EditableText
                    value={L.colCost}
                    onCommit={(v) => updateLabel("colCost", v)}
                  />
                </th>
                <th className="px-3 py-2 font-semibold">
                  <EditableText
                    value={L.colPaid}
                    onCommit={(v) => updateLabel("colPaid", v)}
                  />
                </th>
                <th className="px-3 py-2 font-semibold">
                  <EditableText
                    value={L.colRemaining}
                    onCommit={(v) => updateLabel("colRemaining", v)}
                  />
                </th>
                <th className="px-3 py-2 font-semibold">אמצעי תשלום</th>
                <th className="w-64 px-3 py-2 font-semibold">הערות</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {budget.map((b, idx) => {
                const rowCost = budgetCostOf(b);
                const remaining = Math.max(0, rowCost - (b.paid || 0));
                const vendor = vendorOf(b);
                const cost = vendor ? contractOf(vendor) : 0;
                const mismatch =
                  vendor && (b.expected !== cost || b.actual !== cost);
                return (
                  <tr
                    key={b.id}
                    title={b.notes || undefined}
                    onDragOver={(e) => {
                      if (dragId == null) return;
                      e.preventDefault();
                      if (dragOverId !== b.id) setDragOverId(b.id);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDrop(b.id);
                    }}
                    className={`border-b border-slate-100 transition ${
                      dragId === b.id
                        ? "opacity-40"
                        : mismatch
                          ? "bg-rose-50/70 hover:bg-rose-50"
                          : "hover:bg-white/60"
                    } ${
                      dragOverId === b.id && dragId !== b.id
                        ? "border-t-2 border-t-gold-400 bg-gold-50/40"
                        : ""
                    }`}
                  >
                    <td
                      draggable
                      onDragStart={() => setDragId(b.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setDragOverId(null);
                      }}
                      title="גררו כדי לשנות את סדר השורות"
                      className="cursor-grab px-2 py-3 text-slate-300 transition hover:text-gold-500 active:cursor-grabbing"
                    >
                      <GripVertical size={16} />
                    </td>
                    <td className="px-3 py-3 font-semibold text-slate-800">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {canEdit && !vendor ? (
                          <EditableText
                            value={b.category}
                            onCommit={(v) => renameItem(b.id, v)}
                            title="לחצו לעריכת שם הסעיף"
                          />
                        ) : (
                          b.category
                        )}
                        {vendor && <VendorSourceTag vendorName={vendor.name} />}
                      </span>
                      {mismatch && (
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-normal text-rose-600">
                          העלות בחוזה של הספק היא{" "}
                          <b className="tabular-nums">{fmt(cost)}</b>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => matchVendor(b.id, cost)}
                              className="btn-secondary px-2 text-xs"
                            >
                              עדכון לפי הספק
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="number"
                        value={rowCost}
                        onChange={(e) => updateCost(b.id, e.target.value)}
                        aria-label={`${L.colCost} — ${b.category}`}
                        className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm tabular-nums outline-none focus:border-gold-400"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="number"
                        value={b.paid ?? 0}
                        onChange={(e) => updatePaid(b.id, e.target.value)}
                        aria-label={`${L.colPaid} — ${b.category}`}
                        className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm tabular-nums outline-none focus:border-gold-400"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`font-semibold tabular-nums ${
                          remaining > 0 ? "text-gold-600" : "text-sage-600"
                        }`}
                      >
                        {remaining > 0
                          ? fmt(remaining)
                          : rowCost > 0
                            ? "שולם במלואו"
                            : fmt(0)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-left">
                      <select
                        value={b.paymentMethod || ""}
                        onChange={(event) => updateMetadata(b.id, { paymentMethod: event.target.value })}
                        aria-label={`אמצעי תשלום — ${b.category}`}
                        className="min-h-11 w-36 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700 outline-none focus:border-gold-400 disabled:bg-slate-50"
                      >
                        <option value="">לא נבחר</option>
                        {BUDGET_PAYMENT_METHODS.map((method) => <option key={method} value={method}>{BUDGET_PAYMENT_LABELS[method]}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="w-64">
                        <BudgetNotes item={b} canEdit={canEdit} onChange={updateMetadata} />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-left">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          onClick={() => moveItem(b.id, -1)}
                          disabled={idx === 0}
                          title="העברה למעלה"
                          className="btn-icon"
                        >
                          <ChevronUp size={16} />
                        </button>
                        <button
                          onClick={() => moveItem(b.id, 1)}
                          disabled={idx === budget.length - 1}
                          title="העברה למטה"
                          className="btn-icon"
                        >
                          <ChevronDown size={16} />
                        </button>
                        <button
                          onClick={() => removeItem(b.id)}
                          title="מחיקת סעיף"
                          className="btn-icon-danger"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {budget.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-10 text-center text-slate-400"
                  >
                    עדיין אין סעיפי תקציב – הוסיפו סעיף חדש בעזרת הטופס למעלה.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 font-bold text-slate-800">
                <td className="px-2 py-3"></td>
                <td className="px-3 py-3">סה״כ</td>
                <td className="px-3 py-3 tabular-nums">{fmt(totals.cost)}</td>
                <td className="px-3 py-3 tabular-nums">{fmt(totals.paid)}</td>
                <td className="px-3 py-3 tabular-nums">{fmt(totals.remaining)}</td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Mobile card view – same data & actions without horizontal scrolling */}
        <div className="space-y-3 lg:hidden">
          {budget.map((b) => {
            const rowCost = budgetCostOf(b);
            const remaining = Math.max(0, rowCost - (b.paid || 0));
            const vendor = vendorOf(b);
            const cost = vendor ? contractOf(vendor) : 0;
            const mismatch = vendor && (b.expected !== cost || b.actual !== cost);
            const dragging = touchDrag?.id === b.id;
            const dropTarget = touchDrag?.overId === b.id;
            return (
              <div
                key={b.id}
                ref={(el) => {
                  if (el) cardRefs.current.set(b.id, el);
                  else cardRefs.current.delete(b.id);
                }}
                style={dragging ? { transform: `translateY(${touchDrag.dy}px)` } : undefined}
                className={`rounded-2xl border p-4 ${
                  dragging
                    ? "relative z-10 border-gold-400 bg-white shadow-xl"
                    : dropTarget
                      ? "border-gold-400 bg-gold-50/70"
                      : mismatch
                        ? "border-rose-200 bg-rose-50/70"
                        : "border-slate-200 bg-white/70"
                }`}
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-800">
                      {canEdit && !vendor ? (
                        <EditableText
                          value={b.category}
                          onCommit={(v) => renameItem(b.id, v)}
                          title="לחצו לעריכת שם הסעיף"
                        />
                      ) : (
                        b.category
                      )}
                      {vendor && <VendorSourceTag vendorName={vendor.name} />}
                    </p>
                    {mismatch && (
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-rose-600">
                        העלות בחוזה של הספק היא{" "}
                        <b className="tabular-nums">{fmt(cost)}</b>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => matchVendor(b.id, cost)}
                            className="btn-secondary px-2 text-xs"
                          >
                            עדכון לפי הספק
                          </button>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {/*  ידית גרירה במקום שני חצים: מזיזים את הכרטיס למקומו
                        בתנועה אחת. במקלדת הידית מגיבה לחצי מעלה/מטה.  */}
                    <button
                      type="button"
                      onPointerDown={(e) => {
                        if (e.button > 0) return;
                        dragRef.current = { id: b.id, startY: e.clientY, overId: null };
                        setTouchDrag({ id: b.id, overId: null, dy: 0 });
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                        e.preventDefault();
                        moveItem(b.id, e.key === "ArrowUp" ? -1 : 1);
                      }}
                      title="גררו כדי לשנות את סדר הסעיפים"
                      aria-label={`שינוי מיקום של ${b.category} — גררו, או השתמשו בחצים למעלה ולמטה`}
                      className="btn-icon cursor-grab touch-none active:cursor-grabbing"
                    >
                      <GripVertical size={18} />
                    </button>
                    <button
                      onClick={() => removeItem(b.id)}
                      title="מחיקת סעיף"
                      aria-label={`מחיקת ${b.category}`}
                      className="btn-icon-danger"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <label className="text-xs font-medium text-slate-500">
                    {L.colCost}
                    <input
                      type="number"
                      value={rowCost}
                      onChange={(e) => updateCost(b.id, e.target.value)}
                      aria-label={`${L.colCost} — ${b.category}`}
                      className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-base font-semibold tabular-nums outline-none focus:border-gold-400"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-500">
                    {L.colPaid}
                    <input
                      type="number"
                      value={b.paid ?? 0}
                      onChange={(e) => updatePaid(b.id, e.target.value)}
                      aria-label={`${L.colPaid} — ${b.category}`}
                      className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-base font-semibold tabular-nums outline-none focus:border-gold-400"
                    />
                  </label>
                </div>

                {/*  “נותר לשלם” הוא השורה התחתונה של כל סעיף, ולכן הוא מקבל
                    שורה מודגשת משלו ולא עוד שדה בין השאר.  */}
                <div
                  className={`mt-3 flex items-center justify-between rounded-xl px-3 py-2 ${
                    remaining > 0
                      ? "bg-gold-50 ring-1 ring-inset ring-gold-200"
                      : "bg-sage-50 ring-1 ring-inset ring-sage-200"
                  }`}
                >
                  <span className="text-xs font-semibold text-slate-600">
                    {L.colRemaining}
                  </span>
                  <span
                    className={`text-sm font-bold tabular-nums ${
                      remaining > 0 ? "text-gold-700" : "text-sage-700"
                    }`}
                  >
                    {remaining > 0
                      ? fmt(remaining)
                      : rowCost > 0
                        ? "שולם במלואו"
                        : fmt(0)}
                  </span>
                </div>
                <div className="mt-3 space-y-3">
                  <label className="block text-xs font-medium text-slate-500">
                    אמצעי תשלום
                    <select
                      value={b.paymentMethod || ""}
                      onChange={(event) => updateMetadata(b.id, { paymentMethod: event.target.value })}
                      aria-label={`אמצעי תשלום — ${b.category}`}
                      className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-base text-slate-700 outline-none focus:border-gold-400 disabled:bg-slate-50"
                    >
                      <option value="">לא נבחר</option>
                      {BUDGET_PAYMENT_METHODS.map((method) => <option key={method} value={method}>{BUDGET_PAYMENT_LABELS[method]}</option>)}
                    </select>
                  </label>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-slate-500">הערות</p>
                    <BudgetNotes item={b} canEdit={canEdit} onChange={updateMetadata} />
                  </div>
                </div>
              </div>
            );
          })}

          {budget.length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white/60 px-4 py-10 text-center text-sm text-slate-400">
              עדיין אין סעיפי תקציב – הוסיפו סעיף חדש בעזרת הטופס למעלה.
            </div>
          )}
        </div>
      </Card>

      <div aria-hidden="true" className="h-28 lg:hidden" />
      <aside
        aria-label="סיכום תקציב קבוע"
        data-tour="finance-mobile-totals"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-3 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-8px_24px_rgba(15,23,42,0.12)] backdrop-blur-xl lg:hidden"
      >
        <p className="mb-1.5 text-[11px] font-bold text-slate-500">סיכום תקציב</p>
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <div className="min-w-0 rounded-xl bg-slate-100 px-2 py-1.5">
            <p className="truncate text-[11px] font-medium text-slate-600">{L.statCost}</p>
            <p className="truncate text-sm font-bold tabular-nums text-slate-800">{fmt(totals.cost)}</p>
          </div>
          <div className="min-w-0 rounded-xl bg-sage-50 px-2 py-1.5">
            <p className="truncate text-[11px] font-medium text-sage-700">{L.statPaid}</p>
            <p className="truncate text-sm font-bold tabular-nums text-sage-800">{fmt(totals.paid)}</p>
          </div>
          <div className="min-w-0 rounded-xl bg-gold-50 px-2 py-1.5">
            <p className="truncate text-[11px] font-medium text-gold-800">{L.statRemaining}</p>
            <p className="truncate text-sm font-bold tabular-nums text-gold-800">{fmt(totals.remaining)}</p>
          </div>
        </div>
      </aside>
    </div>
    </fieldset>
  );
}

/* =========================================================================
 *  EXTERNAL VENDOR MOBILE PORTAL
 * ====================================================================== */

function VendorPortal({ vendors, setVendors, weddingName = "", coupleTitle = "" }) {
  const [selectedId, setSelectedId] = useState(null);

  /*  במצב ענן רשימת הספקים ריקה ברינדור הראשון, ולכן useState היה ננעל על
      null לנצח: ה-select הציג את הספק הראשון אבל המצב נשאר ריק והמוקאפ של
      הטלפון לא הוצג כלל. לכן גוזרים את הבחירה בפועל מהרשימה העדכנית.  */
  const vendor = vendors.find((v) => v.id === selectedId) ?? vendors[0] ?? null;
  const activeId = vendor?.id ?? "";

  function toggleTask(taskId) {
    setVendors((prev) =>
      prev.map((v) =>
        v.id === activeId
          ? {
              ...v,
              tasks: v.tasks.map((t) =>
                t.id === taskId
                  ? { ...t, status: t.status === "done" ? "todo" : "done" }
                  : t
              ),
            }
          : v
      )
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card>
        <SectionTitle
          icon={Smartphone}
          title="פורטל ספקים לנייד"
          subtitle="הקישור הייעודי שכל ספק מקבל לטלפון שלו"
          action={
            <select
              value={activeId}
              onChange={(e) => {
                const selected = vendors.find((item) => String(item.id) === e.target.value);
                setSelectedId(selected?.id ?? e.target.value);
              }}
              disabled={vendors.length === 0}
              aria-label="בחירת ספק"
              className="filter-select"
            >
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          }
        />
        <div className="flex items-center gap-2 rounded-2xl bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
          <Link2 size={16} className="text-gold-500" />
          <code dir="ltr" className="flex-1 truncate text-slate-500">
            https://wedding.app/v/{activeId}-{vendor?.name?.length || 0}k
          </code>
          <span className="shrink-0 rounded-full bg-gold-100 px-2 py-0.5 text-[11px] font-semibold text-gold-700">
            קישור לדוגמה
          </span>
          <button
            onClick={() => {
              const link = `https://wedding.app/v/${activeId}-${vendor?.name?.length || 0}k`;
              navigator.clipboard?.writeText(link).then(
                () => notify("הקישור הועתק", { tone: "success" }),
                () => notify("לא ניתן להעתיק את הקישור", { tone: "error" })
              );
            }}
            title="העתקת הקישור"
            aria-label="העתקת הקישור"
            className="btn-icon"
          >
            <FileText size={16} />
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          זהו קישור הדגמה בלבד – בגרסה מלאה כל ספק יקבל קישור אישי פעיל לצפייה בפרטים ובמשימות.
        </p>
      </Card>

      {/* Phone mock */}
      {vendor && (
        <div className="flex justify-center">
          <div className="w-full max-w-sm rounded-[2.75rem] border-[10px] border-slate-900 bg-slate-900 p-2 shadow-2xl">
            <div className="relative overflow-hidden rounded-[2.1rem] bg-gradient-to-b from-slate-50 to-white">
              {/* notch */}
              <div className="absolute left-1/2 top-2 z-10 h-5 w-28 -translate-x-1/2 rounded-full bg-slate-900" />

              {/* header */}
              <div className="bg-gradient-to-br from-slate-800 to-slate-700 px-5 pb-6 pt-9 text-white">
                <div className="flex items-center gap-2 text-gold-200">
                  <Heart size={16} fill="currentColor" />
                  <span className="text-xs font-medium">
                    {[coupleTitle || weddingName, "החתונה שלנו"]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <h3 className="mt-3 text-2xl font-bold">
                  {vendor.name}
                </h3>
                <p className="text-sm text-white/70">{vendor.type}</p>
                <div className="mt-4 flex gap-2">
                  <div className="flex-1 rounded-2xl bg-white/10 p-3 text-center backdrop-blur">
                    <p className="text-lg font-bold text-gold-200">
                      {vendor.tasks.filter((t) => t.status === "done").length}/
                      {vendor.tasks.length}
                    </p>
                    <p className="text-[11px] text-white/70">משימות הושלמו</p>
                  </div>
                  <div className="flex-1 rounded-2xl bg-white/10 p-3 text-center backdrop-blur">
                    <p className="text-lg font-bold text-sage-200">
                      {fmt(vendor.contractCost - vendor.deposit)}
                    </p>
                    <p className="text-[11px] text-white/70">יתרה לתשלום</p>
                  </div>
                </div>
              </div>

              {/* body */}
              <div className="max-h-[380px] space-y-4 overflow-y-auto px-5 py-5">
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-700">
                    <CheckCheck size={16} className="text-gold-500" /> המשימות שלי
                  </h4>
                  <div className="space-y-2">
                    {vendor.tasks.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => toggleTask(t.id)}
                        className="flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-right shadow-sm ring-1 ring-slate-200 transition active:scale-[0.98]"
                      >
                        {t.status === "done" ? (
                          <CheckCircle2 className="shrink-0 text-sage-500" size={22} />
                        ) : (
                          <Circle className="shrink-0 text-slate-400" size={22} />
                        )}
                        <span
                          className={`text-sm ${
                            t.status === "done"
                              ? "text-slate-400 line-through"
                              : "font-medium text-slate-700"
                          }`}
                        >
                          {t.title}
                        </span>
                      </button>
                    ))}
                    {vendor.tasks.length === 0 && (
                      <p className="rounded-2xl bg-slate-50 p-4 text-center text-sm text-slate-400">
                        אין משימות פתוחות 🎉
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-700">
                    <FileText size={16} className="text-gold-500" /> הערות מהזוג
                  </h4>
                  <div className="rounded-2xl bg-gold-50 p-3 text-sm leading-relaxed text-slate-600 ring-1 ring-gold-200/60">
                    {vendor.notes || "אין הערות עדיין."}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <p className="mb-1 text-xs font-semibold text-slate-500">
                    יצירת קשר עם הזוג
                  </p>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Phone size={14} className="text-sage-500" /> 050-0000000
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {!vendor && (
        <Card className="text-center">
          <p className="text-sm text-slate-500">
            עדיין לא הוספתם ספקים. הוסיפו ספק במסך "ספקים" והפורטל שלו יופיע כאן.
          </p>
        </Card>
      )}
    </div>
  );
}

/* =========================================================================
 *  ROOT APP
 * ====================================================================== */

const STORAGE_ROOT = "wp:v1:";

/* Storage namespacing
 * -------------------------------------------------------------------------
 * Cloud mode  → `wp:v1:<userId>:<weddingId>:<key>` so that two users on the
 *               same machine (and two weddings of the same user) never read
 *               each other's cached guest names / phone numbers.
 * Local-only  → EXCEPTION: when `isCloudConfigured` is false there is no
 *               user and no wedding, so we deliberately fall back to the
 *               legacy `wp:v1:<key>` prefix. That keeps the offline/demo path
 *               working exactly as before (and there is no sign-out there,
 *               so the sign-out clear step is skipped too).
 */
const StoragePrefixContext = createContext(STORAGE_ROOT);

function scopedPrefix(userId, weddingId) {
  if (!userId || !weddingId) return STORAGE_ROOT;
  return `${STORAGE_ROOT}${userId}:${weddingId}:`;
}

/** מוחק כל מה שהאפליקציה שמרה בדפדפן (נקרא ביציאה מהחשבון). */
function clearLocalAppData() {
  try {
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORAGE_ROOT)) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore – private mode / quota */
  }
}

function loadStored(prefix, key, fallback) {
  try {
    const raw = localStorage.getItem(prefix + key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function usePersistentState(key, initial) {
  const prefix = useContext(StoragePrefixContext);
  const [state, setState] = useState(() => loadStored(prefix, key, initial));
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(prefix + key, JSON.stringify(state));
      } catch {
        /* ignore write/quota errors – state stays in memory */
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [prefix, key, state]);
  return [state, setState];
}

/* Legacy (pre-multi-tenant) data
 * -------------------------------------------------------------------------
 * Before weddings existed everything lived under the unscoped `wp:v1:<key>`.
 * A user who worked offline and only now connected Supabase would otherwise
 * see their data vanish. We offer to import it — explicitly, never silently,
 * because on a shared machine that data may belong to a different person.
 */
const LEGACY_DATASET_KEYS = ["guests", "tables", "vendors", "budget", "checklist"];

function readLegacyDatasets() {
  const out = {};
  let total = 0;
  for (const k of LEGACY_DATASET_KEYS) {
    const v = loadStored(STORAGE_ROOT, k, null);
    if (Array.isArray(v) && v.length) {
      out[k] = v;
      total += v.length;
    }
  }

  const settings = {};
  for (const key of ["budgetGoal", "financeLabels", "categories", "couple", "weddingDate", "countdownBackgroundUrl"]) {
    const value = loadStored(STORAGE_ROOT, key, null);
    if (value != null) settings[key] = value;
  }
  total += Object.keys(settings).length;
  return total ? { datasets: out, settings, total } : null;
}

function normalizeLegacyVendorIds(weddingId, datasets) {
  const mapKey = `legacy-vendor-ids-${weddingId}`;
  let mapping = loadStored(STORAGE_ROOT, mapKey, {});
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) mapping = {};
  const isUuid = (value) =>
    typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const vendors = (datasets.vendors || []).map((vendor) => {
    if (isUuid(vendor.id)) {
      if (vendor.legacyId != null) mapping[String(vendor.legacyId)] = String(vendor.id);
      return { ...vendor, id: String(vendor.id) };
    }
    const legacyId = String(vendor.id);
    mapping[legacyId] ||= crypto.randomUUID();
    return { ...vendor, id: mapping[legacyId], legacyId };
  });
  try {
    localStorage.setItem(STORAGE_ROOT + mapKey, JSON.stringify(mapping));
  } catch {
    throw new Error("Could not persist the vendor ID migration map locally.");
  }
  const vendorIdMap = new Map(Object.entries(mapping));
  return {
    ...datasets,
    vendors,
    budget: (datasets.budget || []).map((row) => ({
      ...row,
      vendorId: row.vendorId == null
        ? null
        : (vendorIdMap.get(String(row.vendorId)) || String(row.vendorId)),
    })),
  };
}

function canonicalDataset(key, rows) {
  return [...(rows || [])]
    .map((row) => ENTITIES[key].toDoc(row))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function clearLegacyData() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      // מפתחות ישנים בלבד – למפתחות המשויכים יש עוד שני מקטעים אחרי `wp:v1:`.
      if (k && k.startsWith(STORAGE_ROOT) && !k.slice(STORAGE_ROOT.length).includes(":")) {
        localStorage.removeItem(k);
      }
    }
  } catch {
    /* ignore */
  }
}

class ScreenErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Application screen render failed:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-slate-800">
        <h2 className="font-bold text-rose-800">לא ניתן להציג את המסך כרגע</h2>
        <p className="mt-1 text-sm text-rose-700">הנתונים לא נמחקו. נסו לטעון את המסך מחדש.</p>
        {import.meta.env.DEV && this.state.error && (
          <details className="mt-3 rounded-xl bg-white p-3 text-xs text-slate-700 ring-1 ring-rose-200">
            <summary className="cursor-pointer font-semibold">פרטי תקלה למפתח</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words">{this.state.error.name}: {this.state.error.message}</pre>
          </details>
        )}
        <button type="button" onClick={() => window.location.reload()} className="btn-secondary mt-3">טעינה מחדש</button>
      </div>
    );
  }
}

function CloudStatus({ status }) {
  const map = {
    connecting: { icon: Loader2, text: "מתחבר…", cls: "bg-slate-50 text-slate-500 ring-slate-200", spin: true },
    loading: { icon: Loader2, text: "טוען…", cls: "bg-slate-50 text-slate-500 ring-slate-200", spin: true },
    saving: { icon: Loader2, text: "שומר בענן…", cls: "bg-gold-50 text-gold-600 ring-gold-200", spin: true },
    synced: { icon: Cloud, text: "מסונכרן", cls: "bg-sage-50 text-sage-600 ring-sage-200" },
    error: { icon: CloudOff, text: "שגיאת סנכרון", cls: "bg-rose-50 text-rose-600 ring-rose-200" },
    off: { icon: CloudOff, text: "מקומי בלבד", cls: "bg-slate-50 text-slate-400 ring-slate-200" },
  };
  const s = map[status] ?? map.off;
  const Icon = s.icon;
  return (
    /*  הצ׳יפ היה `hidden sm:inline-flex` — כלומר בטלפון המשתמש לא ראה בכלל
     *  אם השינויים נשמרו או שהסנכרון נכשל, וזה בדיוק המסך שבו עובדים באולם.
     *  עכשיו הסמל תמיד גלוי, ורק הטקסט מוסתר במסכים צרים כדי לחסוך מקום.  */
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-medium ring-1 sm:px-3 ${s.cls}`}
      title={`סנכרון ענן בין המכשירים – ${s.text}`}
      aria-label={`מצב סנכרון: ${s.text}`}
    >
      <Icon size={13} className={s.spin ? "animate-spin" : ""} />
      <span className="hidden sm:inline">{s.text}</span>
    </span>
  );
}

/* =========================================================================
 *  AUTH / TENANT SHELL
 * ====================================================================== */

const INVITE_STORAGE_KEY = "wp:pendingInvite";

// A token redeems exactly once, so a re-run of the loading effect must share the first attempt.
const inviteAcceptances = new Map();
function acceptInviteOnce(token) {
  const existing = inviteAcceptances.get(token);
  if (existing) return { promise: existing, first: false };
  const promise = acceptInvite(token);
  inviteAcceptances.set(token, promise);
  promise.catch(() => inviteAcceptances.delete(token));
  return { promise, first: true };
}
/** התנתקות אוטומטית לאחר חוסר פעילות (דקות). */
const IDLE_LOGOUT_MINUTES = 30;

const ROLE_META = {
  owner: { label: "בעלים", icon: Crown, cls: "bg-gold-100 text-gold-700 ring-gold-300/60" },
  editor: { label: "עריכה", icon: Pencil, cls: "bg-sage-100 text-sage-700 ring-sage-300/60" },
  viewer: { label: "צפייה", icon: Eye, cls: "bg-slate-100 text-slate-600 ring-slate-300/60" },
};

function RoleBadge({ role }) {
  const meta = ROLE_META[role] ?? ROLE_META.viewer;
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${meta.cls}`}
    >
      <Icon size={11} />
      {meta.label}
    </span>
  );
}

/** קורא את ?invite=<token> מה-URL, שומר אותו ומנקה את שורת הכתובת. */
function captureInviteToken() {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("invite");
    if (!token) return;
    sessionStorage.setItem(INVITE_STORAGE_KEY, token);
    params.delete("invite");
    const qs = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash
    );
  } catch {
    /* ignore – sessionStorage blocked */
  }
}

// נקרא פעם אחת בטעינת המודול – לפני הרינדור הראשון, כדי ש-LoginScreen כבר
// יידע שיש הזמנה ממתינה ושהטוקן לא יישאר בשורת הכתובת (וב-history/logs).
captureInviteToken();

/*  טוקן איפוס הסיסמה מגיע ב-`?oobCode=` (Firebase) או ב-`?reset=`
    (קישורים ישנים שעוד בתוקף). שולפים אותו לזיכרון ומוחקים מיד
    משורת הכתובת, בדיוק כמו טוקן הזמנה: כתובות נשמרות בהיסטוריה,
    נשלחות ב-Referer ומופיעות בלוגים.  */
function captureAuthAction() {
  try {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode") || "";
    const oobCode = params.get("oobCode");
    const legacyReset = params.get("reset");
    const verifyEmail = mode === "verifyEmail" && oobCode;
    const resetPassword = (mode === "resetPassword" && oobCode) || (!mode && legacyReset);
    const token = verifyEmail ? oobCode : resetPassword ? (oobCode || legacyReset) : "";
    if (!token) return { resetToken: "", verifyToken: "" };
    const action = {
      resetToken: verifyEmail ? "" : token,
      verifyToken: verifyEmail ? token : "",
    };
    params.delete("oobCode");
    params.delete("reset");
    params.delete("mode");
    params.delete("apiKey");
    params.delete("lang");
    const qs = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash
    );
    return action;
  } catch {
    return { resetToken: "", verifyToken: "" };
  }
}

const INITIAL_AUTH_ACTION = captureAuthAction();

/*  מסך הטעינה של האפליקציה. הוא ממשיך ויזואלית את מסך הפתיחה שב-index.html,
    כך שהמעבר מה-HTML הסטטי ל-React אינו נראה כמו קפיצה. אחרי כמה שניות
    מתווספת הודעה שמסבירה למה זה לוקח זמן — השירות בענן נכבה כשאין פעילות,
    וההתעוררות שלו אורכת עשרות שניות. בלי ההסבר המשתמש חושב שהמערכת תקועה.
    הניסוח מדבר על "המערכת" ולא על "השרת", כי זה מונח שלא אומר כלום למי
    שרק רוצה לתכנן חתונה.  */
function BootScreen() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gradient-to-b from-white to-gold-50 px-6 text-center">
      <img src="/icon-192.png" alt="" className="h-16 w-16 rounded-2xl shadow-sm" />
      <Loader2 className="animate-spin text-gold-500" size={30} />
      <p className="text-lg font-bold text-slate-800">מכינים את החתונה שלכם…</p>
      <p className="max-w-sm text-sm leading-6 text-slate-500">
        {slow
          ? "המערכת מתעוררת אחרי תקופת חוסר פעילות. זה עשוי לקחת עד דקה בפעם הראשונה — אין צורך לרענן."
          : "רק רגע, טוענים את הנתונים."}
      </p>
    </div>
  );
}

async function signOutAndWipe() {
  try {
    await signOut();
  } finally {
    // אין להשאיר שמות וטלפונים של מוזמנים ב-localStorage אחרי יציאה.
    clearLocalAppData();
  }
}

function AppContent() {
  const [authReady, setAuthReady] = useState(!isCloudConfigured);
  const [session, setSession] = useState(null);
  const [resetToken, setResetToken] = useState(INITIAL_AUTH_ACTION.resetToken);
  const [verifyToken, setVerifyToken] = useState(INITIAL_AUTH_ACTION.verifyToken);

  useEffect(() => {
    if (!isCloudConfigured) return;
    let active = true;
    // העוגייה היא httpOnly, ולכן הדרך היחידה לדעת אם יש סשן היא לשאול את השרת.
    loadSession()
      .then((s) => {
        if (!active) return;
        setSession(s);
        setAuthReady(true);
      })
      .catch((err) => {
        console.error("Firebase Auth session restoration failed:", err);
        if (!active) return;
        setSession(null);
        setAuthReady(true);
      });
    const unsubscribe = onAuthChange((s) => setSession(s));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  //  מסך איפוס הסיסמה קודם לכל השאר, וגם לפני בדיקת הסשן: מי שהגיע
  //  מהקישור שבמייל רוצה לקבוע סיסמה חדשה גם אם במקרה עדיין יש לו סשן פתוח.
  if (isCloudConfigured && resetToken) {
    return (
      <ResetPasswordScreen token={resetToken} onDone={() => setResetToken("")} />
    );
  }

  if (isCloudConfigured && verifyToken) {
    return (
      <VerifyEmailScreen
        token={verifyToken}
        onDone={() => setVerifyToken("")}
      />
    );
  }

  if (isCloudConfigured && !authReady) {
    return <BootScreen />;
  }

  if (isCloudConfigured && !session) {
    return <LoginScreen />;
  }

  // מצב מקומי בלבד (ללא שרת): אין משתמש ואין חתונה – תחילית ה-localStorage
  // נשארת הישנה (`wp:v1:<key>`) וכל שכבת הענן מנוטרלת.
  if (!isCloudConfigured) {
    return (
      <StoragePrefixContext.Provider value={STORAGE_ROOT}>
        <WeddingApp session={null} weddingId={null} role="owner" weddings={[]} />
      </StoragePrefixContext.Provider>
    );
  }

  return <WeddingShell session={session} />;
}

export default function App() {
  return (
    <ScreenErrorBoundary>
      <AppContent />
    </ScreenErrorBoundary>
  );
}

/*  ולידציית מייל בצד הלקוח, למשוב מיידי בלבד. השרת בודק את אותו כלל שוב
    ב-`normalizeEmail`, והוא הקובע — בדיקה בדפדפן היא נוחות, לא אבטחה.  */
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const isValidEmail = (value) => EMAIL_RE.test(String(value).trim());

/*  שדה מייל אחיד לכל מסכי ההזדהות: אותה ולידציה, אותו dir="ltr", אותו
    autoComplete. בלי זה כל מסך היה מתנהג קצת אחרת.  */
function EmailField({ value, onChange, onBlur, label = "מייל", autoFocus = false, tourId }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <div
        data-tour={tourId}
        className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200 focus-within:ring-gold-400"
      >
        <Mail size={16} className="text-slate-400" />
        <input
          type="email"
          required
          autoFocus={autoFocus}
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className="w-full bg-transparent text-sm outline-none"
          placeholder="name@example.com"
          dir="ltr"
        />
      </div>
    </label>
  );
}

/*  מעטפת אחידה לשלושת מסכי ההזדהות (התחברות, שכחתי סיסמה, סיסמה חדשה),
    כדי שהמעבר ביניהם לא "יקפיץ" את העיצוב.  */
function AuthCard({ title, subtitle, onSubmit, children }) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-gradient-to-br from-gold-50 via-white to-sage-50 p-6">
      <form
        onSubmit={onSubmit}
        //  ולידציית הדפדפן מציגה הודעות באנגלית ובכיוון LTR, מה שנראה שבור
        //  במסך עברי. הבדיקות שלנו רצות בכל מקרה ב-submit ומציגות הודעה בעברית.
        noValidate
        className="my-auto w-full max-w-sm space-y-5 rounded-3xl bg-white/80 p-8 shadow-xl ring-1 ring-white/60 backdrop-blur-xl"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo className="h-32 w-32" rounded="rounded-3xl" />
          {/*  הלוגו כבר נושא את שם המערכת, ולכן הכותרת מוסתרת ויזואלית.
              היא נשארת בקוד כי היא ה-h1 היחיד במסך: בלעדיה קורא מסך
              מקבל טופס בלי שם, והלוגו עצמו מסומן aria-hidden.  */}
          <h1 className="sr-only">{title}</h1>
          <p className="text-xs text-slate-400">{subtitle}</p>
        </div>
        {children}
      </form>
    </div>
  );
}

function LoginScreen() {
  const hasInvite =
    typeof sessionStorage !== "undefined" &&
    !!sessionStorage.getItem(INVITE_STORAGE_KEY);
  //  מי שמגיע דרך קישור הזמנה עדיין אין לו חשבון, ולכן הוא נוחת ישר
  //  על ההרשמה. "התחברות" כברירת מחדל שידרה שיש להזין פרטים קיימים,
  //  ומי שקיבל את הקישור ניסה את הפרטים של מי ששלח אותו.
  const [mode, setMode] = useState(hasInvite ? "signup" : "signin"); // signin | signup | forgot
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [weddingDate, setWeddingDate] = useState("");
  const [partnerEmail, setPartnerEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyEmail] = useState(rememberedPasskeyEmail);
  //  האם האתגר כבר בידינו. כל עוד לא, לחיצה תמתין לרשת והכפתור אומר זאת.
  const [passkeyWarm, setPasskeyWarm] = useState(() => passkeyLoginWarm(passkeyEmail || undefined));
  //  ההדרכה אינה נפתחת לבד: השכבה שלה חוסמת את כפתור ההתחברות,
  //  ומשתמש חוזר שרק רוצה להתחבר נתקל במסך שנראה תקוע. הכפתור
  //  “הדרכה: איך פותחים חשבון” נשאר זמין למי שמעוניין.
  const [tourOn, setTourOn] = useState(false);
  //  זהות יציבה: הסיור מודד מחדש בכל שינוי של אובייקט השלב, ומערך
  //  חדש בכל רנדור היה מכניס אותו ללולאת מדידה אינסופית.
  const authSteps = useMemo(() => authTourSteps(setMode), []);

  function closeTour() {
    setTourOn(false);
    markGuideSeen("auth");
  }

  const signup = mode === "signup";
  const forgot = mode === "forgot";

  //  החימום עצמו כבר התחיל ב-main.jsx לפני שהרכיב הזה נטען. כאן רק
  //  מתעדכנים במצב, ומחממים מחדש אם המייל שבשדה שונה מזה שהוכן.
  const warmPasskey = useCallback((value) => {
    if (!passkeySupported()) return;
    setPasskeyWarm(passkeyLoginWarm(value));
    preparePasskeyLogin(value)
      .then(() => setPasskeyWarm(passkeyLoginWarm(value)))
      .catch(() => setPasskeyWarm(false));
  }, []);

  useEffect(() => {
    if (signup || forgot) return;
    warmPasskey(passkeyEmail || undefined);
  }, [forgot, passkeyEmail, signup, warmPasskey]);

  async function loginWithPasskey() {
    setError("");
    setPasskeyBusy(true);
    const target = email.trim() || passkeyEmail || undefined;
    try {
      await signInWithPasskey(target);
    } catch (err) {
      setError(passkeyErrorMessage(err));
      //  הכניסה צורכת את האתגר המוכן. בלי חימום מחדש ניסיון שני היה קר.
      warmPasskey(target);
    } finally {
      setPasskeyBusy(false);
    }
  }

  function switchMode(next) {
    setMode(next);
    setError("");
    setInfo("");
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setInfo("");
    const address = email.trim();
    if (!isValidEmail(address)) {
      setError("כתובת המייל אינה תקינה. לדוגמה: name@example.com");
      return;
    }
    if (!forgot && password.length < 8) {
      setError("הסיסמה חייבת להכיל לפחות 8 תווים.");
      return;
    }

    setBusy(true);
    try {
      if (forgot) {
        await requestPasswordReset(address);
        //  נוסח מכוון-מעורפל: השרת לא מסגיר אם הכתובת רשומה, ולכן גם
        //  ההודעה כאן לא יכולה לאשר זאת.
        setInfo(
          "אם הכתובת רשומה במערכת, נשלח אליה קישור לאיפוס הסיסמה. הקישור תקף לשעה."
        );
        setPassword("");
      } else if (signup) {
        //  הטוקן נשלח כבר בהרשמה כדי שהשרת לא יפתח למוזמן חתונה פרטית
        //  משלו. אם הצירוף הצליח מסירים אותו, אחרת הוא נשאר וה-effect
        //  שאחרי הכניסה ינסה שוב ויציג שגיאה מדויקת.
        const pendingInvite = sessionStorage.getItem(INVITE_STORAGE_KEY);
        //  מי שמצטרף לחתונה קיימת אינו הבעלים שלה, ולכן אין לו את מי לצרף.
        const partner = hasInvite ? null : partnerEmail.trim();
        if (partner && !isValidEmail(partner)) {
          setError("כתובת המייל של בן/בת הזוג אינה תקינה.");
          return;
        }
        if (partner && partner.toLowerCase() === address.toLowerCase()) {
          setError("מייל בן/בת הזוג חייב להיות שונה מהמייל שלכם.");
          return;
        }
        const res = await signUp(address, password, weddingDate || null, pendingInvite, partner);
        if (res?.joinedWeddingId) sessionStorage.removeItem(INVITE_STORAGE_KEY);
      } else {
        await signIn(address, password);
      }
      // ההרשמה מחברת מיד — אין אימות אימייל בשרת הזה.
      // onAuthChange כבר מעדכן את App, ולכן אין צורך לנווט ידנית.
    } catch (err) {
      setError(authErrorMessage(err, mode));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="תכנון החתונה שלנו"
      subtitle={
        forgot
          ? "נשלח קישור לאיפוס סיסמה"
          : hasInvite
            ? "הוזמנתם לחתונה משותפת"
            : signup
              ? "פתחו חשבון וקבלו חתונה משלכם"
              : "התחברו כדי לגשת לנתונים שלכם"
      }
      onSubmit={submit}
    >
      {hasInvite && (
        /*  הנוסח הקודם היה "התחברו או הירשמו עם אותה כתובת מייל שעבורה
            נוצרה ההזמנה" — וזה נקרא כאילו מדובר בכתובת של מי ששלח. ההרשאה
            המצומצמת נצמדת לחשבון של המוזמן, ולכן חייב להיות לו חשבון משלו;
            כניסה עם הפרטים של המזמין היא פשוט המזמין, עם גישה מלאה.  */
        <p className="rounded-lg bg-sage-50 px-3 py-2 text-xs text-sage-700 ring-1 ring-sage-200">
          <strong className="font-semibold">פתחו חשבון משלכם</strong> — עם המייל
          שלכם וסיסמה שאתם בוחרים. אל תשתמשו בפרטים של מי ששלח את הקישור: הם
          יכניסו אתכם כבעלים ולא לפי ההרשאה שניתנה לכם. יש לכם כבר חשבון?
          התחברו אליו והחתונה תתווסף אליו.
        </p>
      )}

      <EmailField
        value={email}
        onChange={setEmail}
        onBlur={() => {
          if (!signup && !forgot && email.trim()) {
            warmPasskey(email.trim());
          }
        }}
        tourId="auth-email"
      />

      {/*  מי שמצטרף לחתונה קיימת לא פותח חתונה משלו, ולכן שדה התאריך
          שלה רק מבלבל אותו.  */}
      {signup && !hasInvite && (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-500">תאריך החתונה</span>
          <div
            data-tour="auth-date"
            className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200 focus-within:ring-gold-400"
          >
            <CalendarDays size={16} className="text-slate-400" />
            <input
              type="date"
              value={weddingDate}
              onChange={(e) => setWeddingDate(e.target.value)}
              className="w-full bg-transparent text-sm outline-none"
              dir="ltr"
            />
          </div>
          <span className="block text-[11px] text-slate-400">
            עוד לא נקבע תאריך? אפשר לדלג ולהשלים בהמשך במסך "הגדרות החתונה".
          </span>
        </label>
      )}

      {!forgot && (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-500">סיסמה</span>
          <div
            data-tour="auth-password"
            className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200 focus-within:ring-gold-400"
          >
            <Lock size={16} className="text-slate-400" />
            <input
              type="password"
              required
              minLength={signup ? 8 : undefined}
              autoComplete={signup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-transparent text-sm outline-none"
              placeholder="••••••••"
              dir="ltr"
            />
          </div>
          {signup && (
            <span className="block text-[11px] text-slate-400">
              לפחות 8 תווים. אל תשתמשו בסיסמה שכבר בשימוש באתר אחר.
            </span>
          )}
        </label>
      )}

      {/*  צירוף בן/בת הזוג כבר בהרשמה חוסך את כל מסלול ההזמנה (קישור,
          מסירה, קבלה). מי שמצטרף לחתונה של מישהו אחר לא מצרף אף אחד.  */}
      {signup && !hasInvite && (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-500">
            מייל של בן/בת הזוג{" "}
            <span className="font-normal text-slate-400">(רשות)</span>
          </span>
          <div
            data-tour="auth-partner"
            className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200 focus-within:ring-gold-400"
          >
            <Heart size={16} className="text-slate-400" />
            <input
              type="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={partnerEmail}
              onChange={(e) => setPartnerEmail(e.target.value)}
              className="w-full bg-transparent text-sm outline-none"
              placeholder="name@example.com"
              dir="ltr"
            />
          </div>
          <span className="block text-[11px] text-slate-400">
            יישלח לכתובת קישור לקביעת סיסמה משלהם. לכל אחד מכם תהיה כניסה
            נפרדת — מייל וסיסמה שלו — לאותה חתונה. אפשר לדלג ולהוסיף
            בהמשך במסך "הגדרות החתונה".
          </span>
        </label>
      )}

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 ring-1 ring-rose-200">
          {error}
        </p>
      )}
      {info && (
        <p className="rounded-lg bg-sage-50 px-3 py-2 text-xs text-sage-700 ring-1 ring-sage-200">
          {info}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        data-tour="auth-submit"
        className="btn-primary min-h-11 w-full"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
        {forgot ? "שליחת קישור לאיפוס" : signup ? "הרשמה" : "התחברות"}
      </button>

      {!signup && !forgot && passkeySupported() && (
        <button
          type="button"
          onClick={loginWithPasskey}
          disabled={busy || passkeyBusy}
          className="btn-secondary w-full"
        >
          {passkeyBusy ? <Loader2 size={16} className="animate-spin" /> : <Fingerprint size={17} />}
          {/*  לחיצה לפני שהאתגר מוכן ממתינה לרשת. "מתחמם" אומר למשתמש
              שמשהו קורה, במקום ספינר כללי שנראה כמו מסך תקוע.  */}
          {passkeyBusy && !passkeyWarm ? "מתחמם…" : "כניסה מהירה עם Passkey"}
        </button>
      )}

      {/*  min-h-11: קישורי טקסט בגובה של שורה אחת קטנים מדי ללחיצה באצבע.  */}
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => switchMode(signup || forgot ? "signin" : "signup")}
          data-tour="auth-toggle"
          className="btn-secondary w-full text-xs"
        >
          {signup || forgot ? "יש לי כבר חשבון – להתחברות" : "אין לי חשבון – להרשמה"}
        </button>

        {!forgot && !signup && (
          <button
            type="button"
            onClick={() => switchMode("forgot")}
            className="btn-ghost w-full text-xs"
          >
            שכחתי סיסמה
          </button>
        )}

        {/*  ההדרכה נשארת זמינה גם אחרי שסגרו אותה פעם אחת — מי שחוזר
            אחרי חודשיים לא זוכר, ואין דרך אחרת להחזיר אותה במסך הזה.  */}
        <button
          type="button"
          onClick={() => setTourOn(true)}
          className="btn-ghost w-full text-xs"
        >
          <HelpCircle size={14} />
          הדרכה: איך פותחים חשבון
        </button>
      </div>

      {tourOn && <Tour steps={authSteps} onClose={closeTour} />}
    </AuthCard>
  );
}

/* -------------------------------------------------------------------------
 *  ResetPasswordScreen – נפתח כשיש `?reset=<token>` בכתובת, כלומר כשהמשתמש
 *  הגיע מהקישור שנשלח למייל. הטוקן עצמו הוא ההוכחה, ולכן אין כאן התחברות.
 * ---------------------------------------------------------------------- */
function ResetPasswordScreen({ token, onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [checkingLink, setCheckingLink] = useState(true);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    setCheckingLink(true);
    setResetEmail("");
    setError("");
    verifyPasswordResetCode(token)
      .then((email) => {
        if (active) setResetEmail(email);
      })
      .catch((err) => {
        if (active) setError(authErrorMessage(err, "reset"));
      })
      .finally(() => {
        if (active) setCheckingLink(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (checkingLink || !resetEmail) return;
    if (password.length < 8) {
      setError("הסיסמה חייבת להכיל לפחות 8 תווים.");
      return;
    }
    if (password !== confirm) {
      setError("שתי הסיסמאות אינן זהות.");
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(authErrorMessage(err, "reset"));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthCard
        title="הסיסמה עודכנה"
        subtitle="אפשר להתחבר עם הסיסמה החדשה"
        onSubmit={(e) => {
          e.preventDefault();
          onDone();
        }}
      >
        <p className="rounded-lg bg-sage-50 px-3 py-2 text-xs text-sage-700 ring-1 ring-sage-200">
          הסיסמה שונתה בהצלחה. מטעמי אבטחה נותקו כל החיבורים הקיימים לחשבון,
          כך שגם אם מישהו אחר היה מחובר — הוא כבר לא.
        </p>
        <button
          type="submit"
          className="btn-primary w-full"
        >
          <Lock size={16} /> למסך ההתחברות
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="קביעת סיסמה חדשה"
      subtitle={resetEmail ? `איפוס סיסמה עבור ${resetEmail}` : "בחרו סיסמה שלא השתמשתם בה באתר אחר"}
      onSubmit={submit}
    >
      {checkingLink && (
        <p role="status" className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-200">
          בודקים את קישור האיפוס…
        </p>
      )}
      {!checkingLink && !resetEmail && error && (
        <>
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 ring-1 ring-rose-200">
            {error}
          </p>
          <button type="button" onClick={onDone} className="btn-secondary w-full">
            חזרה למסך ההתחברות
          </button>
        </>
      )}
      {!checkingLink && resetEmail && (
        <>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-500">סיסמה חדשה</span>
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200 focus-within:ring-gold-400">
          <Lock size={16} className="text-slate-400" />
          <input
            type="password"
            required
            autoFocus
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-transparent text-sm outline-none"
            placeholder="••••••••"
            dir="ltr"
          />
        </div>
        <span className="block text-[11px] text-slate-400">לפחות 8 תווים.</span>
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-500">אימות סיסמה</span>
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200 focus-within:ring-gold-400">
          <Lock size={16} className="text-slate-400" />
          <input
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full bg-transparent text-sm outline-none"
            placeholder="••••••••"
            dir="ltr"
          />
        </div>
      </label>

      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 ring-1 ring-rose-200">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || checkingLink}
        className="btn-primary w-full"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
        עדכון הסיסמה
      </button>

      <button
        type="button"
        onClick={onDone}
        className="w-full text-center text-xs font-medium text-slate-500 underline-offset-4 transition hover:text-gold-600 hover:underline"
      >
        ביטול, חזרה למסך ההתחברות
      </button>
        </>
      )}
    </AuthCard>
  );
}

function VerifyEmailScreen({ token, onDone }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function verify() {
    setBusy(true);
    setError("");
    try {
      await verifyEmailActionCode(token);
      setDone(true);
    } catch (err) {
      console.error("Email verification failed:", err);
      setError("קישור האימות אינו תקף או שפג תוקפו. בקשו קישור חדש.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="אימות כתובת המייל"
      subtitle={done ? "הכתובת אומתה בהצלחה" : "אשרו שהכתובת הזו שייכת לכם"}
      onSubmit={(event) => {
        event.preventDefault();
        if (done) onDone();
        else verify();
      }}
    >
      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 ring-1 ring-rose-200">
          {error}
        </p>
      )}
      {done ? (
        <>
          <p className="rounded-lg bg-sage-50 px-3 py-2 text-xs text-sage-700 ring-1 ring-sage-200">
            כתובת המייל אומתה. אפשר לחזור לאפליקציה ולהתחבר.
          </p>
          <button type="submit" className="btn-primary w-full">
            המשך לאפליקציה
          </button>
        </>
      ) : (
        <>
          <p className="text-center text-sm leading-6 text-slate-600">
            אימות המייל נדרש כדי לצרף חשבון קיים לחתונה משותפת.
          </p>
          <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-60">
            {busy && <Loader2 size={16} className="animate-spin" />}
            אימות כתובת המייל
          </button>
        </>
      )}
    </AuthCard>
  );
}

/* -------------------------------------------------------------------------
 *  WeddingShell – טוען את רשימת החתונות של המשתמש, מטפל בהזמנה ממתינה
 *  ובוחר את החתונה הפעילה. מרנדר את WeddingApp עם key ייחודי לכל צירוף
 *  משתמש+חתונה, כך שכל המצב (וה-localStorage שמאחוריו) מתאפס בהחלפה.
 * ---------------------------------------------------------------------- */
function WeddingShell({ session }) {
  const userId = session.user.id;
  const activeKey = `${STORAGE_ROOT}${userId}:activeWeddingId`;

  const [weddings, setWeddings] = useState(null); // null = טוען
  const [activeWeddingId, setActiveWeddingId] = useState(() => {
    try {
      return localStorage.getItem(activeKey);
    } catch {
      return null;
    }
  });
  const [error, setError] = useState("");
  //  קלאסטר שנרדם מחוסר תנועה מחזיר שגיאה על הבקשה הראשונה ועונה כרגיל
  //  על השנייה. בלי הניסיון החוזר המשתמש נתקע במסך שגיאה שהמוצא היחיד
  //  ממנו הוא יציאה מהחשבון — והוא לא אמור לדעת שמדובר במסד שמתעורר.
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);

  const retry = useCallback(() => {
    setError("");
    setWeddings(null);
    setAttempt((n) => n + 1);
  }, []);

  const refreshWeddings = useCallback(async () => {
    const list = await listWeddings();
    setWeddings(list);
    return list;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    (async () => {
      try {
        let target = null;
        const token = sessionStorage.getItem(INVITE_STORAGE_KEY);
        if (token) {
          const { promise, first } = acceptInviteOnce(token);
          try {
            target = await promise;
            sessionStorage.removeItem(INVITE_STORAGE_KEY);
            if (first) notify("ההזמנה התקבלה – החתונה נוספה לרשימה שלך", { tone: "success" });
          } catch (err) {
            if (first) notify(inviteErrorMessage(err), { tone: "error", duration: 10000 });
          }
        } else {
          try {
            await ensureMyWedding();
          } catch (err) {
            // Keep the signed-in flow recoverable; the create-wedding screen remains available.
            console.error("Account setup recovery failed:", err);
          }
        }
        //  קוראים ישירות ולא דרך refreshWeddings, כדי ששתי ההשמות — הרשימה
        //  והחתונה הפעילה — יקרו יחד ואחרי בדיקת הביטול. אחרת הרשימה נקבעת
        //  גם בריצה מבוטלת בזמן שהמזהה הפעיל נשאר ריק, ומסך "בואו ניצור את
        //  החתונה שלכם" מהבהב למי שכבר יש לו חתונה.
        const list = await listWeddings();
        if (cancelled) return;
        setRetrying(false);
        setWeddings(list);
        setActiveWeddingId((cur) => {
          if (target && list.some((w) => w.id === target)) return target;
          if (cur && list.some((w) => w.id === cur)) return cur;
          return list[0]?.id ?? null;
        });
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to load weddings:", err);

        //  שלושה ניסיונות אוטומטיים לפני שמוויתרים ומציגים מסך. זמן ההמתנה
        //  גדל בכל סבב, כדי לכסות גם שרת שעולה משינה וגם מסד שמתעורר.
        const transient =
          err?.status === 503 ||
          err?.status === 502 ||
          err?.status === 504 ||
          err?.code === "network_error" ||
          err?.code === "timeout";

        if (transient && attempt < 3) {
          setRetrying(true);
          timer = setTimeout(() => setAttempt((n) => n + 1), 2000 * 2 ** attempt);
          return;
        }

        setRetrying(false);
        setError(
          transient
            ? "המערכת עדיין מתעוררת. המתינו רגע ונסו שוב."
            : "טעינת רשימת החתונות נכשלה. נסו שוב."
        );
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    //  attempt בכוונה ברשימה — הגדלתו היא שמפעילה ניסיון טעינה נוסף.
  }, [attempt]);

  useEffect(() => {
    try {
      if (activeWeddingId) localStorage.setItem(activeKey, activeWeddingId);
    } catch {
      /* ignore */
    }
  }, [activeKey, activeWeddingId]);

  const handleCreateWedding = useCallback(
    async (name, date) => {
      const w = await createWedding(name, date);
      await refreshWeddings();
      setActiveWeddingId(w.id);
      return w;
    },
    [refreshWeddings]
  );

  const handleDeleteWedding = useCallback(async (weddingId, confirmationName) => {
    await deleteWedding(weddingId, confirmationName);
    const list = await listWeddings();
    setWeddings(list);
    setActiveWeddingId(list[0]?.id ?? null);
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <CloudOff className="text-rose-400" size={32} />
        <p className="text-sm text-slate-600">{error}</p>
        <div className="flex items-center gap-2">
          <button
            onClick={retry}
            className="btn-primary"
          >
            נסו שוב
          </button>
          <button
            onClick={signOutAndWipe}
            className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200"
          >
            יציאה
          </button>
        </div>
      </div>
    );
  }

  if (weddings === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <Loader2 className="animate-spin text-gold-500" size={32} />
        {retrying && (
          <p className="text-xs text-slate-400">המערכת מתעוררת, עוד רגע…</p>
        )}
      </div>
    );
  }

  const activeWedding = weddings.find((w) => w.id === activeWeddingId) ?? null;

  if (!activeWedding) {
    return <NoWeddingScreen onCreate={handleCreateWedding} />;
  }

  return (
    <StoragePrefixContext.Provider
      value={scopedPrefix(userId, activeWedding.id)}
    >
      <WeddingApp
        key={`${userId}:${activeWedding.id}`}
        session={session}
        weddingId={activeWedding.id}
        role={activeWedding.role}
        scopes={activeWedding.scopes}
        weddings={weddings}
        activeWedding={activeWedding}
        onSwitchWedding={setActiveWeddingId}
        onCreateWedding={handleCreateWedding}
        onWeddingChanged={refreshWeddings}
        onDeleteWedding={handleDeleteWedding}
      />
    </StoragePrefixContext.Provider>
  );
}

function inviteErrorMessage(err) {
  const msg = String(err?.message || err);
  if (msg.includes("invite_expired")) return "ההזמנה פגה. בקשו קישור חדש.";
  if (msg.includes("invite_already_used")) return "ההזמנה כבר נוצלה.";
  if (msg.includes("invite_email_mismatch"))
    return "ההזמנה נוצרה עבור כתובת מייל אחרת. התחברו עם הכתובת שעבורה נוצרה.";
  if (msg.includes("invite_email_unverified"))
    return "צריך לאמת את כתובת המייל לפני קבלת ההזמנה. אמתו אותה דרך הקישור שנשלח אליכם, ואז רעננו את הדף; ההזמנה נשמרה.";
  if (msg.includes("invite_not_found")) return "קישור ההזמנה אינו תקין.";
  return "קבלת ההזמנה נכשלה.";
}

/** מסך ביניים – אין למשתמש אף חתונה (למשל אם הטריגר ב-DB לא רץ). */
function NoWeddingScreen({ onCreate }) {
  const [name, setName] = useState("החתונה שלי");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await onCreate(name, date || null);
    } catch (err) {
      console.error(err);
      notify("יצירת החתונה נכשלה", { tone: "error" });
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gold-50 via-white to-sage-50 p-6">
      <ToastHost />
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-3xl bg-white/80 p-8 shadow-xl ring-1 ring-white/60 backdrop-blur-xl"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <Logo className="h-24 w-24" rounded="rounded-3xl" />
          <h1 className="font-display text-xl font-bold text-slate-800">
            בואו ניצור את החתונה שלכם
          </h1>
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-500">שם החתונה</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl bg-white px-3 py-2.5 text-sm outline-none ring-1 ring-slate-200 focus:ring-gold-400"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-500">תאריך (אופציונלי)</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl bg-white px-3 py-2.5 text-sm outline-none ring-1 ring-slate-200 focus:ring-gold-400"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="btn-primary w-full"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          יצירת חתונה
        </button>
        <button
          type="button"
          onClick={signOutAndWipe}
          className="w-full text-center text-xs font-medium text-slate-500 transition hover:text-gold-600"
        >
          יציאה מהחשבון
        </button>
      </form>
    </div>
  );
}

function WeddingApp({
  session,
  weddingId = null,
  role = "owner",
  scopes = ["all"],
  weddings = [],
  activeWedding = null,
  onSwitchWedding,
  onCreateWedding,
  onWeddingChanged,
  onDeleteWedding,
}) {
  //  הניווט מסונן לפי ההיקף, והמסך הפעיל חייב להיות אחד מהמסכים המותרים.
  const adminAllowed = !!session?.user?.emailVerified && isAdminEmail(session?.user?.email);
  const navItems = useMemo(() => {
    const items = navForScopes(scopes);
    return adminAllowed
      ? [...items, { key: "admin", label: "ניהול מערכת", icon: ShieldCheck, scope: null }]
      : items;
  }, [scopes, adminAllowed]);
  const [requestedView, setActive] = useState(
    () => navForScopes(scopes)[0]?.key ?? "guests"
  );
  //  אם ההרשאות צומצמו בזמן שהמסך פתוח, נופלים חזרה למסך המותר הראשון
  //  במקום להציג עמוד ריק. גזירה ולא useEffect — בלי רינדור מיותר.
  const active = navItems.some((n) => n.key === requestedView)
    ? requestedView
    : navItems[0]?.key ?? "guests";
  //  לחיצה על ספק בדאשבורד מעבירה למסך הספקים ופותחת בדיוק את אותו ספק,
  //  במקום לזרוק את המשתמש לספק הראשון ולתת לו לחפש שוב את מי שלחץ עליו.
  const [vendorFocusId, setVendorFocusId] = useState(null);
  const canOpenVendors = navItems.some((n) => n.key === "vendors");
  const openVendor = useCallback((id) => {
    setVendorFocusId(id);
    setActive("vendors");
  }, []);
  //  ברגע שיוצאים ממסך הספקים הבחירה שהגיעה מהדאשבורד כבר לא רלוונטית.
  //  בלי האיפוס הזה כניסה מאוחרת למסך הספקים מהתפריט הייתה פותחת שוב את
  //  הספק שנלחץ פעם, במקום את הראשון ברשימה.
  const goTo = useCallback((key) => {
    setActive(key);
    if (key !== "vendors") setVendorFocusId(null);
  }, []);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useDrawerSwipe(sidebarOpen, setSidebarOpen);
  const [membersOpen, setMembersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => window.matchMedia("(max-width: 1023px)").matches
  );
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = (event) => setIsMobileViewport(event.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  //  הדרכה: הסיור עולה לבד פעם אחת בחשבון, וההסבר בראש המסך נשאר עד
  //  שמסתירים אותו — לכל מסך בנפרד, כי כל מסך נלמד בזמן אחר.
  const [tourOn, setTourOn] = useState(false);
  const [tourInviteDismissed, setTourInviteDismissed] = usePersistentState("tourInviteDismissed", false);
  function startTour() {
    setTourInviteDismissed(true);
    setTourOn(true);
  }

  async function resendVerificationEmail() {
    setVerificationBusy(true);
    try {
      await requestEmailVerification();
      setVerificationSent(true);
    } catch (err) {
      console.error("Failed to resend verification email:", err);
      notify("לא ניתן לשלוח כרגע. נסו שוב בעוד כמה דקות.", { tone: "error" });
    } finally {
      setVerificationBusy(false);
    }
  }
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistentState(
    "sidebarCollapsed",
    false
  );
  const backupInputRef = useRef(null);
  //  תפריט "גיבוי" מציע שתי פעולות שונות (JSON לשחזור, אקסל לקריאה), ולכן
  //  הוא נפתח כרשימה במקום להעמיס עוד כפתור על הכותרת הצפופה.
  const backupMenuRef = useRef(null);
  const [backupMenuOpen, setBackupMenuOpen] = useState(false);
  useEffect(() => {
    if (!backupMenuOpen) return;
    const onDown = (e) => {
      if (!backupMenuRef.current?.contains(e.target)) setBackupMenuOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setBackupMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [backupMenuOpen]);
  const [savedAt, setSavedAt] = useState(null);

  const cloudEnabled = isCloudConfigured && !!session && !!weddingId;
  const canEdit = role !== "viewer";
  const isOwner = role === "owner";
  const fullScope = isFullScope(scopes);

  useEffect(() => {
    if (!cloudEnabled || typeof weddingId !== "string" || !weddingId.trim() || !session?.user?.id) return undefined;
    let cancelled = false;
    waitForAuthContext(session.user.id)
      .then(() => {
        if (!cancelled) return touchMembership(weddingId);
        return undefined;
      })
      .catch((error) => {
        console.error("Failed to update wedding lastSeenAt:", {
          weddingId,
          userId: session.user.id,
          code: error?.code,
          error,
        });
      });
    return () => { cancelled = true; };
  }, [cloudEnabled, weddingId, session?.user?.id]);

  /*  הסיור נבנה לפי מה שהמשתמש הזה באמת רואה ורשאי לעשות.
      בלי זה צופה קיבל הדרכה על הוספת מוזמנים ועריכת תקציב,
      ושלבים שהצביעו על לשוניות שאינן קיימות בהיקף שלו.  */
  const showBackup = fullScope || (isCloudConfigured && !!session);
  const navKeys = useMemo(() => navItems.map((n) => n.key), [navItems]);

  //  האם מותר לסנכרן ענן עבור dataset מסוים? כתיבה מחוץ להיקף תיחסם ב-RLS
  //  ותחזיר 403, ולכן אין טעם אפילו לנסות.
  const mayGuests = hasScope(scopes, "guests");
  const mayVendors = hasScope(scopes, "vendors");
  const mayFinance = hasScope(scopes, "finance");
  const mayChecklist = hasScope(scopes, "checklist");

  //  תאריך החתונה מגיע מה-DB כמחרוזת 'YYYY-MM-DD'. מקבעים 19:00 מקומי כשעת
  //  האירוע כדי שהספירה לאחור לא תסתיים בחצות של אותו יום.
  const weddingDate = useMemo(() => {
    const raw = activeWedding?.weddingDate;
    if (!raw) return null;
    const [y, m, d] = String(raw).slice(0, 10).split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, 19, 0, 0);
  }, [activeWedding?.weddingDate]);

  // האם ה-scope הזה היה ריק ברגע הטעינה? נקבע פעם אחת, לפני ש-usePersistentState
  // מספיק לכתוב את ברירות המחדל (debounce של 400ms).
  const scopeWasEmptyRef = useRef(readLegacyDatasets() !== null);

  // במצב ענן ה-DB הוא מקור האמת: חתונה חדשה מתחילה ריקה ולא עם נתוני הדגמה.
  const [guests, setGuests] = usePersistentState(
    "guests",
    cloudEnabled ? [] : SEED_GUESTS
  );
  const [tables, setTables] = usePersistentState(
    "tables",
    cloudEnabled ? [] : SEED_TABLES
  );
  const [vendors, setVendors] = usePersistentState(
    "vendors",
    cloudEnabled ? [] : SEED_VENDORS
  );
  const tourSteps = useMemo(
    () =>
      appTourSteps({
        setSidebarOpen,
        canEdit,
        isOwner,
        navKeys,
        showBackup,
        currentScreen: active,
        isMobile: isMobileViewport,
        hasVendors: vendors.length > 0,
        canTransferBudget: canEdit && hasScope(scopes, "finance"),
      }),
    [active, canEdit, isMobileViewport, isOwner, navKeys, scopes, showBackup, vendors.length]
  );
  //  התקציב חייב להתנהג כמו שאר המערכים: במצב ענן ה-DB הוא מקור האמת, ואסור
  //  שחתונה חדשה תיזרע בסעיפי ההדגמה — הם מוצגים למשתמש כאילו הם שלו.
  const [budget, setBudget] = usePersistentState(
    "budget",
    cloudEnabled ? [] : SEED_BUDGET
  );
  //  הצ׳קליסט מתחיל ריק תמיד, גם ללא ענן: הרשימה המומלצת נטענת
  //  בלחיצה מפורשת במסך ולא נדחפת לאיש לחשבון.
  const [checklist, setChecklist] = usePersistentState("checklist", []);
  const [storedChecklistOptions, setChecklistOptions] = usePersistentState("checklistOptions", DEFAULT_CHECKLIST_OPTIONS);
  const checklistOptions = useMemo(() => normalizeChecklistOptions(storedChecklistOptions), [storedChecklistOptions]);
  const checklistOptionsSavedRef = useRef(null);
  const datasetStateRef = useRef({ guests, tables, vendors, budget, checklist });
  const baselineRowsRef = useRef({
    guests: new Map(),
    tables: new Map(),
    vendors: new Map(),
    budget: new Map(),
    checklist: new Map(),
  });
  const restoreIntentRef = useRef(new Set());
  useEffect(() => {
    datasetStateRef.current = { guests, tables, vendors, budget, checklist };
  }, [guests, tables, vendors, budget, checklist]);
  const [budgetGoal, setBudgetGoal] = usePersistentState(
    "budgetGoal",
    cloudEnabled ? 0 : SEED_BUDGET.reduce((s, b) => s + b.expected, 0)
  );
  const [financeLabels, setFinanceLabels] = usePersistentState(
    "financeLabels",
    {}
  );
  /*  קטגוריות המוזמנים הן נתון של החתונה, לא של המערכת. רשימת הזרעים
      שייכת לחתונה אחת מסוימת, וכל חשבון חדש קיבל אותה כאילו היא שלו.
      במצב ענן מתחילים ריק והמשתמש בונה את הקטגוריות שלו במסך "קטגוריות".  */
  const [categories, setCategories] = usePersistentState(
    "categories",
    cloudEnabled ? [] : GUEST_CATEGORIES
  );
  //  מחשבון האלכוהול הוא נתון של החתונה, כמו הקטגוריות: נשמר בענן כדי שגם
  //  בן/בת הזוג יראו אותו. עד שהוא נטען משם ההתחלה היא מה שכבר נשמר בדפדפן הזה.
  const storagePrefix = useContext(StoragePrefixContext);
  const initialAlcohol = useMemo(
    () => readLocalAlcohol(storagePrefix) ?? ALCOHOL_DEFAULTS,
    [storagePrefix]
  );
  const [alcohol, setAlcohol] = usePersistentState("alcoholCalc", initialAlcohol);
  const alcoholSyncedRef = useRef(null);
  //  שמות בני הזוג. במצב ענן הם חיים על רשומת החתונה עצמה, ולכן הם מסתנכרנים
  //  בין מכשירים ונראים גם למי שהחתונה שותפה איתו. במצב localStorage בלבד אין
  //  רשומת חתונה, ולכן נשמרת ברירת המחדל ההיסטורית של הדמו.
  const [localCouple, setLocalCouple] = usePersistentState(
    "couple",
    cloudEnabled ? { partnerA: "", partnerB: "" } : COUPLE
  );
  const couple = cloudEnabled
    ? {
        partnerA: activeWedding?.partnerA || "",
        partnerB: activeWedding?.partnerB || "",
      }
    : localCouple;
  const coupleTitle = coupleToTitle(couple);
  const [countdownBackgroundUrl, setCountdownBackgroundUrl] = useState("");

  const handleCountdownBackgroundChange = useCallback(
    async (file) => {
      if (!cloudEnabled || !isOwner) return;
      try {
        const url = await uploadCountdownBackground(weddingId, file);
        setCountdownBackgroundUrl(url);
        notify("תמונת הרקע עודכנה", { tone: "success" });
      } catch (err) {
        console.error("Countdown background upload failed:", err);
        notify(
          err?.message === "file_too_large"
            ? "התמונה גדולה מדי (מקסימום 8MB)."
            : "העלאת תמונת הרקע נכשלה. נסו שוב.",
          { tone: "error" }
        );
      }
    },
    [cloudEnabled, isOwner, weddingId]
  );

  //  פרטי היסוד של החתונה נשמרים יחד בפעולה אחת מתוך מסך ההגדרות. שליחה אחת
  //  ולא שתיים מונעת מצב ביניים שבו נשמרו השמות אבל התאריך נכשל.
  const saveWeddingBasics = useCallback(
    async ({ partnerA, partnerB, date }) => {
      if (!cloudEnabled || !activeWedding) {
        setLocalCouple({ partnerA, partnerB });
        return;
      }
      await updateWedding(activeWedding.id, {
        partnerA,
        partnerB,
        date: date || null,
      });
      await onWeddingChanged?.();
    },
    [cloudEnabled, activeWedding, onWeddingChanged, setLocalCouple]
  );

  const saveBudgetGoal = useCallback(async (value) => {
    if (cloudEnabled && weddingId) {
      await saveWeddingSettings(weddingId, { budgetGoal: value });
    }
    setBudgetGoal(value);
  }, [cloudEnabled, weddingId, setBudgetGoal]);

  // --- Cloud sync (Supabase) ---
  const [cloudStatus, setCloudStatus] = useState(
    isCloudConfigured ? "connecting" : "off"
  );
  const [cloudReady, setCloudReady] = useState(false);
  const [initialLoadAttempt, setInitialLoadAttempt] = useState(0);

  const cloudReadyRef = useRef(false);
  const settingsReadyRef = useRef(false);
  const prevIdsRef = useRef({
    guests: new Set(),
    tables: new Set(),
    vendors: new Set(),
    budget: new Set(),
    checklist: new Set(),
  });

  /*  כישלון סנכרון חייב לנסות שוב מעצמו. בלי זה, שינוי שנכשל (שרת עמוס,
   *  ניתוק רגעי, התנגשות טרנזקציות) נשאר רק ב-localStorage — ובטעינה הבאה
   *  הענן דורס את המצב המקומי, כלומר אובדן נתונים שקט שהמשתמש לא רואה.
   *  הטיימר יחיד בכוונה: כל חמשת הסנכרונים חולקים אותו וניסיון אחד מכסה הכול.  */
  const [syncRetry, setSyncRetry] = useState(0);
  const retryTimerRef = useRef(null);
  const scheduleSyncRetry = useCallback(() => {
    if (retryTimerRef.current) return;
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      setSyncRetry((n) => n + 1);
    }, 5000);
  }, []);
  const handleSyncFailure = useCallback((dataset, err) => {
    console.error(`Cloud sync failed (${dataset}):`, err);
    setCloudStatus("error");
    if (err?.code === "sync_conflict") {
      notify(
        "רשומה זו השתנתה במכשיר אחר. השינוי המקומי לא נכתב כדי לא לדרוס נתונים; העתיקו אותו לפני רענון.",
        { tone: "error", duration: 12_000 }
      );
      return;
    }
    scheduleSyncRetry();
  }, [scheduleSyncRetry]);

  /*  תור סדרתי לכל הסנכרונים. ארבעת ה-effects נדלקים באותו רגע ושולחים
   *  בקשות במקביל, וסעיף תקציב שמצביע על ספק היה יכול להגיע לשרת לפני הספק
   *  עצמו. התור מבטיח סדר קבוע — לפי סדר ה-effects בקובץ — ומונע גם עומס
   *  של ארבע בקשות בו-זמנית על תוכנית חינמית.  */
  const syncChainRef = useRef(Promise.resolve());
  const enqueueSync = useCallback((task) => {
    const run = syncChainRef.current.then(task, task);
    //  שרשרת התור לא נשברת מכישלון של משימה בודדת: כל אחת מטפלת בשגיאה
    //  שלה בעצמה, וכאן רק בולעים כדי שלא ייווצר unhandled rejection.
    syncChainRef.current = run.catch(() => {});
    return run;
  }, []);

  // Initial cloud load: seed an empty wedding from local data, then pull the truth.
  useEffect(() => {
    if (
      !cloudEnabled ||
      typeof weddingId !== "string" ||
      !weddingId.trim() ||
      !session?.user?.id
    ) return;
    let cancelled = false;
    let retryTimer = null;
    cloudReadyRef.current = false;
    settingsReadyRef.current = false;
    (async () => {
      try {
        await waitForAuthContext(session.user.id);
        if (cancelled) return;
        setCloudStatus("loading");
        if (isOwner) {
          //  מיגרציית מזהי-הספקים היא חד-פעמית ואינה תנאי לטעינת שאר הנתונים;
          //  כשל כאן לא יפיל את כל הטעינה למסך "הסנכרון נכשל" — הוא נרשם
          //  וינוסה שוב בטעינה הבאה (כתיבות ספקים ממילא מאומתות בכללי האבטחה).
          try {
            await migrateVendorIds(weddingId);
          } catch (err) {
            console.warn("Vendor UUID migration deferred:", err?.code || err);
          }
        }
        // זריעה רק כשיש מה להעלות מהמכשיר (שדרוג ממצב מקומי), ורק לבעלים
        // עם גישה מלאה — למי ששותף לו מסך בודד אין מה לזרוע.
        if (isOwner && fullScope) {
          const migrationKey = `legacy-migration-pending-${weddingId}`;
          const migrationPending = loadStored(STORAGE_ROOT, migrationKey, false) === true;
          const cloudEmpty = await cloudIsEmpty(weddingId);
          const legacy = (scopeWasEmptyRef.current || migrationPending)
            ? readLegacyDatasets()
            : null;
          if (cloudEmpty || migrationPending) {
          let datasets = { guests, tables, vendors, budget, checklist };
          let acceptedLegacy = migrationPending ? legacy : null;

          // שדרוג ממצב מקומי בלבד: הנתונים שמורים תחת התחילית הישנה, ללא
          // שיוך למשתמש. מייבאים רק באישור מפורש – ייתכן שהם של אדם אחר.
          if (legacy && !migrationPending) {
            const ok = await confirmDialog({
              title: "נמצאו נתונים שמורים בדפדפן",
              message:
                `נמצאו ${legacy.total} רשומות שנשמרו במכשיר הזה לפני החיבור לחשבון.\n\n` +
                `לייבא אותן לחתונה "${activeWedding?.name ?? ""}"?\n` +
                "אם המכשיר משותף וייתכן שהנתונים אינם שלכם – בחרו 'התחל ריק'.",
              confirmLabel: "ייבוא הנתונים",
              cancelLabel: "התחל ריק",
            });
            if (cancelled) return;
            if (ok) {
              localStorage.setItem(STORAGE_ROOT + migrationKey, JSON.stringify(true));
              datasets = normalizeLegacyVendorIds(weddingId, {
                ...datasets,
                ...legacy.datasets,
              });
              acceptedLegacy = legacy;
            }
          }

          if (migrationPending && legacy) {
            datasets = normalizeLegacyVendorIds(weddingId, {
              ...datasets,
              ...legacy.datasets,
            });
          }

          const hasSomething = Object.values(datasets).some((d) => d.length);
          if (hasSomething) datasets = await cloudSeed(weddingId, datasets);

          if (acceptedLegacy) {
            const legacySettings = acceptedLegacy.settings || {};
            const scopedSettings = Object.fromEntries(
              Object.entries(legacySettings).filter(([key]) =>
                ["budgetGoal", "financeLabels", "categories", "countdownBackgroundUrl"].includes(key)
              )
            );
            if (Object.keys(scopedSettings).length) {
              await saveWeddingSettings(weddingId, scopedSettings);
            }

            const oldCouple = legacySettings.couple;
            if (oldCouple && typeof oldCouple === "object") {
              await saveWeddingBasics({
                partnerA: String(oldCouple.partnerA || ""),
                partnerB: String(oldCouple.partnerB || ""),
                date: legacySettings.weddingDate ?? activeWedding?.weddingDate ?? null,
              });
            } else if (legacySettings.weddingDate) {
              await saveWeddingBasics({
                partnerA: couple.partnerA,
                partnerB: couple.partnerB,
                date: legacySettings.weddingDate,
              });
            }

            const verified = await cloudFetchAll(weddingId, { scopes, isOwner });
            for (const key of Object.keys(ENTITIES)) {
              if (
                JSON.stringify(canonicalDataset(key, verified[key])) !==
                JSON.stringify(canonicalDataset(key, datasets[key]))
              ) {
                throw new Error(`Legacy migration verification failed for ${key}`);
              }
            }
            for (const [key, value] of Object.entries(scopedSettings)) {
              if (JSON.stringify(verified.settings?.[key]) !== JSON.stringify(value)) {
                throw new Error(`Legacy migration verification failed for settings.${key}`);
              }
            }
            if (oldCouple) {
              const refreshedWeddings = await listWeddings();
              const savedWedding = refreshedWeddings.find((item) => item.id === weddingId);
              if (
                !savedWedding ||
                savedWedding.partnerA !== String(oldCouple.partnerA || "") ||
                savedWedding.partnerB !== String(oldCouple.partnerB || "") ||
                (legacySettings.weddingDate != null &&
                  String(savedWedding.weddingDate || "").slice(0, 10) !==
                    String(legacySettings.weddingDate).slice(0, 10))
              ) {
                throw new Error("Legacy migration verification failed for couple names");
              }
            }

            clearLegacyData();
          }
          }
        }
        const data = await cloudFetchAll(weddingId, { scopes, isOwner });
        if (cancelled) return;
        setGuests(data.guests);
        setTables(data.tables);
        setVendors(data.vendors);
        setChecklist(data.checklist);
        //  השלמה חד-פעמית: חתונות שנוצרו לפני הקישור לתקציב מחזיקות
        //  ספקים בלי סעיף משלהם. מותנה בהרשאה לשני המסכים: למי ששותף
        //  לו מסך בודד רשימת הספקים מגיעה ריקה, והשלמה על סמך רשימה
        //  ריקה הייתה מוחקת לבעלים את כל סעיפי הספקים בתקציב.
        setBudget(
          canEdit && mayVendors && mayFinance
            ? reconcileVendorBudgetRows(data.budget, data.vendors)
            : data.budget
        );
        //  הגדרות החתונה (יעד תקציב, קטגוריות, כותרות מסך התקציב) חיות ב-DB
        //  ולא ב-localStorage, אחרת הן נמחקות בכל יציאה מהמערכת ולא קיימות
        //  במכשיר אחר. מחילים רק מפתחות שקיימים בפועל, כדי שחתונה חדשה תישאר
        //  עם ברירות המחדל במקום להתאפס לערכים ריקים.
        const s = data.settings || {};
        if (typeof s.budgetGoal === "number") setBudgetGoal(s.budgetGoal);
        if (s.financeLabels) setFinanceLabels(s.financeLabels);
        setCountdownBackgroundUrl(s.countdownBackgroundUrl || "");
        //  גם רשימה ריקה היא ערך תקף — משתמש שמחק את כל הקטגוריות שלו
        //  לא אמור לקבל בחזרה את ברירת המחדל בטעינה הבאה.
        if (Array.isArray(s.categories)) setCategories(s.categories);
        if (s.checklistOptions && mayChecklist) {
          const loadedOptions = normalizeChecklistOptions(s.checklistOptions);
          checklistOptionsSavedRef.current = JSON.stringify(loadedOptions);
          setChecklistOptions(loadedOptions);
        }
        if (mayGuests) {
          //  מה שבענן הוא מקור האמת. כשאין שם כלום, מי שרשאי לערוך מעלה את מה
          //  שכבר הזין בדפדפן, כדי ששותף שייכנס אחר כך יראה אותו.
          const remoteAlcohol = normalizeAlcohol(s.alcohol);
          if (remoteAlcohol) {
            alcoholSyncedRef.current = JSON.stringify(remoteAlcohol);
            setAlcohol(remoteAlcohol);
          } else if (canEdit && JSON.stringify(alcohol) !== JSON.stringify(ALCOHOL_DEFAULTS)) {
            const uploaded = JSON.stringify(alcohol);
            saveWeddingSettings(weddingId, { alcohol })
              .then(() => { alcoholSyncedRef.current = uploaded; })
              .catch((err) => console.error("Failed to upload alcohol calculator:", err));
          }
        }
        prevIdsRef.current = {
          guests: new Set(data.guests.map((g) => g.id)),
          tables: new Set(data.tables.map((t) => t.id)),
          vendors: new Set(data.vendors.map((v) => v.id)),
          budget: new Set(data.budget.map((b) => b.id)),
          checklist: new Set(data.checklist.map((c) => c.id)),
        };
        baselineRowsRef.current = Object.fromEntries(
          Object.keys(ENTITIES).map((key) => [
            key,
            new Map(data[key].map((row) => [row.id, row])),
          ])
        );
        cloudReadyRef.current = true;
        setCloudReady(true);
        //  רק אחרי הטעינה מותר לדחוף הגדרות למעלה. בלי זה, ערכי ברירת המחדל
        //  של הרנדר הראשון היו דורסים את מה ששמור בענן.
        settingsReadyRef.current = true;
        setCloudStatus("synced");
      } catch (err) {
        console.error("Initial wedding data load failed:", {
          weddingId,
          userId: session?.user?.id,
          role,
          scopes,
          code: err?.code,
          error: err,
        });
        if (cancelled) return;
        const transient = [
          "unavailable",
          "deadline-exceeded",
          "network-request-failed",
          "functions/unavailable",
          "network_error",
          "timeout",
        ].includes(err?.code) || [502, 503, 504].includes(err?.status);
        if (transient && initialLoadAttempt < 3) {
          console.warn(`Retrying initial Firestore load (${initialLoadAttempt + 1}/3).`);
          setCloudStatus("connecting");
          retryTimer = setTimeout(
            () => setInitialLoadAttempt((attempt) => attempt + 1),
            1000 * 2 ** initialLoadAttempt
          );
          return;
        }
        setCloudReady(false);
        setCloudStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudEnabled, weddingId, session?.user?.id, initialLoadAttempt]);

  // Debounced per-dataset cloud sync (upsert changes + soft-delete removed).
  // צופה (viewer) לעולם לא כותב – ה-DB גם ידחה אותו, ואין טעם ברעש.
  useEffect(() => {
    if (!cloudEnabled || !canEdit || !mayGuests || !cloudReadyRef.current) return;
    const timer = setTimeout(() => {
      enqueueSync(async () => {
        try {
          setCloudStatus("saving");
          prevIdsRef.current.guests = await cloudSyncDataset(
            weddingId,
            "guests",
            guests,
            prevIdsRef.current.guests,
            baselineRowsRef.current.guests,
            { allowRestore: restoreIntentRef.current.has("guests") }
          );
          restoreIntentRef.current.delete("guests");
          setCloudStatus("synced");
        } catch (err) {
          handleSyncFailure("guests", err);
        }
      });
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guests, syncRetry]);

  useEffect(() => {
    if (!cloudEnabled || !canEdit || !mayGuests || !cloudReadyRef.current) return;
    const timer = setTimeout(() => {
      enqueueSync(async () => {
        try {
          setCloudStatus("saving");
          prevIdsRef.current.tables = await cloudSyncDataset(
            weddingId,
            "tables",
            tables,
            prevIdsRef.current.tables,
            baselineRowsRef.current.tables,
            { allowRestore: restoreIntentRef.current.has("tables") }
          );
          restoreIntentRef.current.delete("tables");
          setCloudStatus("synced");
        } catch (err) {
          handleSyncFailure("tables", err);
        }
      });
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, syncRetry]);

  useEffect(() => {
    if (!cloudEnabled || !canEdit || !mayVendors || !cloudReadyRef.current) return;
    const timer = setTimeout(() => {
      enqueueSync(async () => {
        try {
          setCloudStatus("saving");
          prevIdsRef.current.vendors = await cloudSyncDataset(
            weddingId,
            "vendors",
            vendors,
            prevIdsRef.current.vendors,
            baselineRowsRef.current.vendors,
            { allowRestore: restoreIntentRef.current.has("vendors") }
          );
          restoreIntentRef.current.delete("vendors");
          setCloudStatus("synced");
        } catch (err) {
          handleSyncFailure("vendors", err);
        }
      });
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendors, syncRetry]);

  /* Realtime snapshots update clean records while preserving local drafts. */
  useEffect(() => {
    if (
      !cloudEnabled ||
      !cloudReady ||
      typeof weddingId !== "string" ||
      !weddingId.trim() ||
      !session?.user?.id
    ) return undefined;
    let cancelled = false;
    let stops = [];
    (async () => {
      try {
        await waitForAuthContext(session.user.id);
        if (cancelled) return;
        const configs = [
          { key: "guests", allowed: mayGuests, setRows: setGuests },
          { key: "tables", allowed: mayGuests, setRows: setTables },
          { key: "vendors", allowed: mayVendors, setRows: setVendors },
          { key: "budget", allowed: mayFinance, setRows: setBudget },
          { key: "checklist", allowed: mayChecklist, setRows: setChecklist },
        ].filter((item) => item.allowed);

        stops = configs.map(({ key, setRows }) => subscribeCollection(
          weddingId,
          key,
          (remoteRows, { tombstones = [] } = {}) => {
        const cfg = ENTITIES[key];
        const baseline = baselineRowsRef.current[key];
        const knownIds = prevIdsRef.current[key];
        const localRows = datasetStateRef.current[key];
        const localById = new Map(localRows.map((row) => [row.id, row]));
        const remoteById = new Map(remoteRows.map((row) => [row.id, row]));
        const tombstoneIds = new Set(tombstones.map((row) => row.id));
        const next = [];
        const sameEntity = (left, right) =>
          JSON.stringify(cfg.toDoc(left)) === JSON.stringify(cfg.toDoc(right));

        for (const local of localRows) {
          const base = baseline.get(local.id);
          const remote = remoteById.get(local.id);
          if (remote) {
            if (base && (sameEntity(local, base) || sameEntity(local, remote))) {
              next.push(remote);
              baseline.set(local.id, remote);
              knownIds.add(local.id);
            } else {
              next.push(local);
            }
            continue;
          }

          if (!base || !sameEntity(local, base)) {
            next.push(local);
            continue;
          }

          // A clean local copy follows a remote soft or hard delete.
          baseline.delete(local.id);
          knownIds.delete(local.id);
        }

        for (const remote of remoteRows) {
          if (localById.has(remote.id) || knownIds.has(remote.id)) continue;
          next.push(remote);
          baseline.set(remote.id, remote);
          knownIds.add(remote.id);
        }

        for (const id of tombstoneIds) {
          if (!localById.has(id) && !knownIds.has(id)) baseline.delete(id);
        }

        datasetStateRef.current[key] = next;
        setRows((current) =>
          JSON.stringify(current.map(cfg.toDoc)) === JSON.stringify(next.map(cfg.toDoc))
            ? current
            : next
        );
          },
          (error) => {
            console.error("Realtime wedding subscription failed:", {
              weddingId,
              dataset: key,
              userId: session.user.id,
              code: error?.code,
              error,
            });
            if (!cancelled) setCloudStatus("error");
          }
        ));
      } catch (error) {
        console.error("Unable to initialize realtime subscriptions:", {
          weddingId,
          userId: session?.user?.id,
          code: error?.code,
          error,
        });
        if (!cancelled) setCloudStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      stops.forEach((stop) => stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudEnabled, cloudReady, mayGuests, mayVendors, mayFinance, mayChecklist, weddingId, session?.user?.id]);

  useEffect(() => {
    if (!cloudEnabled || !canEdit || !mayFinance || !cloudReadyRef.current) return;
    const timer = setTimeout(() => {
      enqueueSync(async () => {
        try {
          setCloudStatus("saving");
          prevIdsRef.current.budget = await cloudSyncDataset(
            weddingId,
            "budget",
            budget,
            prevIdsRef.current.budget,
            baselineRowsRef.current.budget,
            { allowRestore: restoreIntentRef.current.has("budget") }
          );
          restoreIntentRef.current.delete("budget");
          setCloudStatus("synced");
        } catch (err) {
          handleSyncFailure("budget", err);
        }
      });
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budget, syncRetry]);

  useEffect(() => {
    if (!cloudEnabled || !canEdit || !mayChecklist || !cloudReadyRef.current) return;
    const timer = setTimeout(() => {
      enqueueSync(async () => {
        try {
          setCloudStatus("saving");
          prevIdsRef.current.checklist = await cloudSyncDataset(
            weddingId,
            "checklist",
            checklist,
            prevIdsRef.current.checklist,
            baselineRowsRef.current.checklist,
            { allowRestore: restoreIntentRef.current.has("checklist") }
          );
          restoreIntentRef.current.delete("checklist");
          setCloudStatus("synced");
        } catch (err) {
          handleSyncFailure("checklist", err);
        }
      });
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checklist, syncRetry]);

  //  שמירת ההגדרות. כתיבת מיזוג של אובייקט קטן, ולכן אין צורך בהשוואת מזהים
  //  כמו במערכי הנתונים. גם עורך רשאי לשמור — הקטגוריות ויעד התקציב הם נתון
  //  שיתופי, וה-RLS על wedding_settings מתיר can_edit_wedding.
  //  שולחים רק מפתחות שבתוך היקף השיתוף: שליחת מפתח מחוץ להיקף תיחסם בשרת,
  //  ואין טעם לדחוף ערך שהמשתמש הזה מעולם לא קיבל.
  useEffect(() => {
    if (!cloudEnabled || !canEdit || !settingsReadyRef.current) return;
    const patch = {};
    if (mayGuests) patch.categories = categories;
    if (mayFinance) {
      patch.budgetGoal = budgetGoal;
      patch.financeLabels = financeLabels;
    }
    if (isOwner) patch.countdownBackgroundUrl = countdownBackgroundUrl;
    if (!Object.keys(patch).length) return;
    const timer = setTimeout(async () => {
      try {
        await saveWeddingSettings(weddingId, patch);
      } catch (err) {
        console.error("Cloud sync failed (settings):", err);
        scheduleSyncRetry();
      }
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetGoal, categories, countdownBackgroundUrl, financeLabels, syncRetry]);

  useEffect(() => {
    if (!cloudEnabled || !canEdit || !mayChecklist || !settingsReadyRef.current) return;
    const json = JSON.stringify(checklistOptions);
    if (json === checklistOptionsSavedRef.current) return;
    const timer = setTimeout(async () => {
      try {
        await saveWeddingSettings(weddingId, { checklistOptions });
        checklistOptionsSavedRef.current = json;
      } catch (error) {
        console.error("Checklist options sync failed:", error);
        if (error?.code !== "permission-denied") scheduleSyncRetry();
      }
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checklistOptions, syncRetry]);

  //  מחשבון האלכוהול נשמר בנפרד מההגדרות: הוא שייך להיקף „מוזמנים", וגם הוא
  //  מסתנכרן רק אחרי שהטעינה הסתיימה ורק למי שרשאי לערוך.
  useEffect(() => {
    if (!cloudEnabled || !canEdit || !mayGuests || !settingsReadyRef.current) return;
    const json = JSON.stringify(alcohol);
    if (json === alcoholSyncedRef.current) return;
    const timer = setTimeout(async () => {
      try {
        await saveWeddingSettings(weddingId, { alcohol });
        alcoholSyncedRef.current = json;
      } catch (err) {
        console.error("Cloud sync failed (alcohol):", err);
        scheduleSyncRetry();
      }
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alcohol, syncRetry]);

  // Show a subtle "saved" indicator whenever data changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSavedAt(new Date());
  }, [guests, tables, vendors, budget]);

  // Idle auto-logout – מכשיר שנשאר פתוח על שולחן לא ישאיר את הנתונים חשופים.
  useEffect(() => {
    if (!isCloudConfigured || !session) return;
    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        notify("התנתקת אוטומטית עקב חוסר פעילות", { tone: "info" });
        signOutAndWipe();
      }, IDLE_LOGOUT_MINUTES * 60_000);
    };
    const events = ["mousedown", "keydown", "touchstart", "scroll", "focus"];
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, reset));
    };
  }, [session]);

  function downloadJson(obj, suffix = "") {
    const blob = new Blob([JSON.stringify(obj, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wedding-backup-${new Date()
      .toISOString()
      .slice(0, 10)}${suffix}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  //  ייצוא לאקסל: גיליון נפרד לכל מערך נתונים ולצדו payload שחזור זהה ל-JSON.
  const [excelBusy, setExcelBusy] = useState(false);
  async function exportExcel() {
    setBackupMenuOpen(false);
    setExcelBusy(true);
    try {
      await exportWeddingWorkbook(
        {
          guests,
          tables,
          vendors,
          budget,
          checklist,
          checklistOptions,
          budgetGoal,
          backup: await backupPayload(),
        },
        coupleTitle || activeWedding?.name
      );
      notify("קובץ האקסל הורד", { tone: "success" });
    } catch (err) {
      console.error("Excel export failed:", err);
      notify("ייצוא האקסל נכשל. נסו שוב.", { tone: "error" });
    } finally {
      setExcelBusy(false);
    }
  }

  //  קובץ הגיבוי מכיל שמות וטלפונים של כל המוזמנים. מציעים הצפנה בסיסמה
  // (PBKDF2 → AES-GCM) לפני שהוא יורד לדיסק. ראו src/lib/backupCrypto.js.
  //
  //  ⚠ כל נתון שנשמר במערכת חייב להיכנס לכאן. קודם ההגדרות (יעד התקציב,
  //  תוויות מסך התקציב וקטגוריות המוזמנים) לא נכנסו, ומי ששיחזר איבד אותן בשקט.
  async function backupPayload() {
    const withoutSyncMetadata = (rows) => rows.map((row) => {
      const clean = { ...row };
      delete clean._version;
      return clean;
    });
    let vendorAttachments = [];
    if (cloudEnabled && weddingId && hasScope(scopes, "vendors")) {
      const [active, deleted] = await Promise.all([
        listVendorFiles(weddingId),
        listDeletedVendorFiles(weddingId),
      ]);
      vendorAttachments = [
        ...active.map(({ id, vendorId, name, mime, size, createdAt }) => ({
          id, vendorId, name, mime, size, createdAt, deleted: false,
        })),
        ...deleted.map(({ id, vendorId, name, mime, size, createdAt, deletedAt }) => ({
          id, vendorId, name, mime, size, createdAt, deleted: true, deletedAt,
        })),
      ];
    }
    return {
      app: "wedding-planner",
      version: 3,
      exportedAt: new Date().toISOString(),
      guests: withoutSyncMetadata(guests),
      tables: withoutSyncMetadata(tables),
      vendors: withoutSyncMetadata(vendors),
      budget: withoutSyncMetadata(budget),
      checklist: withoutSyncMetadata(checklist),
      vendorAttachments,
      settings: {
        budgetGoal,
        checklistOptions,
        financeLabels,
        categories,
        countdownBackgroundUrl,
        partnerA: couple.partnerA,
        partnerB: couple.partnerB,
        //  מחרוזת 'YYYY-MM-DD' כמו ב-DB, ולא אובייקט Date שמשתנה לפי אזור זמן.
        weddingDate: activeWedding?.weddingDate
          ? String(activeWedding.weddingDate).slice(0, 10)
          : null,
      },
    };
  }

  async function exportBackup() {
    const payload = await backupPayload();

    if (!isCryptoAvailable) {
      downloadJson(payload);
      return;
    }

    const encrypt = await confirmDialog({
      title: "להצפין את קובץ הגיבוי?",
      message:
        "הקובץ מכיל שמות וטלפונים של כל המוזמנים ואת כל נתוני התקציב.\n" +
        "פרטי הקבצים המצורפים נשמרים, אך תוכן הקבצים עצמם אינו כלול.\n" +
        "הצפנה בסיסמה מומלצת בחום.\n\n" +
        "⚠ אין שחזור סיסמה — סיסמה שאבדה = קובץ שלא ניתן לפתוח.",
      confirmLabel: "הצפן בסיסמה",
      cancelLabel: "הורד ללא הצפנה",
    });

    if (!encrypt) {
      downloadJson(payload);
      return;
    }

    /*  ולידציה בלולאה ולא "הודעת שגיאה וסגירה": קודם, סיסמה קצרה
     *  סגרה את החלון והמשתמש נאלץ להתחיל את כל תהליך הגיבוי מחדש
     *  (גיבוי ← קובץ גיבוי ← הצפן) — חיכוך שדוחף לוותר על ההצפנה לגמרי.  */
    let pass;
    let lastTyped = "";
    for (;;) {
      const entered = await promptDialog({
        title: "סיסמת הצפנה",
        message: "בחרו סיסמה חזקה (לפחות 10 תווים) ושמרו אותה במקום בטוח.",
        type: "password",
        confirmLabel: "הצפן והורד",
        placeholder: "••••••••••",
        initialValue: lastTyped,
      });
      if (!entered) return;
      if (entered.length >= 10) {
        pass = entered;
        break;
      }
      lastTyped = entered;
      notify("הסיסמה קצרה מדי (לפחות 10 תווים)", { tone: "error" });
    }

    try {
      const envelope = await encryptBackup(payload, pass);
      downloadJson(envelope, "-encrypted");
      notify("הגיבוי הוצפן והורד", { tone: "success" });
    } catch (err) {
      console.error("Backup encryption failed:", err);
      notify("ההצפנה נכשלה. הקובץ לא נשמר.", { tone: "error" });
    }
  }

  function applyBackup(data) {
    if (data.app && data.app !== "wedding-planner") {
      notify("קובץ הגיבוי אינו תקין. ודא שזהו קובץ שיוצא מהמערכת.", {
        tone: "error",
      });
      return;
    }
    const s = data.settings || {};
    const summary = [
      Array.isArray(data.guests) ? `${data.guests.length} מוזמנים` : null,
      Array.isArray(data.tables) ? `${data.tables.length} שולחנות` : null,
      Array.isArray(data.vendors) ? `${data.vendors.length} ספקים` : null,
      Array.isArray(data.budget) ? `${data.budget.length} סעיפי תקציב` : null,
      Array.isArray(data.checklist) ? `${data.checklist.length} משימות צ׳קליסט` : null,
      Array.isArray(data.vendorAttachments)
        ? `${data.vendorAttachments.length} פרטי קבצים מצורפים`
        : null,
      data.settings ? "הגדרות החתונה" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const created = data.exportedAt
      ? new Date(data.exportedAt).toLocaleString("he-IL")
      : null;
    confirmDialog({
      title: "שחזור גיבוי יחליף את כל הנתונים",
      message:
        `הקובץ מכיל: ${summary}` +
        (created ? `\nנוצר בתאריך: ${created}` : "") +
        "\n\n⚠ כל הנתונים הקיימים בחתונה יוחלפו במה שבקובץ — כולל שינויים " +
        "שבן/בת הזוג או שותפים אחרים ביצעו אחרי שהגיבוי נוצר.\n\n" +
        "לפני השחזור יורד אוטומטית קובץ גיבוי של המצב הנוכחי, כדי שתמיד " +
        "תהיה דרך חזרה.\n\n" +
        (Array.isArray(data.vendorAttachments) && data.vendorAttachments.length
          ? "רשימת פרטי הקבצים בגיבוי היא לעיון בלבד; השחזור אינו מחבר או משנה קבצים מצורפים. תוכן הקבצים אינו כלול.\n\n"
          : "") +
        "להמשיך?",
      confirmLabel: "שחזר נתונים",
      tone: "danger",
    }).then(async (ok) => {
      if (!ok) return;
      restoreIntentRef.current = new Set(
        ["guests", "tables", "vendors", "budget", "checklist"]
          .filter((key) => Array.isArray(data[key]))
      );
      //  רשת ביטחון: שחזור הוא פעולה בלתי הפיכה שדורסת גם עבודה של שותפים.
      //  הקובץ יורד לא מוצפן בכוונה — הוא נוצר בלי אינטראקציה ואי אפשר
      //  לבקש סיסמה באמצע, ומטרתו לשמש דקה אחורה ולא ארכיון ארוך טווח.
      try {
        downloadJson(await backupPayload(), "-before-restore");
      } catch (err) {
        console.error("Safety backup failed:", err);
      }
      //  קובץ גיבוי הוא קלט חיצוני: שדה חסר או בטיפוס לא צפוי היה מפיל
      //  את כל המסך (למשל v.tasks.map על undefined). מנרמלים בגבול המערכת.
      if (Array.isArray(data.guests))
        setGuests(
          withIds(data.guests, (g) => ({
            ...g,
            seats: Number(g.seats) || 1,
            gift: Number(g.gift) || 0,
          }))
        );
      if (Array.isArray(data.tables))
        setTables(
          withIds(data.tables, (t) => ({
            ...t,
            guestIds: Array.isArray(t.guestIds) ? t.guestIds : [],
          }))
        );
      const vendorIdMap = new Map();
      const currentVendorIds = new Map(
        vendors
          .filter((vendor) => vendor.legacyId != null)
          .map((vendor) => [String(vendor.legacyId), String(vendor.id)])
      );
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const usedVendorIds = new Set();
      const restoredVendors = Array.isArray(data.vendors)
        ? data.vendors.map((vendor) => {
            const rawId = String(vendor.id ?? "");
            let id = uuidPattern.test(rawId)
              ? rawId
              : currentVendorIds.get(rawId) || crypto.randomUUID();
            if (usedVendorIds.has(id)) id = crypto.randomUUID();
            usedVendorIds.add(id);
            if (rawId) vendorIdMap.set(rawId, id);
            return {
              ...vendor,
              id,
              ...(uuidPattern.test(rawId) ? {} : { legacyId: rawId }),
              contractCost: Number(vendor.contractCost) || 0,
              deposit: Number(vendor.deposit) || 0,
              tasks: Array.isArray(vendor.tasks) ? vendor.tasks : [],
            };
          })
        : null;
      if (restoredVendors) setVendors(restoredVendors);
      if (Array.isArray(data.budget))
        setBudget(
          withIds(data.budget, (b) => ({
            ...b,
            expected: Number(b.expected) || 0,
            actual: Number(b.actual) || 0,
            //  גיבוי שנוצר לפני הקישור לספקים אינו מכיל את השדה.
            vendorId: b.vendorId == null
              ? null
              : (vendorIdMap.get(String(b.vendorId)) || String(b.vendorId)),
          }))
        );
      if (Array.isArray(data.checklist)) {
        setChecklist(
          withIds(data.checklist, (item) => ({
            ...item,
            title: String(item.title || ""),
            category: String(item.category || "כללי"),
            assignee: ["both", "bride", "groom"].includes(item.assignee)
              ? item.assignee
              : "both",
            done: Boolean(item.done),
          }))
        );
      }

      //  הגדרות: גיבויים בגרסה 1 לא הכילו אותן, ולכן כל שדה מוחל רק אם קיים
      //  בפועל — אחרת שחזור מקובץ ישן היה מאפס את יעד התקציב והתוויות.
      if (typeof s.budgetGoal === "number") setBudgetGoal(s.budgetGoal);
      if (typeof s.countdownBackgroundUrl === "string")
        setCountdownBackgroundUrl(s.countdownBackgroundUrl);
      if (s.financeLabels && typeof s.financeLabels === "object")
        setFinanceLabels((prev) => ({ ...prev, ...s.financeLabels }));
      if (Array.isArray(s.categories)) setCategories(s.categories);
      if (s.checklistOptions && mayChecklist) setChecklistOptions(normalizeChecklistOptions(s.checklistOptions));
      //  שמות בני הזוג והתאריך יושבים על רשומת החתונה עצמה, שרק הבעלים
      //  רשאי לעדכן. לעורך פשוט מדלגים במקום להציג לו כישלון.
      if (isOwner && (s.partnerA != null || s.partnerB != null || s.weddingDate != null)) {
        saveWeddingBasics({
          partnerA: s.partnerA ?? couple.partnerA,
          partnerB: s.partnerB ?? couple.partnerB,
          date: s.weddingDate ?? activeWedding?.weddingDate ?? null,
        }).catch((err) => console.error("Restore of wedding basics failed:", err));
      }
      notify("הגיבוי שוחזר בהצלחה", { tone: "success" });
    });
  }

  //  תקרה לקובץ שנטען: גיבוי של אלף מוזמנים שוקל מאות קילובייטים, ולכן כל
  //  דבר מעבר לזה הוא קובץ שגוי — ו-FileReader טוען את כולו לזיכרון ומקפיא
  //  את הלשונית לפני שבכלל הגענו לבדיקת התוכן.
  const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

  function importBackup(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      notify("הקובץ גדול מדי (מעל 20MB). ודאו שזהו קובץ גיבוי של המערכת.", {
        tone: "error",
      });
      return;
    }

    //  קובץ אקסל שיוצא מהמערכת נושא גיליון שחזור עם אותו payload בדיוק.
    //  קובץ אקסל אחר — למשל רשימת מוזמנים שהמשתמש בנה בעצמו — אינו גיבוי,
    //  ומפנים אותו לייבוא המוזמנים במקום להיכשל בשקט.
    if (/\.(xlsx|xlsm)$/i.test(file.name || "")) {
      readWorkbookBackup(file)
        .then((data) => applyBackup(data))
        .catch((err) => {
          console.error("Excel backup read failed:", err);
          notify(
            err?.code === "no_backup_sheet"
              ? "קובץ האקסל הזה לא יוצא מהמערכת ואינו מכיל גיבוי לשחזור. " +
                  "לייבוא רשימת מוזמנים השתמשו בכפתור הייבוא במסך המוזמנים."
              : err?.code === "unreadable_file"
                ? "לא הצלחנו לקרוא את קובץ האקסל. ודאו שהוא לא פגום."
                : "גיליון השחזור בקובץ פגום. נסו קובץ גיבוי אחר.",
            { tone: "error", duration: 9000 }
          );
        });
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => notify("קריאת הקובץ נכשלה.", { tone: "error" });
    reader.onload = async () => {
      let data;
      try {
        data = JSON.parse(String(reader.result));
      } catch {
        notify("קובץ הגיבוי אינו תקין. ודא שזהו קובץ שיוצא מהמערכת.", {
          tone: "error",
        });
        return;
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        notify("קובץ הגיבוי אינו תקין. ודא שזהו קובץ שיוצא מהמערכת.", {
          tone: "error",
        });
        return;
      }

      if (isEncryptedBackup(data)) {
        //  אימות המבנה לפני בקשת הסיסמה: אין טעם לבקש סיסמה לקובץ שממילא
        //  לא נוכל לפענח, ובלי הבדיקה iterations מנופח מקפיא את הלשונית.
        const invalid = validateEncryptedBackup(data);
        if (invalid) {
          notify(
            invalid === "corrupt_backup"
              ? "קובץ הגיבוי פגום ולא ניתן לפענוח."
              : "הקובץ אינו קובץ גיבוי תקין של המערכת.",
            { tone: "error" }
          );
          return;
        }
        const pass = await promptDialog({
          title: "קובץ גיבוי מוצפן",
          message: "הזינו את הסיסמה שבה הוצפן הקובץ.",
          type: "password",
          confirmLabel: "פענח",
        });
        if (!pass) return;
        try {
          data = await decryptBackup(data, pass);
        } catch {
          notify("הסיסמה שגויה או שהקובץ פגום.", { tone: "error" });
          return;
        }
      } else if (
        !Array.isArray(data.guests) &&
        !Array.isArray(data.tables) &&
        !Array.isArray(data.vendors) &&
        !Array.isArray(data.budget) &&
        !Array.isArray(data.checklist)
      ) {
        //  JSON תקין שאינו הקובץ שלנו. בלי הבדיקה השחזור "מצליח" ולא משנה כלום.
        notify("הקובץ אינו קובץ גיבוי של המערכת.", { tone: "error" });
        return;
      }

      applyBackup(data);
    };
    reader.readAsText(file);
  }

  const titleMap = {
    overview: "דאשבורד ראשי",
    checklist: "צ׳קליסט",
    guests: "מוזמנים",
    seating: "סידור הושבה",
    vendors: "ספקים",
    finance: "ניהול תקציב",
    portal: "פורטל ספקים",
  };

  const subtitleMap = {
    overview: `${guests.length} מוזמנים · ${vendors.length} ספקים`,
    checklist: checklist.length
      ? `${checklist.filter((c) => c.done).length} מתוך ${checklist.length} משימות הושלמו`
      : "עדיין לא נוספו משימות",
    guests: `${guests.length} רשומות ברשימה`,
    seating: `${tables.length} שולחנות · ${tables.reduce(
      (s, t) => s + (t.guestIds?.length || 0),
      0
    )} רשומות משובצות`,
    vendors: `${vendors.length} ספקים · ${vendors.reduce(
      (s, v) => s + v.tasks.filter((t) => t.status !== "done").length,
      0
    )} משימות פתוחות`,
    finance: `הוצאה בפועל ${fmt(budget.reduce((s, b) => s + b.actual, 0))}`,
    portal: `${vendors.length} ספקים מחוברים`,
  };

  return (
    <div className="flex min-h-screen">
      <ToastHost />
      <ConfirmHost />
      <PromptHost />
      {membersOpen && (
        <MembersModal
          weddingId={weddingId}
          isOwner={isOwner}
          currentUserId={session?.user?.id ?? null}
          weddingName={coupleTitle || activeWedding?.name}
          onClose={() => setMembersOpen(false)}
        />
      )}
      {settingsOpen && (
        <WeddingSettingsModal
          couple={couple}
          weddingDate={activeWedding?.weddingDate}
          weddingName={activeWedding?.name || coupleTitle}
          budgetGoal={budgetGoal}
          currentUserId={session?.user?.id ?? null}
          canEditBasics={cloudEnabled ? isOwner : true}
          canEditBudgetGoal={canEdit && mayFinance}
          showDate={cloudEnabled}
          weddingId={cloudEnabled && isOwner ? weddingId : null}
          onSaveBasics={saveWeddingBasics}
          onSaveBudgetGoal={saveBudgetGoal}
          onDeleteWedding={isOwner ? onDeleteWedding : null}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      <Sidebar
        active={active}
        onChange={goTo}
        open={sidebarOpen}
        setOpen={setSidebarOpen}
        modalSuspended={tourOn}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        navItems={navItems}
        weddings={weddings}
        activeWedding={activeWedding}
        weddingDate={weddingDate}
        coupleTitle={coupleTitle}
        onSwitchWedding={onSwitchWedding}
        onCreateWedding={onCreateWedding}
        onOpenMembers={() => setMembersOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/*  `overflow-x-clip` ולא `overflow-x-hidden`: שניהם חותכים גלישה
          אופקית, אבל `hidden` הופך את האלמנט למכול גלילה ומשבית
          כל `sticky` שבפנים (מתג הטאבים של המוזמנים).
          `min-w-0` הכרחי כאן — בלי מכול גלילה, פריט flex לא מוכן להצטמצם
          מתחת לרוחב התוכן שלו, והמסך היה נהיה רחב מהחלון.  */}
      <main className="min-w-0 flex-1 overflow-x-clip">
        {/* Top bar (mobile) */}
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-white/40 bg-white/60 px-4 py-3 backdrop-blur-xl sm:gap-3 lg:px-8 lg:py-4">
          {/*  ההמבורגר ראשון, כלומר בצד ימין ב-RTL - באותו צד שממנו נפתחת
              המגירה. כשהוא ישב בקצה הנגדי הפתיחה נראתה כאילו היא מגיעה
              מהכיוון הלא נכון.  */}
          <button
            onClick={() => setSidebarOpen(true)}
            title="פתיחת התפריט"
            aria-label="פתיחת תפריט הניווט"
            aria-expanded={sidebarOpen}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 lg:hidden"
          >
            <Menu size={20} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {sidebarCollapsed && (
              <button
                onClick={() => setSidebarCollapsed(false)}
                title="הצגת תפריט הניווט"
                aria-label="הצגת תפריט הניווט"
                className="btn-icon hidden lg:inline-grid"
              >
                <PanelRightOpen size={20} />
              </button>
            )}
            <div className="min-w-0">
              <p className="truncate text-[11px] text-slate-400 sm:text-xs">
                {subtitleMap[active]}
              </p>
              <h2 className="truncate font-display text-base font-bold text-slate-800 sm:text-lg">
                {titleMap[active]}
              </h2>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {/*  כפתור העזרה פותח ישירות את הסיור המודרך.  */}
            <button
              data-tour="help"
              onClick={startTour}
              title="סיור מודרך במערכת"
              aria-label="פתיחת הסיור המודרך"
              className="btn-icon"
            >
              <HelpCircle size={19} />
            </button>
            {/* במצב ענן מחוון הענן כבר מספר את סיפור השמירה; שני מחוונים זה
                רעש ודוחק את כותרת המסך. מציגים "נשמר" רק במצב מקומי. */}
            {isCloudConfigured ? (
              <CloudStatus status={cloudStatus} />
            ) : (
              <>
                <span
                  className="inline-flex items-center justify-center rounded-full bg-sage-50 p-1.5 text-sage-600 ring-1 ring-sage-200 sm:hidden"
                  title={
                    savedAt
                      ? `נשמר ${savedAt.toLocaleTimeString("he-IL", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                      : "נשמר אוטומטית בדפדפן"
                  }
                  aria-label="הנתונים נשמרו"
                >
                  <CheckCircle2 size={14} />
                </span>
                <span
                  className="hidden items-center gap-1.5 rounded-full bg-sage-50 px-3 py-1.5 text-xs font-medium text-sage-600 ring-1 ring-sage-200 sm:inline-flex"
                  title="כל שינוי נשמר אוטומטית בדפדפן"
                >
                  <CheckCircle2 size={13} />
                  {savedAt
                    ? `נשמר ${savedAt.toLocaleTimeString("he-IL", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}`
                    : "נשמר אוטומטית"}
                </span>
              </>
            )}
            <input
              ref={backupInputRef}
              type="file"
              accept="application/json,.json,.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={importBackup}
            />
            {/* גיבוי ושחזור נוגעים בכל מערכי הנתונים, ולכן מוצגים רק למי
                שיש לו גישה לכל המסכים — אחרת שחזור היה מוחק מה שלא נראה. */}
            {(fullScope || (isCloudConfigured && session)) && (
              <div className="relative" ref={backupMenuRef} data-tour="backup">
                {/*  בנייד זה תפריט גלישה אחד שמרכז את כל הפעולות המשניות.
                    חמישה כפתורים נפרדים ברוחב 390px הותירו לכותרת המסך כ-100px,
                    והיא הוצגה כ-"דאשבור...".  */}
                <button
                  onClick={() => setBackupMenuOpen((v) => !v)}
                  title="פעולות נוספות – גיבוי, אקסל ויציאה"
                  aria-label="פעולות נוספות"
                  aria-haspopup="menu"
                  aria-expanded={backupMenuOpen}
                  /*  בנייד הכפתורים האלה היו 32px — קטן מהמינימום שנדרש
                      ללחיצה באצבע.  */
                  className="grid h-11 w-11 place-items-center rounded-xl bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 sm:flex sm:h-auto sm:w-auto sm:min-h-0 sm:items-center sm:gap-1.5 sm:bg-gold-500 sm:px-3 sm:py-2 sm:text-xs sm:font-semibold sm:text-slate-950 sm:ring-0 sm:hover:bg-gold-600"
                >
                  {excelBusy ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <>
                      <MoreHorizontal size={20} className="sm:hidden" />
                      <Download size={16} className="hidden sm:block" />
                    </>
                  )}
                  <span className="hidden sm:inline">גיבוי</span>
                  <ChevronDown size={13} className="hidden sm:block" />
                </button>
                {backupMenuOpen && (
                  <div
                    role="menu"
                    className="animate-fade-in-up absolute left-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl bg-white p-1.5 text-right shadow-xl ring-1 ring-slate-200"
                  >
                    {fullScope && (
                      <>
                        <button
                          role="menuitem"
                          onClick={() => {
                            setBackupMenuOpen(false);
                            exportBackup();
                          }}
                          className="flex w-full items-start gap-2.5 rounded-xl p-2.5 transition hover:bg-slate-50"
                        >
                          <Download
                            size={16}
                            className="mt-0.5 shrink-0 text-gold-600"
                          />
                          <span className="min-w-0">
                            <span className="block text-xs font-semibold text-slate-700">
                              קובץ גיבוי (JSON)
                            </span>
                            <span className="block text-[11px] text-slate-400">
                              כולל פרטי קבצים מצורפים, ללא תוכן הקבצים
                            </span>
                          </span>
                        </button>
                        <button
                          role="menuitem"
                          onClick={exportExcel}
                          disabled={excelBusy}
                          className="flex w-full items-start gap-2.5 rounded-xl p-2.5 transition hover:bg-slate-50 disabled:opacity-60"
                        >
                          <FileSpreadsheet
                            size={16}
                            className="mt-0.5 shrink-0 text-sage-600"
                          />
                          <span className="min-w-0">
                            <span className="block text-xs font-semibold text-slate-700">
                              ייצוא לאקסל (XLSX)
                            </span>
                            <span className="block text-[11px] text-slate-400">
                              גיליונות נתונים ופרטי קבצים — ללא תוכן הקבצים
                            </span>
                          </span>
                        </button>
                      </>
                    )}
                    {/*  בנייד אלה הפריטים היחידים שמובילים לשחזור וליציאה,
                        כי הכפתורים הנפרדים מוסתרים מתחת ל-sm.  */}
                    {fullScope && canEdit && (
                      <button
                        role="menuitem"
                        onClick={() => {
                          setBackupMenuOpen(false);
                          backupInputRef.current?.click();
                        }}
                        className="flex w-full items-center gap-2.5 rounded-xl p-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 sm:hidden"
                      >
                        <Upload size={16} className="shrink-0 text-slate-400" />
                        שחזור מקובץ גיבוי או אקסל
                      </button>
                    )}
                    {isCloudConfigured && session && (
                      <button
                        role="menuitem"
                        onClick={() => {
                          setBackupMenuOpen(false);
                          signOutAndWipe();
                        }}
                        className="flex w-full items-center gap-2.5 rounded-xl p-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 sm:hidden"
                      >
                        <LogOut size={16} className="shrink-0 text-slate-400" />
                        יציאה מהחשבון
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {fullScope && canEdit && (
              <button
                onClick={() => backupInputRef.current?.click()}
                title="שחזור נתונים מקובץ גיבוי (JSON) או מקובץ אקסל שיצא מהמערכת"
                className="btn-secondary hidden px-3 text-xs sm:inline-flex"
              >
                <Upload size={16} /> <span className="hidden sm:inline">שחזור</span>
              </button>
            )}
            {isCloudConfigured && session && (
              <button
                onClick={signOutAndWipe}
                title="התנתקות (מנקה את הנתונים השמורים בדפדפן)"
                className="btn-secondary hidden px-3 text-xs sm:inline-flex"
              >
                <LogOut size={16} /> <span className="hidden sm:inline">יציאה</span>
              </button>
            )}
          </div>
        </header>

        {session?.user?.emailVerified === false && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 sm:px-5 lg:px-8">
            <p className="min-w-0 flex-1">
              {verificationSent
                ? `שלחנו קישור אימות אל ${session.user.email}. פתחו אותו ואז רעננו את האפליקציה.`
                : `אמתו את כתובת המייל ${session.user.email} כדי לאפשר צירוף לחשבונות משותפים.`}
            </p>
            {!verificationSent && (
              <button
                type="button"
                onClick={resendVerificationEmail}
                disabled={verificationBusy}
                className="btn-secondary shrink-0"
              >
                {verificationBusy ? "שולח…" : "שליחת קישור אימות"}
              </button>
            )}
          </div>
        )}

        {!canEdit && (
          <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-xs font-medium text-slate-600 lg:px-8">
            <Eye size={14} className="shrink-0" />
            מצב צפייה בלבד — יש לך הרשאת צפייה בחתונה הזו. שינויים נחסמים גם בשרת.
          </div>
        )}

        {!fullScope && (
          <div className="flex items-center gap-2 border-b border-sage-200 bg-sage-50 px-5 py-2.5 text-xs font-medium text-sage-700 lg:px-8">
            <Share2 size={14} className="shrink-0" />
            שיתוף חלקי — שותפו איתך {navItems.length === 1 ? "המסך" : "המסכים"}{" "}
            {navItems.map((n) => n.label).join(" · ")}. שאר הנתונים אינם נגישים.
          </div>
        )}

        {/*  כשטעינת הענן נכשלת המסכים מציגים מערכים ריקים, וזה נראה בדיוק
            כמו "כל הנתונים נמחקו". הנתונים בטוחים — הסנכרון כלפי מעלה חסום
            עד שהטעינה מצליחה — אבל חייבים לומר את זה במפורש ולא להשאיר
            מסך ריק שנראה כמו אובדן מידע.  */}
        {cloudEnabled && cloudStatus === "error" && (
          <div className="flex flex-wrap items-center gap-2 border-b border-rose-200 bg-rose-50 px-5 py-2.5 text-xs font-medium text-rose-700 lg:px-8">
            <CloudOff size={14} className="shrink-0" />
            טעינת הנתונים מהשרת נכשלה. מה שמוצג כאן אינו מלא —{" "}
            <strong>הנתונים שלכם לא נמחקו</strong> ושום שינוי לא יישמר עד שהחיבור יחזור.
            <button
              onClick={() => {
                setCloudStatus("connecting");
                setCloudReady(false);
                setInitialLoadAttempt((attempt) => attempt >= 3 ? 0 : attempt + 1);
              }}
              className="btn-secondary"
            >
              ניסיון חוזר
            </button>
          </div>
        )}

        <div key={active} className="animate-fade-in-up p-3 sm:p-5 lg:p-8">
          {!tourInviteDismissed && (
            <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-gold-200 bg-gold-50/80 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-gold-600 shadow-sm ring-1 ring-gold-100">
                  <Sparkles size={18} />
                </span>
                <div>
                  <p className="text-sm font-bold text-slate-800">רוצים סיור קצר במערכת?</p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-600">
                    נציג את המסכים והפעולות העיקריות. הסיור לא יתחיל בלי שתבחרו בו.
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                <button type="button" onClick={startTour} className="btn-primary min-h-11">
                  <HelpCircle size={16} /> התחלת הסיור
                </button>
                <button
                  type="button"
                  onClick={() => setTourInviteDismissed(true)}
                  className="btn-secondary min-h-11"
                >
                  לא עכשיו
                </button>
              </div>
            </div>
          )}
          {/*  הרשאת העריכה עוברת ב-context וכל מסך מסתיר בעצמו את מה שכותב.
              קודם היה כאן fieldset מושבת אחד סביב הכול, והוא ניטרל לצופה
              גם את החיפוש, הסינון, המיון והכפתור "הצג עוד".  */}
          <ScreenErrorBoundary key={`${weddingId || "local"}:${active}`}>
          <CanEditContext.Provider value={canEdit}>
          {active === "overview" && (
            <Overview
              guests={guests}
              vendors={vendors}
              budget={budget}
              checklist={checklist}
              checklistAssignees={checklistOptions.assignees}
              weddingDate={weddingDate}
              couple={couple}
              canEditSettings={cloudEnabled ? isOwner : true}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenVendor={canOpenVendors ? openVendor : null}
              canAddVendor={canEdit && mayVendors}
              dataLoading={cloudEnabled && ["connecting", "loading"].includes(cloudStatus)}
              dataUnavailable={cloudEnabled && cloudStatus === "error"}
              backgroundUrl={countdownBackgroundUrl}
              onBackgroundChange={
                cloudEnabled && isOwner ? handleCountdownBackgroundChange : null
              }
            />
          )}
          {active === "checklist" && (
            <Checklist items={checklist} setItems={setChecklist} options={checklistOptions} setOptions={setChecklistOptions} />
          )}
          {active === "guests" && (
            <CategoriesContext.Provider value={categories}>
              <Guests
                guests={guests}
                setGuests={setGuests}
                tables={tables}
                setTables={setTables}
                categories={categories}
                setCategories={setCategories}
                dataLoading={cloudEnabled && ["connecting", "loading"].includes(cloudStatus)}
                dataUnavailable={cloudEnabled && cloudStatus === "error"}
              />
            </CategoriesContext.Provider>
          )}
          {active === "alcohol" && (() => {
            const stats = getAlcoholStats(guests);
            return (
              <AlcoholCalculator
                drinkers={stats.drinkers}
                listedSeats={stats.listedSeats}
                alcohol={alcohol}
                setAlcohol={setAlcohol}
                setBudget={mayFinance ? setBudget : null}
              />
            );
          })()}
          {active === "seating" && (
            <Seating guests={guests} tables={tables} setTables={setTables} />
          )}
          {active === "vendors" && (
            <Vendors
              vendors={vendors}
              setVendors={setVendors}
              budget={budget}
              setBudget={mayFinance ? setBudget : null}
              weddingId={cloudEnabled ? weddingId : null}
              canEdit={canEdit}
              focusId={vendorFocusId}
            />
          )}
          {active === "finance" && (
            <Finance
              budget={budget}
              setBudget={setBudget}
              vendors={vendors}
              guests={guests}
              budgetGoal={budgetGoal}
              setBudgetGoal={setBudgetGoal}
              financeLabels={financeLabels}
              setFinanceLabels={setFinanceLabels}
            />
          )}
          {active === "portal" && (
            <VendorPortal
              vendors={vendors}
              setVendors={setVendors}
              weddingName={activeWedding?.name || ""}
              coupleTitle={coupleTitle}
            />
          )}
          {active === "admin" && adminAllowed && <AdminDashboard />}
          </CanEditContext.Provider>
          </ScreenErrorBoundary>
        </div>
      </main>

      {tourOn && (
        <Tour
          key={active}
          steps={tourSteps}
          onClose={() => {
            setTourOn(false);
            //  הסיור פותח את מגירת הניווט בשלבים שמדברים על הלשוניות.
            //  יציאה באמצע הייתה משאירה אותה פתוחה על המסך.
            setSidebarOpen(false);
          }}
        />
      )}
    </div>
  );
}

/* =========================================================================
 *  WEDDING SWITCHER + MEMBERS
 * ====================================================================== */

function WeddingSwitcher({ weddings, activeWedding, onSwitch, onCreate, onOpenMembers, onOpenSettings }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!activeWedding) return null;

  async function addWedding() {
    const name = await promptDialog({
      title: "חתונה חדשה",
      message: "איך לקרוא לה?",
      initialValue: "החתונה שלי",
      confirmLabel: "יצירה",
    });
    if (!name) return;
    setBusy(true);
    try {
      await onCreate(name, null);
      notify("החתונה נוצרה", { tone: "success" });
      setOpen(false);
    } catch (err) {
      console.error(err);
      notify("יצירת החתונה נכשלה", { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const owned = weddings.filter((w) => w.role === "owner");
  const shared = weddings.filter((w) => w.role !== "owner");

  const item = (w) => (
    <button
      key={w.id}
      onClick={() => {
        onSwitch(w.id);
        setOpen(false);
      }}
      className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-right text-sm transition ${
        w.id === activeWedding.id
          ? "bg-gold-50 font-semibold text-gold-700"
          : "text-slate-600 hover:bg-slate-50"
      }`}
    >
      <span className="min-w-0 truncate">{weddingLabel(w)}</span>
      <RoleBadge role={w.role} />
    </button>
  );

  return (
    <div className="mb-4 px-2" data-tour="switcher">
      <div className="rounded-2xl bg-white/70 p-2 ring-1 ring-slate-200/80">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-right transition hover:bg-slate-50"
          aria-expanded={open}
        >
          <Heart size={15} className="shrink-0 text-gold-500" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700">
            {weddingLabel(activeWedding)}
          </span>
          <ChevronsUpDown size={14} className="shrink-0 text-slate-400" />
        </button>

        {open && (
          <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
            {owned.length > 0 && (
              <p className="px-3 pb-1 text-[11px] font-semibold text-slate-400">
                בבעלותי
              </p>
            )}
            {owned.map(item)}
            {shared.length > 0 && (
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold text-slate-400">
                שותפו איתי
              </p>
            )}
            {shared.map(item)}
            <button
              onClick={addWedding}
              disabled={busy}
              className="mt-2 flex w-full items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-500 transition hover:border-gold-400 hover:text-gold-600 disabled:opacity-60"
            >
              <Plus size={14} /> חתונה חדשה
            </button>
          </div>
        )}

        {/*  min-h-11 רק במסך צר: בנייד התפריט הוא מגירה שנפתחת באצבע,
            ושתי השורות האלה היו 28–31px — קטן מדי לפתיחת מסך שלם.  */}
        <button
          onClick={onOpenMembers}
          className="btn-secondary mt-2 w-full justify-start px-2 text-xs"
        >
          <Share2 size={14} /> שיתוף וחברים
          <RoleBadge role={activeWedding.role} />
        </button>

        {/*  הבית של כל ההגדרות הכלליות: שמות בני הזוג, תאריך החתונה, יעד
            התקציב. כאן ולא בתוך מסכי העבודה, כי אלה נתונים חד-פעמיים.  */}
        <button
          onClick={onOpenSettings}
          className="btn-secondary mt-2 w-full justify-start px-2 text-xs"
        >
          <Settings2 size={14} /> הגדרות החתונה
        </button>
      </div>
    </div>
  );
}

/** תגיות המסכים ששותפו עם חבר. "כל המסכים" כשההיקף מלא. */
function ScopeChips({ scopes }) {
  if (isFullScope(scopes)) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
        כל המסכים
      </span>
    );
  }
  return (
    <>
      {SCOPE_OPTIONS.filter((s) => hasScope(scopes, s.key)).map((s) => (
        <span
          key={s.key}
          className="rounded-full bg-sage-50 px-2 py-0.5 text-[10px] font-semibold text-sage-700 ring-1 ring-sage-200"
        >
          {s.label}
        </span>
      ))}
    </>
  );
}

/**
 * בורר היקף השיתוף: כל המערכת, או מסכים נבחרים.
 * זו שכבת UX בלבד — ההיקף נאכף במדיניות ה-RLS ב-CockroachDB.
 */
function ScopePicker({ scopes, onChange, idPrefix }) {
  const full = isFullScope(scopes);

  function toggle(key) {
    const current = full ? [...ALL_SCOPES] : ALL_SCOPES.filter((k) => scopes.includes(k));
    const next = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key];
    if (!next.length) return; // חייב להישאר לפחות מסך אחד
    onChange(next.length === ALL_SCOPES.length ? ["all"] : next);
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange(["all"])}
          aria-pressed={full}
          className={`filter-chip min-w-0 flex-1 text-xs ${full ? "filter-chip-active" : ""}`}
        >
          כל המערכת
        </button>
        <button
          type="button"
          onClick={() => onChange(full ? ["guests"] : scopes)}
          aria-pressed={!full}
          className={`filter-chip min-w-0 flex-1 text-xs ${!full ? "filter-chip-active" : ""}`}
        >
          מסכים נבחרים
        </button>
      </div>

      {!full && (
        <div className="space-y-1.5 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          {SCOPE_OPTIONS.map((s) => {
            const checked = hasScope(scopes, s.key);
            return (
              <label
                key={s.key}
                htmlFor={`${idPrefix}-${s.key}`}
                className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700"
              >
                <input
                  id={`${idPrefix}-${s.key}`}
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(s.key)}
                  className="h-4 w-4 accent-[var(--color-gold-500)]"
                />
                {s.label}
              </label>
            );
          })}
          <p className="pt-1 text-[11px] text-slate-400">
            הדאשבורד הראשי מוצג רק בשיתוף מלא, כי הוא מסכם את כל המסכים.
          </p>
        </div>
      )}
    </div>
  );
}

/* =========================================================================
 *  WEDDING SETTINGS MODAL
 * ====================================================================== */

function PasskeyPanel({ currentUserId }) {
  const [supported, setSupported] = useState(false);
  const [keys, setKeys] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      setKeys(await listPasskeys());
    } catch (err) {
      console.error("Failed to load passkeys:", err);
      setKeys([]);
    }
  }, []);

  useEffect(() => {
    let active = true;
    platformAuthenticatorAvailable().then((available) => {
      if (!active) return;
      setSupported(available);
      if (available) refresh();
    });
    return () => {
      active = false;
    };
  }, [refresh, currentUserId]);

  if (!supported) return null;

  async function enable() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await registerPasskey(navigator.platform || "המכשיר שלי");
      await refresh();
      setMessage("הכניסה המהירה הופעלה במכשיר הזה.");
    } catch (err) {
      console.error("Passkey registration failed:", err);
      setError(passkeyErrorMessage(err, "register"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    const ok = await confirmDialog({
      title: "הסרת כניסה מהירה",
      message: "להסיר את מפתח הכניסה מהמכשיר הזה? תמיד אפשר להיכנס עם מייל וסיסמה.",
      confirmLabel: "הסרה",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await deletePasskey(id);
      await refresh();
    } catch (err) {
      setError(passkeyErrorMessage(err, "manage"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-5 space-y-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
      <div className="flex items-start gap-3">
        <Fingerprint size={19} className="mt-0.5 shrink-0 text-gold-600" />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-bold text-slate-800">כניסה מהירה עם Passkey</h4>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            כניסה באמצעות Face ID, טביעת אצבע או Windows Hello. המפתח נשמר במכשיר ולא נשלחת ממנו סיסמה.
          </p>
        </div>
      </div>
      {keys.map((key) => (
        <div key={key.id || key.credentialId} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
          <span className="min-w-0 truncate text-xs font-medium text-slate-700">{key.label || "מכשיר רשום"}</span>
          <button type="button" onClick={() => remove(key.id || key.credentialId)} disabled={busy} className="btn-danger shrink-0 px-3 text-xs">
            הסרה
          </button>
        </div>
      ))}
      <button type="button" onClick={enable} disabled={busy} className="btn-secondary px-3 text-xs">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
        הוספת Passkey למכשיר הזה
      </button>
      {message && <p className="text-xs text-sage-700">{message}</p>}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </section>
  );
}

/**
 * בית אחד לכל ההגדרות הכלליות של החתונה — נתונים שקובעים פעם אחת בהתחלה
 * ולא נוגעים בהם תוך כדי עבודה. לפני כן הם היו פזורים בתוך מסכי העבודה
 * (כפתור "שינוי תאריך" באמצע הדאשבורד, עריכת שמות בכותרת), וזה גם הסתיר
 * אותם וגם הפריע לשימוש היומיומי.
 */
function WeddingSettingsModal({
  couple,
  weddingDate,
  weddingName = "",
  budgetGoal,
  currentUserId,
  canEditBasics,
  canEditBudgetGoal,
  showDate,
  weddingId = null,
  onSaveBasics,
  onSaveBudgetGoal,
  onDeleteWedding,
  onClose,
}) {
  const [partnerA, setPartnerA] = useState(couple?.partnerA || "");
  const [partnerB, setPartnerB] = useState(couple?.partnerB || "");
  const [date, setDate] = useState(String(weddingDate || "").slice(0, 10));
  const [goal, setGoal] = useState(String(budgetGoal || ""));
  const [initialDraft, setInitialDraft] = useState(() => ({
    partnerA: couple?.partnerA || "",
    partnerB: couple?.partnerB || "",
    date: String(weddingDate || "").slice(0, 10),
    goal: String(budgetGoal || ""),
  }));
  const dialogRef = useRef(null);
  const firstFieldRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [budgetSaveStatus, setBudgetSaveStatus] = useState("");
  const [basicsSaveStatus, setBasicsSaveStatus] = useState("");

  //  צירוף בן/בת הזוג אינו חלק מטופס השמירה: זו פעולה חד-פעמית שפותחת
  //  חשבון ושולחת מייל, ואין לה מצב של "עוד לא נשמר".
  const [partnerEmail, setPartnerEmail] = useState("");
  const [partnerBusy, setPartnerBusy] = useState(false);
  const [partnerMsg, setPartnerMsg] = useState("");
  const [partnerError, setPartnerError] = useState("");

  const isDirty =
    partnerA !== initialDraft.partnerA ||
    partnerB !== initialDraft.partnerB ||
    date !== initialDraft.date ||
    goal !== initialDraft.goal ||
    !!partnerEmail.trim() ||
    !!deleteConfirmation.trim();

  async function requestClose() {
    if (busy || deleteBusy || partnerBusy) return;
    if (isDirty) {
      const discard = await confirmDialog({
        title: "לסגור בלי לשמור שינויים?",
        message: "השינויים שהקלדתם בהגדרות ובכתובת בן/בת הזוג יימחקו.",
        confirmLabel: "סגירה בלי לשמור",
        cancelLabel: "המשך עריכה",
        tone: "danger",
      });
      if (!discard) return;
    }
    onClose();
  }

  useAccessibleModal({
    open: true,
    containerRef: dialogRef,
    initialFocusRef: firstFieldRef,
    onRequestClose: requestClose,
  });

  async function addPartnerAccount() {
    const address = partnerEmail.trim();
    setPartnerMsg("");
    setPartnerError("");
    if (!isValidEmail(address)) {
      setPartnerError("כתובת המייל אינה תקינה. לדוגמה: name@example.com");
      return;
    }

    setPartnerBusy(true);
    try {
      const res = await addPartner(weddingId, address);
      setPartnerEmail("");
      setPartnerMsg(
        res?.alreadyMember
          ? `${res.email} כבר משותף/ת בחתונה הזו — לא בוצע שינוי.`
          : res?.created
            ? `נשלח ל-${res.email} קישור לקביעת סיסמה. אחרי שיקבעו אותה הכניסה תהיה עם המייל והסיסמה שלהם.`
            : `${res.email} צורף/ה לחתונה. הכניסה היא עם הסיסמה הקיימת שלו/ה.`
      );
    } catch (err) {
      const code = `${err?.code || ""} ${err?.message || ""}`;
      setPartnerError(
        String(code).includes("partner_email_unverified")
          ? "לכתובת הזו כבר קיים חשבון שלא אומת. בעל החשבון צריך להתחבר ולאמת את המייל לפני הצירוף."
          : code === "cannot_invite_self"
          ? "זו כתובת המייל שלכם. הזינו את הכתובת של בן/בת הזוג."
          : code === "invalid_email"
            ? "כתובת המייל אינה תקינה."
            : code === "too_many_attempts"
              ? "בוצעו יותר מדי ניסיונות. נסו שוב בעוד שעה."
              : "צירוף בן/בת הזוג נכשל. נסו שוב."
      );
    } finally {
      setPartnerBusy(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setBudgetSaveStatus("");
    setBasicsSaveStatus("");
    const nextGoal = Math.max(0, Number(goal) || 0);
    const goalChanged = canEditBudgetGoal && nextGoal !== (Number(initialDraft.goal) || 0);
    const basicsChanged = canEditBasics && (
      partnerA.trim() !== initialDraft.partnerA ||
      partnerB.trim() !== initialDraft.partnerB ||
      (showDate && date !== initialDraft.date)
    );
    const failures = [];
    const savedSections = [];

    if (goalChanged) {
      try {
        await onSaveBudgetGoal(nextGoal);
        setInitialDraft((previous) => ({ ...previous, goal: String(nextGoal) }));
        setBudgetSaveStatus("saved");
        savedSections.push("יעד התקציב");
      } catch (err) {
        console.error("Failed to save budget goal:", err);
        setBudgetSaveStatus("error");
        failures.push("יעד התקציב");
      }
    }

    if (basicsChanged) {
      try {
        await onSaveBasics({
          partnerA: partnerA.trim(),
          partnerB: partnerB.trim(),
          date: showDate ? date : undefined,
        });
        setInitialDraft((previous) => ({
          ...previous,
          partnerA: partnerA.trim(),
          partnerB: partnerB.trim(),
          date: showDate ? date : previous.date,
        }));
        setBasicsSaveStatus("saved");
        savedSections.push("פרטי החתונה");
      } catch (err) {
        console.error("Failed to save wedding basics:", err);
        setBasicsSaveStatus("error");
        failures.push("פרטי החתונה");
      }
    }

    setBusy(false);
    if (failures.length) {
      notify(
        `${savedSections.length ? `נשמרו בהצלחה: ${savedSections.join(", ")}. ` : ""}לא נשמרו: ${failures.join(", ")}. אפשר לנסות שוב.`,
        { tone: "error", duration: 8000 }
      );
      return;
    }

    notify(
      savedSections.length ? `נשמרו בהצלחה: ${savedSections.join(", ")}.` : "ההגדרות נשמרו",
      { tone: "success" }
    );
    onClose();
  }

  async function removeWedding() {
    if (!onDeleteWedding || deleteConfirmation.trim() !== weddingName.trim()) return;
    setDeleteBusy(true);
    try {
      await onDeleteWedding(weddingId, deleteConfirmation.trim());
      notify("החתונה וכל הנתונים שלה נמחקו", { tone: "success" });
      onClose();
    } catch (err) {
      console.error("Failed to delete wedding:", err);
      notify("מחיקת החתונה נכשלה. נסו שוב.", { tone: "error" });
    } finally {
      setDeleteBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-gold-400 focus:ring-2 focus:ring-gold-100 disabled:bg-slate-50 disabled:text-slate-400";

  return (
    <div
      className="fixed inset-0 z-[105] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={requestClose}
    >
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wedding-settings-title"
        onSubmit={save}
        className="animate-fade-in-up relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white p-5 shadow-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={requestClose}
          disabled={busy || deleteBusy || partnerBusy}
          aria-label="סגירה"
          title="סגירה"
          className="btn-icon absolute left-4 top-4"
        >
          <X size={18} />
        </button>

        <div className="mb-5 flex items-center gap-3 pl-10">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-gold-400 to-sage-400 text-white">
            <Settings2 size={20} />
          </div>
          <div className="min-w-0">
            <h3 id="wedding-settings-title" className="font-display text-lg font-bold text-slate-800">
              הגדרות החתונה
            </h3>
            <p className="text-xs text-slate-500">
              הפרטים הקבועים שנקבעים פעם אחת
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pb-4">
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-500">
              שמות בני הזוג
            </p>
            <div className="grid grid-cols-2 gap-2">
              <input
                ref={firstFieldRef}
                value={partnerA}
                onChange={(e) => setPartnerA(e.target.value)}
                disabled={!canEditBasics}
                placeholder="בן/בת זוג א׳"
                maxLength={80}
                className={inputCls}
                aria-label="שם בן/בת זוג א׳"
              />
              <input
                value={partnerB}
                onChange={(e) => setPartnerB(e.target.value)}
                disabled={!canEditBasics}
                placeholder="בן/בת זוג ב׳"
                maxLength={80}
                className={inputCls}
                aria-label="שם בן/בת זוג ב׳"
              />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              השמות האלה הם כותרת החתונה בכל המסכים ובקובץ האקסל.
            </p>
            {basicsSaveStatus && (
              <p aria-live="polite" className={`mt-1.5 text-xs font-medium ${basicsSaveStatus === "saved" ? "text-sage-700" : "text-rose-700"}`}>
                {basicsSaveStatus === "saved" ? "פרטי החתונה נשמרו." : "שמירת פרטי החתונה נכשלה. אפשר לנסות שוב."}
              </p>
            )}
          </div>

          {showDate && (
            <div>
              <label
                htmlFor="wedding-date"
                className="mb-2 block text-xs font-semibold text-slate-500"
              >
                תאריך החתונה
              </label>
              <input
                id="wedding-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={!canEditBasics}
                className={inputCls}
              />
              <p className="mt-1.5 text-[11px] text-slate-400">
                הספירה לאחור בדאשבורד מתעדכנת מיד.
              </p>
            </div>
          )}

          <div>
            <label
              htmlFor="budget-goal"
              className="mb-2 block text-xs font-semibold text-slate-500"
            >
              יעד תקציב כולל (₪)
            </label>
            <input
              id="budget-goal"
              type="number"
              min="0"
              step="1000"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              disabled={!canEditBudgetGoal}
              placeholder="לדוגמה: 200000"
              className={inputCls}
            />
            <p className="mt-1.5 text-[11px] text-slate-400">
              הסכום שאתם מוכנים להוציא בסך הכול. משמש להשוואה במסך התקציב.
            </p>
            {budgetSaveStatus && (
              <p aria-live="polite" className={`mt-1.5 text-xs font-medium ${budgetSaveStatus === "saved" ? "text-sage-700" : "text-rose-700"}`}>
                {budgetSaveStatus === "saved" ? "יעד התקציב נשמר." : "שמירת יעד התקציב נכשלה. אפשר לנסות שוב."}
              </p>
            )}
          </div>

          {/*  נפרד מכפתור השמירה בכוונה: זו פעולה שפותחת חשבון אמיתי
              ושולחת מייל, ואי-אפשר לבטל אותה בעזרת "ביטול".  */}
          {weddingId && (
            <div className="rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-200">
              <label
                htmlFor="settings-partner-email"
                className="mb-2 block text-xs font-semibold text-slate-500"
              >
                צירוף בן/בת הזוג
              </label>
              <div className="flex gap-2">
                <input
                  id="settings-partner-email"
                  type="email"
                  value={partnerEmail}
                  onChange={(e) => setPartnerEmail(e.target.value)}
                  disabled={partnerBusy}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="name@example.com"
                  dir="ltr"
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={addPartnerAccount}
                  disabled={partnerBusy || !partnerEmail.trim()}
                  className="shrink-0 rounded-xl bg-sage-500 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-sage-600 disabled:opacity-50"
                >
                  {partnerBusy ? "מצרף…" : "צירוף"}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">
                יישלח לכתובת קישור לקביעת סיסמה משלהם, ולאחר מכן תהיה להם כניסה
                נפרדת לאותה חתונה, עם גישה מלאה לכל המסכים. הסיסמה שלהם
                נפרדת משלכם — אתם לא רואים אותה והם לא רואים את שלכם.
              </p>
              {partnerMsg && (
                <p className="mt-2 rounded-lg bg-sage-50 px-2.5 py-1.5 text-[11px] text-sage-700 ring-1 ring-sage-200">
                  {partnerMsg}
                </p>
              )}
              {partnerError && (
                <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-600 ring-1 ring-rose-200">
                  {partnerError}
                </p>
              )}
            </div>
          )}
        </div>

        <PasskeyPanel currentUserId={currentUserId} />

        {onDeleteWedding && (
          <section className="mt-5 space-y-3 rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
            <div>
              <h4 className="text-sm font-bold text-rose-800">מחיקת החתונה</h4>
              <p className="mt-1 text-xs leading-5 text-rose-700">
                פעולה זו מוחקת לצמיתות את החתונה, החברים, הנתונים והקבצים שלה.
                לא ניתן לבטל אותה.
              </p>
            </div>
            <label className="block space-y-1 text-xs font-medium text-rose-800">
              הקלידו את שם החתונה לאישור: <bdi>{weddingName}</bdi>
              <input
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                className="w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              onClick={removeWedding}
              disabled={deleteBusy || deleteConfirmation.trim() !== weddingName.trim()}
              className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleteBusy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              מחיקה לצמיתות
            </button>
          </section>
        )}

        {!canEditBasics && (
          <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            שמות בני הזוג ותאריך החתונה ניתנים לשינוי על ידי בעלי החתונה בלבד.
          </p>
        )}
        </div>

        <div className="sticky bottom-0 z-10 -mx-5 flex shrink-0 gap-2 border-t border-slate-100 bg-white/95 px-5 pt-3 backdrop-blur sm:-mx-6 sm:px-6">
          <button
            type="submit"
            disabled={busy || deleteBusy || partnerBusy}
            className="btn-primary flex-1 disabled:opacity-60"
          >
            {busy ? "שומר…" : "שמירה"}
          </button>
          <button
            type="button"
            onClick={requestClose}
            disabled={busy || deleteBusy || partnerBusy}
            className="btn-secondary"
          >
            ביטול
          </button>
        </div>
      </form>
    </div>
  );
}

/* =========================================================================
 *  מי מחובר לחתונה
 *  ------------------------------------------------------------------------
 *  למערכת אין חיבור קבוע פתוח מול הדפדפן, ולכן “מחובר” כאן =
 *  “נגע בחתונה הזו לאחרונה”. השרת מעדכן את החותמת לכל היותר פעם
 *  ב-5 דקות, ולכן החלון כאן רחב ממנו — אחרת מי שיושב ועובד היה
 *  מהבהב בין “מחובר” ל”לא מחובר” בכל רענון.
 * ====================================================================== */
const ONLINE_WINDOW_MS = 10 * 60_000;

function presenceLabel(lastSeenAt) {
  if (!lastSeenAt) return { online: false, text: "טרם נכנס/ה לחתונה" };
  const at = new Date(lastSeenAt).getTime();
  if (Number.isNaN(at)) return { online: false, text: "" };

  const diff = Date.now() - at;
  if (diff < ONLINE_WINDOW_MS) return { online: true, text: "מחובר/ת עכשיו" };

  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return { online: false, text: `פעיל/ה לפני ${minutes} דקות` };

  const hours = Math.round(minutes / 60);
  if (hours < 24)
    return { online: false, text: hours === 1 ? "פעיל/ה לפני שעה" : `פעיל/ה לפני ${hours} שעות` };

  const days = Math.round(hours / 24);
  if (days < 30)
    return { online: false, text: days === 1 ? "פעיל/ה אתמול" : `פעיל/ה לפני ${days} ימים` };

  return {
    online: false,
    text: `נכנס/ה לאחרונה ב-${new Date(at).toLocaleDateString("he-IL")}`,
  };
}

function MembersModal({
  weddingId,
  isOwner,
  currentUserId,
  weddingName = "",
  onClose,
}) {
  const dialogRef = useRef(null);
  const emailRef = useRef(null);
  const [members, setMembers] = useState(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [scopes, setScopes] = useState(["all"]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(""); // מוצג בתוך המודל, לא כטוסט
  const [lastLink, setLastLink] = useState("");
  const [lastEmail, setLastEmail] = useState("");
  const [editing, setEditing] = useState(null); // userId שנמצא בעריכת הרשאות
  const [savingMember, setSavingMember] = useState(false);
  const isDirty = !!email.trim() || role !== "editor" || !isFullScope(scopes) || editing !== null;

  async function requestClose() {
    if (busy || savingMember) return;
    if (isDirty) {
      const discard = await confirmDialog({
        title: "לסגור בלי לשמור שינויים?",
        message: "טיוטת ההזמנה או עריכת ההרשאות שביצעתם תימחק.",
        confirmLabel: "סגירה בלי לשמור",
        cancelLabel: "המשך עריכה",
        tone: "danger",
      });
      if (!discard) return;
    }
    onClose();
  }

  useAccessibleModal({
    open: true,
    containerRef: dialogRef,
    initialFocusRef: emailRef,
    onRequestClose: requestClose,
  });

  const onlineCount =
    members?.filter((m) => presenceLabel(m.lastSeenAt).online).length ?? 0;

  //  אין שליחת מיילים אוטומטית להזמנות, ולכן ההזמנה נשלחת על ידי המשתמש
  //  עצמו: ווטסאפ, אימייל או העתקה. כשההזמנה נצמדה לכתובת מייל ההודעה
  //  מזכירה אותה, אחרת הנמען מנסה להתחבר עם חשבון אחר והקישור נכשל.
  const eventLabel = weddingName || "החתונה שלנו";
  const shareSubject = `הזמנה לתכנון ${eventLabel}`;
  const shareMessage =
    `היי! שיתפתי אותך במערכת לתכנון ${eventLabel}.\n` +
    `להצטרפות: ${lastLink}\n` +
    (lastEmail ? `הקישור ממתין לכתובת המייל: ${lastEmail}\n` : "") +
    "פתחו חשבון משלכם עם המייל שלכם — לא בפרטים שלי.\n" +
    "הקישור תקף 7 ימים ומיועד לשימוש חד-פעמי.";

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(lastLink);
      notify("הקישור הועתק", { tone: "success" });
    } catch {
      //  clipboard API חסום בהקשר לא-מאובטח או בלי הרשאה. במקרה כזה
      //  התיבה למעלה עדיין מאפשרת העתקה ידנית.
      notify("ההעתקה נחסמה בדפדפן. סמנו את הקישור והעתיקו ידנית.", {
        tone: "error",
      });
    }
  }, [lastLink]);

  const load = useCallback(async () => {
    try {
      setMembers(await listMembers(weddingId, isOwner));
    } catch (err) {
      console.error(err);
      notify("טעינת רשימת החברים נכשלה", { tone: "error" });
      setMembers([]);
    }
  }, [weddingId, isOwner]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  //  הרשימה מציגה מי מחובר *עכשיו*, ולכן היא מתרעננת מעצמה כל עוד
  //  החלון פתוח. רק לבעלים — לחבר רגיל השרת מחזיר רק את עצמו,
  //  ואין שום דבר שישתנה בין רענונים.
  useEffect(() => {
    if (!isOwner) return;
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [isOwner, load]);

  async function invite(e) {
    e.preventDefault();
    //  המייל הוא רשות: בלעדיו נוצרת הזמנת קישור שכל מי שמקבל אותה יכול
    //  לממש פעם אחת. מוודאים רק שכתובת שכן הוזנה היא תקינה — ולידציה
    //  משלנו ולא של הדפדפן, כי ההודעה של `type="email"` מוצגת באנגלית
    //  ובכיוון LTR, ומעל הכול היא נבלעת לגמרי כשהטופס בתוך מודל.
    const address = email.trim();
    if (address && !isValidEmail(address)) {
      setFormError("כתובת המייל אינה תקינה. לדוגמה: name@example.com");
      return;
    }
    setFormError("");
    setBusy(true);
    try {
      const inv = await inviteMember(weddingId, address, role, scopes);
      setLastLink(inv.link);
      setLastEmail(address.toLowerCase());
      setEmail("");
      setRole("editor");
      setScopes(["all"]);
      setEditing(null);
      setFormError("");
      notify("הקישור מוכן – שלחו אותו למי שרוצים לשתף", { tone: "success" });
    } catch (err) {
      console.error(err);
      //  שגיאה גנרית משאירה את המשתמש בלי מושג מה לתקן. הקודים מגיעים
      //  מהשרת, שהוא מקור האמת היחיד לכללי ההזמנה.
      const byCode = {
        cannot_invite_self: "אתם כבר בעלים של החתונה – אין צורך להזמין את עצמכם.",
        invalid_email: "כתובת המייל אינה תקינה. לדוגמה: name@example.com",
        invalid_scopes: "בחרו לפחות מסך אחד לשיתוף.",
        invalid_role: "רמת ההרשאה אינה תקינה.",
        forbidden: "רק בעלים של החתונה יכול להזמין.",
        timeout: "המערכת לא השיבה בזמן. נסו שוב בעוד רגע.",
        network_error: "אין חיבור למערכת. בדקו את האינטרנט ונסו שוב.",
      };
      setFormError(byCode[err?.code] || "יצירת הקישור נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function saveMember(m, nextRole, nextScopes) {
    setSavingMember(true);
    try {
      await updateMember(weddingId, m.userId, nextRole, nextScopes);
      notify("ההרשאות עודכנו", { tone: "success" });
      setEditing(null);
      load();
    } catch (err) {
      console.error(err);
      notify("עדכון ההרשאות נכשל", { tone: "error" });
    } finally {
      setSavingMember(false);
    }
  }

  async function revoke(m) {
    const self = m.userId === currentUserId;
    const ok = await confirmDialog({
      title: self ? "לעזוב את החתונה?" : `להסיר את ${m.email}?`,
      message: self
        ? "תאבד/י את הגישה לחתונה הזו עד שתקבל/י הזמנה חדשה."
        : "הגישה תיחסם מיידית, גם ב-API.",
      confirmLabel: self ? "עזיבה" : "הסרה",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await removeMember(weddingId, m.userId);
      notify(self ? "עזבת את החתונה" : "החבר הוסר", { tone: "success" });
      if (self) window.location.reload();
      else load();
    } catch (err) {
      console.error(err);
      notify("ההסרה נכשלה", { tone: "error" });
    }
  }

  return (
    <div
      className="fixed inset-0 z-[105] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={requestClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="שיתוף החתונה"
        className="animate-fade-in-up relative max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-auto overscroll-contain rounded-3xl bg-white p-5 shadow-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/*  כפתור הסגירה מקובע לפינה כדי שכותרת ארוכה לא תדחוף אותו למטה  */}
        <button
          onClick={requestClose}
          disabled={busy || savingMember}
          aria-label="סגירה"
          title="סגירה"
          className="btn-icon absolute left-5 top-5"
        >
          <X size={18} />
        </button>
        <div className="pl-10">
          <SectionTitle
            icon={Share2}
            title="שיתוף החתונה"
            subtitle="הזמינו בן/בת זוג, מפיק או משפחה – למערכת כולה או למסך אחד"
          />
        </div>

        {isOwner && (
          <form onSubmit={invite} noValidate className="mb-5 space-y-3">
            <div className="flex flex-wrap gap-2">
              {/*  w-full במסך צר: שלושת הפקדים בשורה אחת כווצו את שדה המייל
                  ל-48px בטלפון, כלומר אי-אפשר היה לראות מה מקלידים בו.  */}
              <input
                ref={emailRef}
                type="email"
                autoCapitalize="none"
                spellCheck={false}
                dir="ltr"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setFormError("");
                }}
                placeholder="name@example.com (רשות)"
                aria-label="כתובת מייל להזמנה – רשות"
                className="w-full min-w-0 rounded-xl bg-white px-3 py-2.5 text-sm outline-none ring-1 ring-slate-200 focus:ring-gold-400 sm:w-auto sm:flex-1"
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                aria-label="רמת הרשאה"
                className="min-w-0 rounded-xl bg-white px-3 py-2.5 text-sm outline-none ring-1 ring-slate-200 focus:ring-gold-400"
              >
                <option value="editor">עריכה</option>
                <option value="viewer">צפייה בלבד</option>
              </select>
              <button
                type="submit"
                disabled={busy}
                className="btn-primary disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <UserPlus size={16} />
                )}
                יצירת קישור
              </button>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-500">
                מה לשתף?
              </p>
              <ScopePicker scopes={scopes} onChange={setScopes} idPrefix="invite-scope" />
            </div>

            {/*  השגיאה חייבת להופיע כאן ולא כטוסט בתחתית המסך: כשהמודל פתוח
                הטוסט נבלע מאחוריו והמשתמש לא מבין למה כלום לא קורה.  */}
            {formError && (
              <p
                role="alert"
                className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 ring-1 ring-rose-200"
              >
                {formError}
              </p>
            )}

            <p className="text-[11px] text-slate-400">
              הקישור תקף 7 ימים וניתן למימוש פעם אחת בלבד. השיתוף מוגבל למה
              שסימנתם למעלה — גם אם המוזמן כבר משתמש במערכת.
              {" "}מילוי כתובת מייל הוא רשות: אם תמלאו, רק בעל אותה כתובת יוכל
              להצטרף; אם לא, כל מי שמקבל את הקישור יוכל להיכנס — אז שלחו אותו
              בערוץ פרטי.
              {" "}
              {/*  בלי המשפט הזה קל להניח שהמוזמן נכנס עם הפרטים של מי ששיתף —
                  וכניסה כבעל החשבון עוקפת את ההיקף שסימנתם כאן.  */}
              <strong className="font-semibold text-slate-500">
                המוזמן פותח חשבון משלו
              </strong>{" "}
              עם המייל והסיסמה שלו. אל תמסרו לו את הפרטים שלכם — הם נותנים גישה
              מלאה לכל המערכת.
            </p>
            {lastLink && (
              <div className="space-y-2 rounded-xl bg-sage-50 p-3 ring-1 ring-sage-200">
                <p className="text-[11px] font-semibold text-sage-800">
                  {lastEmail ? (
                    <>
                      הקישור מוכן – שלחו אותו אל{" "}
                      <span dir="ltr">{lastEmail}</span>:
                    </>
                  ) : (
                    "הקישור מוכן – שלחו אותו למי שרוצים לשתף:"
                  )}
                </p>
                <input
                  readOnly
                  dir="ltr"
                  value={lastLink}
                  onFocus={(e) => e.target.select()}
                  aria-label="קישור ההזמנה"
                  className="w-full rounded-lg bg-white px-2 py-1.5 text-[11px] text-sage-800 outline-none ring-1 ring-sage-200"
                />
                <div className="flex flex-wrap gap-2">
                  {/*  ווטסאפ נפתח בלשונית חדשה עם noopener – הקישור מכיל את
                      טוקן ההזמנה, ואסור לתת לדף היעד גישה לחלון שלנו.  */}
                  <button
                    type="button"
                    onClick={() =>
                      window.open(
                        `https://wa.me/?text=${encodeURIComponent(shareMessage)}`,
                        "_blank",
                        "noopener,noreferrer"
                      )
                    }
                    className="flex items-center gap-1.5 rounded-lg bg-[#25D366] px-3 py-1.5 text-[11px] font-semibold text-white transition hover:brightness-95"
                  >
                    <MessageCircle size={13} /> שליחה בוואטסאפ
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      window.location.href = `mailto:?subject=${encodeURIComponent(
                        shareSubject
                      )}&body=${encodeURIComponent(shareMessage)}`;
                    }}
                    className="btn-secondary px-3 text-xs"
                  >
                    <Mail size={13} /> שליחה באימייל
                  </button>
                  <button
                    type="button"
                    onClick={copyLink}
                    className="btn-secondary px-3 text-xs"
                  >
                    <Copy size={13} /> העתקת הקישור
                  </button>
                </div>
              </div>
            )}
          </form>
        )}

        <div className="space-y-2">
          {members === null && (
            <div className="flex justify-center py-6">
              <Loader2 className="animate-spin text-gold-500" size={22} />
            </div>
          )}
          {/*  לא-בעלים רואה ברשימה רק את עצמו, וזו הגבלת אבטחה במסד ולא תקלה.
              בלי המשפט הזה נראה כאילו הוא לבדו בחתונה.  */}
          {members !== null && !isOwner && (
            <p className="rounded-2xl bg-sage-50 px-3 py-2 text-right text-[12px] leading-relaxed text-sage-800">
              החתונה שותפה איתך. רשימת השותפים המלאה גלויה לבעלי החתונה בלבד —
              כאן מוצגת ההרשאה שלך.
            </p>
          )}
          {/*  שורת הסיכום עונה על השאלה בלי לקרוא את כל הרשימה: האם מישהו
              נמצא כאן איתי ברגע זה.  */}
          {isOwner && !!members?.length && (
            <div className="rounded-2xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
              <p className="flex items-center gap-2 text-[12px] font-semibold text-slate-700">
                <span
                  aria-hidden
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    onlineCount ? "animate-pulse bg-emerald-500" : "bg-slate-300"
                  }`}
                />
                {onlineCount === 0
                  ? "אף אחד לא מחובר כרגע"
                  : onlineCount === 1
                    ? "משתמש אחד מחובר כרגע"
                    : `${onlineCount} משתמשים מחוברים כרגע`}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                “מחובר” = פתח את החתונה או שמר בה שינוי בעשר הדקות האחרונות.
                הרשימה מתעדכנת מעצמה כל חצי דקה.
              </p>
            </div>
          )}
          {members?.map((m) => {
            const presence = presenceLabel(m.lastSeenAt);
            return (
              <div key={m.userId} className="rounded-2xl bg-slate-50 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className="min-w-0 flex-1 truncate text-sm text-slate-700"
                    dir="ltr"
                  >
                    {m.email}
                  </span>
                  <RoleBadge role={m.role} />
                  {isOwner && m.role !== "owner" && (
                    <button
                      onClick={() => setEditing(editing === m.userId ? null : m.userId)}
                      title="עריכת הרשאות"
                      aria-label="עריכת הרשאות"
                      className="btn-icon"
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                  {(isOwner || m.userId === currentUserId) && m.role !== "owner" && (
                    <button
                      onClick={() => revoke(m)}
                      title="הסרה"
                      aria-label="הסרת חבר"
                      className="btn-icon-danger"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>

                {isOwner && presence.text && (
                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span
                      aria-hidden
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        presence.online ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                    />
                    {presence.text}
                    {m.userId === currentUserId && " · זה אתם"}
                  </p>
                )}

                {m.role !== "owner" && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <ScopeChips scopes={m.scopes} />
                  </div>
                )}

                {editing === m.userId && (
                  <MemberPermissionEditor
                    member={m}
                    onCancel={() => setEditing(null)}
                    onSave={saveMember}
                  />
                )}
              </div>
            );
          })}
          {members?.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-400">אין חברים עדיין</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** עריכת התפקיד וההיקף של חבר קיים. */
function MemberPermissionEditor({ member, onCancel, onSave }) {
  const [role, setRole] = useState(member.role);
  const [scopes, setScopes] = useState(member.scopes ?? ["all"]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    await onSave(member, role, scopes);
    setBusy(false);
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl bg-white p-3 ring-1 ring-slate-200">
      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        aria-label="רמת הרשאה"
        className="w-full rounded-xl bg-white px-3 py-2 text-sm outline-none ring-1 ring-slate-200 focus:ring-gold-400"
      >
        <option value="editor">עריכה</option>
        <option value="viewer">צפייה בלבד</option>
      </select>
      <ScopePicker
        scopes={scopes}
        onChange={setScopes}
        idPrefix={`member-${member.userId}`}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="btn-primary min-h-11 flex-1 px-3 text-xs disabled:opacity-60"
        >
          {busy && <Loader2 size={13} className="animate-spin" />} שמירה
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary px-3 text-xs"
        >
          ביטול
        </button>
      </div>
    </div>
  );
}
