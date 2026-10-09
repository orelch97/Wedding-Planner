import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Sparkles, X } from "lucide-react";
import { useAccessibleModal } from "../hooks/useAccessibleModal";

/* =========================================================================
 *  GUIDE – סיור מודרך (זרקור + בועת הסבר) והסבר קבוע לכל מסך
 *  ------------------------------------------------------------------------
 *  לא נוספה ספריית סיור חיצונית. כל מה שנדרש הוא למדוד אלמנט, לחשוך
 *  סביבו חור בשכבה כהה ולהצמיד אליו בועה — וזה קצר יותר מהעטיפה שהיינו
 *  צריכים לכתוב לספרייה כזו, ובלי תלות שמתחזקת RTL בצורה חלקית.
 *
 *  שכבות z: מודלים = 105, דיאלוג אישור = 110. הסיור יושב מעליהם (119-121)
 *  כדי שיוכל להסביר גם על אלמנט שנמצא בתוך מודל פתוח.
 * ====================================================================== */

const SPOT_PAD = 8; // ריווח הזרקור סביב האלמנט
const CARD_GAP = 14; // מרחק הבועה מהזרקור
const CARD_MAX = 330;
const EDGE = 10; // מרווח מינימלי מקצה החלון

/** מודד אלמנט לפי סלקטור. מחזיר null גם אם הוא קיים ב-DOM אך אינו מוצג. */
function measureTarget(selector) {
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  return { el, rect };
}

/*  החישוב רץ גם בכל scroll ובכל רנדור. בלי ההשוואה הזאת כל
    קריאה הייתה מציבה אובייקט חדש ב-state — ומפילה את הרכיב ללולאה
    אינסופית של רנדורים.  */
function sameBox(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height
  );
}

export function Tour({ steps, onClose, onComplete }) {
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState(null);
  const [card, setCard] = useState(null);
  //  המעבר החלק נדלק רק אחרי המיקום הראשון. בלעדיו הבועה מונפשת
  //  ממקום החניה שלה מחוץ למסך וחוצה את כל החלון באלכסון.
  const [animate, setAnimate] = useState(false);
  const cardRef = useRef(null);
  const nextButtonRef = useRef(null);

  const step = steps[index];
  const isLast = index === steps.length - 1;

  /*  חישוב המיקום. נקרא גם בכל resize/scroll, כי המסך מתחתינו ממשיך
      לזוז — פתיחת מגירה, מודל שנפתח או סתם סיבוב מכשיר.  */
  const place = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(CARD_MAX, vw - EDGE * 2);
    const height = cardRef.current?.offsetHeight ?? 210;
    const found = measureTarget(step?.target);

    if (!found) {
      //  בלי מטרה (או כשהמטרה לא על המסך) הבועה יושבת במרכז והשכבה
      //  כולה מוחשכת. עדיף מבועה שמצביעה על כלום.
      setSpot(null);
      const box = {
        top: Math.max(EDGE, (vh - height) / 2),
        left: (vw - width) / 2,
        width,
      };
      setCard((prev) => (sameBox(prev, box) ? prev : box));
      return;
    }

    const { rect } = found;
    const box = {
      top: rect.top - SPOT_PAD,
      left: rect.left - SPOT_PAD,
      width: rect.width + SPOT_PAD * 2,
      height: rect.height + SPOT_PAD * 2,
    };
    setSpot((prev) => (sameBox(prev, box) ? prev : box));

    const below = box.top + box.height + CARD_GAP;
    const above = box.top - CARD_GAP - height;
    const top =
      below + height <= vh - EDGE
        ? below
        : above >= EDGE
          ? above
          : Math.max(EDGE, (vh - height) / 2);

    const centered = rect.left + rect.width / 2 - width / 2;
    const left = Math.min(Math.max(EDGE, centered), Math.max(EDGE, vw - width - EDGE));
    const next = { top, left, width };
    setCard((prev) => (sameBox(prev, next) ? prev : next));
  }, [step]);

  /*  מעבר שלב: קודם משנים את המסך (פתיחת מגירה / החלפת מצב טופס),
      אחר כך גוללים לאלמנט, ורק אז מודדים. המדידה מתעכבת בכוונה —
      גלילה חלקה ואנימציית המגירה נמשכות ~300ms, ומדידה מוקדמת
      הייתה מציבה את הזרקור על המיקום הישן.  */
  useLayoutEffect(() => {
    step?.before?.();
    const el = step?.target ? document.querySelector(step.target) : null;
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    const quick = requestAnimationFrame(place);
    const settled = setTimeout(place, 340);
    return () => {
      cancelAnimationFrame(quick);
      clearTimeout(settled);
    };
  }, [step, place]);

  useEffect(() => {
    if (!card || animate) return;
    const t = setTimeout(() => setAnimate(true), 80);
    return () => clearTimeout(t);
  }, [card, animate]);

  useEffect(() => {
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [place]);

  const next = useCallback(() => {
    if (isLast) {
      onComplete?.();
      onClose();
    }
    else setIndex((i) => i + 1);
  }, [isLast, onClose, onComplete]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      //  RTL: "הבא" מצביע שמאלה, ולכן חץ שמאל מקדם.
      else if (e.key === "ArrowLeft") next();
      else if (e.key === "ArrowRight") setIndex((i) => Math.max(0, i - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, onClose]);

  useAccessibleModal({
    open: !!step,
    containerRef: cardRef,
    initialFocusRef: nextButtonRef,
    onRequestClose: onClose,
  });

  if (!step) return null;

  return createPortal(
    <>
      {spot ? (
        <>
          <div aria-hidden="true" className="fixed left-0 right-0 top-0 z-[119] bg-slate-900/60" style={{ height: Math.max(0, spot.top) }} onClick={onClose} />
          <div aria-hidden="true" className="fixed bottom-0 left-0 right-0 z-[119] bg-slate-900/60" style={{ top: Math.min(window.innerHeight, spot.top + spot.height) }} onClick={onClose} />
          <div aria-hidden="true" className="fixed left-0 z-[119] bg-slate-900/60" style={{ top: Math.max(0, spot.top), width: Math.max(0, spot.left), height: Math.max(0, Math.min(window.innerHeight, spot.top + spot.height) - Math.max(0, spot.top)) }} onClick={onClose} />
          <div aria-hidden="true" className="fixed right-0 z-[119] bg-slate-900/60" style={{ top: Math.max(0, spot.top), left: Math.min(window.innerWidth, spot.left + spot.width), height: Math.max(0, Math.min(window.innerHeight, spot.top + spot.height) - Math.max(0, spot.top)) }} onClick={onClose} />
        </>
      ) : (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[119] bg-slate-900/60"
          onClick={onClose}
        />
      )}
      {spot && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[120] rounded-2xl ring-2 ring-gold-400"
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
            boxShadow: "0 0 0 9999px rgba(15,23,42,0.62)",
            transition: animate
              ? "top .25s, left .25s, width .25s, height .25s"
              : "none",
          }}
        />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guided-tour-title"
        aria-describedby="guided-tour-description"
        className="fixed z-[121] rounded-2xl bg-white p-4 text-right shadow-2xl ring-1 ring-slate-200"
        style={{
          top: card?.top ?? -9999,
          left: card?.left ?? -9999,
          width: card?.width ?? CARD_MAX,
          opacity: card ? 1 : 0,
          transition: animate ? "top .25s, left .25s, opacity .15s" : "opacity .15s",
        }}
      >
        <div className="flex items-start gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-gold-400 to-gold-600 text-white shadow-sm">
            <Sparkles size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="guided-tour-title" className="font-display text-sm font-bold text-slate-800">
              {step.title}
            </h3>
            <p id="guided-tour-description" className="mt-1 text-xs leading-relaxed text-slate-600">{step.body}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירת ההדרכה"
            className="btn-icon -m-1 h-8 w-8"
          >
            <X size={16} />
          </button>
        </div>

        {step.tip && (
          <p className="mt-2.5 rounded-xl bg-gold-50 px-3 py-2 text-[11px] leading-relaxed text-gold-700 ring-1 ring-gold-200">
            {step.tip}
          </p>
        )}

        <div className="mt-3.5 flex items-center justify-between gap-2">
          <span className="text-[11px] tabular-nums text-slate-400">
            {index + 1} מתוך {steps.length}
          </span>
          <div className="flex items-center gap-1.5">
            {index > 0 && (
              <button
                type="button"
                onClick={() => setIndex((i) => i - 1)}
                className="btn-secondary px-3 text-xs"
              >
                הקודם
              </button>
            )}
            <button
              type="button"
              onClick={next}
              ref={nextButtonRef}
              className="btn-primary px-3 text-xs"
            >
              {isLast ? "סיום" : "הבא"}
              {!isLast && <ChevronLeft size={14} />}
            </button>
          </div>
        </div>

        {!isLast && (
          <button
            type="button"
            onClick={onClose}
            className="mt-1.5 w-full rounded-lg py-1 text-[11px] text-slate-400 transition hover:text-slate-600"
          >
            דילוג על ההדרכה
          </button>
        )}
      </div>
    </>,
    document.body
  );
}

