# Consultation export — iplan RSVP sync: technical discovery & architectural proposal

- **Date:** 2026-10-20
- **Project:** Wedding Planner (React + Vite + Firebase, hosted on Render)
- **Topic:** Syncing RSVP data from the external iPlan platform into our Firestore `guests` collection
- **Content below:** the full, exact text of the assistant's response, unmodified.

---

I've completed the discovery. I did **not** modify any application code — the only new files are three throwaway scripts in the gitignored `tmp/`.

## 1. Technical findings: iplan

**Stack.** `app.iplan.co.il/…/invitations` 302-redirects to `iplan.co.il/he-IL/client/sign_in`. It's a **Ruby on Rails** app (Rails UJS `data-remote="true"`, `utf8` hidden field, `.js` responses that `$('…').html(…)`), behind **Cloudflare**.

**Login is a two-step, anti-automation flow:**

| Step | Endpoint | Payload |
|---|---|---|
| 1 | `POST /he-IL/client/account/enter_with_email_check` | `model[email]`, `recaptcha-v3-token` |
| 2 | `POST /he-IL/client/sign_in` | `client_account[email]`, `client_account[password]`, `recaptcha-v3-token` |

Primary sign-in is **Google / Facebook OAuth**; email+password is a secondary flow hidden behind a "כניסה עם אימייל וסיסמה" toggle.

**The blocker.** Both steps are protected by **reCAPTCHA v3** (site key `6LclS2st…`). My automated attempt reached the password step correctly, but the server rejected it and re-rendered the form with a `grecaptcha_complaint_div` and the error:

> **"יש לסמן את התיבה"** — *check the box*

iPlan **escalated to a reCAPTCHA v2 checkbox challenge** because it scored the session as a bot. No session cookie was issued, and `/events/284821/invitations` kept redirecting to sign-in.

**No integration surface.** There's no public API, webhook, developer portal, or Zapier integration — only a contact form.

### What this means
An unattended, credential-based scheduled login **is not viable**. reCAPTCHA scores datacenter IPs (Cloud Functions, GitHub Actions) worst of all, so it would fail more often in production than it does on your laptop. Anything built on it breaks silently and at the worst time — the week guests actually respond. It's also likely contrary to iPlan's ToS, and the payload is guests' personal data.

## 2. Architectural proposal

The core principle: **separate fragile ingestion from stable reconciliation.** Only the first part depends on iPlan.

### Ingestion — three options

| | Approach | Reliability | Effort | Recommendation |
|---|---|---|---|---|
| **A** | Ask iPlan for an official export/API | Highest | Low (an email) | Do this in parallel |
| **B** | You log in once locally, we persist the session cookie and sync until it expires | Medium — breaks on expiry | Medium | Optional upgrade |
| **C** | **Use iPlan's own Excel export; drop the file into a "סנכרון מ-iplan" zone** | Highest | Lowest | **Recommended now** |
| **D** | Headless auto-login on a schedule | Low — captcha-blocked | High | **Not recommended** |

**C wins** because we already have `src/lib/guestImport.js` — Excel/CSV parsing, `windows-1255` Hebrew encoding, quoted commas, leading-zero phone repair — with **87 passing tests**. The only new work is diffing instead of appending. It's a 10-second manual step that never breaks.

### Reconciliation core (identical for A/B/C)

A pure, browser-free module `src/lib/iplanSync.js` → `reconcile({ guests, rows })` returning `{ updates, unmatched, ambiguous }`. Pure means it's testable in Node, exactly like `guestDuplicates.js`.

**Phone matching** reuses the existing `phoneDigits()`, comparing the **last 9 digits** so `050-697-0046`, `0506970046` and `+972506970046` all collapse to one key.

Edge cases, deliberately conservative:
- **No digits** → never match by name; report as unmatched.
- **Duplicate phone** (we already detect these) → **ambiguous, never auto-applied**; queued for your review.
- **In iPlan, not in our list** → suggestion only, not a silent insert.
- **In our list, not in iPlan** → untouched.

**Field mapping** — our schema already fits:

| iPlan | Our field |
|---|---|
| יגיעו | `rsvp: "confirmed"` |
| לא יגיעו | `rsvp: "declined"` |
| מתלבטים | `rsvp: "pending"` + `considering: true` |
| יגיעו בוודאות | `attendingCount`, clamped to `seats` |
| הערות | **new** `iplanNotes` field |

Two points worth your attention:
- **Partial family attendance needs no schema change.** `seats` stays as you set it; `attendingCount` carries how many are actually coming — that's exactly what the field already means.
- **I would not write iPlan notes into `mention`.** That column is labelled "אזכור / הערות" and holds *your* notes; overwriting it is silent data loss. A separate field preserves both.

Writes are **idempotent** — only changed values are written, so repeated syncs don't churn `revision` or spam the feed.

### Live updates — already solved

Server writes must increment `revision` and `updatedAt` to honour the `advancesRevision()` contract. Given that, **no new client plumbing is needed**: `subscribeCollection` already streams remote guest changes into open browsers, and the merge logic accepts remote rows when the local copy is clean. The list updates itself.

### Activity log

New server-only collection `envs/{env}/weddings/{id}/activity/{autoId}`:

```js
{ at, source: "iplan", guestId, guestName, changes: [{ field, from, to }], batchId }
```

Rules: `allow read: if hasScope(weddingId,'guests')` / **`allow write: if false`**. Server-only writes are the security boundary — an audit log the client can forge is worthless. UI: a bell with an unread count in the top bar, reusing the per-user storage pattern from tour progress, plus retention capped at the most recent entries.

### Scheduling
- **Option C:** no scheduler. The on-demand button opens the file picker and runs the same core.
- **Options A/B:** `onSchedule` in `europe-west1` every 15–30 min, plus an `onCall syncIplanNow` for the button, with a lock document to prevent overlapping runs. Credentials via `defineSecret` (Secret Manager) — **never `.env`**.

### Testing (repo conventions)
`npm run test:iplan` for the pure reconciler, plus demo-emulator E2E on desktop and mobile asserting Firestore writes, activity entries, and the UI. Never against production.

## 3. Security — needs action

Your iPlan password is in `.env` in plaintext and **surfaced in my search output**. `.env` is gitignored, so it isn't in git, but please **rotate it** and keep it in Secret Manager if we go with B. My discovery scripts mask the password and guest phone numbers; `tmp/iplan-raw*/` holds only unauthenticated pages and can be deleted.

## 4. What I need from you

1. **Which ingestion option** — A, B, or C? (My recommendation: start C, send A's email today.)
2. **iPlan notes** → separate `iplanNotes` field, as proposed?
3. **Guests in iPlan but not in our list** — suggest only, or auto-create?
4. **One assisted login**, if you want B or a complete map of the export endpoint: I'll open a visible browser, you solve the captcha once, and I'll record exactly which request carries the guest grid and whether an Excel endpoint exists.

Say the word and I'll proceed — still no application code until you choose.
