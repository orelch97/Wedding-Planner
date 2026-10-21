# הוספת תמיכה מלאה בסטטוס "מתלבטים" (`maybe`) במערכת ובסנכרון מול iPlan

קלעת בול לאבחנה! בדקתי את כל שרשרת הסנכרון והתצוגה מקצה לקצה — גם בצד שלנו וגם בתוסף ה-Chrome מול iPlan — ומצאתי את **שני הגורמים המדויקים** לכך שרשומה שעודכנה ל-"מתלבטים" ב-iPlan לא הופיעה בהתראות, וטיפלתי בהם באופן מלא בכל רחבי המערכת.

---

## 1. למה "מתלבטים" לא הופיע בהתראות? (שני גורמי השורש שנמצאו ותוקנו)

### א. התנגשות סטטוסים (`"pending" === "pending"`) — בדיוק כפי שזיהית
- **מה קרה קודם:** במערכת שלנו היו רק 3 ערכים בשדה אישור ההגעה (`rsvp`): `"pending"` (ממתין), `"confirmed"` (אישרו הגעה) ו-`"declined"` (לא מגיעים). לכן, כאשר אורח סומן ב-iPlan כ**"מתלבטים"**, הפונקציה `parseStatusFromCells` ב-[src/lib/iplanSync.js](file:///c:/Users/User/Wedding-Planner/src/lib/iplanSync.js) תרגמה אותו ל-`rsvp: "pending"` ("ממתין").
- מאחר שכל אורח במערכת שלנו מתחיל כברירת מחדל בסטטוס `"pending"` ("ממתין"), מנוע ההשוואה [`reconcileIplan`](file:///c:/Users/User/Wedding-Planner/src/lib/iplanSync.js#L548-L556) השווה בין הסטטוס הנוכחי במערכת (`"pending"`) לסטטוס החדש מ-iPlan (`"pending"`), ראה שהם זהים (`currentRsvp === nextRsvp`), וסיווג את הרשומה כ**"ללא שינוי"** (`unchangedCount++`). לכן היא לא הוצגה בפופ-אפ הסנכרון ולא נכנסה לפעמון ההתראות.

### ב. סדר בדיקת העמודות וזיהוי ה-DOM ב-iPlan עבור "מתלבטים" (בדיקה משלימה מעבר לשדה ה-RSVP)
מעבר להוספת הערך `"מתלבטים"` במערכת שלנו, בדקתי לעומק איך iPlan מייצא ומציג רשומות של "מתלבטים" ומצאתי עוד **2 מקרי קצה חשובים** שתיקנתי:
1. **בקובץ הייצוא של iPlan (`export.xls`):** בייצוא של iPlan יש שתי עמודות נפרדות: עמודה 12 (`"אישרו שיגיעו"`) ועמודה 13 (`"מתלבטים"`). כאשר רשומה מעודכנת ל-"מתלבטים" ב-iPlan, לעיתים מופיע `"0"` בעמודת `"אישרו שיגיעו"` ומספר המתלבטים (למשל `"2"`) בעמודת `"מתלבטים"`. קודם לכן, הקוד בדק קודם אם `confirmedRaw === "0"` ורק אחר כך את עמודת `"מתלבטים"` — מה שעלול היה לסווג מתלבטים כ"לא מגיעים". הפכתי את הסדר ב-[`parseStatusFromCells`](file:///c:/Users/User/Wedding-Planner/src/lib/iplanSync.js#L126-L150) וב-[iplan-extension/background.js](file:///c:/Users/User/Wedding-Planner/iplan-extension/background.js#L65-L85) כך שעמודת `"מתלבטים"` נבדקת ראשונה.
2. **בסריקת טבלת ה-DOM החיה ב-iPlan ([iplan-extension/content-iplan.js](file:///c:/Users/User/Wedding-Planner/iplan-extension/content-iplan.js#L69-L115)):** ב-iPlan הכיתוב בטבלה או בסיכום יכול להופיע כ-`"מתלבטים"` או כ-`"לא החליטו"`, ובתוך תא עריכה חי ב-DOM קיימות לעיתים כל אפשרויות ה-`<select>` (`מגיעים`, `מתלבטים`, `לא מגיעים`). שדרגתי את [`parseRsvpFromDomCell`](file:///c:/Users/User/Wedding-Planner/iplan-extension/content-iplan.js#L69-L115) כך שיבדוק תחילה את האלמנט הפעיל/הנבחר (`option:checked`, `.active`, `.selected`) ויזהה במדויק `"מתלבטים"` / `"לא החליטו"` כ-`rsvp: "maybe"`.

---

## 2. כל המקומות במערכת שעודכנו לתמיכה מלאה ב-"מתלבטים" (`maybe`)

1. **מנוע הסנכרון ([src/lib/iplanSync.js](file:///c:/Users/User/Wedding-Planner/src/lib/iplanSync.js)):**
   - זיהוי `"מתלבטים"` / `"לא החליטו"` כסטטוס עצמאי `rsvp: "maybe"` עם `attendingCount: 0` ו-`hasResponse: true`.
   - תמיכה ב-`"maybe"` ב-[`normalizeIplanRow`](file:///c:/Users/User/Wedding-Planner/src/lib/iplanSync.js#L298-L315) (כולל תאימות לאחור לשורות שנשמרו קודם עם `rawStatus: "considering"`), ב-[`applyIplanUpdates`](file:///c:/Users/User/Wedding-Planner/src/lib/iplanSync.js#L590-L595) וב-[`formatRsvpLabel`](file:///c:/Users/User/Wedding-Planner/src/lib/iplanSync.js#L692-L703) (`"מתלבטים"`).
   - **כלל הברזל נשמר ב-100%:** אך ורק שדה אישור ההגעה (`rsvp` ו-`attendingCount`) מתעדכן. שום שדה אחר ברשומה לא משתנה.
2. **מסך המוזמנים והמערכת ([src/App.jsx](file:///c:/Users/User/Wedding-Planner/src/App.jsx)):**
   - **מילון הסטטוסים (`RSVP`, שורה 216):** נוסף `maybe: { label: "מתלבטים", color: "sky" }` בעיצוב תכלת אלגנטי וברור שמבדיל אותו מיד מ-"אישרו הגעה" (ירוק), "ממתין" (זהב) ו-"לא מגיעים" (ורוד/אדום).
   - **סרגל "סטטוס אישורי הגעה" (`data-tour="guests-rsvp"`, שורה 3295):** נוספה קוביית סיכום רביעית של **"מתלבטים"** שמציגה את מספר האנשים ומספר הרשומות בסטטוס "מתלבטים", ומאפשרת סינון בלחיצה (במובייל מוצג כגריד נקי של `2x2` ובדסקטופ בשורה אחת).
   - **תפריט בחירת סטטוס בכל שורת מוזמן בדסקטופ (`GuestRow`, שורה 2081) ובכרטיס מוזמן בנייד (`GuestCard`, שורה 2351):** נוספה האפשרות `מתלבטים` (כולל נקודת חיווי בצבע תכלת `bg-sky-500` בכרטיס סגור בנייד).
   - **סינון ומיון (`filters.rsvp` בשורה 3570, ומיון לפי עמודת אישור הגעה בשורה 2701):** נוספה אפשרות סינון לפי `"מתלבטים"` ומיון עקבי (`אישרו הגעה` ← `מתלבטים` ← `ממתין` ← `לא מגיעים`).
   - **סרגל פעולות מרובות (Bulk Action Bar, שורה 3730):** נוסף כפתור **"מתלבטים"** לעדכון מהיר של מספר רשומות מסומנות יחד.
3. **פופ-אפ הסנכרון ופעמון ההתראות ([src/components/IplanSyncModal.jsx](file:///c:/Users/User/Wedding-Planner/src/components/IplanSyncModal.jsx)):**
   - הוספת תגית סטטוס ייעודית (`RsvpStatusBadge`) עבור `"מתלבטים"` עם אייקון `HelpCircle` וצבע תכלת (`bg-sky-50 text-sky-700 ring-sky-200`).
   - הצגת השינוי `ממתין ← מתלבטים` גם בטבלת האישור המקדים וגם בפירוט שבתוך פעמון ההתראות.
4. **ייבוא וייצוא קבצי אקסל/CSV ([src/lib/guestImport.js](file:///c:/Users/User/Wedding-Planner/src/lib/guestImport.js) ו-[src/lib/excelExport.js](file:///c:/Users/User/Wedding-Planner/src/lib/excelExport.js)):**
   - תמיכה מלאה בייצוא וייבוא של הערך `"מתלבטים"` בגיליון המוזמנים.
5. **Cloud Functions ותוסף הכרום ([functions/index.js](file:///c:/Users/User/Wedding-Planner/functions/index.js), [iplan-extension/content-iplan.js](file:///c:/Users/User/Wedding-Planner/iplan-extension/content-iplan.js), [iplan-extension/background.js](file:///c:/Users/User/Wedding-Planner/iplan-extension/background.js)):**
   - תמיכה בערך `"maybe"` בשרת ובתוסף, והעלאת `BASELINE_VERSION = 4` בתוסף.

---

## 3. תצוגה מקדימה חיה של הבדיקות (Desktop + Mobile)

הרצתי כעת דפדפן חי (`headless: false`, בהילוך איטי) מול `http://localhost:5177/` שבדק תרחיש מלא עם 538 ההזמנות מ-iPlan ו-3 עדכוני אמת מכל הסוגים:
1. **שי ושקד אלעזרי** (`ממתין` ← `אישרו הגעה (2)`)
2. **אופיר קוזי** (`ממתין` ← `לא מגיעים`)
3. **ירון ושושי אלעזר** (`ממתין` ← `מתלבטים`)

הנה צילומי המסך מתוך הריצה החיה:

````carousel
![פופ-אפ עדכון אישורי הגעה מציג את 3 הרשומות כולל סטטוס מתלבטים החדש](C:/Users/User/.gemini/antigravity/brain/768b4bf4-1239-4073-b7b6-5601ae4ae715/live-considering-desktop-modal.png)
<!-- slide -->
![סרגל סטטוס אישורי הגעה במסך המוזמנים עם הקובייה החדשה של מתלבטים](C:/Users/User/.gemini/antigravity/brain/768b4bf4-1239-4073-b7b6-5601ae4ae715/live-considering-rsvp-summary-bar.png)
<!-- slide -->
![סינון לפי מתלבטים בטבלת המוזמנים מציג את ירון ושושי אלעזר עם סטטוס מתלבטים בתכלת](C:/Users/User/.gemini/antigravity/brain/768b4bf4-1239-4073-b7b6-5601ae4ae715/live-considering-filtered-guest-row.png)
<!-- slide -->
![פעמון ההתראות פתוח ומציג את העדכון ממתין ← מתלבטים](C:/Users/User/.gemini/antigravity/brain/768b4bf4-1239-4073-b7b6-5601ae4ae715/live-considering-bell-expanded.png)
<!-- slide -->
![תצוגת נייד (390x844) של פעמון ההתראות וסרגל 4 הסטטוסים בגריד 2x2 נקי](C:/Users/User/.gemini/antigravity/brain/768b4bf4-1239-4073-b7b6-5601ae4ae715/live-considering-mobile-view.png)
````

### סיכום בדיקות אוטומציה וקוד:
- `npm run test:iplan` — **14 מתוך 14 בדיקות יחידה עברו בהצלחה** (כולל בדיקה ייעודית למעבר `pending` ← `maybe` ולעמודת "מתלבטים" בייצוא של iPlan).
- `npm run test:import` / `npm run test:excel` / `npm run test:duplicates` — **כל הבדיקות עברו ב-100%**.
- `npm run build` — **בניית Vite לייצור עברה בהצלחה ללא שגיאות**.
- `npx eslint` על כל הקבצים ששונו — **0 שגיאות ו-0 אזהרות**.

---

## 4. איך לבדוק עכשיו אצלך בלייב:

1. ב-`chrome://extensions`, לחץ על סמל ה**רענון (↻)** בכרטיס של התוסף **Wedding Planner — סנכרון אישורי הגעה מ-iPlan** (כדי שיטען את הזיהוי החדש של `"מתלבטים"`).
2. בטאב של `http://localhost:5177/`, תוכל לראות מיד את הקובייה החדשה של **"מתלבטים"** בסרגל הסטטוסים, את האפשרות **"מתלבטים"** בכל שורת מוזמן, ואת זיהוי המתלבטים בפופ-אפ הסנכרון ובפעמון ההתראות.

כמו שביקשת, **לא ביצעתי שום Deploy לייצור** — מחכה שתבדוק ותאשר לי שהכול עובד בדיוק כמו שרצית!

