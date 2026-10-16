-- Sharing out content tasks within the writers' desk.
--
-- 1. assign_content_task(): a Team Leader of Content Writers / Copywriters /
--    Brand Strategists may give an unassigned content task to someone in
--    their own department. Until now a Team Leader could only change tasks
--    they had created themselves, so a batch a manager raised without an
--    assignee sat waiting for the manager.
--
-- 2. split_content_task(): picked pieces of a content task - written or not,
--    the task assigned or not - move to a new content task on the same
--    project, for one person. The original keeps the rest, its count down by
--    the target pieces that left. Who may: managers, the Project Leader and
--    the Content Writers' Team Leaders (who may only give it to their own
--    department).
--
-- Mirrors canAssignContentTask / canSplitContentTask in lib/permissions.ts.

create or replace function is_content_team_leader()
returns boolean language sql stable security definer set search_path = public as $$
  select is_team_leader() and is_content_writer();
$$;

create or replace function in_department(p_profile_id uuid, p_department text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profile_departments
     where profile_id = p_profile_id and department = p_department
  );
$$;

-- --------------------------------------------------------- assigning ----

create or replace function assign_content_task(p_task_id uuid, p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t tasks%rowtype;
begin
  select * into t from tasks where id = p_task_id for update;
  if not found then
    raise exception 'That task no longer exists.' using errcode = 'P0002';
  end if;
  if t.kind <> 'content' then
    raise exception 'Only a content task is shared out this way.' using errcode = '22023';
  end if;
  if not is_content_team_leader() then
    raise exception 'Only a Content Writers Team Leader can assign this.' using errcode = '42501';
  end if;
  if t.assignee_id is not null then
    raise exception 'This content task is already assigned.' using errcode = '22023';
  end if;
  if not exists (select 1 from profiles where id = p_profile_id and active) then
    raise exception 'That team member is not active.' using errcode = '22023';
  end if;
  if not in_department(p_profile_id, 'Content Writers / Copywriters / Brand Strategists') then
    raise exception 'Pick someone from the Content Writers team.' using errcode = '22023';
  end if;

  -- The slots follow the assignee (tasks_sync_content_slots); they are told
  -- by notify_task_assignment.
  update tasks set assignee_id = p_profile_id where id = p_task_id;
end;
$$;

-- ---------------------------------------------------------- splitting ----

create or replace function split_content_task(
  p_task_id         uuid,
  p_piece_ids       uuid[],
  p_title           text,
  p_assignee_id     uuid,
  p_start_date      date,
  p_due_date        date,
  p_estimated_hours numeric,
  p_priority        priority_level default 'Medium'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t        tasks%rowtype;
  p        projects%rowtype;
  v_new    uuid;
  v_moved  integer;
  v_slots  integer;
  v_left   integer;
begin
  select * into t from tasks where id = p_task_id for update;
  if not found then
    raise exception 'That task no longer exists.' using errcode = 'P0002';
  end if;
  if t.kind <> 'content' or t.project_id is null then
    raise exception 'Only a content task on a project can be split.' using errcode = '22023';
  end if;
  select * into p from projects where id = t.project_id;

  if not (is_global_manager() or leads_project(t.project_id) or is_content_team_leader()) then
    raise exception 'Only a manager, the Project Leader or a Content Writers Team Leader can split a content task.'
      using errcode = '42501';
  end if;
  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'The new task needs a title.' using errcode = '22023';
  end if;
  if not exists (select 1 from profiles where id = p_assignee_id and active) then
    raise exception 'That team member is not active.' using errcode = '22023';
  end if;
  if not (is_global_manager() or leads_project(t.project_id))
     and not in_department(p_assignee_id, 'Content Writers / Copywriters / Brand Strategists') then
    raise exception 'Pick someone from the Content Writers team.' using errcode = '22023';
  end if;
  if p_start_date is null or p_due_date is null or p_due_date < p_start_date then
    raise exception 'The due date must be on or after the start date.' using errcode = '22023';
  end if;
  if p_start_date < p.start_date or p_due_date > p.deadline then
    raise exception 'The dates must sit inside the project (% to %).',
      to_char(p.start_date, 'FMDD Mon YYYY'), to_char(p.deadline, 'FMDD Mon YYYY')
      using errcode = '22023';
  end if;

  select count(*), count(*) filter (where slot is not null)
    into v_moved, v_slots
    from content_bank
   where id = any (p_piece_ids) and task_id = p_task_id;
  if v_moved = 0 then
    raise exception 'Pick the pieces to move.' using errcode = '22023';
  end if;
  if v_moved <> coalesce(array_length(p_piece_ids, 1), 0) then
    raise exception 'Some of those pieces are not on this task.' using errcode = '22023';
  end if;
  v_left := t.content_count - v_slots;
  if v_left < 1 then
    raise exception 'Leave at least one piece on the original task - to hand over all of it, reassign it instead.'
      using errcode = '22023';
  end if;

  -- The new task, empty for now: its count is set once the pieces are on it,
  -- so no fresh empty slots get laid out.
  insert into tasks (
    project_id, title, description, department, assignee_id, priority,
    start_date, due_date, estimated_hours, tags, kind, content_count, content_types
  ) values (
    t.project_id, btrim(p_title), '', t.department, p_assignee_id, p_priority,
    p_start_date, p_due_date, coalesce(p_estimated_hours, 0), '{}', 'content', 0, '{}'
  ) returning id into v_new;

  -- Move the pieces. Target pieces are numbered 1.. on the new task in their
  -- old order; extras stay extras. A name still generated from the old task
  -- follows the new one; a name someone typed is kept.
  with moved as (
    select c.id,
           c.slot,
           row_number() over (order by c.slot) as n
      from content_bank c
     where c.id = any (p_piece_ids) and c.task_id = p_task_id and c.slot is not null
  )
  update content_bank c
     set task_id = v_new,
         slot    = m.n,
         title   = case when c.title = content_slot_title(t.title, m.slot)
                        then content_slot_title(btrim(p_title), m.n::integer)
                        else c.title end
    from moved m
   where c.id = m.id;
  update content_bank
     set task_id = v_new
   where id = any (p_piece_ids) and task_id = p_task_id and slot is null;

  -- Close the gaps on the original: renumber what is left 1..n, renaming the
  -- generated names to match. Shifted out of the way first so the unique
  -- (task, slot) index never sees two pieces on one number.
  update content_bank set slot = slot + 100000 where task_id = p_task_id and slot is not null;
  with kept as (
    select id, slot - 100000 as old_slot, row_number() over (order by slot) as n
      from content_bank where task_id = p_task_id and slot is not null
  )
  update content_bank c
     set slot  = k.n,
         title = case when c.title = content_slot_title(t.title, k.old_slot::integer)
                      then content_slot_title(t.title, k.n::integer)
                      else c.title end
    from kept k
   where c.id = k.id;

  -- Counts and per-piece types now match what each task actually holds.
  update tasks
     set content_count = v_left,
         content_types = coalesce((
           select array_agg(type order by slot) from content_bank
            where task_id = p_task_id and slot is not null), '{}')
   where id = p_task_id;
  update tasks
     set content_count = v_slots,
         content_types = coalesce((
           select array_agg(type order by slot) from content_bank
            where task_id = v_new and slot is not null), '{}')
   where id = v_new;

  return v_new;
end;
$$;

notify pgrst, 'reload schema';
