---
name: "Multi-tenant + security hardening"
description: "Convert the wedding planner from a single shared dataset into a secure multi-tenant app: per-user weddings, sharing/collaborators, ownership-scoped RLS, and pre-publish security hardening."
agent: "agent"
argument-hint: "Optionally name a phase, e.g. 'phase 1 only'"
---

# Goal

Turn this app into a **secure multi-tenant wedding planner**:

- Any user can sign up and gets their **own** wedding.
- A user can **share** their wedding with others (partner, planner, family) with a role.
- A user sees a list of weddings they own **plus** weddings shared with them, and can switch between them.
- No user can ever read or write another wedding's data — enforced **in the database**, not in the UI.

Work through the phases in order. Do not skip Phase 1 — everything else depends on it.

---

## Current state (verified — do not re-discover)

| File | What it does today |
|---|---|
| [supabase/schema.sql](../../supabase/schema.sql) | 4 tables: `guests`, `seating_tables`, `vendors`, `budget_items`. Soft delete via `deleted_at`. |
| [src/lib/supabase.js](../../src/lib/supabase.js) | Exports `supabase` client + `isSupabaseConfigured`. App falls back to localStorage-only when env vars are absent. |
| [src/lib/cloudStore.js](../../src/lib/cloudStore.js) | `ENTITIES` map (camelCase ↔ snake_case), `cloudFetchAll`, `cloudIsEmpty`, `cloudSeed`, `cloudSyncDataset(key, rows, prevIds)`. |
| [src/App.jsx](../../src/App.jsx) | `App()` gates on session → `LoginScreen` or `WeddingApp`. `usePersistentState` writes to localStorage under prefix `wp:v1:`, debounced 400ms. Cloud sync is debounced 800ms. |

### The critical vulnerability to fix

`schema.sql` currently ends with:

```sql
create policy "authenticated_all" on public.guests
  for all to authenticated
  using (true) with check (true);
```

There is **no `user_id` column anywhere**. Combined with Supabase's default of open public sign-ups, this means *any person on the internet* can register an account and read every guest name, phone number, budget figure and vendor contract. The `LoginScreen` only hides the UI; the REST API is directly reachable with the anon key that ships in the JS bundle.

### Primary-key trap (important)

Record ids are generated **client-side** as `max(id) + 1` (see `nextGuestId` in `src/App.jsx`). Once there are multiple weddings, two weddings will both contain guest `id = 1`. The current `id bigint primary key` will collide.

**Required fix:** make the primary key composite — `primary key (wedding_id, id)` — on all four data tables. This preserves the existing client-side id logic and offline-first behaviour. Every `upsert` must then pass `{ onConflict: "wedding_id,id" }`.

---

## Phase 1 — Database: ownership model + real RLS

Write a **new** migration file `supabase/migrations/002_multi_tenant.sql`. Do not edit `schema.sql` destructively; existing rows must be preserved and assigned to a wedding, never dropped. Because the existing tables carry no ownership information, an automatic backfill is only correct when the project has exactly one user — see the backfill rules below for the zero-user and multi-user cases.

### Tables to add

```
weddings
  id            uuid primary key default gen_random_uuid()
  name          text not null
  wedding_date  date
  owner_id      uuid not null references auth.users(id) on delete cascade
  created_at    timestamptz not null default now()

wedding_members
  wedding_id    uuid references weddings(id) on delete cascade
  user_id       uuid references auth.users(id) on delete cascade
  role          text not null check (role in ('owner','editor','viewer'))
  created_at    timestamptz not null default now()
  primary key (wedding_id, user_id)

wedding_invites
  id            uuid primary key default gen_random_uuid()
  wedding_id    uuid not null references weddings(id) on delete cascade
  email         text not null
  role          text not null check (role in ('editor','viewer'))
  token         uuid not null default gen_random_uuid()
  expires_at    timestamptz not null default now() + interval '7 days'
  accepted_at   timestamptz
  created_by    uuid not null references auth.users(id)
```

### Changes to the four existing tables

1. Add `wedding_id uuid not null references weddings(id) on delete cascade`.
2. Backfill, wrapped in a `DO` block that first reads `select count(*) from auth.users`:
   - **Exactly one user:** create one wedding owned by that user, assign all existing rows to it, add an `owner` row in `wedding_members`.
   - **Zero users:** skip creating the default wedding and leave the four tables as-is (there is nothing to attribute).
   - **More than one user:** `raise exception` with a descriptive message telling the developer to assign rows to weddings manually before re-running the migration. Never guess an owner — that would hand one user's data to another account.
   - **`auth.users` inaccessible** (insufficient privileges from a plain SQL migration): `raise exception` with a message instructing the developer to run the backfill manually with a service-role connection.
3. Drop the old single-column PK, add `primary key (wedding_id, id)`.
4. Index `(wedding_id, deleted_at)` on each table.

### RLS policies

Replace `authenticated_all` everywhere. Use `security definer` helper functions to avoid infinite recursion when a policy on `wedding_members` needs to query `wedding_members`:

```sql
create or replace function public.is_wedding_member(w uuid)
returns boolean language sql security definer stable
set search_path = public
as $$ select exists (
  select 1 from wedding_members
  where wedding_id = w and user_id = auth.uid()
) $$;

create or replace function public.can_edit_wedding(w uuid)
returns boolean language sql security definer stable
set search_path = public
as $$ select exists (
  select 1 from wedding_members
  where wedding_id = w and user_id = auth.uid()
    and role in ('owner','editor')
) $$;
```

Then on each of the four data tables:

- `for select` → `using (is_wedding_member(wedding_id))`
- `for insert` → `with check (can_edit_wedding(wedding_id))`
- `for update` → `using (can_edit_wedding(wedding_id)) with check (can_edit_wedding(wedding_id))`
- `for delete` → `using (can_edit_wedding(wedding_id))`

Also add policies so a user can `select` weddings they are a member of, `insert` a wedding they own, and only the owner can `update`/`delete` it or manage `wedding_members` / `wedding_invites`.

**Enable RLS on the three new tables too.** A new table without RLS is wide open.

### Auto-provisioning

Add a trigger on `auth.users` insert that creates a default wedding + an `owner` membership, so a brand-new signup lands in a working app rather than an empty state.

---

## Phase 2 — Data layer

Update [src/lib/cloudStore.js](../../src/lib/cloudStore.js):

- Every function takes a `weddingId` and stamps `wedding_id` into rows via `toRow`.
- Every `.select()` adds `.eq("wedding_id", weddingId)`.
- Every `.upsert()` passes `{ onConflict: "wedding_id,id" }`.
- Soft-delete `.update()` must be scoped by `.eq("wedding_id", weddingId)` in addition to `.in("id", removed)`.
- Add `listWeddings()`, `createWedding(name, date)`, `inviteMember(weddingId, email, role)`, `acceptInvite(token)`, `listMembers(weddingId)`, `removeMember(weddingId, userId)`.

Invite acceptance flow: the invite link is `https://<app>/?invite=<token>`. After login the app reads the token from the query string, calls `acceptInvite(token)`, and redirects to that wedding. If the user is not yet logged in, store the token in `sessionStorage` and process it immediately after authentication.

Treat `wedding_id` as **required**: throw early if it is missing rather than silently querying across tenants.

---

## Phase 3 — App layer

In [src/App.jsx](../../src/App.jsx):

1. Add an `activeWeddingId` state, persisted under a user-scoped but wedding-agnostic key — `wp:v1:<userId>:activeWeddingId` — so it can be read before any wedding is selected.
2. Add a **wedding switcher** in the sidebar showing owned weddings and shared ones (with the role as a badge). Match the existing gold/sage RTL aesthetic and reuse `Card` / `SectionTitle` / `confirmDialog` / `notify`.
3. Add a **sharing/members panel**: invite by email with a role, list current members, allow the owner to revoke.
4. **Enforce roles in the UI** (`viewer` gets read-only inputs and hidden action buttons) — but treat this as UX only. The DB policies from Phase 1 are the real boundary.
5. **Namespace localStorage per user and per wedding.** Today everything sits under `wp:v1:<key>`. On a shared machine, user B currently loads user A's cached data. Change the prefix to include the user id and wedding id, e.g. `wp:v1:<userId>:<weddingId>:<key>`.
6. **Clear all `wp:v1:*` keys on sign-out.** Right now guest names and phone numbers survive logout in plaintext.

Keep localStorage-only mode working when `isSupabaseConfigured` is false — that's the offline/demo path and it must not regress. Explicit rule for that mode: fall back to the legacy prefix `wp:v1:<key>` with no userId/weddingId segment, and skip the sign-out clear step (there is no sign-out). Document this exception with a comment in the code. The 400ms localStorage debounce stays unchanged in both modes.

---

## Phase 4 — Supabase project configuration (manual, document in README)

These are dashboard settings, not code. List them explicitly for the user:

- **Email confirmation ON** — otherwise anyone can register with an address they don't own.
- **Leaked-password protection ON** (HaveIBeenPwned integration).
- **MFA/TOTP enabled**, at minimum for owner accounts.
- **CAPTCHA (Turnstile or hCaptcha) on auth endpoints** to stop credential stuffing.
- **Rate limits** reviewed under Auth → Rate Limits.
- Confirm the **service role key is never** in client code or `.env` files prefixed `VITE_` (anything `VITE_*` is bundled and public).

---

## Phase 5 — Deployment hardening

1. **Security headers** via `netlify.toml`, `vercel.json`, or `public/_headers`:
   - `Content-Security-Policy` with `default-src 'self'`, `connect-src` limited to the Supabase URL, and `frame-ancestors 'none'`
   - `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`
   - `Permissions-Policy` denying camera/microphone/geolocation
2. **Encrypted backups.** The existing `exportBackup` writes plaintext JSON containing every guest phone number. Add optional passphrase encryption using WebCrypto: PBKDF2 (≥200k iterations, random salt) → AES-GCM with a random IV. Store salt + IV alongside the ciphertext. Warn clearly that a lost passphrase means an unrecoverable file.
3. **Idle auto-logout** after a configurable period.
4. `npm audit` clean; enable Dependabot.

### Explicitly out of scope

Do **not** implement end-to-end encryption of the guest/budget tables. It would break server-side filtering and sorting, make key loss unrecoverable, and defend against a far less likely threat than the open-RLS problem this prompt exists to fix. Data is already encrypted in transit (TLS) and at rest (Supabase disk encryption).

---

## Verification — required before reporting done

1. `npm run build` succeeds.
2. **Cross-tenant test with two real accounts.** This is the acceptance test that matters:
   - Sign up user A, add a guest.
   - Sign up user B in a separate browser profile.
   - As B, call the REST API directly for A's wedding id and confirm it returns zero rows:
     ```
     GET {SUPABASE_URL}/rest/v1/guests?wedding_id=eq.<A_wedding_id>
     Authorization: Bearer <B_access_token>
     apikey: <anon key>
     ```
   - Repeat for `seating_tables`, `vendors`, `budget_items`, and for an attempted `POST`/`PATCH`. All must be denied or empty.
3. Share A's wedding with B as `viewer`; confirm B can read but every write is rejected **by the database**, not just hidden in the UI.
4. Confirm no regressions: Excel import/export, virtualized guest table, editable finance labels, budget row reordering, editable categories, seating, per-record attending counts, mobile card views, collapsible sidebar.
5. Confirm sign-out leaves no `wp:v1:*` keys behind.

## Constraints

- Preserve the existing performance patterns: memoized `GuestRow`/`GuestCard`, virtualized table, local-draft inputs committing on blur, `guestsRef`/`tablesRef` (do not make row callbacks depend on `guests`/`tables` directly), 400ms localStorage debounce, 800ms cloud debounce.
- Preserve the RTL Hebrew UI and the gold/sage design language.
- Ship the migration as a new numbered file so existing data is backfilled, never dropped.
