-- =============================================================================
-- Synovative PMS — baseline 8/8: scheduled jobs and realtime
--
-- pg_cron schedules are in UTC (IST = UTC+5:30). Realtime is published for
-- notifications only - a free-tier budget decision (§19).
-- =============================================================================

select cron.schedule(
  'auto-stop-timers-2359-ist',
  '29 18 * * *',
  $job$ select auto_stop_timers(); $job$
);

select cron.schedule(
  'due-and-overdue-0900-ist',
  '30 3 * * *',
  $job$ select notify_due_and_overdue(); $job$
);

select cron.schedule(
  'generate-recurring-occurrences-0005-ist',
  '35 18 * * *',
  $job$ select skip_paused_recurrences(); select generate_recurring_occurrences(); $job$
);

select cron.schedule(
  'prune-old-notifications',
  '0 20 * * 0',
  $job$ delete from notifications where read and created_at < now() - interval '90 days'; $job$
);

alter publication supabase_realtime add table notifications;

notify pgrst, 'reload schema';
