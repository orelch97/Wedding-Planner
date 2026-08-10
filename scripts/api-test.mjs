// =============================================================================
//  scripts/api-test.mjs — בדיקת קצה-לקצה של הבידוד הרב-דיירי מול ה-API החי.
// -----------------------------------------------------------------------------
//  הרצה:  npm run dev   (בטרמינל נפרד)
//         npm run test:api
//
//  הבדיקה יוצרת משתמשים אמיתיים במסד. הריצו אותה רק מול מסד פיתוח.
//  כל הטענות נבדקות דרך HTTP, כלומר דרך אותו מסלול שהדפדפן עובר בו —
//  ולכן הן מוכיחות שה-RLS אוכף בפועל ולא רק שהקוד "מתכוון" לאכוף.
// =============================================================================

const BASE = (process.env.API_URL || "http://localhost:3001/api").replace(/\/+$/, "");

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `  — ${detail}` : ""}`);
  }
}

//  לקוח מינימלי ששומר את עוגיית הסשן, כמו דפדפן.
function makeClient() {
  let cookie = "";
  return async function call(path, { method = "GET", body } = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const raw of setCookie) {
      const pair = raw.split(";")[0];
      if (pair.startsWith("wp_session=")) cookie = pair;
    }
    let data = null;
    if (res.status !== 204) {
      const text = await res.text();
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
    }
    return { status: res.status, data };
  };
}

const stamp = Date.now();
const alice = { email: `alice-${stamp}@test.local`, password: "CorrectHorse123" };
const bob = { email: `bob-${stamp}@test.local`, password: "CorrectHorse123" };

const A = makeClient();
const B = makeClient();

console.log(`\nבדיקת API מול ${BASE}\n`);

/* ── 1. הרשמה והקצאה אוטומטית ─────────────────────────────────────────────── */
console.log("1. הרשמה");
let r = await A("/auth/register", { method: "POST", body: alice });
check("אליס נרשמה", r.status < 300 && r.data?.user?.email === alice.email, JSON.stringify(r.data));
r = await B("/auth/register", { method: "POST", body: bob });
check("בוב נרשם", r.status < 300 && r.data?.user?.email === bob.email, JSON.stringify(r.data));

r = await A("/auth/register", { method: "POST", body: alice });
check("מייל כפול נדחה", r.data?.error === "email_taken", JSON.stringify(r.data));

r = await A("/auth/register", { method: "POST", body: { email: `x-${stamp}@t.local`, password: "short" } });
check("סיסמה קצרה נדחית", r.data?.error === "weak_password", JSON.stringify(r.data));

//  ההזדהות היא לפי כתובת מייל: היא הערוץ היחיד להחזרת גישה למי ששכח סיסמה,
//  ולכן חייבים לוודא שהיא תקינה. כל צורה שאינה כתובת אמיתית נדחית.
for (const bad of [
  `dana${stamp}`,
  "ab1",
  "יעל@example.com",
  "with space@example.com",
  "no-at-sign.com",
  "missing@domain",
  "@example.com",
  "double@@example.com",
]) {
  r = await A("/auth/register", { method: "POST", body: { email: bad, password: "CorrectHorse123" } });
  check(`מייל פסול נדחה (${bad})`, r.data?.error === "invalid_email", JSON.stringify(r.data));
}

//  אותם כללים גם בהתחברות. כתובת פסולה לא נשמרה מעולם, ולכן אין כאן סיכון
//  לנעול חשבון קיים בחוץ.
r = await makeClient()("/auth/login", { method: "POST", body: { email: "old", password: "CorrectHorse123" } });
check("התחברות עם מזהה שאינו מייל נדחית", r.data?.error === "invalid_credentials", JSON.stringify(r.data));

//  רישיות אינה אמורה ליצור חשבון שני לאותה תיבה.
r = await makeClient()("/auth/login", {
  method: "POST",
  body: { email: alice.email.toUpperCase(), password: alice.password },
});
check("התחברות עם אותיות גדולות עובדת", r.status === 200 && r.data?.user?.email === alice.email, JSON.stringify(r.data));

//  תאריך החתונה נקבע כבר בהרשמה — זה אחד משלושת השדות במסך ההרשמה.
const dated = { email: `dated-${stamp}@test.local`, password: "CorrectHorse123" };
const D = makeClient();
r = await D("/auth/register", { method: "POST", body: { ...dated, weddingDate: "2028-05-14" } });
check("הרשמה עם תאריך חתונה", r.status < 300, JSON.stringify(r.data));
r = await D("/weddings");
check("התאריך נשמר על החתונה הראשונה", r.data?.[0]?.weddingDate === "2028-05-14", JSON.stringify(r.data));

r = await makeClient()("/auth/register", {
  method: "POST",
  body: { email: `baddate-${stamp}@test.local`, password: "CorrectHorse123", weddingDate: "2028-02-31" },
});
check("תאריך חתונה לא קיים נדחה", r.data?.error === "invalid_date", JSON.stringify(r.data));

/* ── 2. כל משתמש מקבל חתונה משלו ──────────────────────────────────────────── */
console.log("\n2. חתונה אוטומטית");
const aw = (await A("/weddings")).data;
const bw = (await B("/weddings")).data;
check("לאליס חתונה אחת בבעלותה", aw?.length === 1 && aw[0].role === "owner", JSON.stringify(aw));
check("לבוב חתונה אחת בבעלותו", bw?.length === 1 && bw[0].role === "owner");
check("שתי חתונות שונות", aw?.[0]?.id !== bw?.[0]?.id);

const AW = aw[0].id;
const BW = bw[0].id;

/* ── 2b. שמות בני הזוג חיים על החתונה ─────────────────────────────────────── */
//  זהו מקור האמת היחיד לשם שמוצג בסרגל הצד ובמחליף החתונות, ולכן חשוב
//  שחתונה חדשה תיוולד בלי שמות ושהעדכון יהיה חלקי (שינוי שמות לא ימחק תאריך).
check("חתונה חדשה נולדת בלי שמות בני זוג", aw[0].partnerA === "" && aw[0].partnerB === "", JSON.stringify(aw[0]));

r = await A(`/weddings/${AW}`, { method: "PATCH", body: { date: "2027-01-06" } });
check("עדכון תאריך בלי לשלוח שם", r.status === 200 && r.data?.weddingDate?.slice(0, 10) === "2027-01-06", JSON.stringify(r.data));

r = await A(`/weddings/${AW}`, { method: "PATCH", body: { partnerA: "אוראל", partnerB: "מיתר" } });
check("שמות בני הזוג נשמרו", r.data?.partnerA === "אוראל" && r.data?.partnerB === "מיתר", JSON.stringify(r.data));
check("עדכון השמות לא מחק את התאריך", r.data?.weddingDate?.slice(0, 10) === "2027-01-06", JSON.stringify(r.data));

r = await A("/weddings");
check("השמות חוזרים גם ברשימת החתונות", r.data?.[0]?.partnerA === "אוראל", JSON.stringify(r.data?.[0]));

r = await A(`/weddings/${AW}`, { method: "PATCH", body: { partnerB: "" } });
check("אפשר למחוק שם שהוזן בטעות", r.data?.partnerA === "אוראל" && r.data?.partnerB === "", JSON.stringify(r.data));

r = await A(`/weddings/${AW}`, { method: "PATCH", body: {} });
check("PATCH ריק נדחה", r.status === 400 && r.data?.error === "no_changes", JSON.stringify(r.data));

r = await A(`/weddings/${AW}`, { method: "PATCH", body: { name: "   " } });
check("שם ריק עדיין נדחה", r.status === 400 && r.data?.error === "invalid_name", JSON.stringify(r.data));

r = await B(`/weddings/${AW}`, { method: "PATCH", body: { partnerA: "פורץ" } });
check("זר לא יכול לשנות את שמות בני הזוג", r.status === 403, JSON.stringify(r.data));

r = await A(`/weddings/${AW}`, { method: "PATCH", body: { partnerA: "אוראל", partnerB: "מיתר" } });
check("השמות שוחזרו להמשך הבדיקה", r.data?.partnerB === "מיתר");

/* ── 3. כתיבה וקריאה של הבעלים ────────────────────────────────────────────── */
console.log("\n3. נתונים");
r = await A(`/weddings/${AW}/sync`, {
  method: "POST",
  body: { key: "guests", rows: [{ id: 1, name: "דוד", seats: 2, rsvp: "pending" }], removedIds: [] },
});
check("אליס כתבה אורח", r.status === 200, JSON.stringify(r.data));

r = await A(`/weddings/${AW}/data`);
check("אליס קוראת את האורח", r.data?.guests?.length === 1 && r.data.guests[0].name === "דוד", JSON.stringify(r.data));
check("id נשמר כמספר", r.data?.guests?.[0]?.id === 1);

//  שתי חתונות עם אותו id — המפתח המורכב חייב להחזיק.
r = await B(`/weddings/${BW}/sync`, {
  method: "POST",
  body: { key: "guests", rows: [{ id: 1, name: "שרה", seats: 1 }], removedIds: [] },
});
check("בוב כתב אורח עם אותו id=1", r.status === 200, JSON.stringify(r.data));
r = await B(`/weddings/${BW}/data`);
check("בוב רואה את שרה ולא את דוד", r.data?.guests?.length === 1 && r.data.guests[0].name === "שרה");

/* ── 4. בידוד — הלב של הבדיקה ─────────────────────────────────────────────── */
console.log("\n4. בידוד בין דיירים");
r = await B(`/weddings/${AW}/data`);
check("בוב חסום מנתוני אליס", r.status >= 400 || (r.data?.guests?.length ?? 0) === 0, `status=${r.status} ${JSON.stringify(r.data)}`);

r = await B(`/weddings/${AW}/sync`, {
  method: "POST",
  body: { key: "guests", rows: [{ id: 99, name: "פריצה" }], removedIds: [] },
});
check("בוב חסום מכתיבה לחתונת אליס", r.status >= 400, `status=${r.status}`);

r = await A(`/weddings/${AW}/data`);
check("נתוני אליס לא זוהמו", r.data?.guests?.length === 1, JSON.stringify(r.data?.guests));

r = await B(`/weddings/${AW}/members`);
check("בוב חסום מרשימת החברים", r.status === 403, `status=${r.status}`);

r = await B(`/weddings/${AW}/invites`, { method: "POST", body: { email: "x@t.local", role: "editor" } });
check("בוב לא יכול להזמין לחתונת אליס", r.status >= 400, `status=${r.status}`);

const anon = makeClient();
r = await anon(`/weddings/${AW}/data`);
check("אנונימי חסום", r.status === 401, `status=${r.status}`);

/* ── 5. שיתוף ─────────────────────────────────────────────────────────────── */
console.log("\n5. שיתוף והרשאות");
//  הזמנה עצמית היתה מורידה את שורת ה-owner ל-editor/viewer בעת הקבלה.
r = await A(`/weddings/${AW}/invites`, { method: "POST", body: { email: alice.email, role: "viewer" } });
check("אליס לא יכולה להזמין את עצמה", r.data?.error === "cannot_invite_self", JSON.stringify(r.data));
r = await A(`/weddings/${AW}/invites`, { method: "POST", body: { email: bob.email, role: "viewer" } });
const token = r.data?.token;
check("אליס יצרה הזמנה", typeof token === "string" && token.length > 20, JSON.stringify(r.data));

r = await A("/invites/accept", { method: "POST", body: { token: "לא-קיים" } });
check("טוקן שגוי נדחה", r.data?.error === "invite_not_found");

r = await B("/invites/accept", { method: "POST", body: { token } });
check("בוב קיבל את ההזמנה", r.data?.weddingId === AW, JSON.stringify(r.data));

r = await B("/invites/accept", { method: "POST", body: { token } });
check("אי-אפשר לממש הזמנה פעמיים", r.data?.error === "invite_already_used", JSON.stringify(r.data));

const bw2 = (await B("/weddings")).data;
check("בוב רואה 2 חתונות", bw2?.length === 2, JSON.stringify(bw2?.map((w) => w.role)));
check("התפקיד של בוב הוא viewer", bw2?.find((w) => w.id === AW)?.role === "viewer");

r = await B(`/weddings/${AW}/data`);
check("viewer קורא נתונים", r.data?.guests?.length === 1, JSON.stringify(r.data?.guests));

r = await B(`/weddings/${AW}/sync`, {
  method: "POST",
  body: { key: "guests", rows: [{ id: 5, name: "viewer-write" }], removedIds: [] },
});
check("viewer חסום מכתיבה", r.status >= 400, `status=${r.status}`);

r = await B(`/weddings/${AW}/invites`, { method: "POST", body: { email: "y@t.local", role: "editor" } });
check("viewer לא יכול להזמין", r.status >= 400, `status=${r.status}`);

r = await A(`/weddings/${AW}/members`);
check("אליס רואה 2 חברים", r.data?.length === 2, JSON.stringify(r.data));
check("המיילים מוחזרים", r.data?.some((m) => m.email === bob.email));

//  נוכחות. בעל החתונה צריך לדעת שני דברים: מי בכלל נכנס לחתונה שלו, ומי
//  עובד בה ברגע זה. שתי השאלות נענות מעמודה אחת — last_seen_at — שהשרת
//  מעדכן כשהחבר קורא נתונים או שומר. בוב קרא נתונים כמה שורות מעל.
const bobRow = r.data?.find((m) => m.email === bob.email);
const aliceRow = r.data?.find((m) => m.email === alice.email);
check("הבעלים מקבל את זמן הפעילות של החבר", !!bobRow?.lastSeenAt, JSON.stringify(bobRow));
check(
  "זמן הפעילות נרשם ברגע שהחבר קרא נתונים",
  Date.now() - new Date(bobRow?.lastSeenAt ?? 0).getTime() < 5 * 60_000,
  String(bobRow?.lastSeenAt)
);
check("הבעלים רואה גם את הפעילות של עצמו", !!aliceRow?.lastSeenAt, JSON.stringify(aliceRow));

r = await B(`/weddings/${AW}/members`);
check("חבר רגיל מקבל רק את השורה של עצמו", r.data?.length === 1 && r.data[0].email === bob.email, JSON.stringify(r.data));
check("חבר רגיל לא מקבל פעילות של אחרים", !r.data?.some((m) => m.email === alice.email), JSON.stringify(r.data));

/* ── 5b. הגדרות החתונה ────────────────────────────────────────────────────── */
//  יעד התקציב, הקטגוריות וכותרות מסך התקציב היו שמורים ב-localStorage בלבד
//  ולכן נמחקו בכל יציאה מהמערכת. עכשיו הם ב-DB, ולכן חייבים גם בידוד וגם
//  ניקוי קלט — זהו JSONB חופשי שמגיע מהלקוח.
console.log("\n5b. הגדרות החתונה");

r = await A(`/weddings/${AW}/data`);
check("חתונה חדשה מתחילה בלי הגדרות", JSON.stringify(r.data?.settings) === "{}", JSON.stringify(r.data?.settings));

r = await A(`/weddings/${AW}/settings`, {
  method: "PUT",
  body: { settings: { budgetGoal: 200000, categories: ["צד חתן", "צד כלה"], financeLabels: { title: "התקציב שלנו" } } },
});
check("הבעלים שומר הגדרות", r.status === 200 && r.data?.settings?.budgetGoal === 200000, JSON.stringify(r.data));

r = await A(`/weddings/${AW}/data`);
check("ההגדרות חוזרות יחד עם הנתונים", r.data?.settings?.categories?.length === 2, JSON.stringify(r.data?.settings));
check("כותרות מסך התקציב נשמרו", r.data?.settings?.financeLabels?.title === "התקציב שלנו", JSON.stringify(r.data?.settings));

r = await A(`/weddings/${AW}/settings`, {
  method: "PUT",
  body: { settings: { budgetGoal: -5, categories: ["א", "א", "  "], evil: "<script>", financeLabels: "לא-אובייקט" } },
});
check("סכום שלילי נזרק והערך הקודם נשמר", r.data?.settings?.budgetGoal === 200000, JSON.stringify(r.data?.settings));
check("קטגוריות כפולות/ריקות מסוננות", JSON.stringify(r.data?.settings?.categories) === '["א"]', JSON.stringify(r.data?.settings));
check("מפתח לא מוכר נזרק", r.data?.settings?.evil === undefined, JSON.stringify(r.data?.settings));
check("financeLabels שאינו אובייקט לא דורס את הקיים", r.data?.settings?.financeLabels?.title === "התקציב שלנו", JSON.stringify(r.data?.settings));

r = await B(`/weddings/${AW}/settings`, { method: "PUT", body: { settings: { budgetGoal: 1 } } });
check("viewer חסום משמירת הגדרות", r.status >= 400, `status=${r.status}`);

r = await A(`/weddings/${AW}/settings`, {
  method: "PUT",
  body: { settings: { budgetGoal: 200000, categories: ["צד חתן", "צד כלה"] } },
});
check("ההגדרות שוחזרו להמשך הבדיקה", r.data?.settings?.budgetGoal === 200000);

/* ── 6. הסרה ──────────────────────────────────────────────────────────────── */
console.log("\n6. הסרת חבר");
const bobId = (await A(`/weddings/${AW}/members`)).data?.find(
  (m) => m.email === bob.email
)?.userId;
r = await B(`/weddings/${AW}/members/${bobId}`, { method: "DELETE" });
check("בוב עוזב את החתונה בעצמו", r.status === 200, `status=${r.status}`);
check("בוב חזר לחתונה אחת", (await B("/weddings")).data?.length === 1);

/* ── 7. סשן ───────────────────────────────────────────────────────────────── */
console.log("\n7. סשן");
r = await A("/auth/me");
check("me מחזיר את אליס", r.data?.user?.email === alice.email, JSON.stringify(r.data));
r = await A("/auth/logout", { method: "POST" });
check("התנתקות", r.status === 200 || r.status === 204);
r = await A("/weddings");
check("אחרי התנתקות אין גישה", r.status === 401, `status=${r.status}`);

r = await A("/auth/login", { method: "POST", body: { email: alice.email, password: "סיסמה-שגויה" } });
check("סיסמה שגויה נדחית", r.data?.error === "invalid_credentials", JSON.stringify(r.data));
r = await A("/auth/login", { method: "POST", body: { email: `nobody-${stamp}@t.local`, password: "whatever12" } });
check("מייל לא קיים מחזיר את אותה שגיאה בדיוק", r.data?.error === "invalid_credentials");
r = await A("/auth/login", { method: "POST", body: alice });
check("התחברות מחדש", r.data?.user?.email === alice.email, JSON.stringify(r.data));
check("הנתונים שרדו", (await A(`/weddings/${AW}/data`)).data?.guests?.length === 1);

/* ── 8. שיתוף ברמת מסך ────────────────────────────────────────────────────── */
console.log("\n8. שיתוף מסך בודד");

//  לאליס יש כעת ספק וסעיף תקציב, כדי שיהיה מה להסתיר.
await A(`/weddings/${AW}/sync`, {
  method: "POST",
  body: { key: "vendors", rows: [{ id: 1, name: "צלם", contractCost: 5000 }], removedIds: [] },
});
await A(`/weddings/${AW}/sync`, {
  method: "POST",
  body: { key: "budget", rows: [{ id: 1, category: "אולם", expected: 100 }], removedIds: [] },
});

const carol = { email: `carol-${stamp}@test.local`, password: "CorrectHorse123" };
const C = makeClient();
await C("/auth/register", { method: "POST", body: carol });

r = await A(`/weddings/${AW}/invites`, {
  method: "POST",
  body: { email: carol.email, role: "editor", scopes: [] },
});
check("היקף ריק נדחה", r.data?.error === "invalid_scopes", JSON.stringify(r.data));

r = await A(`/weddings/${AW}/invites`, {
  method: "POST",
  body: { email: carol.email, role: "editor", scopes: ["guests"] },
});
check("הזמנה למסך המוזמנים בלבד", r.data?.scopes?.join() === "guests", JSON.stringify(r.data));
const carolToken = r.data?.token;

r = await C("/invites/accept", { method: "POST", body: { token: carolToken } });
check("קרול הצטרפה", r.data?.weddingId === AW, JSON.stringify(r.data));

const cw = (await C("/weddings")).data;
check("ההיקף הועתק לחברות", cw?.find((w) => w.id === AW)?.scopes?.join() === "guests", JSON.stringify(cw));

r = await C(`/weddings/${AW}/data`);
check("קרול רואה מוזמנים", r.data?.guests?.length === 1, JSON.stringify(r.data?.guests));
check("קרול לא רואה ספקים", (r.data?.vendors?.length ?? 0) === 0, JSON.stringify(r.data?.vendors));
check("קרול לא רואה תקציב", (r.data?.budget?.length ?? 0) === 0, JSON.stringify(r.data?.budget));

r = await C(`/weddings/${AW}/sync`, {
  method: "POST",
  body: { key: "guests", rows: [{ id: 7, name: "מקרול" }], removedIds: [] },
});
check("קרול כותבת בתוך ההיקף", r.status === 200, `status=${r.status}`);

//  הקטגוריות ויעד התקציב הם נתון שיתופי, ולכן גם עורך רשאי לשמור אותם —
//  אבל רק בתוך היקף השיתוף שלו. לקרול שותף מסך המוזמנים בלבד.
r = await C(`/weddings/${AW}/data`);
check("קרול לא רואה את יעד התקציב", r.data?.settings?.budgetGoal === undefined, JSON.stringify(r.data?.settings));
check("קרול כן רואה קטגוריות", Array.isArray(r.data?.settings?.categories), JSON.stringify(r.data?.settings));

r = await C(`/weddings/${AW}/settings`, {
  method: "PUT",
  body: { settings: { budgetGoal: 1, categories: ["צד חתן", "צד כלה", "חברים"] } },
});
check("עורך רשאי לשמור בתוך ההיקף", r.status === 200 && r.data?.settings?.categories?.length === 3, JSON.stringify(r.data));

r = await A(`/weddings/${AW}/data`);
check("הבעלים רואה את הקטגוריה שהעורך הוסיף", r.data?.settings?.categories?.includes("חברים"), JSON.stringify(r.data?.settings));
check("כתיבה מחוץ להיקף לא מחקה את יעד התקציב", r.data?.settings?.budgetGoal === 200000, JSON.stringify(r.data?.settings));

r = await C(`/weddings/${AW}/sync`, {
  method: "POST",
  body: { key: "vendors", rows: [{ id: 42, name: "ספק פיראטי" }], removedIds: [] },
});
check("קרול חסומה מכתיבה לספקים", r.status >= 400, `status=${r.status}`);

r = await C(`/weddings/${AW}/sync`, {
  method: "POST",
  body: { key: "budget", rows: [{ id: 42, category: "פריצה" }], removedIds: [] },
});
check("קרול חסומה מכתיבה לתקציב", r.status >= 400, `status=${r.status}`);

r = await A(`/weddings/${AW}/data`);
check("נתוני הספקים של אליס נקיים", r.data?.vendors?.length === 1, JSON.stringify(r.data?.vendors));

//  החלפת ההיקף: קרול הופכת לצופה על מסך הספקים בלבד.
const carolId = (await A(`/weddings/${AW}/members`)).data?.find(
  (m) => m.email === carol.email
)?.userId;
r = await A(`/weddings/${AW}/members/${carolId}`, {
  method: "PATCH",
  body: { role: "viewer", scopes: ["vendors"] },
});
check("אליס עדכנה את ההרשאות", r.status === 200, `status=${r.status}`);

r = await C(`/weddings/${AW}/data`);
check("קרול כבר לא רואה מוזמנים", (r.data?.guests?.length ?? 0) === 0);
check("קרול רואה ספקים", r.data?.vendors?.length === 1, JSON.stringify(r.data?.vendors));

r = await C(`/weddings/${AW}/sync`, {
  method: "POST",
  body: { key: "vendors", rows: [{ id: 1, name: "שונה" }], removedIds: [] },
});
check("קרול כצופה חסומה מכתיבה", r.status >= 400, `status=${r.status}`);

r = await C(`/weddings/${AW}/members/${carolId}`, {
  method: "PATCH",
  body: { role: "editor", scopes: ["all"] },
});
check("קרול לא יכולה לשדרג את עצמה", r.status >= 400, `status=${r.status}`);

/* ── 9. קבצים מצורפים לספק ────────────────────────────────────────────────── */
console.log("\n9. קבצים לספקים");
const PAYLOAD = "chuppah-contract-v1";

r = await A(`/weddings/${AW}/vendors/1/files`, {
  method: "POST",
  body: {
    name: "חוזה.txt",
    mime: "text/plain",
    data: Buffer.from(PAYLOAD, "utf8").toString("base64"),
  },
});
const fileId = r.data?.id;
check("אליס צירפה קובץ", r.status === 201 && !!fileId, JSON.stringify(r.data));
check("הגודל נשמר", r.data?.size === PAYLOAD.length, JSON.stringify(r.data));

r = await A(`/weddings/${AW}/vendors/987654/files`, {
  method: "POST",
  body: { name: "x.txt", mime: "text/plain", data: Buffer.from("x").toString("base64") },
});
check("קובץ לספק לא קיים נדחה", r.data?.error === "vendor_not_synced", JSON.stringify(r.data));

r = await A(`/weddings/${AW}/files`);
check("הקובץ מופיע ברשימה", r.data?.length === 1 && r.data[0].vendorId === 1, JSON.stringify(r.data));

r = await A(`/weddings/${AW}/files/${fileId}`);
check("התוכן חוזר נכון", r.data === PAYLOAD, JSON.stringify(r.data));

r = await B(`/weddings/${AW}/files`);
check("בוב (לא חבר) לא רואה קבצים", (r.data?.length ?? 0) === 0 || r.status >= 400, `status=${r.status}`);
r = await B(`/weddings/${AW}/files/${fileId}`);
check("בוב חסום מהורדה", r.status >= 400, `status=${r.status}`);
r = await B(`/weddings/${AW}/files/${fileId}`, { method: "DELETE" });
check("בוב חסום ממחיקה", r.status >= 400, `status=${r.status}`);

r = await C(`/weddings/${AW}/files`);
check("קרול בהיקף ספקים רואה את הקובץ", r.data?.length === 1, JSON.stringify(r.data));
r = await C(`/weddings/${AW}/files/${fileId}`, { method: "DELETE" });
check("קרול כצופה חסומה ממחיקה", r.status >= 400, `status=${r.status}`);

r = await A(`/weddings/${AW}/files/${fileId}`, { method: "DELETE" });
check("אליס מוחקת את הקובץ", r.status === 200, `status=${r.status}`);
check("הרשימה התרוקנה", (await A(`/weddings/${AW}/files`)).data?.length === 0);

/* ── 10. שמירות הבעלות ────────────────────────────────────────────── */
console.log("\n10. שמירות");

//  אחרי כל ההזמנות, העדכונים וההסרות — הבעלים חייב להישאר בעלים.
const awFinal = (await A("/weddings")).data;
check("אליס עדיין בעלים של החתונה", awFinal?.find((w) => w.id === AW)?.role === "owner", JSON.stringify(awFinal));
//  רגרסיה: ה-JOIN על wedding_members החזיר שורה לכל חבר, ולכן חתונה משותפת
//  הופיעה פעמיים ברשימה — פעם כבעלים ופעם בתפקיד של החבר האחר.
check("כל חתונה מופיעה פעם אחת ברשימה", new Set(awFinal.map((w) => w.id)).size === awFinal.length, JSON.stringify(awFinal));

//  ה-fallback של ה-SPA בייצור הוא middleware שרץ אחרי נתיבי ה-API;
//  נתיב API לא קיים חייב להמשיך להחזיר JSON ולא את index.html.
r = await A("/no-such-route");
check("נתיב API לא קיים מחזיר JSON", r.status === 404 && r.data?.error === "not_found", JSON.stringify(r.data));

/* ── 11. איפוס סיסמה ──────────────────────────────────────────────────────── */
console.log("\n11. איפוס סיסמה");

//  הטוקן נשלח רק למייל ואינו חוזר בתשובת ה-API. כדי לבדוק את המסלול המלא
//  צריך לקרוא אותו מהמסד — וזה גם מוודא ששם נשמר רק ה-hash שלו.
const { loadEnv } = await import("../server/env.mjs");
loadEnv();
const { withAdmin, closePool } = await import("../server/db.js");
const { hashToken } = await import("../server/auth.js");

const resetUser = { email: `reset-${stamp}@test.local`, password: "CorrectHorse123" };
const R = makeClient();
await R("/auth/register", { method: "POST", body: resetUser });
const resetUserId = (await R("/auth/me")).data?.user?.id;

//  כתובת שאינה רשומה חייבת להחזיר בדיוק את אותה תשובה, אחרת הטופס הופך
//  לכלי לגילוי אילו כתובות רשומות במערכת.
const unknown = await A("/auth/forgot", { method: "POST", body: { email: `ghost-${stamp}@test.local` } });
const known = await A("/auth/forgot", { method: "POST", body: { email: resetUser.email } });
check("בקשת איפוס מחזירה 200 לכתובת רשומה", known.status === 200, JSON.stringify(known.data));
check(
  "כתובת לא רשומה מחזירה תשובה זהה",
  unknown.status === known.status && JSON.stringify(unknown.data) === JSON.stringify(known.data),
  `${JSON.stringify(unknown.data)} vs ${JSON.stringify(known.data)}`
);

r = await A("/auth/forgot", { method: "POST", body: { email: "not-an-email" } });
check("מייל פסול לא מפיל את הבקשה", r.status === 200, JSON.stringify(r.data));

//  שולפים את הטוקן. הטבלה שומרת hash בלבד, ולכן משחזרים אותו מהצד השני:
//  יוצרים טוקן חדש ומוודאים שה-hash שלו נמצא — לא אפשרי. במקום זה בודקים
//  שהערך במסד אינו הטוקן עצמו, ומייצרים טוקן ידני לבדיקת המימוש.
const stored = await withAdmin((q) =>
  q(
    `SELECT token_hash, used_at, expires_at FROM app.password_resets
      WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [resetUserId]
  )
);
check("נוצרה רשומת איפוס אחת", stored.rows.length === 1, JSON.stringify(stored.rows));
check("נשמר hash ולא הטוקן עצמו", /^[0-9a-f]{64}$/.test(stored.rows[0]?.token_hash ?? ""), stored.rows[0]?.token_hash);
check("הטוקן עוד לא מומש", stored.rows[0]?.used_at === null, JSON.stringify(stored.rows[0]));

//  מזריקים טוקן ידוע ישירות למסד — כך אפשר לבדוק את המימוש בלי לקרוא מייל.
const known1 = "known-token-1-" + stamp;
await withAdmin((q) =>
  q(
    `INSERT INTO app.password_resets (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + INTERVAL '1 hour')`,
    [hashToken(known1), resetUserId]
  )
);

r = await A("/auth/reset", { method: "POST", body: { token: known1, password: "short" } });
check("סיסמה קצרה נדחית באיפוס", r.data?.error === "weak_password", JSON.stringify(r.data));

r = await A("/auth/reset", { method: "POST", body: { token: "no-such-token", password: "NewCorrect456" } });
check("טוקן לא קיים נדחה", r.data?.error === "invalid_reset_token", JSON.stringify(r.data));

r = await A("/auth/reset", { method: "POST", body: { token: known1, password: "NewCorrect456" } });
check("איפוס הסיסמה הצליח", r.status === 200 && r.data?.ok === true, JSON.stringify(r.data));

r = await A("/auth/reset", { method: "POST", body: { token: known1, password: "AnotherOne789" } });
check("אותו טוקן לא ניתן למימוש פעמיים", r.data?.error === "invalid_reset_token", JSON.stringify(r.data));

r = await makeClient()("/auth/login", { method: "POST", body: { email: resetUser.email, password: resetUser.password } });
check("הסיסמה הישנה כבר לא עובדת", r.data?.error === "invalid_credentials", JSON.stringify(r.data));

r = await makeClient()("/auth/login", { method: "POST", body: { email: resetUser.email, password: "NewCorrect456" } });
check("הסיסמה החדשה עובדת", r.status === 200 && r.data?.user?.email === resetUser.email, JSON.stringify(r.data));

//  אחרי איפוס, כל סשן קיים חייב להתנתק — אחרת מי שכבר היה מחובר לחשבון
//  נשאר מחובר בדיוק כמו קודם, וזה מבטל את כל התועלת שבאיפוס.
r = await R("/auth/me");
check("הסשן הישן נותק אחרי האיפוס", r.status === 401, `status=${r.status}`);

//  טוקן שפג תוקפו לא אמור לעבוד גם אם מעולם לא מומש.
const expired = "expired-token-" + stamp;
await withAdmin((q) =>
  q(
    `INSERT INTO app.password_resets (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() - INTERVAL '1 minute')`,
    [hashToken(expired), resetUserId]
  )
);
r = await A("/auth/reset", { method: "POST", body: { token: expired, password: "YetAnother999" } });
check("טוקן שפג תוקפו נדחה", r.data?.error === "invalid_reset_token", JSON.stringify(r.data));

/*  ניקוי אחרי עצמנו: הבדיקה נרשמת כמשתמשת אמיתית, וכל ריצה משאירה כ-13
    חשבונות במסד. מוחקים רק את מה שהריצה הזו יצרה (לפי ה-stamp), כך שריצה
    מקבילה של מישהו אחר לא נפגעת. ריצה שקרסה באמצע מנוקה ב-npm run test:cleanup.  */
const { purgeTestData } = await import("./test-cleanup.mjs");
const purged = await purgeTestData({ stamp });
console.log(`\nניקוי: נמחקו ${purged.users} חשבונות בדיקה ו-${purged.invites} הזמנות מהריצה הזו.`);

await closePool();

console.log(`\n${failed === 0 ? "\x1b[32m" : "\x1b[31m"}${passed}/${passed + failed} עברו\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
