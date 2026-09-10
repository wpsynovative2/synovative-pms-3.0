-- =============================================================================
-- Scheduled jobs (PRD §11.3.4, §17, §19)
-- Requires the pg_cron and pg_net extensions — enable them in the Supabase
-- dashboard under Database → Extensions before running this file.
-- =============================================================================

create extension if not exists pg_cron;

-- -----------------------------------------------------------------------------
-- §11.3.4 — stop every running timer at 11:59 PM IST and notify the assignee.
-- The task stays In Progress (Paused); only the session closes.
-- -----------------------------------------------------------------------------

create or replace function auto_stop_timers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stopped integer;
begin
  with closed as (
    update time_sessions s
       set ended_at   = now(),
           end_reason = 'Auto-stopped'
     where s.ended_at is null
    returning s.task_id, s.profile_id
  )
  insert into notifications (profile_id, type, title, body, href)
  select
    c.profile_id,
    'timer_autostop',
    'Timer auto-stopped at 11:59 PM',
    'Your timer on "' || t.title || '" was stopped automatically.',
    '/tasks?task=' || c.task_id
  from closed c
  join tasks t on t.id = c.task_id;

  get diagnostics v_stopped = row_count;
  return v_stopped;
end;
$$;

-- pg_cron schedules in UTC. 23:59 IST = 18:29 UTC (IST = UTC + 5:30).
select cron.schedule(
  'auto-stop-timers-2359-ist',
  '29 18 * * *',
  $$ select auto_stop_timers(); $$
);

-- -----------------------------------------------------------------------------
-- §17 — "Task due tomorrow" and "Overdue" notifications.
-- Runs at 9:00 AM IST (3:30 AM UTC). Guarded so a re-run cannot duplicate.
-- -----------------------------------------------------------------------------

create or replace function notify_due_and_overdue()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  -- Due tomorrow
  insert into notifications (profile_id, type, title, body, href)
  select t.assignee_id, 'due_soon', 'Task due tomorrow',
         '"' || t.title || '" is due tomorrow.',
         '/tasks?task=' || t.id
    from tasks t
   where t.status <> 'Approved'
     and t.due_date = current_date + 1
     and not exists (
       select 1 from notifications n
        where n.profile_id = t.assignee_id
          and n.type = 'due_soon'
          and n.href = '/tasks?task=' || t.id
          and n.created_at >= current_date
     );

  get diagnostics v_count = row_count;

  -- Overdue
  insert into notifications (profile_id, type, title, body, href)
  select t.assignee_id, 'overdue', 'Task overdue',
         '"' || t.title || '" passed its due date on ' ||
         to_char(t.due_date, 'DD Mon') || '.',
         '/tasks?task=' || t.id
    from tasks t
   where t.status <> 'Approved'
     and t.due_date < current_date
     and not exists (
       select 1 from notifications n
        where n.profile_id = t.assignee_id
          and n.type = 'overdue'
          and n.href = '/tasks?task=' || t.id
          and n.created_at >= current_date
     );

  return v_count;
end;
$$;

select cron.schedule(
  'due-and-overdue-0900-ist',
  '30 3 * * *',
  $$ select notify_due_and_overdue(); $$
);

-- -----------------------------------------------------------------------------
-- Housekeeping: read notifications older than 90 days are dropped so the
-- free-tier row budget stays predictable (§19).
-- -----------------------------------------------------------------------------

select cron.schedule(
  'prune-old-notifications',
  '0 20 * * 0',
  $$ delete from notifications where read and created_at < now() - interval '90 days'; $$
);

-- To inspect or remove:
--   select * from cron.job;
--   select cron.unschedule('auto-stop-timers-2359-ist');
