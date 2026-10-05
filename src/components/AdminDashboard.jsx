import { useCallback, useEffect, useState } from "react";
import { Activity, AlertCircle, Clock3, RefreshCw, Users } from "lucide-react";
import { getAdminActivity } from "../lib/firebaseStore.js";

const dateLabel = (value) => {
  if (!value) return "טרם נרשם";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "תאריך לא זמין"
    : new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeStyle: "short" }).format(date);
};

export default function AdminDashboard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async (activeRef) => {
    try {
      const result = await getAdminActivity();
      if (activeRef.current) setRows(result);
    } catch (err) {
      console.error("Failed to load admin activity:", err);
      if (activeRef.current) setError("לא ניתן לטעון פעילות מערכת כרגע. בדקו הרשאה וחיבור ונסו שוב.");
    } finally {
      if (activeRef.current) setLoading(false);
    }
  }, []);

  const refresh = () => {
    setLoading(true);
    setError("");
    setRefreshKey((key) => key + 1);
  };

  useEffect(() => {
    const activeRef = { current: true };
    const timer = window.setTimeout(() => load(activeRef), 0);
    return () => {
      activeRef.current = false;
      window.clearTimeout(timer);
    };
  }, [load, refreshKey]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <section data-tour="admin-activity-summary" className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 p-5 text-white shadow-xl sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/15">
              <Activity size={21} className="text-gold-300" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-gold-200">ניהול מערכת · נתוני Production</p>
              <h2 className="mt-1 font-display text-xl font-bold sm:text-2xl">פעילות משתמשים</h2>
              <p className="mt-1 text-xs leading-5 text-slate-300 sm:text-sm">כניסות אחרונות לפי חותמת הנוכחות שנשמרה בכל חתונה.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/15 disabled:opacity-50 sm:w-auto"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> רענון
          </button>
        </div>
      </section>

      <section data-tour="admin-activity-table" className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="admin-activity-heading">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Users size={18} className="shrink-0 text-gold-600" />
            <h3 id="admin-activity-heading" className="font-bold text-slate-800">כניסות אחרונות</h3>
          </div>
          <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{rows.length}</span>
        </div>

        {error ? (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl bg-rose-50 p-4 text-sm text-rose-800 ring-1 ring-rose-200 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-2"><AlertCircle size={17} />{error}</span>
            <button type="button" onClick={refresh} className="min-h-11 rounded-xl bg-white px-4 font-semibold ring-1 ring-rose-200">ניסיון חוזר</button>
          </div>
        ) : loading ? (
          <div role="status" className="flex min-h-32 items-center justify-center gap-2 text-sm text-slate-500">
            <RefreshCw size={17} className="animate-spin text-gold-600" /> טוען פעילות…
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">לא נמצאה פעילות משתמשים להצגה.</div>
        ) : (
          <>
            <div className="space-y-2 md:hidden">
              {rows.map((row) => (
                <article key={`${row.weddingId}:${row.email}`} className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
                  <p className="break-all text-sm font-semibold text-slate-800" dir="ltr">{row.email || "מייל לא זמין"}</p>
                  <p className="mt-2 truncate text-xs text-slate-600" title={row.weddingName || row.weddingId}>חתונה: {row.weddingName || row.weddingId}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><Clock3 size={13} />{dateLabel(row.lastSeenAt)}</p>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto rounded-2xl ring-1 ring-slate-200 md:block">
              <table className="w-full min-w-[640px] text-right text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                  <tr><th className="px-4 py-3">כתובת מייל</th><th className="px-4 py-3">חתונה</th><th className="px-4 py-3">מזהה חתונה</th><th className="px-4 py-3">כניסה אחרונה</th></tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.weddingId}:${row.email}`} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-medium text-slate-700" dir="ltr">{row.email || "—"}</td>
                      <td className="px-4 py-3 text-slate-700">{row.weddingName || "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500" dir="ltr">{row.weddingId}</td>
                      <td className="px-4 py-3 text-slate-600">{dateLabel(row.lastSeenAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="mt-3 text-[11px] leading-5 text-slate-400">הפעילות מבוססת על lastSeenAt במסמכי החברות. משתמש המשויך לכמה חתונות עשוי להופיע ביותר משורה אחת.</p>
      </section>
    </div>
  );
}
