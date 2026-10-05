# Isolated browser E2E tests

These browser tests are deliberately restricted to local Firebase emulators. They do not use a configured project from `.env`, do not deploy rules/functions, and do not call the legacy API/database test scripts. The runner always pins Auth, Firestore, Storage, Functions, and the Firebase project to loopback/demo values; both the Playwright configuration and the Functions emulator fail closed if the expected values are absent or different. Firebase cloud service requests are blocked by the browser test route.

## Prerequisites (Windows PowerShell)

- Node.js 22 or newer and npm.
- Java 21 or newer available as `java` on `PATH` (required by the Firestore emulator).
- Network access for the one-time Firebase emulator and Playwright Chromium downloads.

From the repository root:

```powershell
npm install
npm run e2e:install-browsers
java -version
```

If Java is unavailable, install a JDK 21+ through your organization’s normal software channel, reopen PowerShell, and verify `java -version` before continuing. Do not add production Firebase credentials or edit `.env` for E2E; the runner uses harmless demo configuration.

## Run

```powershell
npm run test:e2e
```

The Firebase CLI starts only Auth, Firestore, Storage, and Functions under project `demo-wedding-planner-e2e`, invokes the test runner, then stops the emulators. Data lives only in the disposable emulator process and is not exported. Tests use synthetic `@example.test` identities and uniquely named records.

Optional modes:

```powershell
npm run test:e2e:headed
npm run test:e2e:ui
npm run e2e:report
```

The headed/UI commands also run within `emulators:exec`; keep that process alive while interacting with Playwright UI mode. The HTML report is written to `playwright-report/`, with traces, screenshots, and videos under `test-results/`. Those generated directories are ignored by Git.

## Safety boundaries

- Do not run `playwright test` directly. The Playwright config intentionally refuses to start without the expected emulator environment.
- Do not replace `demo-wedding-planner-e2e` or the loopback emulator hosts with a cloud project.
- Do not run `npm run test:api`, database reset/cleanup scripts, migration tools, or deployment commands as part of this browser suite; they are separate legacy/local-DB workflows.
- The emulator configuration loads the checked-in Firestore and Storage rules. Tests must not use Admin SDK/rule bypasses for normal browser workflows.
- Emulator-only destructive test cases are safe only while invoked via the guarded `npm run test:e2e` scripts. Never point destructive tests at production or a shared cloud project.

## Current coverage

The suite covers runner/project isolation, emulator-backed synthetic signup, invalid sign-in handling, guest creation and CSV download, checklist create/complete, seating assignment, budget-line creation, vendor creation/editing, the owner-sharing dialog, navigation smoke checks across exposed planning screens, and mobile viewport overflow. Further scenarios—password-reset action links, invite redemption and membership-scope enforcement, spreadsheet import, vendor file uploads/downloads, and backup restore—remain to be added as guarded emulator-only tests in `tests/e2e/`; keep all records synthetic and isolated.
