-- =============================================================================
-- Enum values for the CRM modules.
-- Run after 0012_recurrence_pause.sql, and before 0014_crm_modules.sql.
--
-- Postgres refuses to *use* an enum value in the same transaction that adds it,
-- so the additions live alone in this file. Everything that reads them is in
-- 0014.
-- =============================================================================

-- A Content Writer allotting a piece of content to a colleague.
alter type notification_type add value if not exists 'content_allotted';
