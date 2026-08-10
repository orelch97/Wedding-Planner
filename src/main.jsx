import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

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
