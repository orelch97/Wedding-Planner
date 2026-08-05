-- =============================================================================
--  003_wedding_settings.sql — הגדרות ברמת החתונה
-- -----------------------------------------------------------------------------
--  עד כה יעד התקציב, קטגוריות המוזמנים וכותרות מסך התקציב נשמרו ב-localStorage
--  בלבד. משמעות הדבר שהם נמחקו בכל יציאה מהמערכת ולא היו קיימים במכשיר אחר או
--  אצל מי שהחתונה שותפה איתו — כלומר נתונים שהמשתמש הזין נעלמו לו.
--
--  הם לא נשמרים בעמודה על public.weddings בכוונה: מדיניות ה-UPDATE על weddings
--  שמורה לבעלים בלבד (שם החתונה, התאריך, שמות בני הזוג), ואילו ההגדרות האלה הן
--  נתון שיתופי שגם עורך אמור לשנות. טבלה נפרדת מאפשרת מדיניות RLS משלה
--  (can_edit_wedding) בלי להחליש את ההגנה על weddings עצמה.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.wedding_settings (
  wedding_id UUID PRIMARY KEY REFERENCES public.weddings(id) ON DELETE CASCADE,
  data       JSONB       NOT NULL DEFAULT '{}'::JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.wedding_settings TO app_user;

--  אין DELETE: מחיקת החתונה מוחקת את השורה דרך ON DELETE CASCADE, ואין תרחיש
--  שבו לקוח צריך למחוק הגדרות — איפוס נעשה בכתיבת אובייקט ריק.
ALTER TABLE public.wedding_settings ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wedding_settings_select ON public.wedding_settings;
CREATE POLICY wedding_settings_select ON public.wedding_settings
  FOR SELECT TO app_user USING (app.is_wedding_member(wedding_id));

DROP POLICY IF EXISTS wedding_settings_insert ON public.wedding_settings;
CREATE POLICY wedding_settings_insert ON public.wedding_settings
  FOR INSERT TO app_user WITH CHECK (app.can_edit_wedding(wedding_id));

DROP POLICY IF EXISTS wedding_settings_update ON public.wedding_settings;
CREATE POLICY wedding_settings_update ON public.wedding_settings
  FOR UPDATE TO app_user
  USING (app.can_edit_wedding(wedding_id)) WITH CHECK (app.can_edit_wedding(wedding_id));
