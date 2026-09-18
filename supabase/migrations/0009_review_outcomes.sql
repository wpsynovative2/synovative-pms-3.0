-- =============================================================================
-- "Waiting for Client Response" — a fourth review outcome.
-- Run after 0008_task_visibility.sql.
--
-- A reviewer who has passed the work to the client can park the task instead of
-- approving or rejecting it: the assignee is finished, nobody is blocked here,
-- and the reviewer comes back to decide once the client answers.
--
-- Nothing but the enum values belongs in this file. Postgres will not let a new
-- enum value be *used* in the transaction that adds it, so everything that
-- references them lives in 0010.
-- =============================================================================

alter type review_decision add value if not exists 'Waiting for Client Response';
alter type task_status     add value if not exists 'Waiting for Client Response';
