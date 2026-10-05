import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { preparePasskeyLogin, rememberedPasskeyEmail } from './lib/passkeys.js'

/*  מחממים את אתגר ה-Passkey כבר עכשיו ולא כשמסך הכניסה נטען. בין טעינת
    הדף לבין הרגע שבו Firebase מסיים לפתור את מצב ההתחברות עוברות כמה
    מאות אלפיות שנייה שבהן המסך ממילא מציג טעינה — זה בדיוק הזמן שבו
    כדאי שהבקשה לשרת תהיה כבר בדרך. אם אין Passkey או שהמשתמש מחובר,
    הקריאה פשוט נדחית בשקט ולא עולה דבר.  */
preparePasskeyLogin(rememberedPasskeyEmail() || undefined).catch(() => {})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/*  רישום ה-Service Worker. תפקידו היחיד הוא לשמור עותק של מעטפת האפליקציה,
    כדי שכניסה חוזרת תציג מיד את מסך הטעינה שלנו במקום מסך ההמתנה של שירות
    האחסון בזמן שהשרת מתעורר. בפיתוח הוא מכובה בכוונה — מטמון של מודולים
    חיים היה מסתיר שינויים בקוד.  */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* דפדפן ללא תמיכה או גלישה פרטית — האפליקציה עובדת גם בלי זה. */
    })
  })
}
