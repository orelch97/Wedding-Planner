/**
 * Static host for the built SPA.
 *
 * render.yaml declares this app as a Render *static site*, which would make this
 * file unnecessary. The live Render service is still a *web service*, so it runs
 * `npm start` and never applies the `headers:` block in render.yaml. Until the
 * service is recreated as a static site, the headers below are the ones that
 * actually reach the browser and must stay in sync with render.yaml and
 * public/_headers.
 */
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname, sep } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "dist");
const PORT = Number(process.env.PORT || 3001);

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; worker-src 'self'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' data: https://fonts.gstatic.com; " +
    "img-src 'self' data: blob: https://firebasestorage.googleapis.com; " +
    "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com " +
    "https://identitytoolkit.googleapis.com https://securetoken.googleapis.com " +
    "https://firestore.googleapis.com https://firebasestorage.googleapis.com " +
    "https://europe-west1-wedding-planner-c3d62.cloudfunctions.net; " +
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

/** Maps a URL path to a file inside dist/, or null if it escapes the root. */
function resolvePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const candidate = normalize(join(ROOT, decoded));
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null;
  return candidate;
}

function cacheControl(pathname) {
  // The entry point and the service worker must be revalidated every load,
  // otherwise a deploy never reaches browsers that already visited.
  if (pathname === "/sw.js" || pathname === "/index.html") return "no-cache";
  // Vite fingerprints everything under /assets/, so those URLs never change meaning.
  if (pathname.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}

function send(res, status, headers, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function sendFile(req, res, filePath, pathname, size) {
  const headers = {
    "Content-Type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream",
    "Content-Length": size,
    "Cache-Control": cacheControl(pathname),
  };
  if (req.method === "HEAD") {
    send(res, 200, headers, undefined);
    return;
  }
  res.writeHead(200, { ...SECURITY_HEADERS, ...headers });
  createReadStream(filePath).on("error", () => res.destroy()).pipe(res);
}

const server = createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, { Allow: "GET, HEAD", "Content-Type": "text/plain" }, "Method Not Allowed");
    return;
  }

  const pathname = new URL(req.url, "http://localhost").pathname;
  const filePath = resolvePath(pathname);
  if (!filePath) {
    send(res, 403, { "Content-Type": "text/plain" }, "Forbidden");
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isFile()) {
      sendFile(req, res, filePath, pathname, info.size);
      return;
    }
  } catch {
    // Falls through to the SPA entry point below.
  }

  // A missing asset must not resolve to HTML, or a failed chunk load looks like success.
  if (extname(pathname)) {
    send(res, 404, { "Content-Type": "text/plain" }, "Not Found");
    return;
  }

  const index = join(ROOT, "index.html");
  try {
    const info = await stat(index);
    sendFile(req, res, index, "/index.html", info.size);
  } catch {
    send(res, 500, { "Content-Type": "text/plain" }, "Build output missing");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Serving ${ROOT} on port ${PORT}`);
});
