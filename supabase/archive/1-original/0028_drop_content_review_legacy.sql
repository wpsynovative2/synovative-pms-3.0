-- =============================================================================
-- Drop what is left of per-piece content review. Run after
-- 0027_ready_to_design.sql.
--
-- 0024 removed the workflow but kept its data in case it was wanted. Nothing
-- reads it any more - a piece's progress is its stage - so the trail, the
-- verdict column and their enum go.
-- =============================================================================

drop table if exists content_reviews;

drop index if exists content_bank_status_idx;

alter table content_bank
  drop column if exists status,
  drop column if exists submitted_at;

drop type if exists content_status;

notify pgrst, 'reload schema';
