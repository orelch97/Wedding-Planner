/* =========================================================================
 *  API CLIENT — תקשורת עם שרת ה-API
 *  ------------------------------------------------------------------------
 *  אין כאן מפתחות ואין חיבור ישיר למסד. הדפדפן מדבר רק עם השרת שלנו,
 *  והזיהוי נעשה בעוגיית httpOnly שה-JavaScript כלל לא יכול לקרוא — ולכן
 *  גם XSS לא יכול לגנוב אותה.
 *
 *  אם VITE_API_URL אינו מוגדר, האפליקציה רצה במצב מקומי בלבד (localStorage).
 * ====================================================================== */

const RAW_BASE = import.meta.env.VITE_API_URL;

export const isCloudConfigured = Boolean(RAW_BASE);

/** בלי סלאש בסוף, כדי ש-`${API_BASE}/weddings` תמיד ייצא נכון. */
export const API_BASE = String(RAW_BASE || "/api").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

/*  אף בקשה לא תמתין לנצח. בלי זה, שרת שנתקע (למשל חיבור מסד שמת אחרי
 *  שהמחשב חזר משינה) משאיר את המסך ב"טוען…" ללא הגבלת זמן ובלי שום
 *  הודעה — נראה בדיוק כמו תקלה חמורה. עדיף להיכשל במפורש ולהציג באנר.  */
const REQUEST_TIMEOUT_MS = 30_000;

export async function apiFetch(path, { method = "GET", body } = {}) {
  let response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      // חובה — בלעדיו הדפדפן לא ישלח את עוגיית הסשן.
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    throw new ApiError(err?.name === "AbortError" ? "timeout" : "network_error", 0);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) return null;

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    /* גוף ריק או לא-JSON */
  }

  if (!response.ok) {
    throw new ApiError(payload?.error || "server_error", response.status);
  }
  return payload;
}
