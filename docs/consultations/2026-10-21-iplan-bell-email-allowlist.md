# Temporary iPlan Bell Email Allowlist

The RSVP activity bell now renders only when all existing source/permission checks pass and the signed-in email, trimmed and lowercased, equals `orelch97@gmail.com`. This is a temporary UI visibility gate; RSVP synchronization and server authorization were not changed. The allowlisted E2E fixture resets Auth and Firestore only inside the guarded `demo-wedding-planner-e2e` emulators so the same account can be tested independently on desktop and mobile.

Validation: iPlan E2E **22/22 passed** across desktop and mobile; `npm run build` passed; the changed E2E file passed ESLint. Existing Vite warnings about chunk size and ineffective dynamic imports remain. Commit `f5a1f8ea9eb12cbcb592df3a445daa2842d867b7` was pushed to `origin/main`, and Render was verified serving bundle `index-CLen5NiJ.js` with the email gate and bell action, without the old Guests-page button. No Cloud Function redeploy was needed because this change is client-only.

Consultation copy: [2026-10-21-iplan-bell-email-allowlist.md](docs/consultations/2026-10-21-iplan-bell-email-allowlist.md)
