# iPlan Production Deployment Status

## Completed

- Deployed Firebase Functions first with:

```powershell
firebase deploy --project wedding-planner-c3d62 --only functions
```

The deployment completed successfully in `europe-west1`, including `commitIplanRsvpUpdates`. `firebase functions:list` confirms the callable is deployed. Firestore rules were not deployed because they were unchanged.
- Committed and pushed all current staged workspace changes to `origin/main`:

```powershell
git add -A
git diff --cached --name-only
git commit -m "Fix and streamline iPlan RSVP sync"
git push origin main
```

Release commit: `9eccbe9a68cc6a95a71cc5a2fc522dd85370ce6b`. `origin/main` matches this commit and the worktree is clean. The ignored `iplan-extension/local-config.js` credential file was not staged.

## Render Still Pending

Render has not served this release yet. The production app still references `index-BbAOrcRl.js`; inspection found the old Guests-page RSVP control and did not find the new extension signal or bell action. The Render dashboard redirected to sign-in in the shared browser, so I could not inspect or trigger the deployment.

In Render Dashboard, open the `wedding-planner` service and confirm the deployment for commit `9eccbe9` on `main` completes successfully. If no deployment is running, use **Manual Deploy → Deploy latest commit**. Wait for the service to report **Live**, then reload the site and confirm the app references the updated bundle, the Guests-page RSVP button is gone, and the bell appears only when an iPlan extension or snapshot is present. Do not use live RSVP sync until this frontend verification passes.

## Firebase and Security Checks

- In Firebase Console, select `wedding-planner-c3d62` → Functions → `europe-west1`; confirm `commitIplanRsvpUpdates` is active and inspect its logs for errors after the first test.
- In the intended test wedding, verify one approved test RSVP changes only RSVP/count/revision and creates one activity batch; verify extension sync alone only updates the iPlan snapshot.
- The iPlan password and extension sync token were exposed in prior diagnostics. Rotate both before production testing. Sign into the Wedding Planner as owner, issue a fresh extension token, reconnect the extension, and verify the old token no longer works.
- No live RSVP records were changed by this release process; E2E writes used demo emulators only.

Consultation copy: [2026-10-21-iplan-production-deployment.md](docs/consultations/2026-10-21-iplan-production-deployment.md)
