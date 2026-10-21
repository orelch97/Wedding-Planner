# iPlan Sync Approval Race: Investigation Report

## Findings
The modal previously applied RSVP changes to local React state immediately, showed a success toast, and fired the activity/cloud callback without awaiting it. The Cloud Function was called with `applyToGuests: false`, so the real guest writes depended on a separate debounced sync and could fail after the UI had reported success. Opening the review modal itself does not write guest data.

The fix now waits for a single Cloud Function transaction that validates the previewed RSVP values, updates guest RSVP/attendance fields and revision metadata, and writes the activity entry atomically. A stale or deleted record rejects the entire commit. The modal stays open and shows an error; it only reports success and closes after the server confirms the commit. Old open clients that explicitly send `applyToGuests: false` retain activity-only behavior during rollout.

## Verification
- iPlan reconciliation unit tests: 17 passed, 0 failed.
- Full iPlan Playwright suite: 12 passed, 0 failed across desktop and mobile.
- Coverage includes normal approval, no guest mutation before approval, failed commit with safe retry, a concurrent RSVP change rejecting a stale preview without activity, legacy-client compatibility, activity bell behavior, and mobile modal layout.
- Production build passed. Changed-file syntax and lint checks passed.

## Live iPlan Limitation
The authenticated iPlan page is open and shows 538 invitations, but the shared browser has no installed iPlan extension (no extension badge is present). I did not modify any live RSVP records because a manual iPlan edit without the extension would not test the sync path.

A sync token was exposed in local diagnostics during the investigation; the iPlan password had also appeared in an earlier local-search output. Please rotate both before live testing. After logging into Wedding Planner as the owner, regenerate the extension sync token and reload the extension. Then a one-record live test can be run and reverted safely.

## Release Status
The fix is local only. No commit, push, Firebase deployment, or production RSVP change was made. The workspace contains other pending iPlan integration changes, so they should be reviewed together before release.
