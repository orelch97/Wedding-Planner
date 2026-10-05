# Pre-deployment QA record — 2026-10-04

## Status

**Not a production release sign-off.** A live, button-by-button cloud workflow audit remains blocked until an isolated Firebase Auth/Firestore/Storage/Functions emulator or disposable QA project and test credentials are provided. The configured Firebase `test` environment is a logical data namespace, not proof of disposable isolation. The existing CockroachDB API tests and cleanup scripts were not run because they may mutate configured data.

The repository/workspace exposed one React/Vite application, not two independently deployable applications. The existing cloud-configured sign-in view and a temporarily Firebase-disabled local-only mode of the same frontend were inspected. No separate "new system built from scratch" build was available for comparison.

## Safety and scope

- Observed the existing cloud-configured app at `http://localhost:5173/` without submitting authentication, reset, signup, invite, or other cloud-backed forms.
- Used a temporary `.env.local` override and a second Vite process at `127.0.0.1:5174` to verify Firebase is unconfigured and work against synthetic-only browser-local records. Stopped the process and removed the temporary override after the run.
- The synthetic local dataset used only QA-prefixed names and records. It is not part of the user's cloud data.
- The browser automation controller did not report download events even for a plain-text download probe. Actual on-disk browser downloads therefore remain unverified in this run.
- Destructive production/QA cleanup, API integration scripts, and live database tests were not run.

## Bugs discovered and resolved

1. **Tall mobile authentication card started above the scroll origin.** At 390×844, the sign-up card was about 923px tall and started near y = −49px because a `min-h-screen` flex container centered it vertically. This clipped the top of the form. Changed the container to a column layout and used auto vertical margins on the form: it stays centered when it fits and begins within the scrollable page when it does not. Retest: sign-up card top is y = 24px; first field and logo are visible, and lower content is scrollable. Source: `src/App.jsx` (`AuthCard`).

2. **Generated-file URLs were revoked immediately after triggering downloads.** The guest template CSV, guest CSV export, JSON backup, and XLSX export called `URL.revokeObjectURL()` synchronously after `.click()`, which can race the browser's download startup. Changed these to revoke after a 1-second grace period. Source: `src/App.jsx` and `src/lib/excelExport.js`. The browser harness suppressed download events for both the app action and an independent text-download probe, so the fix is source-reviewed and build-tested, but actual browser file creation still needs verification in a normal browser.

No other confirmed functional/UI defects were found in the tested isolated workflows. Automation click timeouts occurred for elements that were visually present; DOM activation succeeded, so these were treated as harness limitations rather than application failures.

## Browser coverage performed

### Existing cloud-configured sign-in

- Confirmed sign-in page renders with email/password, submit, Passkey, sign-up, forgot-password, and help controls.
- Exercised sign-up and forgot-password view switches without submitting requests.
- Invalid email produced an inline Hebrew validation message without a server request.
- Invalid optional partner email produced an inline Hebrew validation message without account creation.
- Opened the 6-step authentication guide, advanced to its final step, and closed with Escape.
- Measured auth buttons at 44px minimum. Checked responsive widths including 320px, 390px, tablet, and desktop; no horizontal overflow was observed.
- Did not submit valid credentials, perform reset-email delivery, complete registration, verify an email, authenticate with Passkey, or accept a real invite.

### Synthetic local-only planner

- Dashboard: verified synthetic metrics and relationship between guest/vendor/checklist/finance data.
- Checklist: added, assigned, completed, filtered, hid completed, renamed, canceled a deletion, and confirmed deletion of a transient QA task.
- Wedding settings: edited a synthetic couple name and budget goal, saved, verified the success toast, and confirmed local-storage values updated. Failure/partial-success injection was not available.
- Guests: added a synthetic guest with seats, note, dietary/alcohol flags; searched; opened details; updated RSVP and gift; verified persistence. Added, renamed, and deleted an unused synthetic category. Confirmed guest deletion and cleared the filter.
- Alcohol calculator: changed assumed drinker percentage and beverage price, checked estimate, and transferred the amount into a local synthetic budget item.
- Seating: created a temporary knight table, removed/reassigned a synthetic guest through the picker, verified capacity/availability, and deleted the temporary table.
- Vendors: added a temporary task, moved it through in-progress and completed states, and deleted it. Cloud-only attachment controls correctly indicated cloud is required in local mode.
- Budget: added a synthetic row, confirmed expected/actual/paid totals, and opened the column-visibility menu.
- Visually inspected mobile guests view and auth sign-up; desktop/tablet widths and horizontal overflow were checked on representative auth and planner views.

### Not exhaustively covered

- Every component/button/edge case on all screens; all import file variants in an actual browser; actual CSV/XLSX/JSON file downloads and restore; vendor file upload/view/download/delete; file permissions and access scopes; invite email verification, sharing, revocation, and membership changes; email delivery and password reset; Passkeys; installation/share APIs; offline recovery; service worker production behavior; Firestore/Storage/Functions security rules against an emulator; full real mobile/tablet device/browser matrix; Settings partial-failure behavior.
- An existing historical browser tab recorded prior Vite HMR 500 events. The separately launched local-only app rendered successfully and the final build passed; no assertion is made that the stale events were current production failures.

## Automated tests rerun after the fixes

- `npm run build` — passed. Existing warnings remain for large bundles and ineffective dynamic imports.
- `npm run test:import` — 78 passed, 0 failed.
- `npm run test:excel` — 48 passed, 0 failed.
- `npm run test:backup` — 38 passed, 0 failed.
- `node scripts/entity-map-test.mjs --dir migration/export-2026-09-01T10-22-07-432Z` — 7/7 equivalence checks passed, including 1,188 guest records and all local fixture rows.
- ESLint on edited `src/lib/firebaseStore.js`, `src/lib/excelExport.js`, `src/components/Guide.jsx`, and `functions/index.js` — passed.
- `src/App.jsx` remains at its existing lint baseline of 19 errors; there are no diagnostics in the changed line ranges checked for this pass.
- `git diff --check` — passed.

## Recommendation

Do not treat this as exhaustive pre-production QA or production approval. Complete the blocked cloud/security/restore/download workflows against a verified isolated Firebase environment, run the omitted service integration suite against disposable services, and repeat real-browser download and device accessibility checks before deployment.

## Expanded follow-up — 2026-10-04

This follow-up supersedes the earlier emulator/browser coverage gaps for workflows that were completed below. It remains **not a production release sign-off**: the repository exposes one React/Vite application with Firebase-backed and Firebase-disabled local-only modes, not two independent deployables. Browser actions and screenshots were performed in the VS Code integrated browser; this chat cannot provide OS-level screen sharing.

### Bugs found and fixed

1. **E2E runner rejected Firebase's storage-emulator URL.** Firebase supplies `STORAGE_EMULATOR_HOST` as a URL while the app expects a bare host/port. The guarded runner now accepts only the configured loopback HTTP origin and normalizes the child test environment.
2. **Firestore rules contained an invalid interpolated migration document ID.** `vendor-ids-$(weddingId)` was not a valid rules path segment and prevented rules compilation. The rules-side migration-path lookup was removed; marker reads/writes remain in the server migration workflow.
3. **Numeric IDs were reused after soft deletion.** The next ID was derived only from active rows, while Firestore retains soft-delete tombstones. Re-adding the checklist template reused `checklist/1` and caused sync conflicts. Numeric IDs now use a monotonic high-water mark, with a timestamp and in-memory guard.
4. **Vendor and linked-budget writes could fail on missing migration marker fields.** Rules-side migration-marker reads produced null evaluation errors during vendor creation and calculator transfers. The app already awaits the guarded `migrateVendorIds` function before cloud hydration, so the fragile rules-side marker read was removed. Rules still enforce UUID vendor IDs, matching document IDs, UUID-or-null vendor links, and owner/editor scope; the migration function owns its marker lifecycle.
5. **E2E coverage did not validate real download bytes or a browser restore round trip.** Added emulator-only coverage for CSV template, XLSX workbook, unencrypted/encrypted JSON backups, encrypted payload confidentiality, wrong-password rejection, restore cancellation, pre-restore safety download, and successful restore.

The signup/email/password/navigation locators were also corrected to match the actual Hebrew accessible labels, default auth mode, Passkey action, mobile drawer, and viewport-specific guest controls. Those were test-harness defects, not application defects.

### Coverage performed

- Cloud-backed signup, invalid sign-in, guest CRUD/flags/RSVP/filtering/CSV export/import, checklist search/assignment/completion/rename/delete/template load, seating assignment, budget creation and alcohol transfer, vendor task lifecycle and linked budget, attachment upload/signed download/soft-delete/restore, owner-sharing dialog, navigation across all seven exposed screens, encrypted/uncompressed backup/restore, and mobile overflow checks.
- Real browser E2E ran against only `demo-wedding-planner-e2e` emulators: **26 tests, 25 passed, 1 intentional desktop skip**. The local E2E worker count is capped at one to avoid emulator concurrency failures.
- Responsive browser geometry was checked at 320, 390, 768, and 1365 CSS pixels for all seven screens. No horizontal overflow or hidden main headings were observed.
- Firebase-disabled local-only mode was tested on port 4174 with a temporary blank `.env.local`; dashboard and all seven screens rendered, and a QA guest add/search/delete flow returned the seeded local list to its original 592 records. `.env.local` and the temporary CSV fixture were removed; `.env` was not changed.
- `npm run test:import` — 78 passed; `npm run test:excel` — 48 passed; `npm run test:backup` — 38 passed; `npm run test:alcohol` — 3 passed; `npm run test:guide` — 36 targets verified; entity mapping — 7/7 passed.
- `npm run build` — passed. Existing warnings remain for large bundles and ineffective dynamic imports. Targeted ESLint for Functions/E2E/config files passed. Editor diagnostics in `App.jsx` are Tailwind v4 class-canonicalization suggestions; no new diagnostics were reported in the changed rules, Functions, or E2E files.

### Still not verified against live services

No production/shared-project actions were performed. Password-reset email delivery, email verification delivery, Passkeys, real two-account invite redemption/revocation/scope enforcement, install/share APIs, production service-worker behavior, and legacy API/database scripts were not run. The invite-flow script uses live Cloud Functions and real credentials, and the API/cleanup scripts can mutate configured databases; they were intentionally excluded. Review those in a separately verified disposable service environment before release.

## Authentication follow-up — 2026-10-04

- **Passkey prompt latency:** Login options are requested while the sign-in screen is ready (and refreshed on email-field blur), then cached per normalized email for up to four minutes. The tap consumes the prepared options rather than waiting for the callable/Firestore round trip first. The Auth Emulator E2E stubs the browser credential prompt and verifies it opens within 500 ms after options are warm. This does not replace verification on physical Face ID/passkey devices.
- **Hebrew password reset:** Reset requests set Firebase Auth's locale to Hebrew and use the app origin as the continue URL. The custom Hebrew screen validates the `oobCode` before exposing the form, shows the account email, handles expired/invalid codes, and gives accessible Hebrew validation errors. The Auth Emulator flow checks the outgoing `X-Firebase-Locale: he` header, rejects invalid codes and short/mismatched passwords, completes reset, then signs in with the new password.
- **Required Firebase Console configuration:** In Firebase Authentication email templates, configure the Password reset action URL to the deployed app's custom action handler (the app root accepts `mode=resetPassword` and `oobCode`) and authorize the domain. The SDK's continue URL alone does not replace Firebase's default hosted action handler. Firebase Auth Emulator currently emits action links with `lang=en` even when the request carries the Hebrew locale header; production email language should be verified with a controlled account after the Console change.
