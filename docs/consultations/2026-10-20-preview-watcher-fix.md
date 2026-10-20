Fixed the local preview crash by excluding `tmp/` from Vite's file watcher. The preview is running again at http://localhost:5177/.

Validation: config lint and build passed; the page and app module return HTTP 200. No application code was changed, and nothing was deployed.

[Exact response document](docs/consultations/2026-10-20-preview-watcher-fix.md)