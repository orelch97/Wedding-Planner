# iPlan Approval and Transaction Fixes

The requested core fixes were already present in the current working tree from the prior implementation. I reviewed those paths without overwriting the other uncommitted integration work, then made two additional hardening changes:

- In [functions/index.js](functions/index.js), reject a request if any RSVP entry is malformed instead of filtering invalid entries and potentially committing only the valid subset. A non-array `changes` payload and invalid `fromRsvp` are rejected too.
- In [src/components/IplanSyncModal.jsx](src/components/IplanSyncModal.jsx), the initial-fetch timeout no longer clears a manual refresh that is still pending. The refresh response or the manual refresh's own timeout owns that state.
- Added an emulator regression in [tests/e2e/iplan.spec.js](tests/e2e/iplan.spec.js) verifying that a mixed valid/invalid batch changes neither the valid guest nor the activity stream.

[src/lib/iplanSync.js](src/lib/iplanSync.js) was not changed in this pass: it parses, reconciles, and calculates proposed RSVP changes; it does not persist them. Moving persistence there would bypass the Cloud Function transaction boundary.

## Exact Blocks Replaced

Cloud Function request-array validation:

```diff
-  const rawChanges = Array.isArray(data.changes) ? data.changes : [];
+  if (!Array.isArray(data.changes)) {
+    throw new HttpsError("invalid-argument", "רשימת עדכוני iPlan אינה תקינה.");
+  }
+  const rawChanges = data.changes;
```

Cloud Function RSVP source validation and whole-batch rejection:

```diff
-      const fromRsvp = ["confirmed", "declined", "maybe", "pending"].includes(c.fromRsvp) ? c.fromRsvp : "pending";
+      if (!["confirmed", "declined", "maybe", "pending"].includes(c.fromRsvp)) return null;
+      const fromRsvp = c.fromRsvp;
...
-    })
-    .filter(Boolean);
+    });
 
-  if (!cleanChanges.length) {
-    return { updatedCount: 0, batchId: null };
+  if (cleanChanges.some((change) => !change)) {
+    throw new HttpsError("invalid-argument", "אחד או יותר מעדכוני iPlan אינם תקינים.");
   }
```

Modal refresh timeout:

```diff
     const timer = setTimeout(() => {
+      if (manualRefreshPendingRef.current) return;
       setFetchingFromExtension(false);
-      manualRefreshPendingRef.current = false;
     }, 3500);
```

## Approval Path Verified

Modal commit acknowledgment:

```diff
-        const result = await onCommitUpdates?.(changes, displayedSource?.kind || "iplan");
-        if (result?.updatedCount != null && result.updatedCount !== changes.length) {
-          throw new Error("The server did not commit every approved iPlan update.");
-        }
+        if (typeof onCommitUpdates !== "function") {
+          throw new Error("The iPlan update handler is unavailable.");
+        }
+        const result = await onCommitUpdates(changes, displayedSource?.kind || "iplan");
+        if (!result || result.updatedCount !== changes.length) {
+          throw new Error("The server did not commit every approved iPlan update.");
+        }
 ```

The existing modal handler is click-driven: `handleApproveAndUpdate` is called only by the explicit “כן, עדכן אישורי הגעה” button. It requires the commit handler and a complete update-count acknowledgment, shows the success toast only afterward, and leaves the modal open on failure.

The existing App handler awaits `commitIplanRsvpUpdates`, checks the committed count, and marks the user's activity as seen only after success. The client callable defaults to guest updates. The Cloud Function validates all previewed rows and performs guest RSVP/count/revision updates and activity creation in one Firestore transaction; stale or deleted rows abort the batch. Local-only mode remains local and still requires the same explicit button click.

The modal pins the review snapshot while open. Later incoming rows set the “new data available” notice without replacing the reviewed rows. Only the explicit refresh action rebases the preview.

## Verification

- iPlan E2E: **16 passed** across desktop and mobile, including the new malformed-batch regression. After the final callback guard, the manual approval test passed on both desktop and mobile (**2 passed**).
- iPlan reconciliation tests: **17 passed**.
- `npm run build`, targeted ESLint, and `node --check functions/index.js` passed.
- The build reports the repository's existing chunk-size and ineffective-dynamic-import warnings. VS Code also reports three Tailwind class-name suggestions in the modal; these are unrelated to the logic changes.

Only demo-emulator records were written by tests. No live RSVP data was changed. No commit, push, or deployment was performed. Existing uncommitted iPlan changes were preserved.

Consultation copy: [2026-10-21-iplan-lead-developer-implementation.md](docs/consultations/2026-10-21-iplan-lead-developer-implementation.md)
