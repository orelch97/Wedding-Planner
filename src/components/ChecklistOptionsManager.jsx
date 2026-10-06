import { useRef, useState } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";
import { useAccessibleModal } from "../hooks/useAccessibleModal.js";

function OptionRow({ option, kind, canDelete, onRename, onDelete }) {
  const [name, setName] = useState(option.label);
  return (
    <li className="flex min-w-0 items-center gap-2 border-b border-slate-100 py-2">
      <form onSubmit={(event) => { event.preventDefault(); onRename(kind, option.key, name); }} className="flex min-w-0 flex-1 items-center gap-1">
        <input aria-label={`שם ${option.label}`} value={name} onChange={(event) => setName(event.target.value)} maxLength={60} className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-base text-slate-700 outline-none focus:border-gold-400 sm:text-sm" />
        <button type="submit" aria-label={`שמירת ${option.label}`} title="שמירת שם" disabled={!name.trim() || name === option.label} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-gold-700 transition hover:bg-gold-50 disabled:opacity-40"><Save size={16} /></button>
      </form>
      <button type="button" aria-label={`מחיקת ${option.label}`} title={canDelete ? "מחיקת אפשרות" : "חייבת להישאר אפשרות אחת"} disabled={!canDelete} onClick={() => onDelete(kind, option.key)} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"><Trash2 size={16} /></button>
    </li>
  );
}

export default function ChecklistOptionsManager({ categories, assignees, onAdd, onRename, onDelete, onClose }) {
  const [kind, setKind] = useState("category");
  const [draft, setDraft] = useState("");
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  useAccessibleModal({ open: true, containerRef: dialogRef, initialFocusRef: inputRef, onRequestClose: onClose });
  const options = kind === "category" ? categories.map((label) => ({ key: label, label })) : assignees;
  return (
    <div className="fixed inset-0 z-[105] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-label="ניהול קטגוריות ושיוך" onClick={(event) => event.stopPropagation()} className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col rounded-2xl bg-white p-4 shadow-xl sm:p-6">
        <header className="mb-4 flex items-center justify-between gap-2">
          <h3 className="font-display text-lg font-bold text-slate-800">ניהול קטגוריות ושיוך</h3>
          <button onClick={onClose} type="button" aria-label="סגירה" title="סגירה" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100"><X size={18} /></button>
        </header>
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
          {[{ key: "category", label: "קטגוריה" }, { key: "assignee", label: "שיוך" }].map((tab) => (
            <button key={tab.key} type="button" aria-pressed={kind === tab.key} onClick={() => { setKind(tab.key); setDraft(""); }} className={`min-h-11 rounded-lg text-sm font-semibold transition ${kind === tab.key ? "bg-white text-gold-700 shadow-sm" : "text-slate-500 hover:bg-white/60"}`}>{tab.label}</button>
          ))}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); if (onAdd(kind, draft)) setDraft(""); }} className="mb-3 flex min-w-0 gap-2">
          <input ref={inputRef} aria-label={kind === "category" ? "קטגוריה חדשה" : "שיוך חדש"} placeholder={kind === "category" ? "קטגוריה חדשה" : "שיוך חדש"} value={draft} maxLength={60} onChange={(event) => setDraft(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-base outline-none focus:border-gold-400 sm:text-sm" />
          <button type="submit" disabled={!draft.trim()} className="btn-primary shrink-0"><Plus size={16} /> הוספה</button>
        </form>
        <ul className="min-h-0 overflow-y-auto overscroll-contain">
          {options.map((option) => <OptionRow key={`${kind}:${option.key}:${option.label}`} option={option} kind={kind} canDelete={options.length > 1} onRename={onRename} onDelete={onDelete} />)}
        </ul>
      </section>
    </div>
  );
}