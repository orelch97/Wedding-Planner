# iPlan Premature Confirmation: Investigation and Fix

I traced the screenshots to two related but separate issues:

1. **The review changed from 14 proposed updates to zero.** Opening the modal requests a fresh extension snapshot, and incoming snapshots could replace the data being reviewed. The green message meant “no differences in the current scan”; it did **not** mean the changes had been saved. The modal now pins the snapshot being reviewed. New data arriving mid-review is flagged without changing the proposed rows; only the explicit refresh action rebases the preview. The zero-difference message now explicitly says that no changes were made.
2. **A failed save could look successful.** The previous flow updated local React state and showed success before the server commit had completed. The approval flow now awaits one Firestore transaction that updates guest RSVP fields and writes the activity record atomically. If a row changed or was deleted after preview, the transaction rejects the entire batch, the modal remains open with an error, and no success toast is shown.

For rolling-deployment compatibility, older clients that explicitly request activity-only behavior retain that behavior; new clients use the atomic guest-and-activity commit by default.

## Verification

- iPlan E2E: **14/14 passed** across desktop and mobile.
- iPlan reconciliation unit tests: **17/17 passed**.
- Production build passed; changed-file syntax and lint checks passed.
- Tests cover the original preview/approval path, failed commit and retry, a concurrent RSVP change rejected atomically with no activity entry, snapshots arriving during review, explicit refresh, legacy-client compatibility, activity-bell behavior, and mobile modal layout.

## Live-Data Limitation and Security

No live RSVP records were edited. The authenticated iPlan tab showed 538 invitations but no Chrome extension badge, so a live extension sync could not be exercised. The production Wedding Planner page available in this session was signed out.

A production extension sync token was exposed in earlier diagnostic output; the iPlan password had also appeared in an earlier local search. Treat both as compromised and rotate them before production testing. After rotation, sign into Wedding Planner as the owner and reload/reconfigure the extension. Then run a one-record live canary and verify the Firestore result and activity entry before relying on the integration.

## Release Status

The fixes are local only: no commit, push, Firebase deployment, or production RSVP change was made. The worktree already contains numerous uncommitted iPlan integration changes; those should be reviewed and released together rather than staged indiscriminately.

Consultation copy: [2026-10-21-iplan-premature-confirmation-investigation.md](docs/consultations/2026-10-21-iplan-premature-confirmation-investigation.md)
