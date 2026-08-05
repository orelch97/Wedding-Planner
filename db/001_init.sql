-- =============================================================================
--  001_init.sql — Wedding Planner על CockroachDB
-- -----------------------------------------------------------------------------
--  הרצה:  npm run db:migrate      (קורא את DATABASE_URL מ-.env)
--
--  הבדלים מהותיים מול Supabase/PostgreSQL, וההתמודדות איתם:
--
--   1. אין auth.users — CockroachDB הוא מסד נתונים בלבד, בלי שירות הזדהות.
--      לכן app.users + app.sessions כאן, וה-hashing נעשה בשרת (scrypt).
--
--   2. אין משתני סשן מותאמים (`SET app.user_id = ...` לא קיים ב-CockroachDB).
--      לפי התיעוד הרשמי של Cockroach מעבירים את זהות הדייר בתוך
--      `application_name`. השרת מגדיר `wp:<uuid>` בכל טרנזקציה, ו-
--      app.current_user_id() שולף משם. זה מחליף את auth.uid() של Supabase.
--
--   3. אין בלוקי DO $$ ... $$ אנונימיים — כל לולאה כאן פרושה ידנית.
--
--   4. ביטויי USING/WITH CHECK של מדיניות אינם יכולים להכיל תת-שאילתה,
--      ולכן כל הלוגיקה עוברת דרך פונקציות SECURITY DEFINER.
--
--  ⚠ מגבלה מתועדת של CockroachDB: מפתחות זרים (וכן cascade), אילוצי
--    PRIMARY KEY / UNIQUE ו-TRUNCATE עוקפים RLS. לכן אילוץ ייחודיות לא
--    נשען עליו כגבול אבטחה בקובץ הזה.
--
--  הקובץ אידמפוטנטי — אפשר להריץ אותו שוב בבטחה.
-- =============================================================================

-- =============================================================================
--  1. הזדהות (מחליף את auth.users של Supabase)
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  email_lower   TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

--  נשמר רק ה-hash של הטוקן. דליפת המסד לא מאפשרת התחזות לסשן קיים.
CREATE TABLE IF NOT EXISTS app.sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_idx    ON app.sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx  ON app.sessions (expires_at);

-- =============================================================================
--  2. בעלות ושיתוף
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.weddings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  wedding_date DATE,
  partner_a    TEXT,
  partner_b    TEXT,
  owner_id     UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

--  שמות בני הזוג נשמרים על החתונה עצמה ולא ב-localStorage, כדי שהם יסונכרנו
--  בין מכשירים ויוצגו גם למי שהחתונה שותפה איתו. ה-ALTER מוסיף אותם למסדים
--  שנוצרו לפני שהעמודות קיימות — המיגרציה חייבת להיות ניתנת להרצה חוזרת.
ALTER TABLE public.weddings ADD COLUMN IF NOT EXISTS partner_a TEXT;
ALTER TABLE public.weddings ADD COLUMN IF NOT EXISTS partner_b TEXT;

CREATE INDEX IF NOT EXISTS weddings_owner_idx ON public.weddings (owner_id);

--  דרוש כיעד ל-FK המורכב של wedding_members למטה.
CREATE UNIQUE INDEX IF NOT EXISTS weddings_id_owner_key ON public.weddings (id, owner_id);

--  ⚠ owner_id כאן הוא דנורמליזציה מכוונת, ולא נוחות.
--  CockroachDB מסרב לקשור מדיניות על טבלה לפונקציה שקוראת אותה טבלה
--  ("dependency cycle"), גם כשהפונקציה היא SECURITY DEFINER. לכן המדיניות על
--  wedding_members חייבת להסתמך על עמודות בשורה עצמה בלבד.
--  ה-FK המורכב (wedding_id, owner_id) → weddings(id, owner_id) הוא שמבטיח
--  שאי-אפשר להמציא owner_id — בלעדיו היה אפשר להוסיף את עצמך
--  לחתונה של אחר על ידי כתיבת owner_id = ה-uuid שלך.
CREATE TABLE IF NOT EXISTS public.wedding_members (
  wedding_id UUID NOT NULL,
  user_id    UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  owner_id   UUID NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wedding_id, user_id),
  FOREIGN KEY (wedding_id, owner_id)
    REFERENCES public.weddings (id, owner_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS wedding_members_user_idx ON public.wedding_members (user_id);

CREATE TABLE IF NOT EXISTS public.wedding_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_id  UUID NOT NULL REFERENCES public.weddings(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '7 days',
  accepted_at TIMESTAMPTZ,
  created_by  UUID NOT NULL REFERENCES app.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wedding_invites_wedding_idx ON public.wedding_invites (wedding_id);

-- =============================================================================
--  3. טבלאות הנתונים
-- -----------------------------------------------------------------------------
--  המפתח הראשי מורכב: (wedding_id, id). מזהי רשומות נוצרים בצד הלקוח
--  כ-max(id)+1, ולכן שתי חתונות שונות יכילו שתיהן id = 1.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.guests (
  wedding_id      UUID   NOT NULL REFERENCES public.weddings(id) ON DELETE CASCADE,
  id              BIGINT NOT NULL,
  name            TEXT NOT NULL,
  phone           TEXT,
  category        TEXT,
  seats           INTEGER     NOT NULL DEFAULT 1,
  mention         TEXT,
  source          TEXT,
  probably_coming BOOLEAN     NOT NULL DEFAULT false,
  considering     BOOLEAN     NOT NULL DEFAULT false,
  glatt           BOOLEAN     NOT NULL DEFAULT false,
  rsvp            TEXT        NOT NULL DEFAULT 'pending',
  gift            NUMERIC     NOT NULL DEFAULT 0,
  deleted_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wedding_id, id)
);

CREATE TABLE IF NOT EXISTS public.seating_tables (
  wedding_id UUID   NOT NULL REFERENCES public.weddings(id) ON DELETE CASCADE,
  id         BIGINT NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT  NOT NULL DEFAULT 'standard',
  guest_ids  JSONB NOT NULL DEFAULT '[]'::JSONB,
  deleted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wedding_id, id)
);

CREATE TABLE IF NOT EXISTS public.vendors (
  wedding_id    UUID   NOT NULL REFERENCES public.weddings(id) ON DELETE CASCADE,
  id            BIGINT NOT NULL,
  name          TEXT NOT NULL,
  type          TEXT,
  phone         TEXT,
  email         TEXT,
  contract_cost NUMERIC     NOT NULL DEFAULT 0,
  deposit       NUMERIC     NOT NULL DEFAULT 0,
  notes         TEXT,
  tasks         JSONB       NOT NULL DEFAULT '[]'::JSONB,
  deleted_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wedding_id, id)
);

CREATE TABLE IF NOT EXISTS public.budget_items (
  wedding_id UUID   NOT NULL REFERENCES public.weddings(id) ON DELETE CASCADE,
  id         BIGINT NOT NULL,
  category   TEXT NOT NULL,
  expected   NUMERIC     NOT NULL DEFAULT 0,
  actual     NUMERIC     NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wedding_id, id)
);

CREATE INDEX IF NOT EXISTS guests_wedding_active_idx         ON public.guests         (wedding_id, deleted_at);
CREATE INDEX IF NOT EXISTS seating_tables_wedding_active_idx ON public.seating_tables (wedding_id, deleted_at);
CREATE INDEX IF NOT EXISTS vendors_wedding_active_idx        ON public.vendors        (wedding_id, deleted_at);
CREATE INDEX IF NOT EXISTS budget_items_wedding_active_idx   ON public.budget_items   (wedding_id, deleted_at);

-- =============================================================================
--  4. זהות המשתמש בסשן
-- -----------------------------------------------------------------------------
--  ⚠ נכונות הבידוד תלויה בכך שהשרת — ורק השרת — קובע את application_name.
--    לכן app_user חייב להיות תפקיד ללא הרשאה לשנות נתונים מחוץ למדיניות,
--    והחיבור למסד לעולם לא נחשף ללקוח.
-- =============================================================================

--  ⚠ VOLATILE ולא STABLE: ב-CockroachDB הפונקציה current_setting() מסומנת
--    volatile (בניגוד ל-PostgreSQL), וקריאה אליה מתוך פונקציה STABLE נדחית
--    בשגיאה "volatile statement not allowed in stable function".
CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  raw TEXT;
BEGIN
  raw := split_part(current_setting('application_name', true), ':', 2);
  IF raw IS NULL OR raw = '' THEN
    RETURN NULL;
  END IF;
  RETURN raw::UUID;
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$$;

-- =============================================================================
--  5. פונקציות עזר (SECURITY DEFINER)
-- -----------------------------------------------------------------------------
--  שלוש סיבות: (א) ביטוי מדיניות ב-CockroachDB לא יכול להכיל תת-שאילתה;
--  (ב) המדיניות צריכה לרוץ עם הרשאות מלאות על wedding_members;
--  (ג) שלוש הפונקציות קוראות את wedding_members בלבד — ולא את weddings —
--      כדי שלא ייווצר מעגל תלויות עם המדיניות של weddings.
--  בעל החתונה מקבל תמיד שורת wedding_members עם role='owner' בעת היצירה,
--  והמדיניות אוסרת עליו למחוק אותה, כך שהוא לא יכול לנעול את עצמו בחוץ.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.is_wedding_owner(w UUID)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER VOLATILE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.wedding_members
    WHERE wedding_id = w AND user_id = app.current_user_id() AND role = 'owner'
  )
$$;

CREATE OR REPLACE FUNCTION app.is_wedding_member(w UUID)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER VOLATILE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.wedding_members
    WHERE wedding_id = w AND user_id = app.current_user_id()
  )
$$;

CREATE OR REPLACE FUNCTION app.can_edit_wedding(w UUID)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER VOLATILE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.wedding_members
    WHERE wedding_id = w AND user_id = app.current_user_id()
      AND role IN ('owner', 'editor')
  )
$$;

-- =============================================================================
--  6. תפקיד האפליקציה
-- -----------------------------------------------------------------------------
--  השרת מתחבר כמשתמש ה-SQL של הקלאסטר (שהוא admin ולכן עוקף RLS), ולכל
--  בקשה מבצע `SET LOCAL ROLE app_user`. מכאן ואילך ה-RLS חל עליו.
-- =============================================================================

CREATE ROLE IF NOT EXISTS app_user;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT USAGE ON SCHEMA app    TO app_user;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.weddings        TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wedding_members TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wedding_invites TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guests          TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seating_tables  TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendors         TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_items    TO app_user;

--  app_user לא נוגע בטבלאות ההזדהות. סיסמאות וטוקנים מטופלים רק בחיבור ה-admin.
REVOKE ALL ON app.users    FROM app_user;
REVOKE ALL ON app.sessions FROM app_user;

--  ⚠ CockroachDB דורש הרשאת SELECT על הטבלה שאליה מצביע FK כדי
--  לאמת אותו. בלעדיה כל INSERT ל-weddings / wedding_members / wedding_invites
--  נכשל ב-42501 "does not have SELECT privilege on relation users".
--  אבל אנחנו לא רוצים ש-app_user יוכל בפועל לקרוא מיילים ו-hash של סיסמאות.
--  הפתרון: לתת את ההרשאה ולהפעיל RLS ללא אף מדיניות — שאילתות
--  רגילות של app_user יחזירו אפס שורות, ובדיקות FK עוקפות RLS ולכן
--  ממשיכות לעבוד. ללא FORCE, כדי שבעל הטבלה (חיבור ה-admin של השרת)
--  ימשיך לנהל הרשמות והתחברויות.
GRANT SELECT ON TABLE app.users TO app_user;
ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;

GRANT EXECUTE ON FUNCTION app.current_user_id()   TO app_user;
GRANT EXECUTE ON FUNCTION app.is_wedding_owner(UUID)  TO app_user;
GRANT EXECUTE ON FUNCTION app.is_wedding_member(UUID) TO app_user;
GRANT EXECUTE ON FUNCTION app.can_edit_wedding(UUID)  TO app_user;

-- =============================================================================
--  7. Row Level Security
-- -----------------------------------------------------------------------------
--  FORCE כדי שגם בעל הטבלה יהיה כפוף למדיניות.
-- =============================================================================

ALTER TABLE public.weddings        ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_members ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_invites ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE public.guests          ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE public.seating_tables  ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendors         ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE public.budget_items    ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

-- ── weddings ────────────────────────────────────────────────────────────────
--  ⚠ ה-`owner_id = app.current_user_id()` אינו מיותר. ב-`INSERT ... RETURNING`
--  מדיניות ה-SELECT מוחלת על השורה החדשה, אבל שורת ה-wedding_members של
--  הבעלים עדיין לא נוצרה בשלב הזה, ולכן is_wedding_member תחזיר false.
--  ההשוואה הישירה מתבצעת על השורה עצמה ולכן עובדת.
DROP POLICY IF EXISTS weddings_select ON public.weddings;
CREATE POLICY weddings_select ON public.weddings
  FOR SELECT TO app_user
  USING (owner_id = app.current_user_id() OR app.is_wedding_member(id));

DROP POLICY IF EXISTS weddings_insert ON public.weddings;
CREATE POLICY weddings_insert ON public.weddings
  FOR INSERT TO app_user
  WITH CHECK (owner_id = app.current_user_id());

DROP POLICY IF EXISTS weddings_update ON public.weddings;
CREATE POLICY weddings_update ON public.weddings
  FOR UPDATE TO app_user
  USING (owner_id = app.current_user_id())
  WITH CHECK (owner_id = app.current_user_id());

DROP POLICY IF EXISTS weddings_delete ON public.weddings;
CREATE POLICY weddings_delete ON public.weddings
  FOR DELETE TO app_user
  USING (owner_id = app.current_user_id());

-- ── wedding_members ─────────────────────────────────────────────────────────
--  ⚠ המדיניות כאן משתמשת בעמודות השורה בלבד, ללא קריאה לפונקציה שקוראת
--  טבלאות — אחרת CockroachDB פוסל את המדיניות בשגיאת dependency cycle
--  (weddings → is_wedding_member → wedding_members → is_wedding_owner → weddings).
--  האמינות של owner_id מובטחת על ידי ה-FK המורכב אל weddings(id, owner_id).
DROP POLICY IF EXISTS wedding_members_select ON public.wedding_members;
CREATE POLICY wedding_members_select ON public.wedding_members
  FOR SELECT TO app_user
  USING (owner_id = app.current_user_id() OR user_id = app.current_user_id());

DROP POLICY IF EXISTS wedding_members_insert ON public.wedding_members;
CREATE POLICY wedding_members_insert ON public.wedding_members
  FOR INSERT TO app_user
  WITH CHECK (owner_id = app.current_user_id());

DROP POLICY IF EXISTS wedding_members_update ON public.wedding_members;
CREATE POLICY wedding_members_update ON public.wedding_members
  FOR UPDATE TO app_user
  USING (owner_id = app.current_user_id() AND role <> 'owner')
  WITH CHECK (owner_id = app.current_user_id() AND role <> 'owner');

--  הבעלים מסיר כל חבר; כל חבר יכול להסיר את עצמו (עזיבת חתונה).
--  שורת ה-owner חסינה למחיקה, כדי שהבעלים לא ינעל את עצמו מחוץ לחתונה שלו.
DROP POLICY IF EXISTS wedding_members_delete ON public.wedding_members;
CREATE POLICY wedding_members_delete ON public.wedding_members
  FOR DELETE TO app_user
  USING (
    role <> 'owner'
    AND (owner_id = app.current_user_id() OR user_id = app.current_user_id())
  );

-- ── wedding_invites ─────────────────────────────────────────────────────────
--  רק הבעלים מנפיק/רואה/מבטל. קבלת ההזמנה עוברת בשרת עם חיבור ה-admin.
DROP POLICY IF EXISTS wedding_invites_select ON public.wedding_invites;
CREATE POLICY wedding_invites_select ON public.wedding_invites
  FOR SELECT TO app_user
  USING (app.is_wedding_owner(wedding_id));

DROP POLICY IF EXISTS wedding_invites_insert ON public.wedding_invites;
CREATE POLICY wedding_invites_insert ON public.wedding_invites
  FOR INSERT TO app_user
  WITH CHECK (app.is_wedding_owner(wedding_id) AND created_by = app.current_user_id());

DROP POLICY IF EXISTS wedding_invites_update ON public.wedding_invites;
CREATE POLICY wedding_invites_update ON public.wedding_invites
  FOR UPDATE TO app_user
  USING (app.is_wedding_owner(wedding_id))
  WITH CHECK (app.is_wedding_owner(wedding_id));

DROP POLICY IF EXISTS wedding_invites_delete ON public.wedding_invites;
CREATE POLICY wedding_invites_delete ON public.wedding_invites
  FOR DELETE TO app_user
  USING (app.is_wedding_owner(wedding_id));

-- ── guests ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS guests_select ON public.guests;
CREATE POLICY guests_select ON public.guests
  FOR SELECT TO app_user USING (app.is_wedding_member(wedding_id));
DROP POLICY IF EXISTS guests_insert ON public.guests;
CREATE POLICY guests_insert ON public.guests
  FOR INSERT TO app_user WITH CHECK (app.can_edit_wedding(wedding_id));
DROP POLICY IF EXISTS guests_update ON public.guests;
CREATE POLICY guests_update ON public.guests
  FOR UPDATE TO app_user
  USING (app.can_edit_wedding(wedding_id)) WITH CHECK (app.can_edit_wedding(wedding_id));
DROP POLICY IF EXISTS guests_delete ON public.guests;
CREATE POLICY guests_delete ON public.guests
  FOR DELETE TO app_user USING (app.can_edit_wedding(wedding_id));

-- ── seating_tables ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS seating_tables_select ON public.seating_tables;
CREATE POLICY seating_tables_select ON public.seating_tables
  FOR SELECT TO app_user USING (app.is_wedding_member(wedding_id));
DROP POLICY IF EXISTS seating_tables_insert ON public.seating_tables;
CREATE POLICY seating_tables_insert ON public.seating_tables
  FOR INSERT TO app_user WITH CHECK (app.can_edit_wedding(wedding_id));
DROP POLICY IF EXISTS seating_tables_update ON public.seating_tables;
CREATE POLICY seating_tables_update ON public.seating_tables
  FOR UPDATE TO app_user
  USING (app.can_edit_wedding(wedding_id)) WITH CHECK (app.can_edit_wedding(wedding_id));
DROP POLICY IF EXISTS seating_tables_delete ON public.seating_tables;
CREATE POLICY seating_tables_delete ON public.seating_tables
  FOR DELETE TO app_user USING (app.can_edit_wedding(wedding_id));

-- ── vendors ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS vendors_select ON public.vendors;
CREATE POLICY vendors_select ON public.vendors
  FOR SELECT TO app_user USING (app.is_wedding_member(wedding_id));
DROP POLICY IF EXISTS vendors_insert ON public.vendors;
CREATE POLICY vendors_insert ON public.vendors
  FOR INSERT TO app_user WITH CHECK (app.can_edit_wedding(wedding_id));
DROP POLICY IF EXISTS vendors_update ON public.vendors;
CREATE POLICY vendors_update ON public.vendors
  FOR UPDATE TO app_user
  USING (app.can_edit_wedding(wedding_id)) WITH CHECK (app.can_edit_wedding(wedding_id));
DROP POLICY IF EXISTS vendors_delete ON public.vendors;
CREATE POLICY vendors_delete ON public.vendors
  FOR DELETE TO app_user USING (app.can_edit_wedding(wedding_id));

-- ── budget_items ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS budget_items_select ON public.budget_items;
CREATE POLICY budget_items_select ON public.budget_items
  FOR SELECT TO app_user USING (app.is_wedding_member(wedding_id));
DROP POLICY IF EXISTS budget_items_insert ON public.budget_items;
CREATE POLICY budget_items_insert ON public.budget_items
  FOR INSERT TO app_user WITH CHECK (app.can_edit_wedding(wedding_id));
DROP POLICY IF EXISTS budget_items_update ON public.budget_items;
CREATE POLICY budget_items_update ON public.budget_items
  FOR UPDATE TO app_user
  USING (app.can_edit_wedding(wedding_id)) WITH CHECK (app.can_edit_wedding(wedding_id));
DROP POLICY IF EXISTS budget_items_delete ON public.budget_items;
CREATE POLICY budget_items_delete ON public.budget_items
  FOR DELETE TO app_user USING (app.can_edit_wedding(wedding_id));
