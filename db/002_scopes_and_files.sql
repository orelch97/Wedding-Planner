-- =============================================================================
--  002_scopes_and_files.sql
--  (א) שיתוף ברמת מסך — עמודת scopes על wedding_members / wedding_invites.
--  (ב) קבצים מצורפים לספק — public.vendor_files.
-- -----------------------------------------------------------------------------
--  עקרון: ההיקף נאכף במדיניות ה-RLS, לא ב-UI. חבר שקיבל רק את מסך המוזמנים
--  לא יקבל אף שורה מ-vendors או מ-budget_items גם אם הלקוח יבקש אותן ישירות.
--
--  מיפוי היקף → טבלאות:
--    'guests'   → guests, seating_tables       (מסך "מוזמנים והושבה")
--    'vendors'  → vendors, vendor_files        (מסכי "ספקים" ו"פורטל ספקים")
--    'finance'  → budget_items                 (מסך "ניהול תקציב")
--    'all'      → הכול, כולל הדאשבורד הראשי
-- =============================================================================

-- =============================================================================
--  1. עמודת ההיקף
-- =============================================================================

ALTER TABLE public.wedding_members
  ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT ARRAY['all'];

ALTER TABLE public.wedding_invites
  ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT ARRAY['all'];

-- =============================================================================
--  2. פונקציות ההיקף
-- -----------------------------------------------------------------------------
--  VOLATILE כי הן קוראות ל-app.current_user_id() שקוראת current_setting().
--  קוראות wedding_members בלבד — אחרת ייווצר מעגל תלויות (ראו 001).
-- =============================================================================

CREATE OR REPLACE FUNCTION app.has_scope(w UUID, s TEXT)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER VOLATILE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.wedding_members
    WHERE wedding_id = w
      AND user_id = app.current_user_id()
      AND ('all' = ANY(scopes) OR s = ANY(scopes))
  )
$$;

CREATE OR REPLACE FUNCTION app.can_edit_scope(w UUID, s TEXT)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER VOLATILE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.wedding_members
    WHERE wedding_id = w
      AND user_id = app.current_user_id()
      AND role IN ('owner', 'editor')
      AND ('all' = ANY(scopes) OR s = ANY(scopes))
  )
$$;

GRANT EXECUTE ON FUNCTION app.has_scope(UUID, TEXT)      TO app_user;
GRANT EXECUTE ON FUNCTION app.can_edit_scope(UUID, TEXT) TO app_user;

-- =============================================================================
--  3. קבצים מצורפים לספק
-- -----------------------------------------------------------------------------
--  הקובץ נשמר ב-BYTES בתוך המסד ולא באחסון חיצוני, כדי שאותה מדיניות RLS
--  תגן גם עליו. CockroachDB עובד טוב עם שורות קטנות — השרת חוסם מעל 5MB.
--  ה-FK המורכב מבטיח שלא יישאר קובץ יתום שמצביע על ספק שאינו קיים.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.vendor_files (
  wedding_id UUID   NOT NULL,
  id         UUID   NOT NULL DEFAULT gen_random_uuid(),
  vendor_id  BIGINT NOT NULL,
  name       TEXT   NOT NULL,
  mime       TEXT   NOT NULL,
  size       INT8   NOT NULL,
  data       BYTES  NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wedding_id, id),
  FOREIGN KEY (wedding_id) REFERENCES public.weddings (id) ON DELETE CASCADE,
  FOREIGN KEY (wedding_id, vendor_id)
    REFERENCES public.vendors (wedding_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS vendor_files_vendor_idx
  ON public.vendor_files (wedding_id, vendor_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_files TO app_user;

ALTER TABLE public.vendor_files ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_files_select ON public.vendor_files;
CREATE POLICY vendor_files_select ON public.vendor_files
  FOR SELECT TO app_user
  USING (app.has_scope(wedding_id, 'vendors'));

DROP POLICY IF EXISTS vendor_files_insert ON public.vendor_files;
CREATE POLICY vendor_files_insert ON public.vendor_files
  FOR INSERT TO app_user
  WITH CHECK (app.can_edit_scope(wedding_id, 'vendors'));

DROP POLICY IF EXISTS vendor_files_update ON public.vendor_files;
CREATE POLICY vendor_files_update ON public.vendor_files
  FOR UPDATE TO app_user
  USING (app.can_edit_scope(wedding_id, 'vendors'))
  WITH CHECK (app.can_edit_scope(wedding_id, 'vendors'));

DROP POLICY IF EXISTS vendor_files_delete ON public.vendor_files;
CREATE POLICY vendor_files_delete ON public.vendor_files
  FOR DELETE TO app_user
  USING (app.can_edit_scope(wedding_id, 'vendors'));

-- =============================================================================
--  4. החלפת המדיניות על ארבע טבלאות הנתונים — מהיקף "חבר" להיקף "מסך"
-- =============================================================================

-- ── guests ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS guests_select ON public.guests;
CREATE POLICY guests_select ON public.guests
  FOR SELECT TO app_user USING (app.has_scope(wedding_id, 'guests'));

DROP POLICY IF EXISTS guests_insert ON public.guests;
CREATE POLICY guests_insert ON public.guests
  FOR INSERT TO app_user WITH CHECK (app.can_edit_scope(wedding_id, 'guests'));

DROP POLICY IF EXISTS guests_update ON public.guests;
CREATE POLICY guests_update ON public.guests
  FOR UPDATE TO app_user
  USING (app.can_edit_scope(wedding_id, 'guests'))
  WITH CHECK (app.can_edit_scope(wedding_id, 'guests'));

DROP POLICY IF EXISTS guests_delete ON public.guests;
CREATE POLICY guests_delete ON public.guests
  FOR DELETE TO app_user USING (app.can_edit_scope(wedding_id, 'guests'));

-- ── seating_tables ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS seating_tables_select ON public.seating_tables;
CREATE POLICY seating_tables_select ON public.seating_tables
  FOR SELECT TO app_user USING (app.has_scope(wedding_id, 'guests'));

DROP POLICY IF EXISTS seating_tables_insert ON public.seating_tables;
CREATE POLICY seating_tables_insert ON public.seating_tables
  FOR INSERT TO app_user WITH CHECK (app.can_edit_scope(wedding_id, 'guests'));

DROP POLICY IF EXISTS seating_tables_update ON public.seating_tables;
CREATE POLICY seating_tables_update ON public.seating_tables
  FOR UPDATE TO app_user
  USING (app.can_edit_scope(wedding_id, 'guests'))
  WITH CHECK (app.can_edit_scope(wedding_id, 'guests'));

DROP POLICY IF EXISTS seating_tables_delete ON public.seating_tables;
CREATE POLICY seating_tables_delete ON public.seating_tables
  FOR DELETE TO app_user USING (app.can_edit_scope(wedding_id, 'guests'));

-- ── vendors ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS vendors_select ON public.vendors;
CREATE POLICY vendors_select ON public.vendors
  FOR SELECT TO app_user USING (app.has_scope(wedding_id, 'vendors'));

DROP POLICY IF EXISTS vendors_insert ON public.vendors;
CREATE POLICY vendors_insert ON public.vendors
  FOR INSERT TO app_user WITH CHECK (app.can_edit_scope(wedding_id, 'vendors'));

DROP POLICY IF EXISTS vendors_update ON public.vendors;
CREATE POLICY vendors_update ON public.vendors
  FOR UPDATE TO app_user
  USING (app.can_edit_scope(wedding_id, 'vendors'))
  WITH CHECK (app.can_edit_scope(wedding_id, 'vendors'));

DROP POLICY IF EXISTS vendors_delete ON public.vendors;
CREATE POLICY vendors_delete ON public.vendors
  FOR DELETE TO app_user USING (app.can_edit_scope(wedding_id, 'vendors'));

-- ── budget_items ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS budget_items_select ON public.budget_items;
CREATE POLICY budget_items_select ON public.budget_items
  FOR SELECT TO app_user USING (app.has_scope(wedding_id, 'finance'));

DROP POLICY IF EXISTS budget_items_insert ON public.budget_items;
CREATE POLICY budget_items_insert ON public.budget_items
  FOR INSERT TO app_user WITH CHECK (app.can_edit_scope(wedding_id, 'finance'));

DROP POLICY IF EXISTS budget_items_update ON public.budget_items;
CREATE POLICY budget_items_update ON public.budget_items
  FOR UPDATE TO app_user
  USING (app.can_edit_scope(wedding_id, 'finance'))
  WITH CHECK (app.can_edit_scope(wedding_id, 'finance'));

DROP POLICY IF EXISTS budget_items_delete ON public.budget_items;
CREATE POLICY budget_items_delete ON public.budget_items
  FOR DELETE TO app_user USING (app.can_edit_scope(wedding_id, 'finance'));
