# Temporary iPlan Bell Email Allowlist

The RSVP activity bell now renders only when all existing source/permission checks pass and the signed-in email, trimmed and lowercased, equals `orelch97@gmail.com`. This is a temporary UI visibility gate; RSVP synchronization and server authorization were not changed. The allowlisted E2E fixture resets Auth and Firestore only inside the guarded `demo-wedding-planner-e2e` emulators so the same account can be tested independently on desktop and mobile.

Validation: iPlan E2E **22/22 passed** across desktop and mobile; `npm run build` passed; the changed E2E file passed ESLint. Existing Vite warnings about chunk size and ineffective dynamic imports remain. These changes are local only; no commit, push, or production deployment was performed.

Consultation copy: [2026-10-21-iplan-bell-email-allowlist.md](docs/consultations/2026-10-21-iplan-bell-email-allowlist.md)
