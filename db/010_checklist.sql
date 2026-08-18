-- =============================================================================
--  010_checklist.sql — צ׳קליסט החתונה
-- -----------------------------------------------------------------------------
--  מסך חדש עם היקף שיתוף משלו ('checklist'), ולכן טבלה נפרדת ולא עמודה על
--  טבלה קיימת: אחרת אי אפשר היה לשתף את הצ׳קליסט בלי לחשוף גם את הנתונים
--  שיושבים לידו.
--
--  ההבחנה בין המשימות כאן לבין vendors.tasks מכוונת: שם אלו משימות מול ספק
--  מסוים ("לשלוח לצלם את לוח הזמנים"), וכאן זו רשימת המטלות של הזוג עצמו.
--  ערבוב השניים היה הופך את לוח המשימות של הספק לרשימה שאי אפשר לעבוד איתה.
--
--  assignee: 'both' | 'bride' | 'groom' — מי אחראי. נשמר כטקסט ולא כ-ENUM
--  כי CockroachDB דורש מיגרציה מלאה כדי להוסיף ערך ל-ENUM, והשרת ממילא
--  מנקה את הערך מול רשימה לבנה.
--
--  position: סדר ידני. INT8 עם רווחים גדולים כדי שאפשר יהיה לגרור שורה
--  בין שתי שורות בלי לכתוב מחדש את כל הרשימה.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.checklist_items (
  wedding_id UUID    NOT NULL REFERENCES public.weddings(id) ON DELETE CASCADE,
  id         BIGINT  NOT NULL,
  title      TEXT    NOT NULL,
  category   TEXT    NOT NULL DEFAULT '',
  assignee   TEXT    NOT NULL DEFAULT 'both',
  done       BOOLEAN NOT NULL DEFAULT false,
  position   INT8    NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wedding_id, id)
);

CREATE INDEX IF NOT EXISTS checklist_items_wedding_active_idx
  ON public.checklist_items (wedding_id, deleted_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_items TO app_user;

ALTER TABLE public.checklist_items
  ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checklist_items_select ON public.checklist_items;
CREATE POLICY checklist_items_select ON public.checklist_items
  FOR SELECT TO app_user
  USING (app.has_scope(wedding_id, 'checklist'));

DROP POLICY IF EXISTS checklist_items_insert ON public.checklist_items;
CREATE POLICY checklist_items_insert ON public.checklist_items
  FOR INSERT TO app_user
  WITH CHECK (app.can_edit_scope(wedding_id, 'checklist'));

DROP POLICY IF EXISTS checklist_items_update ON public.checklist_items;
CREATE POLICY checklist_items_update ON public.checklist_items
  FOR UPDATE TO app_user
  USING (app.can_edit_scope(wedding_id, 'checklist'))
  WITH CHECK (app.can_edit_scope(wedding_id, 'checklist'));

DROP POLICY IF EXISTS checklist_items_delete ON public.checklist_items;
CREATE POLICY checklist_items_delete ON public.checklist_items
  FOR DELETE TO app_user
  USING (app.can_edit_scope(wedding_id, 'checklist'));
