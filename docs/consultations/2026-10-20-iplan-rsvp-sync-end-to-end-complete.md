# סיכום ביצוע מלא מקצה לקצה — סנכרון אישורי הגעה מ-iPlan (תוסף Chrome + תצוגה מקדימה ואישור מבוקר)

השלמתי את הפיתוח, הבדיקות והפריסה המלאה של מערכת סנכרון אישורי ההגעה מ-iPlan עבור **"החתונה של אוראל ומיתר"** (`ef9e96b1-e593-43e4-8df9-883dd15a7acc`), בהתאם המדויק לדרישות שלך: **אף רשומה לא מתעדכנת אוטומטית מאחורי הקלעים, והשדה היחיד שמתעדכן באישורך הוא שדה "אישור הגעה" (`rsvp` + `attendingCount`)**.

---

## 1. מה נבנה ונפרס במערכת (שלבים A עד E)

### שלב A — ניתוח מבנה הייצוא המלא מ-iPlan (538 הזמנות)
- פוענח קובץ ה-`.xls` המקורי של iPlan (`invitations/export.xls`, גיליון `"הזמנות"` עם 538 הזמנות).
- זוהה מבנה הכותרות הדו-שורתי של iPlan (`הזמנה לכבוד`, `מס' אורחים שהוזמנו`, `סלולרי`, `טלפון רגיל`, `אישרו שיגיעו`, `מתלבטים`).
- זוהתה הרשומה שאישרה הגעה מתוך 538 ההזמנות (**ליאור אלעזרי**, נייד `0506970046`, 2 מוזמנים שאישרו הגעה) וכן 537 הרשומות שטרם השיבו.

### שלב B — מנוע ההתאמה הטהור, חוקי האבטחה ו-Cloud Functions
1. **מנוע התאמה ועדכון מבוקר ([src/lib/iplanSync.js](file:///c:/Users/User/Wedding-Planner/src/lib/iplanSync.js)):**
   - התאמה שמרנית לפי 9 ספרות אחרונות של הטלפון (`phoneKey`).
   - רשומות עם מספרי טלפון כפולים או חסרים ורשומות שקיימות ב-iPlan אך לא ברשימה שלנו מוצגות לידיעה בלבד ואינן מתעדכנות אוטומטית.
   - **אכיפת כלל השדה היחיד (`applyIplanUpdates`):** הפונקציה מעדכנת **אך ורק** את `rsvp` (`"pending"` / `"confirmed"` / `"declined"`) ואת `attendingCount` (מספר המגיעים כשאושרה הגעה, או `0` אחרת). כל יתר השדות ברשומה (`name`, `phone`, `seats`, `category`, `mention`, `gift`, `glatt`, `drinks`, `probablyComing`, `considering`) נשמרים ללא כל שינוי.
   - נוספה חבילת בדיקות יחידה ייעודית ([scripts/iplan-test.mjs](file:///c:/Users/User/Wedding-Planner/scripts/iplan-test.mjs) — `npm run test:iplan`, 10 מתוך 10 בדיקות עוברות).
2. **חוקי האבטחה ([firestore.rules](file:///c:/Users/User/Wedding-Planner/firestore.rules)):**
   - נוספו הרשאות קריאה בלבד לצד הלקוח עבור תמונת המצב `iplan/snapshot` ויומן הפעילות `activity/{activityId}` (כתיבה מותרת אך ורק מ-Cloud Functions).
3. **פונקציות ענן ב-`europe-west1` ([functions/index.js](file:///c:/Users/User/Wedding-Planner/functions/index.js)) ושכבת הנתונים ([src/lib/firebaseStore.js](file:///c:/Users/User/Wedding-Planner/src/lib/firebaseStore.js)):**
   - `issueIplanSyncToken` — הנפקת מפתח סנכרון מאובטח לתוסף ה-Chrome (שמירת גיבוב SHA-256 בלבד ב-`iplan/auth`).
   - `iplanExtensionSync` — נקודת קצה (HTTPS) המקבלת מתוסף ה-Chrome את רשומות ה-`.xls` של iPlan ושומרת אותן תחת `iplan/snapshot` (ללא נגיעה ברשומות המוזמנים עד לאישור שלך במערכת).
   - `commitIplanRsvpUpdates` — תיעוד העדכונים שאישרת ביומן הפעילות (`activity`).

### שלב C — ממשק המשתמש: כפתור "עדכון אישורי הגעה", פופ-אפ אישור ופעמון התראות
- **כפתור "עדכון אישורי הגעה" ([src/App.jsx](file:///c:/Users/User/Wedding-Planner/src/App.jsx)):** נוסף בסרגל הפעולות של מסך המוזמנים, כולל מונה (Badge) המציג כמה רשומות ממתינות לאישור מתוך הסנכרון האחרון של iPlan.
- **פופ-אפ תצוגה מקדימה ואישור ([src/components/IplanSyncModal.jsx](file:///c:/Users/User/Wedding-Planner/src/components/IplanSyncModal.jsx)):**
  - מציג את כל הרשומות שבהן חל שינוי בסטטוס אישור ההגעה מול iPlan (לפני ← אחרי, כולל מספר אנשים שיגיעו).
  - מאפשר לסמן/לבטל רשומות ספציפיות וללחוץ על **"כן, עדכן אישורי הגעה"**.
  - כולל גם כפתור **"העלאת קובץ ייצוא (.xls / .xlsx / .csv)"** כגיבוי ידני בכל עת.
- **פעמון התראות (`ActivityBell`) בבר העליון:** מציג התראה כשיש עדכונים חדשים מ-iPlan הממתינים לאישור וכן את היסטוריית העדכונים שאושרו.

### שלב D — תוסף ה-Chrome הפרטי (`iplan-extension/`)
נבנה תוסף Manifest V3 מלא בתיקייה `iplan-extension/`:
- [manifest.json](file:///c:/Users/User/Wedding-Planner/iplan-extension/manifest.json), [config.js](file:///c:/Users/User/Wedding-Planner/iplan-extension/config.js), [background.js](file:///c:/Users/User/Wedding-Planner/iplan-extension/background.js), [content-iplan.js](file:///c:/Users/User/Wedding-Planner/iplan-extension/content-iplan.js), [content-planner.js](file:///c:/Users/User/Wedding-Planner/iplan-extension/content-planner.js), [popup.html](file:///c:/Users/User/Wedding-Planner/iplan-extension/popup.html), [popup.js](file:///c:/Users/User/Wedding-Planner/iplan-extension/popup.js).
- **סנכרון אוטומטי בכניסה ל-iPlan + חיווי צף בעברית:** בכל פתיחה של `app.iplan.co.il`, התוסף מושך אוטומטית את כל 538+ ההזמנות מקובץ הייצוא של iPlan ומעביר אותן למערכת החתונה, תוך הצגת חיווי צף בפינה השמאלית התחתונה (`"מסנכרן עם מערכת החתונה..."` ← `"538 הזמנות סונכרנו — מוכן לאישור במערכת החתונה ✓"`).
- **סנכרון רקע אוטומטי (`chrome.alarms`):** מתבצע כל 30 דקות ברקע כל עוד הדפדפן פתוח.
- **מוגדר מראש לחתונה שלכם:** הקובץ המקומי `iplan-extension/local-config.js` (שמוחרג ב-`.gitignore` כדי לא לחשוף מפתחות ב-Git) כבר הוגדר מראש עם מזהה החתונה שלכם (`ef9e96b1-e593-43e4-8df9-883dd15a7acc`), האירוע `284821` ומפתח הסנכרון מול הפרודקשן, ותמונת המצב הראשונית (538 ההזמנות מ-iPlan) כבר הוזרקה לחתונה שלכם בענן.

### שלב E — בדיקות, ניקוי ופריסה מלאה לייצור
- נוקו כל קובצי הגילוי הזמניים מ-`tmp/` והוסרו פרטי ההתחברות מ-`.env`.
- כל חבילות בדיקות היחידה (`test:iplan`, `test:import`, `test:duplicates`, `test:excel`, `test:alcohol`, `test:backup`, `test:guide`), בניית הייצור (`npm run build`) ובדיקת ה-E2E ב-Playwright ([tests/e2e/iplan.spec.js](file:///c:/Users/User/Wedding-Planner/tests/e2e/iplan.spec.js) בדסקטופ ובמובייל) עברו בהצלחה (0 שגיאות).
- פונקציות הענן (`issueIplanSyncToken`, `iplanExtensionSync`, `commitIplanRsvpUpdates`) וחוקי `firestore.rules` נפרסו לפרויקט הייצור `wedding-planner-c3d62`.
- כל הקוד נשמר ונדחף ל-`origin/main` לטובת בניית ה-Production ב-Render.

---

## 2. מדריך קצר ב-3 צעדים לטעינת תוסף ה-Chrome (`iplan-extension`)

1. **פתיחת מסך התוספים בכרום:**
   פתחו כרטיסייה חדשה בדפדפן Chrome, הקלידו בשורת הכתובת `chrome://extensions` ולחצו על **Enter**. בפינה העליונה של המסך, הפעילו את המתג **"מצב פיתוח"** (**Developer mode**).
2. **טעינת תיקיית התוסף:**
   לחצו על הכפתור **"טעינת פריט שלא נארז"** (**Load unpacked**) שמופיע בראש המסך, ובחרו את התיקייה הבאה מתוך המחשב שלכם:
   `C:\Users\User\Wedding-Planner\iplan-extension`
3. **שימוש ואישור עדכונים במערכת החתונה:**
   התוסף מוגדר ומוכן לפעולה מיד עם טעינתו! בכל פעם שתיכנסו ל-iPlan (או אוטומטית ברקע כל 30 דקות), הנתונים יסונכרנו. לאחר מכן, היכנסו למערכת החתונה שלנו ← מסך **מוזמנים** ← לחצו על כפתור **"עדכון אישורי הגעה"**, בדקו את הרשומות בפופ-אפ ולחצו על **"כן, עדכן אישורי הגעה"**.

---

*עותק מלא ומדויק של תשובה זו נשמר עבורך בקובץ `docs/consultations/2026-10-20-iplan-rsvp-sync-end-to-end-complete.md` להמשך התייעצות עם Gemini.*
