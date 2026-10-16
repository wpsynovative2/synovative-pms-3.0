-- =============================================================================
-- "Content Bank" as a place a submission's output can be. Run after
-- 0011_company_nature.sql, and before 0013.
--
-- A file of its own because Postgres cannot use a new enum value in the same
-- transaction that adds it, and 0013 does.
-- =============================================================================

alter type output_location add value if not exists 'Content Bank';
