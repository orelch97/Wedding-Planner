# iPlan RSVP Controls: UX Update

I removed the separate “עדכון אישורי הגעה” button from the Guests page. The activity bell is now the single top-level iPlan entrypoint because it combines RSVP history, unread activity, and pending review counts in the place users expect notifications. Its popover has one contextual action: “בדיקה ואישור (N)” when updates are pending, or “פתיחת הסנכרון” when the source is available but no updates are pending.

The bell is hidden unless the app detects the iPlan extension or has an iPlan snapshot with rows. The extension bridge sends only an availability signal, not its token. Old activity by itself does not make the bell appear. The extension can be detected before token setup, so an owner can still open the sync modal to configure first-time connection.

Changed [src/App.jsx](src/App.jsx), [src/components/IplanSyncModal.jsx](src/components/IplanSyncModal.jsx), [iplan-extension/content-planner.js](iplan-extension/content-planner.js), and [tests/e2e/iplan.spec.js](tests/e2e/iplan.spec.js). Tests now launch review from the bell and verify that controls are absent for a fresh account with no iPlan source.

## Verification

- Full iPlan E2E: **18 passed** across desktop and mobile after updating the snapshot test to use the bell.
- After the final refinement excluding activity-only history from source detection, the no-source test passed on desktop and mobile (**2 passed**).
- Production build passed. Focused ESLint and extension syntax checks passed; whole-file App.jsx lint still reports unrelated pre-existing violations.

No live RSVP data was changed. No commit, push, or deployment was made.

Consultation copy: [2026-10-21-iplan-controls-ux-update.md](docs/consultations/2026-10-21-iplan-controls-ux-update.md)
