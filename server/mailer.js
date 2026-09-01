/* =============================================================================
 *  mailer.js — שליחת מיילים יוצאים
 * -----------------------------------------------------------------------------
 *  שני שימושים: קישור לאיפוס סיסמה, ויידוע בן/בת זוג שנפתח עבורם חשבון.
 *
 *  ההגדרות מגיעות כולן ממשתני סביבה, כי סיסמת ה-SMTP היא סוד ואסור שתשב
 *  בקוד. אם לא הוגדר SMTP, המערכת לא נופלת: היא מדפיסה את הקישור ללוג
 *  השרת וממשיכה כרגיל. זה מאפשר לפתח ולבדוק בלי שרת דואר, ומונע מצב שבו
 *  תקלת דואר חוסמת התחברות.
 *
 *  משתני הסביבה:
 *    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS   — פרטי שרת הדואר
 *    SMTP_FROM                                     — כתובת השולח
 *    APP_URL                                       — כתובת הבסיס לקישורים
 * ========================================================================== */

let transporter;
let warned = false;

export const APP_URL = String(process.env.APP_URL || "http://localhost:5173").replace(
  /\/+$/,
  ""
);

export function isMailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function getTransporter() {
  if (transporter) return transporter;

  const nodemailer = (await import("nodemailer")).default;
  const port = Number(process.env.SMTP_PORT || 587);

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    //  465 הוא SMTPS (הצפנה מהשנייה הראשונה). בשאר הפורטים מתחילים בטקסט
    //  ומשדרגים ל-TLS, ולכן requireTLS — בלעדיו שליחה בטקסט גלוי אפשרית.
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  return transporter;
}

/**
 * שולח מייל איפוס סיסמה. לעולם לא זורק — כישלון דואר לא אמור להפיל בקשה
 * ולא אמור להסגיר ללקוח אם הכתובת רשומה במערכת.
 * @returns {Promise<boolean>} האם המייל נשלח בפועל
 */
export async function sendPasswordResetEmail(to, link) {
  if (!isMailConfigured()) {
    if (!warned) {
      console.warn(
        "[mail] SMTP לא מוגדר — קישורי איפוס סיסמה יודפסו ללוג במקום להישלח."
      );
      warned = true;
    }
    console.info(`[mail] קישור איפוס סיסמה עבור ${to}:\n${link}`);
    return false;
  }

  try {
    const mail = await getTransporter();
    await mail.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: "איפוס סיסמה — תכנון החתונה שלנו",
      text: [
        "שלום,",
        "",
        "התקבלה בקשה לאיפוס הסיסמה שלכם.",
        "לקביעת סיסמה חדשה היכנסו לקישור הבא:",
        link,
        "",
        "הקישור תקף לשעה אחת וניתן לשימוש פעם אחת בלבד.",
        "אם לא ביקשתם לאפס סיסמה, אפשר להתעלם מההודעה — לא בוצע שום שינוי.",
      ].join("\n"),
      //  ה-HTML נבנה מטקסט קבוע בלבד. הדבר היחיד המשתנה הוא הקישור, שנוצר
      //  אצלנו מטוקן אקראי — אין כאן שום קלט מהמשתמש, ולכן אין סכנת הזרקה.
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.7;color:#1e293b">
  <h2 style="margin:0 0 12px">איפוס סיסמה</h2>
  <p>התקבלה בקשה לאיפוס הסיסמה שלכם.</p>
  <p><a href="${link}" style="display:inline-block;background:#c9a227;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">קביעת סיסמה חדשה</a></p>
  <p style="font-size:13px;color:#64748b">הקישור תקף לשעה אחת וניתן לשימוש פעם אחת בלבד.<br>אם לא ביקשתם לאפס סיסמה, אפשר להתעלם מההודעה — לא בוצע שום שינוי.</p>
</div>`,
    });
    return true;
  } catch (err) {
    //  נכשל? מדפיסים ללוג וממשיכים. הלקוח מקבל את אותה תשובה בכל מקרה.
    console.error("[mail] שליחת מייל איפוס נכשלה:", err.message);
    return false;
  }
}

/*  כתובות המייל עוברות את EMAIL_RE של auth.js, שמתיר רק אותיות, ספרות
 *  ו-._%+-@ — כלומר אין בהן תווי HTML. הבריחה כאן היא חגורת ביטחון למקרה
 *  שהוולידציה תתרחב בעתיד, ולא הגנה יחידה.  */
function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

/**
 * מיידע בן/בת זוג שצורפו לחתונה. לעולם לא זורק — כישלון דואר לא אמור
 * לבטל צירוף שכבר נשמר במסד.
 *
 * @param {string|null} setupLink  קישור לקביעת סיסמה. קיים רק כשנפתח חשבון
 *                                 חדש; מי שכבר היה רשום נכנס עם הסיסמה שלו.
 * @returns {Promise<boolean>} האם המייל נשלח בפועל
 */
export async function sendPartnerWelcomeEmail(
  to,
  { ownerEmail = "", created = true, setupLink = null } = {}
) {
  const subject = created
    ? "הוזמנתם לנהל חתונה משותפת — תכנון החתונה שלנו"
    : "צורפתם לחתונה — תכנון החתונה שלנו";

  const lines = created
    ? [
        `${ownerEmail} צירף/ה אתכם לניהול החתונה המשותפת.`,
        "כדי להיכנס, קבעו לעצמכם סיסמה בקישור הבא. הכניסה שלכם היא עם כתובת המייל הזו ועם הסיסמה שתבחרו — נפרדת לחלוטין מזו של בן/בת הזוג.",
      ]
    : [
        `${ownerEmail} צירף/ה את החשבון שלכם לחתונה המשותפת.`,
        "אפשר להיכנס כרגיל, עם המייל והסיסמה הקיימים שלכם.",
      ];

  const link = setupLink || APP_URL;

  if (!isMailConfigured()) {
    console.info(
      `[mail] יידוע צירוף בן/בת זוג עבור ${to}:\n${lines.join("\n")}\n${link}`
    );
    return false;
  }

  try {
    const mail = await getTransporter();
    await mail.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text: [
        "שלום,",
        "",
        ...lines,
        "",
        created ? `קביעת סיסמה: ${link}` : `כניסה למערכת: ${link}`,
        ...(created ? ["הקישור תקף לשבוע וניתן לשימוש פעם אחת."] : []),
        "",
        "אם ההודעה הגיעה אליכם בטעות, אפשר להתעלם ממנה — בלי קביעת סיסמה לא ניתן להיכנס לחשבון.",
      ].join("\n"),
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.7;color:#1e293b">
  <h2 style="margin:0 0 12px">${escapeHtml(created ? "הוזמנתם לנהל חתונה משותפת" : "צורפתם לחתונה")}</h2>
  ${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n  ")}
  <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#c9a227;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">${escapeHtml(created ? "קביעת סיסמה" : "כניסה למערכת")}</a></p>
  <p style="font-size:13px;color:#64748b">${created ? "הקישור תקף לשבוע וניתן לשימוש פעם אחת.<br>" : ""}אם ההודעה הגיעה אליכם בטעות, אפשר להתעלם ממנה — בלי קביעת סיסמה לא ניתן להיכנס לחשבון.</p>
</div>`,
    });
    return true;
  } catch (err) {
    console.error("[mail] שליחת יידוע לבן/בת הזוג נכשלה:", err.message);
    return false;
  }
}
