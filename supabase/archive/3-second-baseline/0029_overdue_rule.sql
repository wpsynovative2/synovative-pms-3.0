-- Who answers for a late task, settled (Doc.md §12; asked for on 7 Nov 2026).
--
-- Submitted, Waiting for Client Response and Approved are judged by the latest
-- submission: late only if it came after the due date. Work handed in on time is
-- not overdue while the reviewer or the client sits on it, and stays on time when
-- it is approved. Once it comes back (Changes Required, or Rejected, which resets
-- it to Not Started) it is judged by the due date again, so a resubmission after
-- that date stays overdue through review and approval. A rejection that sets a new
-- due date moves the date it is judged by. Before this, Waiting for Client Response
-- was never late and Approved never was either.
--
-- Submission days are read in IST, as the rest of the calendar is. An Approved
-- task late this way counts in overdue figures (project_stats) but gets no daily
-- overdue notification: there is nothing left for anyone to do.
--
-- Mirrors isOverdue() in lib/analytics.ts.

create or replace function task_is_overdue(p_task_id uuid, p_status task_status, p_due_date date)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $function$
  with last_submission as (
    select (max(s.submitted_at) at time zone 'Asia/Kolkata')::date as day
      from submissions s
     where s.task_id = p_task_id
  )
  select case
    when task_is_waiting(p_task_id) then false
    when p_status in ('Submitted', 'Waiting for Client Response', 'Approved')
         and (select day from last_submission) is not null
      then (select day from last_submission) > p_due_date
    when p_status = 'Approved' then false
    else p_due_date < ist_today()
  end;
$function$;

-- notify_due_and_overdue as in 0014, plus: no overdue notice for Approved work.
create or replace function notify_due_and_overdue()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_count integer := 0;
begin
  -- Due tomorrow
  insert into notifications (profile_id, type, title, body, href)
  select t.assignee_id, 'due_soon', 'Task due tomorrow',
         '"' || t.title || '" is due tomorrow.',
         task_href(t.id, t.project_id)
    from tasks t
   where t.assignee_id is not null
     and t.recurrence is null
     and not is_blueprint_project(t.project_id)
     and t.status not in ('Approved', 'Waiting for Client Response')
     and t.due_date = current_date + 1
     and not task_is_waiting(t.id)
     and not exists (
       select 1 from notifications n
        where n.profile_id = t.assignee_id
          and n.type = 'due_soon'
          and n.href = task_href(t.id, t.project_id)
          and n.created_at >= current_date
     );

  -- Overdue
  insert into notifications (profile_id, type, title, body, href)
  select t.assignee_id, 'overdue', 'Task overdue',
         '"' || t.title || '" passed its due date on ' ||
         to_char(t.due_date, 'DD Mon') || '.',
         task_href(t.id, t.project_id)
    from tasks t
   where t.assignee_id is not null
     and t.recurrence is null
     and not is_blueprint_project(t.project_id)
     and t.status <> 'Approved'
     and task_is_overdue(t.id, t.status, t.due_date)
     and not exists (
       select 1 from notifications n
        where n.profile_id = t.assignee_id
          and n.type = 'overdue'
          and n.href = task_href(t.id, t.project_id)
          and n.created_at >= current_date
     );

  return v_count;
end;
$function$;

notify pgrst, 'reload schema';
