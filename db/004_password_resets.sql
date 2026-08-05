-- =============================================================================
--  004_password_resets.sql — איפוס סיסמה במייל
-- -----------------------------------------------------------------------------
--  נשמר רק ה-hash של הטוקן, בדיוק כמו ב-app.sessions: דליפה של הטבלה הזו
--  לא מאפשרת לאף אחד לאפס סיסמה של מישהו אחר, כי הטוקן המקורי קיים רק
--  בקישור שנשלח למייל ואינו נשמר בשום מקום.
--
--  הטבלה יושבת בסכמה `app`, שאין עליה שום GRANT ל-app_user. כלומר גם אם
--  יש באג ב-RLS של נתוני החתונה, אין דרך להגיע לטוקנים האלה דרך המשתמש
--  שהלקוח מתחבר בו. הגישה היחידה היא דרך withAdmin בנתיבי ההזדהות.
-- =============================================================================

CREATE TABLE IF NOT EXISTS app.password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS password_resets_user_idx   ON app.password_resets (user_id);
CREATE INDEX IF NOT EXISTS password_resets_expiry_idx ON app.password_resets (expires_at);
