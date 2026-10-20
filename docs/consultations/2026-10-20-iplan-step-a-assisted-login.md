# Consultation export — iPlan sync: onboarding + Step A (assisted login)

- **Date:** 2026-10-20
- **Project:** Wedding Planner (React + Vite + Firebase, hosted on Render)
- **Topic:** Context onboarding and Step A of the approved iPlan Chrome Extension + Reconciliation Core plan
- **Content below:** the full, exact text of the assistant's response, unmodified.

---

## ✅ קראתי את הקבצים — וחלון הדפדפן פתוח עכשיו

**מה קראתי:** `project-architecture.md`, `agents.md`, `.github/copilot-instructions.md`, ואת דוח ה-Discovery (הוא נמצא בפועל ב-`docs/consultations/2026-10-20-iplan-rsvp-sync-discovery.md`, לא בשורש הפרויקט).

### שלב A — מה עליך לעשות עכשיו
נפתח חלון **Chrome גלוי** עם פרופיל נפרד וזמני (`tmp/iplan-profile`) שמכוון ל:
`https://app.iplan.co.il/he-IL/client/events/284821/invitations`

1. **התחבר בעצמך** — Google, או "כניסה עם אימייל וסיסמה", ופתור את ה-reCAPTCHA אם יופיע. הסקריפט **לא מקליד** סיסמה ולא נוגע בפרטי ההתחברות.
2. אם Google מסרב ("הדפדפן אינו מאובטח") — השתמש באפשרות **אימייל + סיסמה**.
3. ודא שאתה מגיע למסך **ההזמנות** של האירוע. מהרגע הזה הסקריפט ינתח אוטומטית את מבנה הטבלה, הדפדוף וכפתור "יצוא ל־".
4. **רשות, אבל עוזר מאוד:** לחץ פעם אחת על **"יצוא ל־" → Excel**. הקובץ ייתפס ואוכל למפות בדיוק את endpoint הייצוא (זו הדרך הכי אמינה לקבל את כל 538 ההזמנות בבת אחת, ולא רק את עמוד 1 מתוך 25).
5. **אל תסגור את החלון** עד שאודיע לך — אולי אריץ עוד כמה בדיקות קריאה בלבד.

כתוב לי **"התחברתי"** כשאתה במסך ההזמנות.

### שתי הערות אבטחה
- כל מה שנאסף (כולל פרטי אורחים) נשמר רק ב-`tmp/` (מוחרג מ-git) וימחק בשלב E, יחד עם הפרופיל הזמני.
- `IPLAN_PASSWORD` עדיין נמצא ב-`.env` כטקסט גלוי. בשלב E אסיר אותו — וממליץ שוב **להחליף את הסיסמה** ב-iPlan.

### המשך התוכנית (אחרי ההתחברות)
B — `iplanSync.js` + בדיקות, `iplanNotes`, אוסף `activity`, rules ו-Cloud Function → C — פעמון התראות, הצגת הערות iPlan ומודל "סנכרון מ-iplan" עם גיבוי קובץ → D — תוסף Chrome (MV3) עם סנכרון בביקור ובכל 30 דקות → E — בדיקות, build, E2E, פריסה, push ומדריך התקנה.

> הערה: Chrome חוסם בדרך כלל אוטומציה של OAuth של Google. אם זה קורה, זה תקין — אפשרות האימייל+סיסמה מספיקה לגמרי.

📄 גרסה מלאה של התשובה הזו נשמרה בשביל Gemini: `docs/consultations/2026-10-20-iplan-step-a-assisted-login.md`

