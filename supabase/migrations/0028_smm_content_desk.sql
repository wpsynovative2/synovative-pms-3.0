-- Content tasks reach the Social Media Marketing team too, and every Team
-- Leader can read the whole Content Bank.
--
-- 1. on_content_desk(): Content Writers or Social Media Marketing. The
--    Content Writers' Team Leader may now give an unassigned content task
--    (assign_content_task) or a split-off one (split_content_task) to someone
--    on either team. Who may assign or split is unchanged from 0024.
--
-- 2. sees_every_content_task(): the Team Leaders of both teams see every
--    project with a content task (0025 gave this to Content Writers only).
--
-- 3. content_bank_read: every Team Leader reads every piece, whether or not
--    their team holds a task on the project - and projects_read lets them
--    read the name of any project with content, so the pieces are filed
--    under it. Nothing else of that project opens up.
--
-- Mirrors onContentDesk / seesEveryContentTask / canViewContentEntry in
-- lib/permissions.ts. Function bodies otherwise as 0024 / 0025.

create or replace function on_content_desk(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select in_department(p_profile_id, 'Content Writers / Copywriters / Brand Strategists')
      or in_department(p_profile_id, 'Social Media Marketing');
$$;

create or replace function sees_every_content_task()
returns boolean language sql stable security definer set search_path = public as $$
  select is_team_leader() and on_content_desk(auth.uid());
$$;

-- --------------------------------------------------- assigning, splitting ----

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
  if not on_content_desk(p_profile_id) then
    raise exception 'Pick someone from the Content Writers or Social Media Marketing team.'
      using errcode = '22023';
  end if;

  -- The slots follow the assignee (tasks_sync_content_slots); they are told
  -- by notify_task_assignment.
  update tasks set assignee_id = p_profile_id where id = p_task_id;
end;
$$;

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
     and not on_content_desk(p_assignee_id) then
    raise exception 'Pick someone from the Content Writers or Social Media Marketing team.'
      using errcode = '22023';
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

-- ------------------------------------------------------------ visibility ----

create or replace function my_project_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct id), '{}') from (
    select p.id from projects p where p.leader_id = auth.uid()
    union
    select t.project_id from tasks t
     where t.assignee_id = auth.uid() and t.project_id is not null
    union
    select t.project_id from tasks t
     where is_team_leader() and t.project_id is not null
       and t.department = any (my_departments())
    union
    select t.project_id from tasks t
     where sees_every_content_task() and t.project_id is not null
       and t.kind = 'content'
  ) visible;
$$;

create or replace function can_see_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    is_global_manager()
    or exists (select 1 from projects p
               where p.id = p_project_id and p.leader_id = auth.uid())
    or exists (select 1 from tasks t
               where t.project_id = p_project_id and t.assignee_id = auth.uid())
    or (is_team_leader() and exists (
          select 1 from tasks t
           where t.project_id = p_project_id
             and t.department = any (my_departments())))
    or (sees_every_content_task() and exists (
          select 1 from tasks t
           where t.project_id = p_project_id and t.kind = 'content'));
$$;

-- So those pieces are filed under their project's name, a Team Leader also
-- reads the project row (name, colour, company) of any project with content.
-- Its tasks, expenses and the project page still follow my_project_ids.
drop policy if exists projects_read on projects;
create policy projects_read on projects for select to authenticated
  using (
    (select is_global_manager())
    or id = any ((select my_project_ids())::uuid[])
    or ((select is_team_leader())
        and exists (select 1 from content_bank c where c.project_id = projects.id))
  );

drop policy if exists content_bank_read on content_bank;
create policy content_bank_read on content_bank for select to authenticated
  using (
    (select is_global_manager())
    or (select is_team_leader())
    or project_id = any ((select my_project_ids())::uuid[])
    or allotted_to = (select auth.uid())
    or motion_allotted_to = (select auth.uid())
  );

notify pgrst, 'reload schema';
