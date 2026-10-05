// Set the single system administrator email here; mirror the exact value in
// ADMIN_EMAIL in functions/index.js because authorization is server-enforced.
export const ADMIN_EMAIL = "orelch97@gmail.com";

export function isAdminEmail(email) {
  return typeof email === "string" && email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
}
