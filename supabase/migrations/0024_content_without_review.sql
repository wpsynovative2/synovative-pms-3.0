-- =============================================================================
-- Content pieces are no longer approved one by one. Run after
-- 0023_property_clients.sql.
--
-- 0021 gave every piece its own submit -> approve / reject / changes cycle and
-- let the batch approve its task. In practice the writer is the one who knows
-- where a piece has got to, so they now say so through its stage (0022:
-- Ready To Move, Design Completed, Scheduled, Cancelled, Carry Forwarded), and
-- a content task is submitted and reviewed as a whole like any other task.
--
-- The piece-level workflow is removed rather than left dormant:
--   * the trigger goes first, because it re-opened an approved content task
--     whenever a piece was added or edited without being "Approved" - which,
--     with nobody approving pieces any more, would be every edit;
--   * then the functions it and the review screen called.
--
-- content_bank.status and content_reviews stay, untouched, so decisions
-- already recorded are not lost. Nothing writes to them from here on.
-- =============================================================================

drop trigger if exists content_bank_sync_task on content_bank;

drop function if exists touch_content_task();
drop function if exists review_content(uuid, review_decision, text);
drop function if exists submit_content(uuid);
drop function if exists sync_content_task(uuid);

comment on column tasks.kind is
  'standard = one piece of work; content = a batch of Content Bank pieces. Both are submitted and reviewed as a task.';
comment on column content_bank.status is
  'Legacy (0021): the per-piece review verdict. No longer written since 0024; the writer reports progress through stage.';

notify pgrst, 'reload schema';
