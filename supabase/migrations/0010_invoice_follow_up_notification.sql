-- =============================================================================
-- 0010 — notification_type gains invoice_follow_up
--
-- Its own file: Postgres cannot use a new enum value in the transaction that
-- adds it, and 0011 does. Run this before 0011.
-- =============================================================================

alter type notification_type add value if not exists 'invoice_follow_up';
