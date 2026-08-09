import { useCallback, useEffect, useMemo, useRef, useState, memo, createContext, useContext } from "react";
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
  ListTodo,
  Save,
  Settings2,
  Menu,
  MoreHorizontal,
  CheckCheck,
  Search,
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
} from "lucide-react";
import { SEED_GUESTS, GUEST_CATEGORIES, GUEST_SOURCES } from "./data/guestsData";
import { SEED_TABLES, SEED_VENDORS, SEED_BUDGET } from "./data/seedData";
import { isCloudConfigured } from "./lib/api";
import {
  loadSession,
  onAuthChange,
  signIn,
  signUp,
  signOut,
  authErrorMessage,
  requestPasswordReset,
  resetPassword,
} from "./lib/auth";
import {
  cloudFetchAll,
  cloudIsEmpty,
  cloudSeed,
  cloudSyncDataset,
  listWeddings,
  createWedding,
  updateWedding,
  saveWeddingSettings,
  inviteMember,
  acceptInvite,
  listMembers,
  removeMember,
  updateMember,
  hasScope,
  isFullScope,
  SCOPE_OPTIONS,
  ALL_SCOPES,
  listVendorFiles,
  uploadVendorFile,
  deleteVendorFile,
  vendorFileUrl,
  MAX_FILE_BYTES,
} from "./lib/cloudStore";
import {
  encryptBackup,
  decryptBackup,
  isEncryptedBackup,
  isCryptoAvailable,
} from "./lib/backupCrypto";
import { exportWeddingWorkbook } from "./lib/excelExport";
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
        setToasts((p) => [...p.filter((t) => t.id !== ev.toast.id), ev.toast]);
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
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[200] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => {
        const Icon = toneIcon[t.tone] || CheckCircle2;
        return (
          <div
            key={t.id}
            className={`animate-fade-in-up pointer-events-auto flex max-w-[92vw] items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium shadow-xl ring-1 ${
              toneCls[t.tone] || toneCls.info
            }`}
          >
            <Icon size={18} className="shrink-0" />
            <span>{t.message}</span>
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
  useEffect(() => {
    const listener = (r) => setReq(r);
    confirmListeners.add(listener);
    return () => confirmListeners.delete(listener);
  }, []);
  useEffect(() => {
    if (!req) return;
    const onKey = (e) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);
  if (!req) return null;
  const close = (val) => {
    req.resolve(val);
    setReq(null);
  };
  const danger = req.tone === "danger";
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={() => close(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
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
            <h3 className="text-lg font-bold text-slate-800">{req.title}</h3>
            {req.message && (
              <p className="mt-1 whitespace-pre-line text-sm text-slate-500">
                {req.message}
              </p>
            )}
          </div>
        </div>
        <div className="mt-6 flex justify-start gap-2">
          <button
            autoFocus
            onClick={() => close(true)}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition focus-visible:ring-2 focus-visible:ring-offset-2 ${
              danger
                ? "bg-rose-500 hover:bg-rose-600 focus-visible:ring-rose-400"
                : "bg-gold-500 hover:bg-gold-600 focus-visible:ring-gold-400"
            }`}
          >
            {req.confirmLabel || "אישור"}
          </button>
          <button
            onClick={() => close(false)}
            className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-300"
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
  useEffect(() => {
    const listener = (r) => {
      setReq(r);
      setValue(r.initialValue || "");
    };
    promptListeners.add(listener);
    return () => promptListeners.delete(listener);
  }, []);
  if (!req) return null;
  const close = (val) => {
    req.resolve(val);
    setReq(null);
    setValue("");
  };
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
        aria-label={req.title || "הזנת ערך"}
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
            <h3 className="text-lg font-bold text-slate-800">{req.title}</h3>
            {req.message && (
              <p className="mt-1 whitespace-pre-line text-sm text-slate-500">
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
            className="rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-gold-600"
          >
            {req.confirmLabel || "אישור"}
          </button>
          <button
            type="button"
            onClick={() => close(null)}
            className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50"
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

// Guaranteed-unique numeric id (one greater than the current max), so rapidly
// added guests can never collide — a collision would make delete remove 2 rows.
function nextGuestId(list) {
  return list.reduce((m, g) => Math.max(m, Number(g.id) || 0), 0) + 1;
}

//  אותו שיקול לכל אוסף אחר שה-id שלו משמש למחיקה/עריכה: Date.now()
//  חוזר על עצמו כשנוספות שתי שורות באותה מילישנייה, ואז מחיקה מוחקת שתיים.
function nextRowId(list) {
  return list.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
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

function SortHeader({ label, sortKey, sort, onSort, center = false }) {
  const active = sort.key === sortKey;
  return (
    <th className={`px-2 py-2 font-semibold ${center ? "text-center" : ""}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title="מיון לפי עמודה זו"
        className={`inline-flex items-center gap-1 transition hover:text-slate-700 ${
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

function Card({ children, className = "" }) {
  return (
    <div
      /*  רווח פנימי קטן יותר בנייד: ב-390px כל כרטיס ביזבז 40px מהרוחב
          ו-40px מהגובה רק על ריפוד, ויש עשרות כרטיסים במסך.  */
      className={`glass rounded-2xl p-3.5 shadow-[0_10px_40px_-15px_rgba(51,65,85,0.25)] sm:rounded-3xl sm:p-5 ${className}`}
    >
      {children}
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
          <h2 className="font-[var(--font-display)] text-lg font-bold text-slate-800 sm:text-2xl">
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
const NAV = [
  { key: "overview", label: "דאשבורד ראשי", icon: LayoutDashboard, scope: null },
  { key: "guests", label: "מוזמנים והושבה", icon: Users, scope: "guests" },
  { key: "vendors", label: "ספקים ומשימות", icon: Briefcase, scope: "vendors" },
  { key: "finance", label: "ניהול תקציב", icon: Wallet, scope: "finance" },
  { key: "portal", label: "פורטל ספקים", icon: Smartphone, scope: "vendors" },
];

/** מסנן את הניווט לפי ההיקף שהוקצה לחבר. ה-UI בלבד — ה-RLS הוא הגבול. */
function navForScopes(scopes) {
  if (isFullScope(scopes)) return NAV;
  return NAV.filter((item) => item.scope && hasScope(scopes, item.scope));
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
      if (document.querySelector('[role="dialog"]')) return;
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
  collapsed,
  setCollapsed,
  navItems = NAV,
  weddings = [],
  activeWedding = null,
  weddingDate = null,
  coupleTitle = "",
  onSwitchWedding,
  onCreateWedding,
  onOpenMembers,
  onOpenSettings,
}) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/30 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 right-0 z-40 flex w-72 flex-col gap-2 border-l border-white/40 bg-white/70 p-5 backdrop-blur-xl transition-transform duration-300 lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "translate-x-full"
        } ${collapsed ? "lg:hidden" : ""}`}
      >
        <div className="mb-6 flex items-center gap-3 px-2">
          <Logo className="h-12 w-12" />
          <div className="min-w-0">
            <h1 className="font-[var(--font-display)] text-xl font-bold leading-tight text-slate-800">
              תכנון החתונה שלי
            </h1>
            <p className="truncate text-xs text-slate-500">
              {coupleTitle || activeWedding?.name || "החתונה שלנו"}
            </p>
          </div>
          <button
            onClick={() => setCollapsed(true)}
            title="הסתרת התפריט לתצוגה ברוחב מלא"
            aria-label="הסתרת התפריט"
            className="mr-auto hidden shrink-0 rounded-xl p-2 text-slate-400 transition hover:bg-white hover:text-slate-700 lg:block"
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
                onClick={() => {
                  onChange(key);
                  setOpen(false);
                }}
                className={`group flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition-all ${
                  isActive
                    ? "bg-gradient-to-l from-gold-500 to-gold-400 text-white shadow-lg shadow-gold-500/30"
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
      </aside>
    </>
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
  goalTitle: "יעד התקציב הכולל",
  goalSubtitle: "קבעו את התקרה הכוללת לחתונה",
  statPlanned: "תקציב מתוכנן",
  statActual: "הוצאה בפועל",
  statIncome: "הכנסות (מתנות)",
  statBalance: "מאזן סופי",
  sectionTitle: "מעקב תקציב מפורט",
  sectionSubtitle: "עלות צפויה מול עלות בפועל לכל סעיף",
  colCategory: "סעיף",
  colExpected: "צפוי",
  colActual: "בפועל",
  colDiff: "פער",
};

// Inline click-to-edit label. Renders as text with a subtle pencil affordance;
// clicking turns it into an input that commits on blur / Enter (Esc cancels).
function EditableText({
  value,
  onCommit,
  className = "",
  inputClassName = "",
  placeholder = "",
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
        className={`min-w-0 max-w-full rounded-md border border-gold-300 bg-white px-1.5 py-0.5 text-inherit outline-none focus:border-gold-500 ${inputClassName}`}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="לחצו לעריכת הכותרת"
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
    <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 font-[var(--font-display)] text-2xl font-bold sm:text-3xl">
      <span className="justify-self-end">{name("partnerA", "בן/בת זוג א׳")}</span>
      <span className="text-gold-300">&amp;</span>
      <span className="justify-self-start">{name("partnerB", "בן/בת זוג ב׳")}</span>
    </div>
  );
}

function Countdown({ date, couple = null, canEditSettings = false, onOpenSettings }) {
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
    <Card className="relative overflow-hidden bg-gradient-to-br from-slate-800 via-slate-700 to-slate-800 text-white">
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
          <button
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-white/70 underline decoration-white/30 underline-offset-4 transition hover:text-white"
          >
            <Settings2 size={13} />
            להשלמת פרטי החתונה
          </button>
        )}
      </div>
    </Card>
  );
}

function Overview({
  guests,
  vendors,
  budget,
  weddingDate,
  couple,
  canEditSettings,
  onOpenSettings,
}) {
  const stats = useMemo(() => {
    const totalExpected = budget.reduce((s, b) => s + b.expected, 0);
    const totalSpent = budget.reduce((s, b) => s + b.actual, 0);
    const invited = guests.reduce((s, g) => s + (g.rsvp !== "declined" ? g.seats || 1 : 0), 0);
    const confirmed = guests
      .filter((g) => g.rsvp === "confirmed")
      .reduce((s, g) => {
        const seats = g.seats || 1;
        return s + (g.attendingCount != null ? Math.min(g.attendingCount, seats) : seats);
      }, 0);
    const probably = guests
      .filter((g) => g.probablyComing)
      .reduce((s, g) => s + (g.seats || 0), 0);
    const considering = guests.filter((g) => g.considering).length;
    const openTasks = vendors.reduce(
      (s, v) => s + v.tasks.filter((t) => t.status !== "done").length,
      0
    );
    const totalTasks = vendors.reduce((s, v) => s + v.tasks.length, 0);
    return {
      totalExpected,
      totalSpent,
      invited,
      confirmed,
      probably,
      considering,
      openTasks,
      totalTasks,
    };
  }, [guests, vendors, budget]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Countdown hero */}
      <Countdown
        date={weddingDate}
        couple={couple}
        canEditSettings={canEditSettings}
        onOpenSettings={onOpenSettings}
      />

      {/* Summary cards */}
      {/*  שתי עמודות גם בנייד: כרטיס נתון בשורה שלמה מבזבז את מחצית הרוחב.  */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-4 xl:grid-cols-3">
        <StatCard
          icon={Wallet}
          label="תקציב מול הוצאה"
          value={fmt(stats.totalSpent)}
          sub={`מתוך תקציב מתוכנן של ${fmt(stats.totalExpected)}`}
          tone="gold"
        >
          <ProgressBar value={stats.totalSpent} max={stats.totalExpected} tone="gold" />
        </StatCard>

        <StatCard
          icon={Star}
          label="כנראה יבואו (כיסאות)"
          value={stats.probably}
          sub={`מתוך ${stats.invited} מוזמנים ברשימה`}
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
      </div>

      {/* Vendors quick glance */}
      <Card>
        <SectionTitle
          icon={Briefcase}
          title="הספקים שלנו במבט מהיר"
          subtitle="סטטוס משימות ויתרת תשלום"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {vendors.map((v) => {
            const done = v.tasks.filter((t) => t.status === "done").length;
            const balance = v.contractCost - v.deposit;
            return (
              <div
                key={v.id}
                className="flex items-center justify-between rounded-2xl bg-white/60 p-4 ring-1 ring-slate-200/70"
              >
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
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/* =========================================================================
 *  GUESTS + SEATING MODULE
 * ====================================================================== */

const GuestRow = memo(function GuestRow({
  g,
  tableLabel,
  selected,
  onToggleSelect,
  updateName,
  updatePhone,
  updateCategory,
  updateMention,
  updateSeats,
  updateGift,
  toggleFlag,
  updateRsvp,
  updateAttending,
  removeGuest,
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
        <input
          type="checkbox"
          checked={!!selected}
          onChange={() => onToggleSelect(g.id)}
          aria-label={`בחירת ${g.name || "מוזמן"}`}
          className="h-4 w-4 cursor-pointer accent-gold-500"
        />
      </td>
      <td className="px-2 py-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== (g.name || "") && updateName(g.id, name)}
          placeholder="שם"
          className="w-36 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-sm font-semibold text-slate-800 outline-none focus:border-gold-400"
        />
      </td>
      <td className="px-2 py-3">
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={() => phone !== (g.phone || "") && updatePhone(g.id, phone)}
          placeholder="נייד"
          type="tel"
          dir="ltr"
          className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-start text-sm tabular-nums outline-none focus:border-gold-400"
        />
      </td>
      <td className="px-2 py-3">
        <select
          value={g.category}
          onChange={(e) => updateCategory(g.id, e.target.value)}
          title="שינוי קטגוריה"
          className={`max-w-[180px] cursor-pointer rounded-full px-2 py-1 text-xs font-semibold ring-inset outline-none transition focus:ring-2 ${
            g.category?.startsWith("צד כלה") ? "ring-2" : "ring-1"
          } ${categoryStyle(g.category)}`}
        >
          {categories.map((c) => (
            <option key={c} value={c} className="bg-white text-slate-700">
              {c}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-3">
        <input
          value={mention}
          onChange={(e) => setMention(e.target.value)}
          onBlur={() => mention !== (g.mention || "") && updateMention(g.id, mention)}
          placeholder="אזכור"
          className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-sm outline-none focus:border-gold-400"
        />
      </td>
      <td className="px-2 py-3">
        <input
          value={seats}
          onChange={(e) => setSeats(e.target.value)}
          onBlur={() => {
            const n = Math.max(1, Number(seats) || 1);
            if (n !== (g.seats || 1)) updateSeats(g.id, n);
            setSeats(n);
          }}
          type="number"
          min="1"
          title="מספר הכיסאות לרשומה זו"
          className="w-14 rounded-lg border border-slate-200 bg-white px-2 py-1 text-center text-sm font-semibold tabular-nums text-slate-700 outline-none focus:border-gold-400"
        />
      </td>
      <td className="px-2 py-3 text-center">
        <label
          title="נדרש להזמין מנת בד״צ / גלאט"
          className="inline-flex cursor-pointer items-center justify-center"
        >
          <input
            type="checkbox"
            checked={!!g.glatt}
            onChange={() => toggleFlag(g.id, "glatt")}
            className="h-5 w-5 accent-gold-500"
          />
        </label>
      </td>
      <td className="px-2 py-3">
        {tableLabel ? (
          <Badge color="sage">
            <Armchair size={12} /> {tableLabel}
          </Badge>
        ) : (
          <span className="text-xs text-slate-400">לא משובץ</span>
        )}
      </td>
      <td className="px-2 py-3 text-center">
        <button
          onClick={() => toggleFlag(g.id, "probablyComing")}
          aria-label={g.probablyComing ? "מסומן ככנראה יבוא" : "סימון ככנראה יבוא"}
          aria-pressed={!!g.probablyComing}
          title="כנראה יבוא"
          className={`grid h-8 w-8 place-items-center rounded-lg transition focus-visible:ring-2 focus-visible:ring-sage-400 focus-visible:outline-none ${
            g.probablyComing
              ? "bg-sage-100 text-sage-600 ring-1 ring-sage-300"
              : "text-slate-400 hover:bg-slate-100"
          }`}
        >
          {g.probablyComing ? <CheckCircle2 size={18} /> : <Circle size={18} />}
        </button>
      </td>
      <td className="px-2 py-3 text-center">
        <button
          onClick={() => toggleFlag(g.id, "considering")}
          aria-label={g.considering ? "מסומן לשקילה" : "סימון לשקילה"}
          aria-pressed={!!g.considering}
          title="לשקול אם להזמין"
          className={`grid h-8 w-8 place-items-center rounded-lg transition focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none ${
            g.considering
              ? "bg-rose-100 text-rose-600 ring-1 ring-rose-300"
              : "text-slate-400 hover:bg-slate-100"
          }`}
        >
          <HelpCircle size={18} className={g.considering ? "fill-rose-200" : ""} />
        </button>
      </td>
      <td className="px-2 py-3">
        <div className="flex flex-col gap-1">
          <select
            value={RSVP[g.rsvp] ? g.rsvp : "pending"}
            onChange={(e) => updateRsvp(g.id, e.target.value)}
            aria-label="אישור הגעה"
            title="שינוי סטטוס אישור הגעה"
            className={`cursor-pointer rounded-full px-2 py-1 text-xs font-semibold ring-1 ring-inset outline-none transition focus:ring-2 ${
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
                onChange={(e) => setAttending(e.target.value)}
                onBlur={() => {
                  const n = Math.max(0, Math.min(g.seats || 1, Math.round(Number(attending) || 0)));
                  if (n !== (g.attendingCount ?? (g.seats || 1))) updateAttending(g.id, n);
                  setAttending(n);
                }}
                aria-label={`כמה אישרו הגעה מתוך ${g.seats || 1}`}
                title="כמה אנשים אישרו הגעה מתוך הרשומה"
                className="w-12 rounded-lg border border-sage-200 bg-sage-50 px-1.5 py-0.5 text-center text-xs font-bold tabular-nums text-sage-700 outline-none focus:border-sage-400"
              />
              <span className="text-[11px] text-slate-400">/ {g.seats || 1}</span>
            </div>
          )}
        </div>
      </td>
      <td className="px-2 py-3">
        <input
          type="number"
          value={gift}
          onChange={(e) => setGift(e.target.value)}
          onBlur={() => Number(gift) !== (g.gift || 0) && updateGift(g.id, gift)}
          className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm tabular-nums outline-none focus:border-gold-400"
        />
      </td>
      <td className="px-2 py-3 text-left">
        <button
          onClick={() => removeGuest(g.id)}
          aria-label={`מחיקת ${g.name || "מוזמן"}`}
          title="מחיקת מוזמן"
          className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none"
        >
          <Trash2 size={16} />
        </button>
      </td>
    </tr>
  );
});

const GuestCard = memo(function GuestCard({
  g,
  tableLabel,
  selected,
  onToggleSelect,
  updateName,
  updatePhone,
  updateCategory,
  updateMention,
  updateSeats,
  updateGift,
  toggleFlag,
  updateRsvp,
  updateAttending,
  removeGuest,
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
          <input
            type="checkbox"
            checked={!!selected}
            onChange={() => onToggleSelect(g.id)}
            aria-label={`בחירת ${g.name || "מוזמן"}`}
            className="h-5 w-5 cursor-pointer accent-gold-500"
          />
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== (g.name || "") && updateName(g.id, name)}
          placeholder="שם האורח"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-base font-semibold text-slate-800 outline-none focus:border-gold-400 sm:min-h-0 sm:text-sm"
        />
        {/*  סיכום בשורה עצמה: מספר הכיסאות ונקודת צבע לסטטוס, כדי
            שלא יהיה צורך לפתוח כרטיס רק כדי לראות אותם.  */}
        {!open && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
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
          className="grid h-11 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
        >
          <ChevronDown size={18} className={open ? "rotate-180 transition" : "transition"} />
        </button>
        <button
          onClick={() => removeGuest(g.id)}
          aria-label={`מחיקת ${g.name || "מוזמן"}`}
          className="grid h-11 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none"
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
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => phone !== (g.phone || "") && updatePhone(g.id, phone)}
            placeholder="נייד"
            type="tel"
            dir="ltr"
            className={`${field} text-start tabular-nums`}
          />
        </label>
        <label className="col-span-2 text-xs font-medium text-slate-500">
          קטגוריה
          <select
            value={g.category}
            onChange={(e) => updateCategory(g.id, e.target.value)}
            className={field}
          >
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
            onChange={(e) => setGift(e.target.value)}
            onBlur={() => Number(gift) !== (g.gift || 0) && updateGift(g.id, gift)}
            className={`${field} tabular-nums`}
          />
        </label>
        <label className="col-span-2 text-xs font-medium text-slate-500">
          אזכור
          <input
            value={mention}
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
          aria-pressed={!!g.glatt}
          className={`flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition sm:min-h-0 sm:px-2.5 sm:py-1.5 sm:text-xs ${
            g.glatt
              ? "bg-gold-100 text-gold-600 ring-1 ring-gold-300"
              : "bg-white text-slate-500 ring-1 ring-slate-200"
          }`}
        >
          <UtensilsCrossed size={16} /> גלאט
        </button>
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

function Guests({ guests, setGuests, tables, setTables, categories, setCategories }) {
  const fileRef = useRef(null);
  const [catManagerOpen, setCatManagerOpen] = useState(false);
  //  המסך מאחד שתי עבודות נפרדות. כשהן זו מתחת לזו, כל כניסה
  //  לסידור ההושבה דורשת לגלול דרך מאות מוזמנים — בלתי אפשרי בנייד.
  //  לכן נפרד לשני טאבים; כבונוס, רשימת 592 השורות לא מרונדרת כלל
  //  כשעובדים על ההושבה.
  const [tab, setTab] = useState("list");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    category: categories[0] || "",
    seats: 1,
    mention: "",
    glatt: false,
  });
  const [filters, setFilters] = useState({
    search: "",
    source: "all",
    category: "all",
    rsvp: "all",
    onlyProbably: false,
    onlyConsidering: false,
    onlyGlatt: false,
    onlyUnassigned: false,
  });

  const [sort, setSort] = useState({ key: null, dir: "asc" });

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
    return {
      count: guests.length,
      seatsTotal: notDeclined.reduce((s, g) => s + (g.seats || 0), 0),
      probablySeats: guests
        .filter((g) => g.probablyComing)
        .reduce((s, g) => s + (g.seats || 0), 0),
      probablyCount: guests.filter((g) => g.probablyComing).length,
      consideringCount: guests.filter((g) => g.considering).length,
      glattCount: guests.filter((g) => g.glatt).length,
      glattSeats: notDeclined
        .filter((g) => g.glatt)
        .reduce((s, g) => s + (g.seats || 0), 0),
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
      if (filters.source !== "all" && g.source !== filters.source) return false;
      if (filters.category !== "all" && g.category !== filters.category) return false;
      if (filters.rsvp !== "all" && g.rsvp !== filters.rsvp) return false;
      if (filters.onlyProbably && !g.probablyComing) return false;
      if (filters.onlyConsidering && !g.considering) return false;
      if (filters.onlyGlatt && !g.glatt) return false;
      if (assigned && assigned.has(g.id)) return false;
      return true;
    });
  }, [guests, filters, tables]);

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
        source: GUEST_SOURCES[0],
        probablyComing: false,
        considering: false,
        glatt: form.glatt,
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
    });
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
        return { ...g, seats: n, attendingCount };
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

  // --- Excel/CSV import (header-aware) ---
  // Recognised columns (by header name, any order):
  // שם, נייד, קטגוריה, אזכור, כיסאות, מקור, גלאט, כנראה יבוא, לשקול, אישור הגעה, כמה אישרו, מתנה
  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = String(ev.target?.result || "");
        const rows = text
          .split(/\r?\n/)
          .map((r) => r.trim())
          .filter(Boolean);
        if (!rows.length) {
          notify("לא נמצאו רשומות תקינות בקובץ", { tone: "error" });
          e.target.value = "";
          return;
        }

        const splitRow = (r) =>
          r.split(/[,\t;]/).map((c) => c.replace(/^"|"$/g, "").trim());

        const aliases = {
          name: ["שם", "name"],
          phone: ["נייד", "טלפון", "phone"],
          category: ["קטגוריה", "category"],
          mention: ["אזכור", "mention"],
          seats: ["כיסאות", "seats"],
          source: ["מקור", "source"],
          glatt: ["גלאט", "glatt"],
          probablyComing: ["כנראה", "probably"],
          considering: ["לשקול", "considering"],
          rsvp: ["אישור הגעה", "אישורי הגעה", "סטטוס", "rsvp"],
          attendingCount: ["כמה אישרו", "מאושרים", "attending"],
          gift: ["מתנה", "gift"],
        };

        const headerCells = splitRow(rows[0]);
        const hasHeader = headerCells.some((c) => /שם|name/i.test(c));
        const idx = {};
        if (hasHeader) {
          Object.entries(aliases).forEach(([key, names]) => {
            idx[key] = headerCells.findIndex((c) =>
              names.some((n) => c.toLowerCase().includes(n.toLowerCase()))
            );
          });
        } else {
          // positional fallback (canonical order)
          [
            "name",
            "phone",
            "category",
            "mention",
            "seats",
            "source",
            "glatt",
            "probablyComing",
            "considering",
            "rsvp",
            "attendingCount",
            "gift",
          ].forEach((k, i) => (idx[k] = i));
        }

        const dataRows = hasHeader ? rows.slice(1) : rows;
        const get = (cells, key) => (idx[key] >= 0 ? cells[idx[key]] : undefined);
        const truthy = (s) => /^(v|כן|yes|1|true|✓)$/i.test((s || "").trim());
        const parseRsvp = (s) => {
          const t = (s || "").trim();
          if (/אישר|confirm|✓/i.test(t)) return "confirmed";
          if (/לא מגיע|declin|no|^לא$/i.test(t)) return "declined";
          return "pending";
        };

        const parsed = dataRows.map((row, i) => {
          const cells = splitRow(row);
          const category = get(cells, "category");
          const source = get(cells, "source");
          const seats = Math.max(1, Number(get(cells, "seats")) || 1);
          const rsvp = parseRsvp(get(cells, "rsvp"));
          let attendingCount = 0;
          if (rsvp === "confirmed") {
            const raw = get(cells, "attendingCount");
            const n =
              raw != null && String(raw).trim() !== ""
                ? Math.round(Number(raw) || 0)
                : seats;
            attendingCount = Math.max(0, Math.min(seats, n));
          }
          return {
            name: get(cells, "name") || `אורח ${i + 1}`,
            phone: get(cells, "phone") || "",
            category: categories.includes(category)
              ? category
              : category || categories[0] || "",
            mention: get(cells, "mention") || "",
            seats,
            source: GUEST_SOURCES.includes(source) ? source : GUEST_SOURCES[0],
            glatt: truthy(get(cells, "glatt")),
            probablyComing: truthy(get(cells, "probablyComing")),
            considering: truthy(get(cells, "considering")),
            rsvp,
            attendingCount,
            gift: Number(get(cells, "gift")) || 0,
          };
        });
        if (parsed.length) {
          //  קטגוריה שהגיעה מהקובץ ואינה ברשימה נשמרת על הרשומה, אבל בלעדיה
          //  לרשימה ה-select של השורה מוצג ריק והערך אובד בעריכה הבאה.
          const imported = [
            ...new Set(parsed.map((p) => p.category).filter((c) => c && !categories.includes(c))),
          ];
          if (imported.length) setCategories((prev) => [...prev, ...imported.filter((c) => !prev.includes(c))]);
          setGuests((prev) => {
            let id = nextGuestId(prev) - 1;
            const additions = parsed.map((p) => ({ ...p, id: ++id }));
            return [...prev, ...additions];
          });
          notify(`יובאו ${parsed.length} רשומות בהצלחה`, { tone: "success" });
        } else {
          notify("לא נמצאו רשומות תקינות בקובץ", { tone: "error" });
        }
      } catch {
        notify("שגיאה בקריאת הקובץ – ודאו שהפורמט תקין", { tone: "error" });
      }
      e.target.value = "";
    };
    //  בלי זה כשל קריאה שותק לגמרי, וה-input נשאר עם אותו קובץ כך שבחירה חוזרת לא מפעילה onChange.
    reader.onerror = () => {
      notify("לא ניתן לקרוא את הקובץ", { tone: "error" });
      e.target.value = "";
    };
    reader.readAsText(file, "UTF-8");
  }

  function downloadTemplate() {
    const header =
      "שם,נייד,קטגוריה,אזכור,כיסאות,מקור,גלאט,כנראה יבוא,לשקול,אישור הגעה,כמה אישרו,מתנה";
    const examples = [
      `ישראל ישראלי,050-1234567,${categories[0] || ""},חבר של אבא,2,${GUEST_SOURCES[0]},,V,,אישרו הגעה,2,0`,
      `דנה כהן,052-7654321,${categories[0] || ""},,4,${GUEST_SOURCES[0]},כן,,,אישרו הגעה,3,0`,
      `משפחת לוי,,${categories[0] || ""},,3,${GUEST_SOURCES[0]},,,,ממתין,,0`,
    ];
    const blob = new Blob(["\uFEFF" + header + "\n" + examples.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "תבנית-מוזמנים.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportGuests() {
    if (!sorted.length) {
      notify("אין רשומות לייצוא", { tone: "error" });
      return;
    }
    const header =
      "שם,נייד,קטגוריה,אזכור,כיסאות,מקור,גלאט,שיבוץ,כנראה יבוא,לשקול,אישור הגעה,כמה אישרו,מתנה";
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
        g.source || "",
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
    URL.revokeObjectURL(url);
    notify(`יוצאו ${sorted.length} רשומות לקובץ CSV`, { tone: "success" });
  }

  const sourceColor = (s) => (s === "הורים" ? "sage" : "gold");

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="grid grid-cols-2 gap-2.5 sm:gap-4 xl:grid-cols-5">
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

      {/*  מתג בין שתי העבודות — עדכון הרשימה מול סידור ההושבה.
          דביק לראש המסך כדי שאפשר יהיה לעבור ביניהן מכל נקודה ברשימה,
          בלי לגלול חזרה למעלה.  */}
      <div className="sticky top-2 z-20 -mx-1 px-1">
        <div
          role="tablist"
          aria-label="תצוגת מוזמנים"
          className="glass flex gap-1 rounded-2xl p-1 shadow-sm ring-1 ring-slate-200/70"
        >
          {[
            { key: "list", label: "רשימת המוזמנים", icon: Users, count: totals.count },
            { key: "seating", label: "סידור הושבה", icon: Armchair, count: tables.length },
          ].map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setTab(t.key);
                  //  מחליפים טאב לרוב מאמצע הרשימה; בלי זה נוחתים
                  //  בתוך התוכן החדש בלי להבין איפה אנחנו.
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-gradient-to-br from-gold-500 to-gold-600 text-white shadow-md shadow-gold-500/25"
                    : "text-slate-500 hover:bg-white/70 hover:text-slate-700"
                }`}
              >
                <t.icon size={17} className="shrink-0" />
                <span className="truncate">{t.label}</span>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                    active ? "bg-white/25" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {tab === "list" && (
        <>
      {/* RSVP summary */}
      <Card>
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
                  className={`flex min-w-0 flex-col items-center gap-1 rounded-2xl border px-2 py-2 text-sm transition sm:min-w-[150px] sm:flex-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:px-4 sm:py-2.5 ${
                    active
                      ? "border-slate-400 bg-slate-50 ring-2 ring-slate-200"
                      : "border-slate-200 bg-white hover:bg-slate-50"
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
      <Card>
        <SectionTitle
          icon={Users}
          title="ניהול רשימת המוזמנים"
          subtitle={`יובאו ${totals.count} רשומות מהקובץ – הוסיפו, סננו ועדכנו`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,.tsv"
                className="hidden"
                onChange={handleFile}
              />
              <button
                onClick={() => setCatManagerOpen(true)}
                title="הוספה, עריכה ומחיקה של קטגוריות מוזמנים"
                className="flex items-center gap-2 rounded-2xl bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50"
              >
                <Tag size={17} /> קטגוריות
              </button>
              <button
                onClick={downloadTemplate}
                title="הורדת קובץ תבנית לייבוא"
                className="flex items-center gap-2 rounded-2xl bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50"
              >
                <FileText size={17} /> תבנית
              </button>
              <button
                onClick={exportGuests}
                title="ייצוא הרשומות המסוננות לקובץ CSV"
                className="flex items-center gap-2 rounded-2xl bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50"
              >
                <Download size={17} /> ייצוא
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 rounded-2xl bg-sage-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sage-500/30 transition hover:bg-sage-600"
              >
                <Upload size={18} /> ייבוא Excel / CSV
              </button>
            </div>
          }
        />

        <form
          onSubmit={addGuest}
          className="mb-4 rounded-2xl border border-gold-200 bg-gradient-to-l from-gold-50/70 to-white p-3 shadow-sm sm:mb-5 sm:p-4"
        >
          <div className="mb-3 flex items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold-500 text-white shadow-md shadow-gold-500/30">
              <Plus size={18} />
            </span>
            <div>
              <p className="text-sm font-bold text-slate-800">הוספת מוזמן חדש</p>
              <p className="text-xs text-slate-500">מלאו את הפרטים ולחצו “הוסף לרשימה”</p>
            </div>
          </div>
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
          <button
            type="submit"
            className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-gold-500/30 transition hover:bg-gold-600 lg:col-span-1"
          >
            <Plus size={18} /> הוסף לרשימה
          </button>
          </div>
        </form>

        {/* Search & Filters */}
        <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 sm:mb-4 sm:p-4">
          <div className="mb-2.5 flex items-center gap-2.5 sm:mb-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-600 text-white shadow-md shadow-slate-500/20 sm:h-9 sm:w-9">
              <Search size={16} />
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
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-10 pl-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
            </div>
            <select
              value={filters.category}
              onChange={(e) => setFilters({ ...filters, category: e.target.value })}
              title="סינון לפי קטגוריה"
              className="min-w-0 rounded-xl border border-slate-300 bg-white px-2 py-2.5 text-sm font-medium outline-none focus:border-slate-400 sm:px-3"
            >
              <option value="all">כל הקטגוריות</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={filters.source}
              onChange={(e) => setFilters({ ...filters, source: e.target.value })}
              title="סינון לפי מקור ההזמנה"
              className="min-w-0 rounded-xl border border-slate-300 bg-white px-2 py-2.5 text-sm font-medium outline-none focus:border-slate-400 sm:px-3"
            >
              <option value="all">כל המקורות</option>
              {GUEST_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={filters.rsvp}
              onChange={(e) => setFilters({ ...filters, rsvp: e.target.value })}
              title="סינון לפי אישור הגעה"
              className="min-w-0 rounded-xl border border-slate-300 bg-white px-2 py-2.5 text-sm font-medium outline-none focus:border-slate-400 sm:px-3"
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
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                filters.onlyProbably
                  ? "bg-sage-500 text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-sage-50"
              }`}
            >
              <Star size={15} /> כנראה יבוא
            </button>
            <button
              onClick={() =>
                setFilters({ ...filters, onlyConsidering: !filters.onlyConsidering })
              }
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                filters.onlyConsidering
                  ? "bg-rose-500 text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-rose-50"
              }`}
            >
              <HelpCircle size={15} /> לשקול
            </button>
            <button
              onClick={() =>
                setFilters({ ...filters, onlyGlatt: !filters.onlyGlatt })
              }
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                filters.onlyGlatt
                  ? "bg-gold-500 text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-gold-50"
              }`}
            >
              <UtensilsCrossed size={15} /> גלאט
            </button>
            <button
              onClick={() =>
                setFilters({ ...filters, onlyUnassigned: !filters.onlyUnassigned })
              }
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                filters.onlyUnassigned
                  ? "bg-slate-700 text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
              }`}
            >
              <Armchair size={15} /> לא משובץ
            </button>
            {(filters.search ||
              filters.category !== "all" ||
              filters.source !== "all" ||
              filters.rsvp !== "all" ||
              filters.onlyProbably ||
              filters.onlyConsidering ||
              filters.onlyGlatt ||
              filters.onlyUnassigned) && (
              <button
                onClick={() =>
                  setFilters({
                    search: "",
                    source: "all",
                    category: "all",
                    rsvp: "all",
                    onlyProbably: false,
                    onlyConsidering: false,
                    onlyGlatt: false,
                    onlyUnassigned: false,
                  })
                }
                title="ניקוי כל הסינונים"
                className="flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-500 ring-1 ring-slate-200 transition hover:bg-white"
              >
                <X size={15} /> נקה
              </button>
            )}
          </div>
        </div>

        <p className="mb-3 text-xs text-slate-400">
          מציג {filtered.length} מתוך {guests.length} רשומות · מבנה קובץ לייבוא: שם,
          קטגוריה, כיסאות, מקור, "כנראה יבוא" (V), "להזמין" (?)
        </p>

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-gold-200 bg-gold-50/70 px-4 py-3">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              <CheckCheck size={16} className="text-gold-600" />
              {selectedIds.size} נבחרו
            </span>
            <div className="mx-1 h-5 w-px bg-gold-200" />
            <span className="text-xs font-medium text-slate-500">סמן כ:</span>
            <button
              onClick={() => bulkRsvp("confirmed")}
              className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-sage-600 ring-1 ring-sage-200 transition hover:bg-sage-50"
            >
              אישרו הגעה
            </button>
            <button
              onClick={() => bulkRsvp("pending")}
              className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-gold-600 ring-1 ring-gold-200 transition hover:bg-gold-50"
            >
              ממתין
            </button>
            <button
              onClick={() => bulkRsvp("declined")}
              className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-500 ring-1 ring-rose-200 transition hover:bg-rose-50"
            >
              לא מגיעים
            </button>
            <div className="mx-1 h-5 w-px bg-gold-200" />
            <button
              onClick={bulkDelete}
              className="flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-500 ring-1 ring-rose-200 transition hover:bg-rose-50"
            >
              <Trash2 size={14} /> מחק
            </button>
            <button
              onClick={clearSelection}
              className="mr-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-white"
            >
              <X size={14} /> ביטול בחירה
            </button>
          </div>
        )}

        {/* Table (desktop) */}
        <div
          ref={scrollRef}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          className="hidden max-h-[560px] overflow-auto rounded-2xl ring-1 ring-slate-200/70 lg:block"
        >
          <table className="w-full min-w-[760px] text-right text-sm">
            <thead className="sticky top-0 z-10 bg-white/95 backdrop-blur">
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label="בחירת כל הרשומות המסוננות"
                    checked={sorted.length > 0 && sorted.every((g) => selectedIds.has(g.id))}
                    onChange={(e) =>
                      setSelectedIds(
                        e.target.checked ? new Set(sorted.map((g) => g.id)) : new Set()
                      )
                    }
                    className="h-4 w-4 cursor-pointer accent-gold-500"
                  />
                </th>
                <SortHeader label="שם" sortKey="name" sort={sort} onSort={toggleSort} />
                <SortHeader label="נייד" sortKey="phone" sort={sort} onSort={toggleSort} />
                <SortHeader label="קטגוריה" sortKey="category" sort={sort} onSort={toggleSort} />
                <SortHeader label="אזכור" sortKey="mention" sort={sort} onSort={toggleSort} />
                <SortHeader label="כיסאות" sortKey="seats" sort={sort} onSort={toggleSort} />
                <SortHeader label="גלאט" sortKey="glatt" sort={sort} onSort={toggleSort} center />
                <SortHeader label="שיבוץ" sortKey="table" sort={sort} onSort={toggleSort} />
                <SortHeader label="כנראה יבוא" sortKey="probablyComing" sort={sort} onSort={toggleSort} center />
                <SortHeader label="לשקול" sortKey="considering" sort={sort} onSort={toggleSort} center />
                <SortHeader label="אישור הגעה" sortKey="rsvp" sort={sort} onSort={toggleSort} />
                <SortHeader label="מתנה (₪)" sortKey="gift" sort={sort} onSort={toggleSort} />
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {padTop > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={13} className="p-0" style={{ height: padTop }} />
                </tr>
              )}
              {visibleRows.map((g) => (
                <GuestRow
                  key={g.id}
                  g={g}
                  tableLabel={guestTableMap[g.id]}
                  selected={selectedIds.has(g.id)}
                  onToggleSelect={toggleSelect}
                  updateName={updateName}
                  updatePhone={updatePhone}
                  updateCategory={updateCategory}
                  updateMention={updateMention}
                  updateSeats={updateSeats}
                  updateGift={updateGift}
                  toggleFlag={toggleFlag}
                  updateRsvp={updateRsvp}
                  updateAttending={updateAttending}
                  removeGuest={removeGuest}
                />
              ))}
              {padBottom > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={13} className="p-0" style={{ height: padBottom }} />
                </tr>
              )}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-3 py-10 text-center text-slate-400">
                    לא נמצאו רשומות התואמות לסינון
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Cards (mobile) */}
        <div className="space-y-3 lg:hidden">
          {sorted.slice(0, mobileLimit).map((g) => (
            <GuestCard
              key={g.id}
              g={g}
              tableLabel={guestTableMap[g.id]}
              selected={selectedIds.has(g.id)}
              onToggleSelect={toggleSelect}
              updateName={updateName}
              updatePhone={updatePhone}
              updateCategory={updateCategory}
              updateMention={updateMention}
              updateSeats={updateSeats}
              updateGift={updateGift}
              toggleFlag={toggleFlag}
              updateRsvp={updateRsvp}
              updateAttending={updateAttending}
              removeGuest={removeGuest}
            />
          ))}
          {sorted.length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white/60 px-4 py-10 text-center text-sm text-slate-400">
              לא נמצאו רשומות התואמות לסינון
            </div>
          )}
          {sorted.length > mobileLimit && (
            <button
              onClick={() => setMobileLimit((n) => n + 30)}
              className="w-full rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition hover:border-gold-400 hover:bg-gold-50 hover:text-gold-600"
            >
              הצג עוד ({sorted.length - mobileLimit} נותרו)
            </button>
          )}
        </div>
      </Card>
        </>
      )}

      {tab === "seating" && (
        <Seating guests={guests} tables={tables} setTables={setTables} />
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

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
    const fallback = remaining.includes("ללא קטגוריה")
      ? "ללא קטגוריה"
      : remaining[0] ?? "";
    confirmDialog({
      title: `למחוק את הקטגוריה “${name}”?`,
      message: used
        ? `${used} מוזמנים ישויכו מחדש ל“${fallback || "ללא קטגוריה"}”.`
        : "הקטגוריה תוסר מהרשימה.",
      confirmLabel: "מחק קטגוריה",
      tone: "danger",
    }).then((ok) => ok && onDelete(name, fallback));
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="animate-fade-in-up flex max-h-[85vh] w-full max-w-lg flex-col rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold-100 text-gold-600">
              <Tag size={20} />
            </span>
            <div>
              <h3 className="text-lg font-bold text-slate-800">
                ניהול קטגוריות מוזמנים
              </h3>
              <p className="text-xs text-slate-500">
                הוסיפו קטגוריה, שנו שם או מחקו – עדכון שם יחול על כל המוזמנים המשויכים
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="סגירה"
            className="rounded-xl p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submitAdd} className="mb-4 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="שם קטגוריה חדשה"
            aria-label="שם קטגוריה חדשה"
            className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-200"
          />
          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-gold-600"
          >
            <Plus size={18} /> הוסף
          </button>
        </form>

        <div className="-mx-1 flex-1 overflow-auto px-1">
          <ul className="space-y-1.5">
            {categories.map((c) => (
              <li
                key={c}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2"
              >
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <CategoryBadge category={c} />
                  <span className="shrink-0 text-[11px] text-slate-400">
                    {counts[c] || 0} מוזמנים
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <EditableText
                    value={c}
                    onCommit={(v) => handleRename(c, v)}
                    className="text-xs font-medium text-slate-500"
                  />
                  <button
                    onClick={() => handleDelete(c)}
                    title="מחיקת קטגוריה"
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
            onClick={onClose}
            className="rounded-xl bg-slate-800 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            סיום
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- Seating arrangements ---- */
function Seating({ guests, tables, setTables }) {
  const categories = useContext(CategoriesContext);
  const [newTable, setNewTable] = useState({ name: "", type: "standard" });
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [pickerTableId, setPickerTableId] = useState(null);

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
    setTables((prev) =>
      prev.map((t) => {
        if (t.id !== tableId) return t;
        //  הגנה מפני כפילות: id כפול היה נספר פעמיים בתפוסה ונותן מפתח React כפול.
        if (t.guestIds.includes(gid)) return t;
        return { ...t, guestIds: [...t.guestIds, gid] };
      })
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

  //  חלון השיבוץ נשאר פתוח בכוונה אחרי כל שיבוץ (כדי לשבץ כמה מוזמנים ברצף),
  //  ולכן חשוב שתהיה דרך מהירה לסגור אותו – גם ב-Escape וגם מהמקלדת בנייד.
  const pickerOpen = pickerTableId !== null;
  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") setPickerTableId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickerOpen]);

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
    <Card>
      <SectionTitle
        icon={Armchair}
        title="סידור הושבה"
        subtitle="שולחן רגיל (12) או שולחן אבירים (24) · ניתן לשבץ כל מוזמן שלא סירב להגיע"
        action={
          <form
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
              className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2 text-base outline-none focus:border-gold-400 sm:min-h-0 sm:text-sm"
            >
              <option value="standard">רגיל · 12</option>
              <option value="knight">אבירים · 24</option>
            </select>
            <button
              type="submit"
              className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-gold-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gold-600 sm:min-h-0 sm:px-3"
            >
              <Plus size={16} /> שולחן
            </button>
          </form>
        }
      />

      {unassigned.length > 0 && (
        <div className="mb-5 rounded-2xl bg-amber-50/70 p-3 text-sm ring-1 ring-amber-200/70">
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                <button
                  onClick={() => removeTable(t.id)}
                  aria-label={`מחיקת השולחן ${t.name}`}
                  title="מחיקת שולחן"
                  className="-m-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-slate-500">
                  תפוסה: {used}/{cap}
                </span>
                <Badge color={left === 0 ? "rose" : left <= 3 ? "gold" : "sage"}>
                  {left} מקומות פנויים
                </Badge>
              </div>
              <ProgressBar
                value={used}
                max={cap}
                tone={left === 0 ? "rose" : "sage"}
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
                        className="-my-1.5 grid h-11 w-11 shrink-0 place-items-center rounded text-slate-400 transition hover:text-rose-500 focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none"
                      >
                        <X size={16} />
                      </button>
                    </li>
                  );
                })}
              </ul>

              <button
                onClick={() => openPicker(t.id)}
                disabled={left <= 0}
                className="mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-500 transition hover:border-gold-400 hover:bg-gold-50 hover:text-gold-600 disabled:opacity-50"
              >
                <Plus size={16} /> {left <= 0 ? "השולחן מלא" : "שבץ מוזמן"}
              </button>
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
              הוסיפו שולחן חדש בעזרת הכפתור למעלה כדי להתחיל לשבץ מוזמנים.
            </p>
          </div>
        )}
      </div>

      {pickerTable && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`שיבוץ ל${pickerTable.name}`}
        >
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={closePicker}
          />
          <div className="glass relative z-10 flex max-h-[80vh] w-full max-w-lg flex-col rounded-3xl p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-[var(--font-display)] text-xl font-bold text-slate-800">
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
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              <div className="relative min-w-[160px] flex-1">
                <Search
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="חיפוש לפי שם..."
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-9 pl-3 text-sm outline-none focus:border-gold-400"
                />
              </div>
              <select
                value={catFilter}
                onChange={(e) => setCatFilter(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-gold-400"
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
                      className="flex w-full items-center justify-between gap-2 rounded-xl bg-white/70 px-3 py-2.5 text-right text-sm ring-1 ring-slate-200/70 transition hover:bg-gold-50 hover:ring-gold-300"
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

/* =========================================================================
 *  VENDORS + TASK MANAGEMENT MODULE
 * ====================================================================== */

function Vendors({ vendors, setVendors, weddingId = null, canEdit = true }) {
  const [openId, setOpenId] = useState(vendors[0]?.id ?? null);
  const [taskInput, setTaskInput] = useState("");

  //  כל הקבצים של החתונה נטענים פעם אחת (מטא-דאטה בלבד) ומסוננים לפי ספק.
  const [files, setFiles] = useState([]);

  const reloadFiles = useCallback(async () => {
    if (!weddingId) return;
    try {
      setFiles(await listVendorFiles(weddingId));
    } catch (err) {
      console.error("Failed to load vendor files:", err);
    }
  }, [weddingId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reloadFiles();
  }, [reloadFiles]);

  function updateVendor(id, patch) {
    setVendors((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
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
    const attached = files.filter((f) => f.vendorId === id);
    confirmDialog({
      title: `למחוק את הספק “${vendor?.name || ""}”?`,
      message:
        "כל הפרטים והמשימות של הספק יימחקו לצמיתות." +
        (attached.length
          ? `\n\nיימחקו גם ${attached.length} קבצים מצורפים.`
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

      setVendors((prev) => {
        const next = prev.filter((v) => v.id !== id);
        setOpenId((cur) => (cur === id ? next[0]?.id ?? null : cur));
        return next;
      });
      notify("הספק נמחק", { tone: "success" });
    });
  }

  function addVendor() {
    //  ה-id הוא גם המפתח הראשי ב-DB, ומשמש לקישור הקבצים המצורפים.
    //  nextRowId מבטיח ייחודיות גם כשנוספים שני ספקים באותה מילישנייה.
    const id = nextRowId(vendors);
    setVendors((prev) => [
      ...prev,
      {
        id,
        name: "ספק חדש",
        type: "כללי",
        phone: "",
        email: "",
        contractCost: 0,
        deposit: 0,
        notes: "",
        tasks: [],
      },
    ]);
    setOpenId(id);
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card>
        <SectionTitle
          icon={Briefcase}
          title="ניהול ספקים ומשימות"
          subtitle="פרטים, תשלומים, סיכומי פגישות ולוח משימות"
          action={
            <button
              onClick={addVendor}
              className="flex items-center gap-2 rounded-2xl bg-gold-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-gold-500/30 transition hover:bg-gold-600"
            >
              <Plus size={18} /> ספק חדש
            </button>
          }
        />

        <div className="flex flex-wrap gap-2">
          {vendors.map((v) => (
            <button
              key={v.id}
              onClick={() => setOpenId(v.id)}
              className={`min-h-11 rounded-2xl px-4 py-2 text-sm font-semibold transition sm:min-h-0 ${
                openId === v.id
                  ? "bg-slate-800 text-white shadow-lg"
                  : "bg-white/70 text-slate-600 ring-1 ring-slate-200 hover:bg-white"
              }`}
            >
              {v.name}
            </button>
          ))}
        </div>
      </Card>

      {vendors.length === 0 && (
        <Card>
          <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
            <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400">
              <Briefcase size={26} />
            </div>
            <p className="text-base font-semibold text-slate-700">עדיין אין ספקים</p>
            <p className="mt-1 max-w-sm text-sm text-slate-400">
              הוסיפו ספק חדש בעזרת הכפתור למעלה כדי לנהל פרטים, תשלומים ומשימות.
            </p>
            <button
              onClick={addVendor}
              className="mt-4 flex items-center gap-2 rounded-2xl bg-gold-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-gold-500/30 transition hover:bg-gold-600"
            >
              <Plus size={18} /> הוספת ספק ראשון
            </button>
          </div>
        </Card>
      )}

      {vendors
        .filter((v) => v.id === openId)
        .map((v) => {
          const balance = v.contractCost - v.deposit;
          return (
            <div key={v.id} className="grid gap-6 xl:grid-cols-3">
              {/* Details + finance */}
              <Card className="xl:col-span-1">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <input
                      value={v.name}
                      onChange={(e) => updateVendor(v.id, { name: e.target.value })}
                      aria-label="שם הספק"
                      className="min-h-11 w-full bg-transparent font-[var(--font-display)] text-xl font-bold text-slate-800 outline-none sm:min-h-0"
                    />
                    <button
                      onClick={() => removeVendor(v.id)}
                      aria-label="מחיקת ספק"
                      title="מחיקת ספק"
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 focus-visible:ring-2 focus-visible:ring-rose-300"
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
              <Card className="xl:col-span-2">
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
                <div className="mt-6">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 font-semibold text-slate-800">
                      <ListTodo size={18} className="text-gold-500" /> לוח משימות
                    </h3>
                    <div className="flex items-center gap-2">
                      <input
                        value={taskInput}
                        onChange={(e) => setTaskInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addTask(v.id)}
                        placeholder="משימה חדשה..."
                        className="min-h-11 w-44 rounded-xl border border-slate-200 bg-white px-3 py-2 text-base outline-none focus:border-gold-400 sm:min-h-0 sm:text-sm"
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

                  <div className="grid gap-3 sm:grid-cols-3">
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
                                    className="-m-1 grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-300 opacity-60 transition group-hover:opacity-100 focus-visible:opacity-100 hover:text-rose-500"
                                  >
                                    <X size={16} />
                                  </button>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {TASK_COLUMNS.filter(
                                    (c) => c.key !== t.status
                                  ).map((c) => (
                                    <button
                                      key={c.key}
                                      onClick={() => moveTask(v.id, t.id, c.key)}
                                      aria-label={`העברת המשימה ${t.title} ל-${c.label}`}
                                      className="min-h-10 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-gold-100 hover:text-gold-700 sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-[11px]"
                                    >
                                      → {c.label}
                                    </button>
                                  ))}
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
                </div>
              </Card>

              {/* Attachments */}
              <Card className="xl:col-span-3">
                <VendorFiles
                  weddingId={weddingId}
                  vendorId={v.id}
                  files={files.filter((f) => f.vendorId === v.id)}
                  canEdit={canEdit}
                  onChanged={reloadFiles}
                />
              </Card>
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

function VendorFiles({ weddingId, vendorId, files, canEdit, onChanged }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold text-slate-800">
          <Paperclip size={18} className="text-gold-500" /> חוזים וקבצים
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
            {files.length}
          </span>
        </h3>
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
              className="flex items-center gap-2 rounded-2xl bg-gold-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-gold-500/30 transition hover:bg-gold-600 disabled:opacity-60"
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

      {files.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-white text-gold-500 ring-1 ring-slate-200">
            <Paperclip size={22} />
          </span>
          <p className="text-sm font-semibold text-slate-600">
            עדיין לא צורפו קבצים
          </p>
          <p className="mt-1 text-xs text-slate-400">
            חוזה, הצעת מחיר או תמונה — עד {formatBytes(MAX_FILE_BYTES)} לקובץ.
          </p>
          {canEdit && (
            <button
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-gold-600 disabled:opacity-60"
            >
              <Upload size={16} />
              בחירת קובץ
            </button>
          )}
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {files.map((f) => {
            const isImage = IMAGE_MIME.has(f.mime);
            return (
              <li
                key={f.id}
                className="flex items-center gap-2 rounded-2xl bg-white/70 p-2.5 ring-1 ring-slate-200 transition hover:ring-gold-300"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-100 text-slate-400 ring-1 ring-slate-200">
                  {isImage ? (
                    <img
                      src={vendorFileUrl(weddingId, f.id)}
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
                {isImage && (
                  <a
                    href={vendorFileUrl(weddingId, f.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="פתיחה בכרטיסייה חדשה"
                    aria-label={`פתיחת ${f.name}`}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  >
                    <ExternalLink size={16} />
                  </a>
                )}
                <a
                  href={vendorFileUrl(weddingId, f.id, { download: true })}
                  download={f.name}
                  title="הורדה"
                  aria-label={`הורדת ${f.name}`}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-gold-600"
                >
                  <Download size={16} />
                </a>
                {canEdit && (
                  <button
                    onClick={() => remove(f)}
                    title="מחיקת הקובץ"
                    aria-label={`מחיקת ${f.name}`}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* =========================================================================
 *  FINANCE MODULE
 * ====================================================================== */

function Finance({ budget, setBudget, guests, budgetGoal, setBudgetGoal, financeLabels, setFinanceLabels }) {
  const [form, setForm] = useState({ category: "", expected: "", actual: "" });
  const [goalDraft, setGoalDraft] = useState(budgetGoal);
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

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
    const expected = budget.reduce((s, b) => s + b.expected, 0);
    const actual = budget.reduce((s, b) => s + b.actual, 0);
    const income = guests.reduce((s, g) => s + (g.gift || 0), 0);
    return { expected, actual, income, balance: income - actual };
  }, [budget, guests]);

  function addItem(e) {
    e.preventDefault();
    if (!form.category.trim()) return;
    setBudget((prev) => [
      ...prev,
      {
        id: nextRowId(prev),
        category: form.category.trim(),
        expected: Number(form.expected) || 0,
        actual: Number(form.actual) || 0,
      },
    ]);
    setForm({ category: "", expected: "", actual: "" });
  }

  function updateItem(id, key, value) {
    setBudget((prev) =>
      prev.map((b) => (b.id === id ? { ...b, [key]: Number(value) || 0 } : b))
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
    if (dragId == null || dragId === targetId) {
      setDragId(null);
      return;
    }
    setBudget((prev) => {
      const from = prev.findIndex((b) => b.id === dragId);
      const to = prev.findIndex((b) => b.id === targetId);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDragId(null);
  }

  function removeItem(id) {
    const b = budget.find((x) => x.id === id);
    confirmDialog({
      title: `למחוק את הסעיף “${b?.category || ""}”?`,
      message: "סעיף התקציב יוסר לצמיתות.",
      confirmLabel: "מחק סעיף",
      tone: "danger",
    }).then((ok) => {
      if (ok) setBudget((prev) => prev.filter((b) => b.id !== id));
    });
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card>
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

        <div className="mt-4 space-y-2">
          {/*  יעד 0 = עוד לא נקבע יעד. אין טעם להציג "חריגה" באדום על יעד
              שהמשתמש מעולם לא הגדיר — זה מבהיל בלי סיבה.  */}
          {goal <= 0 ? (
            <div className="rounded-xl bg-gold-50 px-3 py-2.5 text-xs text-slate-600 ring-1 ring-gold-200">
              עוד לא הוגדר יעד תקציב. הזינו סכום למעלה כדי לעקוב אחרי חריגות.
              <br />
              <span className="text-slate-500">
                תכנון נוכחי (סכום הסעיפים):{" "}
                <b className="tabular-nums text-slate-700">{fmt(totals.expected)}</b>
                {" · "}
                הוצאה בפועל:{" "}
                <b className="tabular-nums text-slate-700">{fmt(totals.actual)}</b>
              </span>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-slate-500">
                  תכנון נוכחי (סכום הסעיפים):{" "}
                  <b className="tabular-nums text-slate-700">{fmt(totals.expected)}</b>
                </span>
                <span
                  className={
                    totals.expected > goal
                      ? "font-semibold text-rose-500"
                      : "font-semibold text-sage-600"
                  }
                >
                  {totals.expected > goal
                    ? `חריגה מהיעד ב-${fmt(totals.expected - goal)}`
                    : `נותרו לתכנון ${fmt(goal - totals.expected)}`}
                </span>
              </div>
              <ProgressBar
                value={totals.actual}
                max={goal}
                tone={totals.actual > goal ? "rose" : "gold"}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-slate-500">
                  הוצאה בפועל:{" "}
                  <b className="tabular-nums text-slate-700">{fmt(totals.actual)}</b>
                </span>
                <span
                  className={
                    totals.actual > goal
                      ? "font-semibold text-rose-500"
                      : "text-slate-500"
                  }
                >
                  {totals.actual > goal
                    ? `מעל היעד ב-${fmt(totals.actual - goal)}`
                    : `נותרו מהיעד ${fmt(goal - totals.actual)}`}
                </span>
              </div>
            </>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2.5 sm:gap-4 xl:grid-cols-4">
        <StatCard
          icon={Wallet}
          label={
            <EditableText
              value={L.statPlanned}
              onCommit={(v) => updateLabel("statPlanned", v)}
            />
          }
          value={fmt(totals.expected)}
          tone="gold"
        />
        <StatCard
          icon={TrendingDown}
          label={
            <EditableText
              value={L.statActual}
              onCommit={(v) => updateLabel("statActual", v)}
            />
          }
          value={fmt(totals.actual)}
          tone="rose"
        />
        <StatCard
          icon={Gift}
          label={
            <EditableText
              value={L.statIncome}
              onCommit={(v) => updateLabel("statIncome", v)}
            />
          }
          value={fmt(totals.income)}
          tone="sage"
        />
        <StatCard
          icon={totals.balance >= 0 ? TrendingUp : TrendingDown}
          label={
            <EditableText
              value={L.statBalance}
              onCommit={(v) => updateLabel("statBalance", v)}
            />
          }
          value={fmt(totals.balance)}
          sub={totals.balance >= 0 ? "צפי לרווח 🎉" : "צפי לגרעון"}
          tone={totals.balance >= 0 ? "sage" : "rose"}
        />
      </div>

      <Card>
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

        <form
          onSubmit={addItem}
          className="mb-4 grid grid-cols-2 gap-2 rounded-2xl bg-white/50 p-3 ring-1 ring-slate-200/70 sm:mb-5 sm:gap-3 sm:p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
        >
          <input
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="שם הסעיף"
            className="col-span-2 min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-gold-400 sm:col-span-1"
          />
          <input
            type="number"
            value={form.expected}
            onChange={(e) => setForm({ ...form, expected: e.target.value })}
            placeholder="עלות צפויה"
            className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-gold-400"
          />
          <input
            type="number"
            value={form.actual}
            onChange={(e) => setForm({ ...form, actual: e.target.value })}
            placeholder="עלות בפועל"
            className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-gold-400"
          />
          <button
            type="submit"
            className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-gold-600 sm:col-span-1"
          >
            <Plus size={18} /> הוסף
          </button>
        </form>

        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[620px] text-right text-sm">
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
                    value={L.colExpected}
                    onCommit={(v) => updateLabel("colExpected", v)}
                  />
                </th>
                <th className="px-3 py-2 font-semibold">
                  <EditableText
                    value={L.colActual}
                    onCommit={(v) => updateLabel("colActual", v)}
                  />
                </th>
                <th className="px-3 py-2 font-semibold">
                  <EditableText
                    value={L.colDiff}
                    onCommit={(v) => updateLabel("colDiff", v)}
                  />
                </th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {budget.map((b, idx) => {
                const diff = b.expected - b.actual;
                return (
                  <tr
                    key={b.id}
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
                      dragId === b.id ? "opacity-40" : "hover:bg-white/60"
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
                      {b.category}
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="number"
                        value={b.expected}
                        onChange={(e) =>
                          updateItem(b.id, "expected", e.target.value)
                        }
                        className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm tabular-nums outline-none focus:border-gold-400"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="number"
                        value={b.actual}
                        onChange={(e) =>
                          updateItem(b.id, "actual", e.target.value)
                        }
                        className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm tabular-nums outline-none focus:border-gold-400"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`font-semibold tabular-nums ${
                          diff >= 0 ? "text-sage-600" : "text-rose-500"
                        }`}
                      >
                        {fmt(diff)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-left">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          onClick={() => moveItem(b.id, -1)}
                          disabled={idx === 0}
                          title="העברה למעלה"
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-gold-50 hover:text-gold-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                        >
                          <ChevronUp size={16} />
                        </button>
                        <button
                          onClick={() => moveItem(b.id, 1)}
                          disabled={idx === budget.length - 1}
                          title="העברה למטה"
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-gold-50 hover:text-gold-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                        >
                          <ChevronDown size={16} />
                        </button>
                        <button
                          onClick={() => removeItem(b.id)}
                          title="מחיקת סעיף"
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
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
                  <td colSpan={6} className="px-3 py-10 text-center text-slate-400">
                    עדיין אין סעיפי תקציב – הוסיפו סעיף חדש בעזרת הטופס למעלה.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 font-bold text-slate-800">
                <td className="px-2 py-3"></td>
                <td className="px-3 py-3">סה״כ</td>
                <td className="px-3 py-3 tabular-nums">{fmt(totals.expected)}</td>
                <td className="px-3 py-3 tabular-nums">{fmt(totals.actual)}</td>
                <td className="px-3 py-3 tabular-nums">
                  {fmt(totals.expected - totals.actual)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Mobile card view – same data & actions without horizontal scrolling */}
        <div className="space-y-3 lg:hidden">
          {budget.map((b, idx) => {
            const diff = b.expected - b.actual;
            return (
              <div
                key={b.id}
                className="rounded-2xl border border-slate-200 bg-white/70 p-4"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 font-semibold text-slate-800">
                    {b.category}
                  </p>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      onClick={() => moveItem(b.id, -1)}
                      disabled={idx === 0}
                      title="העברה למעלה"
                      aria-label={`העברת ${b.category} למעלה`}
                      className="grid h-11 w-11 place-items-center rounded-lg text-slate-400 transition hover:bg-gold-50 hover:text-gold-600 disabled:opacity-30"
                    >
                      <ChevronUp size={18} />
                    </button>
                    <button
                      onClick={() => moveItem(b.id, 1)}
                      disabled={idx === budget.length - 1}
                      title="העברה למטה"
                      aria-label={`העברת ${b.category} למטה`}
                      className="grid h-11 w-11 place-items-center rounded-lg text-slate-400 transition hover:bg-gold-50 hover:text-gold-600 disabled:opacity-30"
                    >
                      <ChevronDown size={18} />
                    </button>
                    <button
                      onClick={() => removeItem(b.id)}
                      title="מחיקת סעיף"
                      aria-label={`מחיקת ${b.category}`}
                      className="grid h-11 w-11 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <label className="text-xs font-medium text-slate-500">
                    {L.colExpected}
                    <input
                      type="number"
                      value={b.expected}
                      onChange={(e) =>
                        updateItem(b.id, "expected", e.target.value)
                      }
                      className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-base tabular-nums outline-none focus:border-gold-400 sm:min-h-0 sm:text-sm"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-500">
                    {L.colActual}
                    <input
                      type="number"
                      value={b.actual}
                      onChange={(e) =>
                        updateItem(b.id, "actual", e.target.value)
                      }
                      className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-base tabular-nums outline-none focus:border-gold-400 sm:min-h-0 sm:text-sm"
                    />
                  </label>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-sm">
                  <span className="text-xs font-medium text-slate-500">
                    {L.colDiff}
                  </span>
                  <span
                    className={`font-semibold tabular-nums ${
                      diff >= 0 ? "text-sage-600" : "text-rose-500"
                    }`}
                  >
                    {fmt(diff)}
                  </span>
                </div>
              </div>
            );
          })}

          {budget.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white/60 px-4 py-10 text-center text-sm text-slate-400">
              עדיין אין סעיפי תקציב – הוסיפו סעיף חדש בעזרת הטופס למעלה.
            </div>
          ) : (
            <div className="rounded-2xl bg-slate-800 p-4 text-white">
              <p className="mb-2 text-sm font-bold">סה״כ</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[11px] text-white/60">{L.colExpected}</p>
                  <p className="text-sm font-bold tabular-nums">
                    {fmt(totals.expected)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-white/60">{L.colActual}</p>
                  <p className="text-sm font-bold tabular-nums">
                    {fmt(totals.actual)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-white/60">{L.colDiff}</p>
                  <p className="text-sm font-bold tabular-nums">
                    {fmt(totals.expected - totals.actual)}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
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
              onChange={(e) => setSelectedId(Number(e.target.value))}
              disabled={vendors.length === 0}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold outline-none focus:border-gold-400"
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
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-white hover:text-gold-600 focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
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
                <h3 className="mt-3 font-[var(--font-display)] text-2xl font-bold">
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
            עדיין לא הוספתם ספקים. הוסיפו ספק במסך "ספקים ומשימות" והפורטל שלו יופיע כאן.
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
const LEGACY_DATASET_KEYS = ["guests", "tables", "vendors", "budget"];

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
  return total ? { datasets: out, total } : null;
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

/*  טוקן איפוס הסיסמה מגיע ב-`?reset=`. שולפים אותו לזיכרון ומוחקים
    מיד משורת הכתובת, בדיוק כמו טוקן הזמנה: כתובות נשמרות בהיסטוריה,
    נשלחות ב-Referer ומופיעות בלוגים. בניגוד להזמנה לא משתמשים כאן
    ב-sessionStorage — טוקן שמאפשר לקבוע סיסמה לא צריך לשרוד רענון דף.  */
function captureResetToken() {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("reset");
    if (!token) return "";
    params.delete("reset");
    const qs = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash
    );
    return token;
  } catch {
    return "";
  }
}

const INITIAL_RESET_TOKEN = captureResetToken();

async function signOutAndWipe() {
  try {
    await signOut();
  } finally {
    // אין להשאיר שמות וטלפונים של מוזמנים ב-localStorage אחרי יציאה.
    clearLocalAppData();
  }
}

export default function App() {
  const [authReady, setAuthReady] = useState(!isCloudConfigured);
  const [session, setSession] = useState(null);
  const [resetToken, setResetToken] = useState(INITIAL_RESET_TOKEN);

  useEffect(() => {
    if (!isCloudConfigured) return;
    let active = true;
    // העוגייה היא httpOnly, ולכן הדרך היחידה לדעת אם יש סשן היא לשאול את השרת.
    loadSession().then((s) => {
      if (!active) return;
      setSession(s);
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

  if (isCloudConfigured && !authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin text-gold-500" size={32} />
      </div>
    );
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

/*  ולידציית מייל בצד הלקוח, למשוב מיידי בלבד. השרת בודק את אותו כלל שוב
    ב-`normalizeEmail`, והוא הקובע — בדיקה בדפדפן היא נוחות, לא אבטחה.  */
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const isValidEmail = (value) => EMAIL_RE.test(String(value).trim());

/*  שדה מייל אחיד לכל מסכי ההזדהות: אותה ולידציה, אותו dir="ltr", אותו
    autoComplete. בלי זה כל מסך היה מתנהג קצת אחרת.  */
function EmailField({ value, onChange, label = "מייל", autoFocus = false }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200 focus-within:ring-gold-400">
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gold-50 via-white to-sage-50 p-6">
      <form
        onSubmit={onSubmit}
        //  ולידציית הדפדפן מציגה הודעות באנגלית ובכיוון LTR, מה שנראה שבור
        //  במסך עברי. הבדיקות שלנו רצות בכל מקרה ב-submit ומציגות הודעה בעברית.
        noValidate
        className="w-full max-w-sm space-y-5 rounded-3xl bg-white/80 p-8 shadow-xl ring-1 ring-white/60 backdrop-blur-xl"
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
  const [mode, setMode] = useState("signin"); // signin | signup | forgot
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [weddingDate, setWeddingDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const hasInvite =
    typeof sessionStorage !== "undefined" &&
    !!sessionStorage.getItem(INVITE_STORAGE_KEY);

  const signup = mode === "signup";
  const forgot = mode === "forgot";

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
        const res = await signUp(address, password, weddingDate || null, pendingInvite);
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
          : signup
            ? "פתחו חשבון וקבלו חתונה משלכם"
            : "התחברו כדי לגשת לנתונים שלכם"
      }
      onSubmit={submit}
    >
      {hasInvite && (
        <p className="rounded-lg bg-sage-50 px-3 py-2 text-xs text-sage-700 ring-1 ring-sage-200">
          קיבלתם הזמנה לחתונה משותפת. התחברו או הירשמו עם אותה כתובת מייל
          שעבורה נוצרה ההזמנה, והיא תתווסף אוטומטית.
        </p>
      )}

      <EmailField value={email} onChange={setEmail} />

      {signup && (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-500">תאריך החתונה</span>
          <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200 focus-within:ring-gold-400">
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
          <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200 focus-within:ring-gold-400">
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
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-gold-600 disabled:opacity-60"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
        {forgot ? "שליחת קישור לאיפוס" : signup ? "הרשמה" : "התחברות"}
      </button>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => switchMode(signup || forgot ? "signin" : "signup")}
          className="w-full text-center text-xs font-medium text-slate-500 underline-offset-4 transition hover:text-gold-600 hover:underline"
        >
          {signup || forgot ? "יש לי כבר חשבון – להתחברות" : "אין לי חשבון – להרשמה"}
        </button>

        {!forgot && !signup && (
          <button
            type="button"
            onClick={() => switchMode("forgot")}
            className="w-full text-center text-xs font-medium text-slate-400 underline-offset-4 transition hover:text-gold-600 hover:underline"
          >
            שכחתי סיסמה
          </button>
        )}
      </div>
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
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
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
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-gold-600"
        >
          <Lock size={16} /> למסך ההתחברות
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="קביעת סיסמה חדשה"
      subtitle="בחרו סיסמה שלא השתמשתם בה באתר אחר"
      onSubmit={submit}
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-500">סיסמה חדשה</span>
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200 focus-within:ring-gold-400">
          <Lock size={16} className="text-slate-400" />
          <input
            type="password"
            required
            minLength={8}
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
            minLength={8}
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
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 ring-1 ring-rose-200">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-gold-600 disabled:opacity-60"
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
          sessionStorage.removeItem(INVITE_STORAGE_KEY);
          try {
            target = await acceptInvite(token);
            notify("ההזמנה התקבלה – החתונה נוספה לרשימה שלך", { tone: "success" });
          } catch (err) {
            notify(inviteErrorMessage(err), { tone: "error", duration: 8000 });
          }
        }
        const list = await refreshWeddings();
        if (cancelled) return;
        setRetrying(false);
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
            ? "השרת עדיין מתעורר. המתינו רגע ונסו שוב."
            : "טעינת רשימת החתונות נכשלה. נסו שוב."
        );
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    //  attempt בכוונה ברשימה — הגדלתו היא שמפעילה ניסיון טעינה נוסף.
  }, [refreshWeddings, attempt]);

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

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <CloudOff className="text-rose-400" size={32} />
        <p className="text-sm text-slate-600">{error}</p>
        <div className="flex items-center gap-2">
          <button
            onClick={retry}
            className="rounded-xl bg-gold-500 px-4 py-2 text-sm font-semibold text-white"
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
          <p className="text-xs text-slate-400">השרת מתעורר, עוד רגע…</p>
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
          <h1 className="font-[var(--font-display)] text-xl font-bold text-slate-800">
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
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-gold-600 disabled:opacity-60"
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
}) {
  //  הניווט מסונן לפי ההיקף, והמסך הפעיל חייב להיות אחד מהמסכים המותרים.
  const navItems = useMemo(() => navForScopes(scopes), [scopes]);
  const [requestedView, setActive] = useState(
    () => navForScopes(scopes)[0]?.key ?? "guests"
  );
  //  אם ההרשאות צומצמו בזמן שהמסך פתוח, נופלים חזרה למסך המותר הראשון
  //  במקום להציג עמוד ריק. גזירה ולא useEffect — בלי רינדור מיותר.
  const active = navItems.some((n) => n.key === requestedView)
    ? requestedView
    : navItems[0]?.key ?? "guests";
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useDrawerSwipe(sidebarOpen, setSidebarOpen);
  //  כשמגירת הניווט פתוחה בנייד היא מכסה את המסך, אבל הדף שמאחוריה עדיין
  //  גלל עם האצבע — מה שגרם לתחושה של "המסך קופץ". נועלים את הגלילה של
  //  ה-body כל עוד המגירה פתוחה, ומשחררים בסגירה או בפירוק הרכיב.
  useEffect(() => {
    if (!sidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sidebarOpen]);
  const [membersOpen, setMembersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  //  האם מותר לסנכרן ענן עבור dataset מסוים? כתיבה מחוץ להיקף תיחסם ב-RLS
  //  ותחזיר 403, ולכן אין טעם אפילו לנסות.
  const mayGuests = hasScope(scopes, "guests");
  const mayVendors = hasScope(scopes, "vendors");
  const mayFinance = hasScope(scopes, "finance");

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
  const storagePrefix = useContext(StoragePrefixContext);
  const scopeWasEmptyRef = useRef(
    loadStored(storagePrefix, "guests", null) === null
  );

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
  //  התקציב חייב להתנהג כמו שאר המערכים: במצב ענן ה-DB הוא מקור האמת, ואסור
  //  שחתונה חדשה תיזרע בסעיפי ההדגמה — הם מוצגים למשתמש כאילו הם שלו.
  const [budget, setBudget] = usePersistentState(
    "budget",
    cloudEnabled ? [] : SEED_BUDGET
  );
  const [budgetGoal, setBudgetGoal] = usePersistentState(
    "budgetGoal",
    cloudEnabled ? 0 : SEED_BUDGET.reduce((s, b) => s + b.expected, 0)
  );
  const [financeLabels, setFinanceLabels] = usePersistentState(
    "financeLabels",
    {}
  );
  const [categories, setCategories] = usePersistentState(
    "categories",
    GUEST_CATEGORIES
  );
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

  // --- Cloud sync (Supabase) ---
  const [cloudStatus, setCloudStatus] = useState(
    isCloudConfigured ? "connecting" : "off"
  );

  const cloudReadyRef = useRef(false);
  const settingsReadyRef = useRef(false);
  const prevIdsRef = useRef({
    guests: new Set(),
    tables: new Set(),
    vendors: new Set(),
    budget: new Set(),
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

  // Initial cloud load: seed an empty wedding from local data, then pull the truth.
  useEffect(() => {
    if (!cloudEnabled) return;
    let cancelled = false;
    cloudReadyRef.current = false;
    settingsReadyRef.current = false;
    (async () => {
      try {
        setCloudStatus("loading");
        // זריעה רק כשיש מה להעלות מהמכשיר (שדרוג ממצב מקומי), ורק לבעלים
        // עם גישה מלאה — למי ששותף לו מסך בודד אין מה לזרוע.
        if (isOwner && fullScope && (await cloudIsEmpty(weddingId))) {
          let datasets = { guests, tables, vendors, budget };

          // שדרוג ממצב מקומי בלבד: הנתונים שמורים תחת התחילית הישנה, ללא
          // שיוך למשתמש. מייבאים רק באישור מפורש – ייתכן שהם של אדם אחר.
          const legacy = scopeWasEmptyRef.current ? readLegacyDatasets() : null;
          if (legacy) {
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
              datasets = { ...datasets, ...legacy.datasets };
              clearLegacyData();
            }
          }

          const hasSomething = Object.values(datasets).some((d) => d.length);
          if (hasSomething) await cloudSeed(weddingId, datasets);
        }
        const data = await cloudFetchAll(weddingId);
        if (cancelled) return;
        setGuests(data.guests);
        setTables(data.tables);
        setVendors(data.vendors);
        setBudget(data.budget);
        //  הגדרות החתונה (יעד תקציב, קטגוריות, כותרות מסך התקציב) חיות ב-DB
        //  ולא ב-localStorage, אחרת הן נמחקות בכל יציאה מהמערכת ולא קיימות
        //  במכשיר אחר. מחילים רק מפתחות שקיימים בפועל, כדי שחתונה חדשה תישאר
        //  עם ברירות המחדל במקום להתאפס לערכים ריקים.
        const s = data.settings || {};
        if (typeof s.budgetGoal === "number") setBudgetGoal(s.budgetGoal);
        if (s.financeLabels) setFinanceLabels(s.financeLabels);
        if (Array.isArray(s.categories) && s.categories.length) setCategories(s.categories);
        prevIdsRef.current = {
          guests: new Set(data.guests.map((g) => g.id)),
          tables: new Set(data.tables.map((t) => t.id)),
          vendors: new Set(data.vendors.map((v) => v.id)),
          budget: new Set(data.budget.map((b) => b.id)),
        };
        cloudReadyRef.current = true;
        //  רק אחרי הטעינה מותר לדחוף הגדרות למעלה. בלי זה, ערכי ברירת המחדל
        //  של הרנדר הראשון היו דורסים את מה ששמור בענן.
        settingsReadyRef.current = true;
        setCloudStatus("synced");
      } catch (err) {
        console.error("Cloud load failed:", err);
        if (!cancelled) setCloudStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudEnabled, weddingId]);

  // Debounced per-dataset cloud sync (upsert changes + soft-delete removed).
  // צופה (viewer) לעולם לא כותב – ה-DB גם ידחה אותו, ואין טעם ברעש.
  useEffect(() => {
    if (!cloudEnabled || !canEdit || !mayGuests || !cloudReadyRef.current) return;
    const timer = setTimeout(async () => {
      try {
        setCloudStatus("saving");
        prevIdsRef.current.guests = await cloudSyncDataset(
          weddingId,
          "guests",
          guests,
          prevIdsRef.current.guests
        );
        setCloudStatus("synced");
      } catch (err) {
        console.error("Cloud sync failed (guests):", err);
        setCloudStatus("error");
        scheduleSyncRetry();
      }
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guests, syncRetry]);

  useEffect(() => {
    if (!cloudEnabled || !canEdit || !mayGuests || !cloudReadyRef.current) return;
    const timer = setTimeout(async () => {
      try {
        setCloudStatus("saving");
        prevIdsRef.current.tables = await cloudSyncDataset(
          weddingId,
          "tables",
          tables,
          prevIdsRef.current.tables
        );
        setCloudStatus("synced");
      } catch (err) {
        console.error("Cloud sync failed (tables):", err);
        setCloudStatus("error");
        scheduleSyncRetry();
      }
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, syncRetry]);

  useEffect(() => {
    if (!cloudEnabled || !canEdit || !mayVendors || !cloudReadyRef.current) return;
    const timer = setTimeout(async () => {
      try {
        setCloudStatus("saving");
        prevIdsRef.current.vendors = await cloudSyncDataset(
          weddingId,
          "vendors",
          vendors,
          prevIdsRef.current.vendors
        );
        setCloudStatus("synced");
      } catch (err) {
        console.error("Cloud sync failed (vendors):", err);
        setCloudStatus("error");
        scheduleSyncRetry();
      }
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendors, syncRetry]);

  useEffect(() => {
    if (!cloudEnabled || !canEdit || !mayFinance || !cloudReadyRef.current) return;
    const timer = setTimeout(async () => {
      try {
        setCloudStatus("saving");
        prevIdsRef.current.budget = await cloudSyncDataset(
          weddingId,
          "budget",
          budget,
          prevIdsRef.current.budget
        );
        setCloudStatus("synced");
      } catch (err) {
        console.error("Cloud sync failed (budget):", err);
        setCloudStatus("error");
        scheduleSyncRetry();
      }
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budget, syncRetry]);

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
  }, [budgetGoal, categories, financeLabels, syncRetry]);

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
    URL.revokeObjectURL(url);
  }

  //  ייצוא לאקסל: גיליון נפרד לכל מערך נתונים (מוזמנים, ספקים, סדר הושבה,
  //  ניהול תקציב). בניגוד לגיבוי ה-JSON זהו פלט לקריאה בלבד — הוא לא נועד
  //  לשחזור, ולכן אין בו קבצים מצורפים.
  const [excelBusy, setExcelBusy] = useState(false);
  async function exportExcel() {
    setBackupMenuOpen(false);
    setExcelBusy(true);
    try {
      await exportWeddingWorkbook(
        { guests, tables, vendors, budget, budgetGoal },
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

  // קובץ הגיבוי מכיל שמות וטלפונים של כל המוזמנים. מציעים הצפנה בסיסמה
  // (PBKDF2 → AES-GCM) לפני שהוא יורד לדיסק. ראו src/lib/backupCrypto.js.
  async function exportBackup() {
    const payload = {
      app: "wedding-planner",
      version: 1,
      exportedAt: new Date().toISOString(),
      guests,
      tables,
      vendors,
      budget,
    };

    if (!isCryptoAvailable) {
      downloadJson(payload);
      return;
    }

    const encrypt = await confirmDialog({
      title: "להצפין את קובץ הגיבוי?",
      message:
        "הקובץ מכיל שמות וטלפונים של כל המוזמנים ואת כל נתוני התקציב.\n" +
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
    const summary = [
      Array.isArray(data.guests) ? `${data.guests.length} מוזמנים` : null,
      Array.isArray(data.tables) ? `${data.tables.length} שולחנות` : null,
      Array.isArray(data.vendors) ? `${data.vendors.length} ספקים` : null,
      Array.isArray(data.budget) ? `${data.budget.length} סעיפי תקציב` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    confirmDialog({
      title: "שחזור גיבוי יחליף את כל הנתונים",
      message: `הקובץ מכיל: ${summary}\n\nכל הנתונים הנוכחיים יוחלפו. להמשיך?`,
      confirmLabel: "שחזר נתונים",
      tone: "danger",
    }).then((ok) => {
      if (!ok) return;
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
      if (Array.isArray(data.vendors))
        setVendors(
          withIds(data.vendors, (v) => ({
            ...v,
            contractCost: Number(v.contractCost) || 0,
            deposit: Number(v.deposit) || 0,
            tasks: Array.isArray(v.tasks) ? v.tasks : [],
          }))
        );
      if (Array.isArray(data.budget))
        setBudget(
          withIds(data.budget, (b) => ({
            ...b,
            expected: Number(b.expected) || 0,
            actual: Number(b.actual) || 0,
          }))
        );
      notify("הגיבוי שוחזר בהצלחה", { tone: "success" });
    });
  }

  function importBackup(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
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

      if (isEncryptedBackup(data)) {
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
      }

      applyBackup(data);
    };
    reader.readAsText(file);
  }

  const titleMap = {
    overview: "דאשבורד ראשי",
    guests: "מוזמנים והושבה",
    vendors: "ספקים ומשימות",
    finance: "ניהול תקציב",
    portal: "פורטל ספקים",
  };

  const subtitleMap = {
    overview: `${guests.length} מוזמנים · ${vendors.length} ספקים`,
    guests: `${guests.length} רשומות ברשימה`,
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
          budgetGoal={budgetGoal}
          canEditBasics={cloudEnabled ? isOwner : true}
          canEditBudgetGoal={canEdit && mayFinance}
          showDate={cloudEnabled}
          onSaveBasics={saveWeddingBasics}
          onSetBudgetGoal={setBudgetGoal}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      <Sidebar
        active={active}
        onChange={setActive}
        open={sidebarOpen}
        setOpen={setSidebarOpen}
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
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 lg:hidden"
          >
            <Menu size={20} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {sidebarCollapsed && (
              <button
                onClick={() => setSidebarCollapsed(false)}
                title="הצגת תפריט הניווט"
                aria-label="הצגת תפריט הניווט"
                className="hidden shrink-0 rounded-xl bg-white p-2.5 text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 lg:block"
              >
                <PanelRightOpen size={20} />
              </button>
            )}
            <div className="min-w-0">
              <p className="truncate text-[11px] text-slate-400 sm:text-xs">
                {subtitleMap[active]}
              </p>
              <h2 className="truncate font-[var(--font-display)] text-base font-bold text-slate-800 sm:text-lg">
                {titleMap[active]}
              </h2>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
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
              accept="application/json,.json"
              className="hidden"
              onChange={importBackup}
            />
            {/* גיבוי ושחזור נוגעים בכל מערכי הנתונים, ולכן מוצגים רק למי
                שיש לו גישה לכל המסכים — אחרת שחזור היה מוחק מה שלא נראה. */}
            {(fullScope || (isCloudConfigured && session)) && (
              <div className="relative" ref={backupMenuRef}>
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
                  className="grid h-10 w-10 place-items-center rounded-xl bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 sm:flex sm:h-auto sm:w-auto sm:min-h-0 sm:items-center sm:gap-1.5 sm:bg-gold-500 sm:px-3 sm:py-2 sm:text-xs sm:font-semibold sm:text-white sm:ring-0 sm:hover:bg-gold-600"
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
                              לשחזור מלא של הנתונים למערכת
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
                              גיליון לכל מסך: מוזמנים, ספקים, הושבה ותקציב
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
                        שחזור מקובץ גיבוי
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
                title="שחזור נתונים מקובץ גיבוי"
                className="hidden items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 sm:flex"
              >
                <Upload size={16} /> <span className="hidden sm:inline">שחזור</span>
              </button>
            )}
            {isCloudConfigured && session && (
              <button
                onClick={signOutAndWipe}
                title="התנתקות (מנקה את הנתונים השמורים בדפדפן)"
                className="hidden items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 sm:flex"
              >
                <LogOut size={16} /> <span className="hidden sm:inline">יציאה</span>
              </button>
            )}
          </div>
        </header>

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
              onClick={() => window.location.reload()}
              className="rounded-full bg-white px-3 py-1 font-semibold text-rose-700 ring-1 ring-rose-300 transition hover:bg-rose-100"
            >
              רענון הדף
            </button>
          </div>
        )}

        <div key={active} className="animate-fade-in-up p-3 sm:p-5 lg:p-8">
          {/* הרשאת viewer: fieldset מושבת מנטרל כל input/select/button שבתוכו.
              זו שכבת UX בלבד — הגבול האמיתי הוא מדיניות ה-RLS ב-CockroachDB. */}
          <fieldset disabled={!canEdit} className="contents">
          {active === "overview" && (
            <Overview
              guests={guests}
              vendors={vendors}
              budget={budget}
              weddingDate={weddingDate}
              couple={couple}
              canEditSettings={cloudEnabled ? isOwner : true}
              onOpenSettings={() => setSettingsOpen(true)}
            />
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
              />
            </CategoriesContext.Provider>
          )}
          {active === "vendors" && (
            <Vendors
              vendors={vendors}
              setVendors={setVendors}
              weddingId={cloudEnabled ? weddingId : null}
              canEdit={canEdit}
            />
          )}
          {active === "finance" && (
            <Finance
              budget={budget}
              setBudget={setBudget}
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
          </fieldset>
        </div>
      </main>
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
    <div className="mb-4 px-2">
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

        <button
          onClick={onOpenMembers}
          className="mt-1 flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-right text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-gold-600"
        >
          <Share2 size={14} /> שיתוף וחברים
          <RoleBadge role={activeWedding.role} />
        </button>

        {/*  הבית של כל ההגדרות הכלליות: שמות בני הזוג, תאריך החתונה, יעד
            התקציב. כאן ולא בתוך מסכי העבודה, כי אלה נתונים חד-פעמיים.  */}
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-right text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-gold-600"
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
          className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
            full
              ? "bg-gold-500 text-white shadow-sm"
              : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
          }`}
        >
          כל המערכת
        </button>
        <button
          type="button"
          onClick={() => onChange(full ? ["guests"] : scopes)}
          className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
            !full
              ? "bg-gold-500 text-white shadow-sm"
              : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
          }`}
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

/**
 * בית אחד לכל ההגדרות הכלליות של החתונה — נתונים שקובעים פעם אחת בהתחלה
 * ולא נוגעים בהם תוך כדי עבודה. לפני כן הם היו פזורים בתוך מסכי העבודה
 * (כפתור "שינוי תאריך" באמצע הדאשבורד, עריכת שמות בכותרת), וזה גם הסתיר
 * אותם וגם הפריע לשימוש היומיומי.
 */
function WeddingSettingsModal({
  couple,
  weddingDate,
  budgetGoal,
  canEditBasics,
  canEditBudgetGoal,
  showDate,
  onSaveBasics,
  onSetBudgetGoal,
  onClose,
}) {
  const [partnerA, setPartnerA] = useState(couple?.partnerA || "");
  const [partnerB, setPartnerB] = useState(couple?.partnerB || "");
  const [date, setDate] = useState(String(weddingDate || "").slice(0, 10));
  const [goal, setGoal] = useState(String(budgetGoal || ""));
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      //  יעד התקציב נשמר דרך ה-state הרגיל (סנכרון ענן מושהה), ולכן הוא לא
      //  חלק מאותה בקשה — אבל הוא כן נשמר לפני שהמודאל נסגר.
      if (canEditBudgetGoal) onSetBudgetGoal(Math.max(0, Number(goal) || 0));
      if (canEditBasics) {
        await onSaveBasics({
          partnerA: partnerA.trim(),
          partnerB: partnerB.trim(),
          date: showDate ? date : undefined,
        });
      }
      notify("ההגדרות נשמרו", { tone: "success" });
      onClose();
    } catch (err) {
      console.error("Failed to save wedding settings:", err);
      notify("שמירת ההגדרות נכשלה. נסו שוב.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-gold-400 focus:ring-2 focus:ring-gold-100 disabled:bg-slate-50 disabled:text-slate-400";

  return (
    <div
      className="fixed inset-0 z-[105] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        role="dialog"
        aria-modal="true"
        onSubmit={save}
        className="animate-fade-in-up relative max-h-[85vh] w-full max-w-md overflow-auto rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="סגירה"
          title="סגירה"
          className="absolute left-5 top-5 rounded-xl p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <X size={18} />
        </button>

        <div className="mb-5 flex items-center gap-3 pl-10">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-gold-400 to-sage-400 text-white">
            <Settings2 size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="font-[var(--font-display)] text-lg font-bold text-slate-800">
              הגדרות החתונה
            </h3>
            <p className="text-xs text-slate-500">
              הפרטים הקבועים שנקבעים פעם אחת
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-500">
              שמות בני הזוג
            </p>
            <div className="grid grid-cols-2 gap-2">
              <input
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
          </div>
        </div>

        {!canEditBasics && (
          <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            שמות בני הזוג ותאריך החתונה ניתנים לשינוי על ידי בעלי החתונה בלבד.
          </p>
        )}

        <div className="mt-6 flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 rounded-xl bg-gradient-to-l from-gold-500 to-gold-400 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-gold-500/30 transition hover:brightness-105 disabled:opacity-60"
          >
            {busy ? "שומר…" : "שמירה"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100"
          >
            ביטול
          </button>
        </div>
      </form>
    </div>
  );
}

function MembersModal({
  weddingId,
  isOwner,
  currentUserId,
  weddingName = "",
  onClose,
}) {
  const [members, setMembers] = useState(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [scopes, setScopes] = useState(["all"]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(""); // מוצג בתוך המודל, לא כטוסט
  const [lastLink, setLastLink] = useState("");
  const [lastEmail, setLastEmail] = useState("");
  const [editing, setEditing] = useState(null); // userId שנמצא בעריכת הרשאות

  //  אין שליחת מיילים אוטומטית להזמנות, ולכן ההזמנה נשלחת על ידי המשתמש
  //  עצמו: ווטסאפ, אימייל או העתקה. כשההזמנה נצמדה לכתובת מייל ההודעה
  //  מזכירה אותה, אחרת הנמען מנסה להתחבר עם חשבון אחר והקישור נכשל.
  const eventLabel = weddingName || "החתונה שלנו";
  const shareSubject = `הזמנה לתכנון ${eventLabel}`;
  const shareMessage =
    `היי! שיתפתי אותך במערכת לתכנון ${eventLabel}.\n` +
    `להצטרפות: ${lastLink}\n` +
    (lastEmail ? `הקישור ממתין לכתובת המייל: ${lastEmail}\n` : "") +
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
      setMembers(await listMembers(weddingId));
    } catch (err) {
      console.error(err);
      notify("טעינת רשימת החברים נכשלה", { tone: "error" });
      setMembers([]);
    }
  }, [weddingId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

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
        timeout: "השרת לא השיב בזמן. נסו שוב בעוד רגע.",
        network_error: "אין חיבור לשרת. בדקו את האינטרנט ונסו שוב.",
      };
      setFormError(byCode[err?.code] || "יצירת הקישור נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function saveMember(m, nextRole, nextScopes) {
    try {
      await updateMember(weddingId, m.userId, nextRole, nextScopes);
      notify("ההרשאות עודכנו", { tone: "success" });
      setEditing(null);
      load();
    } catch (err) {
      console.error(err);
      notify("עדכון ההרשאות נכשל", { tone: "error" });
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
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="animate-fade-in-up relative max-h-[85vh] w-full max-w-lg overflow-auto rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/*  כפתור הסגירה מקובע לפינה כדי שכותרת ארוכה לא תדחוף אותו למטה  */}
        <button
          onClick={onClose}
          aria-label="סגירה"
          title="סגירה"
          className="absolute left-5 top-5 rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
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
              <input
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
                className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2.5 text-sm outline-none ring-1 ring-slate-200 focus:ring-gold-400"
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
                className="flex items-center gap-1.5 rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-gold-600 disabled:opacity-60"
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
                    className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50"
                  >
                    <Mail size={13} /> שליחה באימייל
                  </button>
                  <button
                    type="button"
                    onClick={copyLink}
                    className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[11px] font-semibold text-sage-700 ring-1 ring-sage-200 transition hover:bg-sage-100"
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
          {members?.map((m) => (
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
                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-gold-600"
                  >
                    <Pencil size={15} />
                  </button>
                )}
                {(isOwner || m.userId === currentUserId) && m.role !== "owner" && (
                  <button
                    onClick={() => revoke(m)}
                    title="הסרה"
                    aria-label="הסרת חבר"
                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>

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
          ))}
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
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gold-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-gold-600 disabled:opacity-60"
        >
          {busy && <Loader2 size={13} className="animate-spin" />} שמירה
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50"
        >
          ביטול
        </button>
      </div>
    </div>
  );
}
