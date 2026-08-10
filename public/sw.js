/* =============================================================================
 *  sw.js — Service Worker
 * -----------------------------------------------------------------------------
 *  הסיבה היחידה לקיומו: השרת בענן נכבה אחרי חוסר פעילות, וההתעוררות שלו
 *  לוקחת עשרות שניות. עד שהיא מסתיימת הדפדפן לא מקבל אפילו את ה-HTML,
 *  והמארח מציג במקומו מסך המתנה שחור משלו — חוויה שנראית כמו תקלה.
 *
 *  לכן נשמר כאן עותק של מעטפת האפליקציה (index.html + הנכסים שלה). בכניסה
 *  חוזרת המעטפת עולה מיד מהמטמון, המשתמש רואה את מסך הטעינה שלנו, ורק
 *  הנתונים ממתינים לשרת.
 *
 *  אין כאן שמירה של נתוני משתמש: כל בקשה ל-/api עוברת לרשת בלבד, אחרת
 *  היה נוצר מטמון של רשימות מוזמנים שנשאר במכשיר גם אחרי יציאה מהחשבון.
 * ========================================================================== */

const CACHE = "wedding-shell-v1";
const SHELL_URL = "/index.html";

//  כמה להמתין לרשת לפני שמגישים את המעטפת השמורה. ערך נמוך בכוונה —
//  זו בדיוק ההמתנה שהמשתמש חווה מול מסך לבן.
const NETWORK_TIMEOUT_MS = 2500;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(SHELL_URL, { cache: "reload" })))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function timedFetch(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(request).then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  //  נתונים אישיים ומצב הזדהות אף פעם לא נשמרים.
  if (url.pathname.startsWith("/api/")) return;

  //  ניווט: רשת תחילה כדי לקבל גרסה חדשה אחרי פריסה, ועם פסק זמן קצר
  //  שנופל למעטפת השמורה כשהשרת עדיין מתעורר.
  if (request.mode === "navigate") {
    event.respondWith(
      timedFetch(request, NETWORK_TIMEOUT_MS)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(SHELL_URL, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(SHELL_URL);
          if (cached) {
            //  הבקשה ממשיכה ברקע כדי לרענן את המטמון לכניסה הבאה,
            //  וגם כדי להעיר את השרת בזמן שהמשתמש כבר רואה מסך.
            fetch(request)
              .then((res) => {
                if (res && res.ok) caches.open(CACHE).then((c) => c.put(SHELL_URL, res.clone()));
              })
              .catch(() => {});
            return cached;
          }
          return fetch(request);
        })
    );
    return;
  }

  //  נכסי הבילד נושאים חתימת תוכן בשם הקובץ, ולכן מטמון קודם-כול בטוח:
  //  שינוי בקוד מייצר שם חדש ולעולם לא מוגש תוכן ישן תחת אותה כתובת.
  const isAsset =
    url.pathname.startsWith("/assets/") ||
    /\.(?:css|js|png|svg|webmanifest|woff2?)$/.test(url.pathname);
  if (!isAsset) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
