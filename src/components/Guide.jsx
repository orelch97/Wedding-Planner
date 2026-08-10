import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, HelpCircle, Sparkles, X } from "lucide-react";

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

export function Tour({ steps, onClose }) {
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState(null);
  const [card, setCard] = useState(null);
  //  המעבר החלק נדלק רק אחרי המיקום הראשון. בלעדיו הבועה מונפשת
  //  ממקום החניה שלה מחוץ למסך וחוצה את כל החלון באלכסון.
  const [animate, setAnimate] = useState(false);
  const cardRef = useRef(null);

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
    if (isLast) onClose();
    else setIndex((i) => i + 1);
  }, [isLast, onClose]);

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

  if (!step) return null;

  return createPortal(
    <>
      {/*  חוסם קליקים על המסך שמתחת — בלי זה אפשר לשנות את המסך
          באמצע ההסבר והזרקור מצביע על אלמנט שכבר לא שם.
          לחיצה על הרקע סוגרת את הסיור: בלי זה משתמש שלא מזהה את הסיור
          חווה מסך תקוע שלא מגיב לכלום.  */}
      <div
        className="fixed inset-0 z-[119]"
        style={spot ? undefined : { background: "rgba(15,23,42,0.62)" }}
        onClick={onClose}
      />
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
        aria-label="הדרכה מודרכת"
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
            <h3 className="font-[var(--font-display)] text-sm font-bold text-slate-800">
              {step.title}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">{step.body}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירת ההדרכה"
            className="-m-1 shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
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
                className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
              >
                הקודם
              </button>
            )}
            <button
              type="button"
              onClick={next}
              autoFocus
              className="flex items-center gap-1 rounded-xl bg-gold-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-gold-600"
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

/* =========================================================================
 *  ScreenIntro – "מה עושים במסך הזה?"
 *  מוצג בראש כל מסך עד שהמשתמש סוגר אותו, וניתן להחזרה מכפתור העזרה.
 * ====================================================================== */

export function ScreenIntro({ guide, onStartTour, onDismiss }) {
  //  בטלפון הפירוט המלא תפס יותר מחצי מהמסך הראשון ודחף את הנתונים עצמם
  //  מתחת לקיפול. במסך רחב אין בעיה כזו, ולכן שם הוא פתוח תמיד.
  const [more, setMore] = useState(false);

  if (!guide) return null;

  return (
    <div className="mb-4 rounded-2xl bg-gradient-to-l from-gold-50/80 to-sage-50/60 p-3.5 ring-1 ring-gold-200/70 sm:mb-6 sm:p-4">
      <div className="flex items-start gap-2.5">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white text-gold-500 shadow-sm ring-1 ring-gold-200">
          <HelpCircle size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-bold text-slate-700 sm:text-sm">
            מה עושים במסך הזה?
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">{guide.lead}</p>

          <div className={more ? "block" : "hidden sm:block"}>
            {guide.here?.length > 0 && (
              <ul className="mt-2 space-y-1">
                {guide.here.map((line) => (
                  <li
                    key={line}
                    className="flex gap-1.5 text-[11px] leading-relaxed text-slate-500 sm:text-xs"
                  >
                    <span aria-hidden="true" className="text-gold-500">
                      •
                    </span>
                    <span className="min-w-0">{line}</span>
                  </li>
                ))}
              </ul>
            )}

            {guide.notHere && (
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                <span className="font-semibold text-slate-600">שימו לב: </span>
                {guide.notHere}
              </p>
            )}
          </div>

          {/*  השלושה הם קישורי טקסט בגובה של שורה אחת — 17px בפועל, קטן מכדי
              ללחיצה באצבע. min-h-11 מגדיל את אזור המגע בלבד, ורק במסך צר:
              במסך רחב יש עכבר, ושורה של 44px היתה מנפחת את ההסבר בלי צורך.  */}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <button
              type="button"
              onClick={() => setMore((v) => !v)}
              aria-expanded={more}
              className="inline-flex min-h-11 items-center text-[11px] font-semibold text-slate-500 underline-offset-4 transition hover:text-slate-700 hover:underline sm:hidden"
            >
              {more ? "פחות" : "מה בדיוק מזינים כאן?"}
            </button>
            {onStartTour && (
              <button
                type="button"
                onClick={onStartTour}
                className="inline-flex min-h-11 items-center text-[11px] font-semibold text-gold-600 underline-offset-4 transition hover:underline sm:min-h-0 sm:text-xs"
              >
                סיור מודרך במערכת
              </button>
            )}
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex min-h-11 items-center text-[11px] font-medium text-slate-400 underline-offset-4 transition hover:text-slate-600 hover:underline sm:min-h-0 sm:text-xs"
            >
              הבנתי, אפשר להסתיר
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
