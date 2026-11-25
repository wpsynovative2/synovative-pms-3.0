-- 0016_project_files.sql
--
-- Files to receive. Work on a project often cannot begin until the client has
-- sent things: drawings, CAD, brochures. A project lists them in named groups
-- ("Architectural drawings": Site plan, Floor plans, Elevations), and each file
-- is ticked Received or not. A group is received once it has files and every
-- one of them is in; `file_groups.received_on` is that day, kept by the database.
--
-- A task can wait on file groups as it waits on a task (0021) or on the project
-- starting (0015): until each is received it is waiting, and its dates are a
-- projection from the project's start date or today, whichever is later. When
-- the last file of a group comes in, each task waiting on it and on nothing else
-- starts that working day, due `duration_days` working days later, and its
-- assignee is told. Unticking a file puts the group, and its tasks, back to
-- waiting. Written by whoever manages the project's 3D groups
-- (can_manage_task_groups). Mirrors lib/files.ts and markWaiting.

create table file_groups (
  id          uuid        not null default uuid_generate_v4(),
  project_id  uuid        not null references projects(id) on delete cascade,
  name        text        not null,
  received_on date,
  created_by  uuid        not null references profiles(id),
  created_at  timestamptz not null default now(),
  constraint file_groups_pkey primary key (id),
  constraint file_groups_name_check check (btrim(name) <> '')
);
create index file_groups_project_idx on file_groups (project_id);

create table file_items (
  id          uuid        not null default uuid_generate_v4(),
  group_id    uuid        not null references file_groups(id) on delete cascade,
  project_id  uuid        not null references projects(id) on delete cascade,
  name        text        not null,
  received    boolean     not null default false,
  received_on date,
  received_by uuid        references profiles(id) on delete set null,
  created_by  uuid        not null references profiles(id),
  created_at  timestamptz not null default now(),
  constraint file_items_pkey primary key (id),
  constraint file_items_name_check check (btrim(name) <> '')
);
create index file_items_group_idx on file_items (group_id);

alter table tasks add column file_group_ids uuid[] not null default '{}';

/* ------------------------------------------------------------ the files */

-- A file takes its group's project, and the day and person when ticked.
create or replace function stamp_file_item()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  select project_id into new.project_id from file_groups where id = new.group_id;
  if tg_op = 'UPDATE' and new.group_id is distinct from old.group_id then
    raise exception 'A file stays in its group.' using errcode = '22023';
  end if;
  if new.received and (tg_op = 'INSERT' or not old.received) then
    new.received_on := ist_today();
    new.received_by := auth.uid();
  elsif not new.received then
    new.received_on := null;
    new.received_by := null;
  end if;
  return new;
end;
$function$;

create trigger file_items_stamp before insert or update on file_items
  for each row execute function stamp_file_item();

-- Any change to a group's files has the group work out again whether it is in.
create or replace function touch_file_group()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update file_groups set received_on = received_on
   where id = case when tg_op = 'DELETE' then old.group_id else new.group_id end;
  return null;
end;
$function$;

create trigger file_items_touch_group after insert or update of received or delete on file_items
  for each row execute function touch_file_group();

-- Received: it has files and all are in, on the day the last came in. Whatever a
-- write says, this decides.
create or replace function stamp_file_group()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_all  integer;
  v_open integer;
  v_last date;
begin
  select count(*), count(*) filter (where not received), max(received_on)
    into v_all, v_open, v_last
    from file_items
   where group_id = new.id;
  new.received_on := case when v_all > 0 and v_open = 0 then v_last end;
  return new;
end;
$function$;

create trigger file_groups_stamp before insert or update on file_groups
  for each row execute function stamp_file_group();

/* ------------------------------------------------- waiting on the files */

-- Waiting: on a task not yet approved, on the project starting (0015), or on a
-- file group not yet received.
create or replace function task_is_waiting(p_task_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
           select 1
             from task_dependencies d
             join tasks p on p.id = d.depends_on_task_id
            where d.task_id = p_task_id and p.status <> 'Approved'
         )
      or exists (
           select 1
             from tasks t
             join projects pr on pr.id = t.project_id
            where t.id = p_task_id and t.waits_on_project_start and pr.started_on is null
         )
      or exists (
           select 1
             from tasks t
             join file_groups g on g.id = any (t.file_group_ids)
            where t.id = p_task_id and g.received_on is null
         );
$function$;

-- The same question from inside a trigger, as a volatile function so it reads
-- the rows the triggering statement has just written.
create or replace function task_waiting_now(p_task_id uuid)
 returns boolean
 language plpgsql
 volatile security definer
 set search_path to 'public'
as $function$
begin
  return exists (
           select 1
             from task_dependencies d
             join tasks p on p.id = d.depends_on_task_id
            where d.task_id = p_task_id and p.status <> 'Approved'
         )
      or exists (
           select 1
             from tasks t
             join projects pr on pr.id = t.project_id
            where t.id = p_task_id and t.waits_on_project_start and pr.started_on is null
         )
      or exists (
           select 1
             from tasks t
             join file_groups g on g.id = any (t.file_group_ids)
            where t.id = p_task_id and g.received_on is null
         );
end;
$function$;

-- As 0015, with file groups as one more thing to wait on. A group not received
-- counts as "due" on the project's start date, or today once that has passed.
create or replace function schedule_dependent_task()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_links  integer;
  v_latest date;
  v_from   date;
begin
  if tg_op = 'UPDATE' then
    select count(*), max(p.due_date) filter (where p.status <> 'Approved')
      into v_links, v_latest
      from task_dependencies d
      join tasks p on p.id = d.depends_on_task_id
     where d.task_id = new.id;
  else
    v_links := 0;
  end if;

  if v_links = 0 and not new.waits_on_project_start and cardinality(new.file_group_ids) = 0 then
    return new;
  end if;

  if new.project_id is null or new.kind <> 'standard' then
    raise exception 'Only a standard task in a project can wait on anything.'
      using errcode = '22023';
  end if;
  if new.duration_days is null then
    raise exception 'A task that waits needs its days to complete.'
      using errcode = '22023';
  end if;

  if (new.waits_on_project_start
      and exists (select 1 from projects where id = new.project_id and started_on is null))
     or exists (
       select 1 from file_groups g
        where g.id = any (new.file_group_ids) and g.received_on is null
     )
  then
    select greatest(pr.start_date, ist_today()) into v_from
      from projects pr where pr.id = new.project_id;
    -- greatest() skips nulls, so either alone will do.
    v_latest := greatest(v_latest, v_from);
  end if;

  if v_latest is not null then
    -- Projected: as if the last thing still open is settled on its date.
    new.start_date := snap_to_working_day(v_latest);
    new.due_date   := add_working_days(new.start_date, new.duration_days);
  elsif tg_op = 'UPDATE' then
    -- Nested so OLD is never read on insert.
    if new.duration_days is distinct from old.duration_days then
      -- Under way: a new length moves the due date, never the start.
      new.due_date := add_working_days(new.start_date, new.duration_days);
    end if;
  end if;
  -- Otherwise the task is released and its dates are its own, hand edits included.

  return new;
end;
$function$;

drop trigger tasks_schedule_dependent_insert on tasks;
create trigger tasks_schedule_dependent_insert before insert on tasks
  for each row when (new.waits_on_project_start or new.file_group_ids <> '{}'::uuid[])
  execute function schedule_dependent_task();

-- A task waits only on its own project's file groups, each named once.
create or replace function guard_task_file_groups()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if exists (
    select 1 from unnest(new.file_group_ids) x
     where not exists (
       select 1 from file_groups g where g.id = x and g.project_id = new.project_id)
  ) then
    raise exception 'A task waits on files of its own project.' using errcode = '22023';
  end if;
  if cardinality(new.file_group_ids)
     <> (select count(distinct x) from unnest(new.file_group_ids) x) then
    raise exception 'A task names each file group once.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger tasks_guard_file_groups before insert or update of file_group_ids, project_id on tasks
  for each row when (new.file_group_ids <> '{}'::uuid[])
  execute function guard_task_file_groups();

-- A deleted file group leaves every task that waited on it.
create or replace function drop_file_group_links()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update tasks set file_group_ids = array_remove(file_group_ids, old.id)
   where file_group_ids @> array[old.id];
  return null;
end;
$function$;

create trigger file_groups_drop_task_links after delete on file_groups
  for each row execute function drop_file_group_links();

-- Names the files when a task cannot be timed or submitted for want of them.
create or replace function guard_waiting_task()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_titles text;
begin
  if exists (
    select 1
      from tasks t
      join projects pr on pr.id = t.project_id
     where t.id = new.task_id and t.waits_on_project_start and pr.started_on is null
  ) then
    raise exception 'This task starts once the project is started.' using errcode = '22023';
  end if;

  select string_agg('"' || g.name || '"', ', ' order by g.created_at, g.id)
    into v_titles
    from tasks t
    join file_groups g on g.id = any (t.file_group_ids)
   where t.id = new.task_id and g.received_on is null;
  if v_titles is not null then
    raise exception 'This task starts once the files in % are received.', v_titles
      using errcode = '22023';
  end if;

  select string_agg('"' || p.title || '"', ', ' order by p.created_at, p.id)
    into v_titles
    from task_dependencies d
    join tasks p on p.id = d.depends_on_task_id
   where d.task_id = new.task_id and p.status <> 'Approved';
  if v_titles is not null then
    raise exception 'This task starts once % approved.',
      v_titles || case when v_titles like '%", "%' then ' are' else ' is' end
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

/* ------------------------------------------------- releasing the tasks */

-- The last file of a group came in: each task waiting on it and on nothing
-- else starts today's working day. A group going back to waiting re-projects
-- its tasks. Each release fires follow_task_dependency, so the chain follows.
create or replace function follow_file_group()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_start date := snap_to_working_day(ist_today());
  v_due   date;
  r       record;
begin
  for r in
    select t.id, t.title, t.assignee_id, t.duration_days
      from tasks t
     where t.project_id = new.project_id and new.id = any (t.file_group_ids)
     order by t.created_at, t.id
  loop
    if new.received_on is null or task_waiting_now(r.id) then
      update tasks set start_date = start_date where id = r.id;
      continue;
    end if;

    v_due := add_working_days(v_start, r.duration_days);
    update tasks set start_date = v_start, due_date = v_due where id = r.id;
    if r.assignee_id is not null and not is_blueprint_project(new.project_id) then
      perform notify(
        array[r.assignee_id], 'task_assigned', 'Task ready to start',
        'The files in "' || new.name || '" are in, so "' || r.title || '" can start. Due '
          || to_char(v_due, 'FMDD Mon YYYY') || '.',
        task_href(r.id, new.project_id)
      );
    end if;
  end loop;
  return null;
end;
$function$;

create trigger file_groups_follow after update of received_on on file_groups
  for each row when ((old.received_on is null) <> (new.received_on is null))
  execute function follow_file_group();

-- As 0015, asking about the file groups too before releasing a dependant.
create or replace function follow_task_dependency()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_start date;
  v_due   date;
  r       record;
begin
  if new.status = 'Approved' and old.status is distinct from 'Approved' then
    v_start := snap_to_working_day(ist_today());
    for r in
      select t.id, t.title, t.assignee_id, t.duration_days
        from task_dependencies d
        join tasks t on t.id = d.task_id
       where d.depends_on_task_id = new.id
    loop
      if task_waiting_now(r.id) then
        update tasks set start_date = start_date where id = r.id;
        continue;
      end if;

      v_due := add_working_days(v_start, r.duration_days);
      update tasks set start_date = v_start, due_date = v_due where id = r.id;
      if not is_blueprint_project(new.project_id) then
        perform notify(
          array[r.assignee_id], 'task_assigned', 'Task ready to start',
          '"' || new.title || '" was approved, so "' || r.title || '" can start. Due '
            || to_char(v_due, 'FMDD Mon YYYY') || '.',
          task_href(r.id, new.project_id)
        );
      end if;
    end loop;
  elsif new.status <> 'Approved' then
    -- Touching the row is enough: schedule_dependent_task recomputes it.
    update tasks set start_date = start_date
     where id in (select task_id from task_dependencies where depends_on_task_id = new.id);
  end if;
  return null;
end;
$function$;

-- As 0015, asking about the file groups too.
create or replace function follow_project_start()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_start date := snap_to_working_day(new.started_on);
  v_due   date;
  r       record;
begin
  for r in
    select t.id, t.title, t.assignee_id, t.duration_days
      from tasks t
     where t.project_id = new.id and t.waits_on_project_start
     order by t.created_at, t.id
  loop
    if task_waiting_now(r.id) then
      update tasks set start_date = start_date where id = r.id;
      continue;
    end if;

    v_due := add_working_days(v_start, r.duration_days);
    update tasks set start_date = v_start, due_date = v_due where id = r.id;
    if r.assignee_id is not null and not is_blueprint_project(new.id) then
      perform notify(
        array[r.assignee_id], 'task_assigned', 'Task ready to start',
        '"' || new.name || '" has started, so "' || r.title || '" can start. Due '
          || to_char(v_due, 'FMDD Mon YYYY') || '.',
        task_href(r.id, new.id)
      );
    end if;
  end loop;
  return null;
end;
$function$;

-- As 0015, through task_waiting_now.
create or replace function follow_task_dependency_link()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_start date;
  v_days  integer;
begin
  if tg_op = 'DELETE' then
    update tasks set start_date = start_date where id = old.task_id;
    return null;
  end if;

  if task_waiting_now(new.task_id) then
    update tasks set start_date = start_date where id = new.task_id;
  else
    select duration_days into v_days from tasks
     where id = new.task_id and status = 'Not Started';
    if found then
      v_start := snap_to_working_day(ist_today());
      update tasks
         set start_date = v_start, due_date = add_working_days(v_start, v_days)
       where id = new.task_id;
    end if;
  end if;
  return null;
end;
$function$;

/* ------------------------------------------------------------- security */

alter table file_groups enable row level security;
alter table file_items enable row level security;

create policy file_groups_read on file_groups for select to authenticated
  using (((select is_global_manager()) or (project_id = any ((select my_project_ids())::uuid[]))));
create policy file_groups_insert on file_groups for insert to authenticated
  with check ((can_manage_task_groups(project_id) and (created_by = auth.uid())));
create policy file_groups_update on file_groups for update to authenticated
  using (can_manage_task_groups(project_id))
  with check (can_manage_task_groups(project_id));
create policy file_groups_delete on file_groups for delete to authenticated
  using (can_manage_task_groups(project_id));

create policy file_items_read on file_items for select to authenticated
  using (((select is_global_manager()) or (project_id = any ((select my_project_ids())::uuid[]))));
create policy file_items_insert on file_items for insert to authenticated
  with check ((can_manage_task_groups(project_id) and (created_by = auth.uid())));
create policy file_items_update on file_items for update to authenticated
  using (can_manage_task_groups(project_id))
  with check (can_manage_task_groups(project_id));
create policy file_items_delete on file_items for delete to authenticated
  using (can_manage_task_groups(project_id));

-- received_on / received_by are the database's, as is a group's received_on.
revoke all on file_groups, file_items from anon;
revoke insert, update on file_groups, file_items from authenticated;
grant select, delete on file_groups, file_items to authenticated;
grant insert (id, project_id, name, created_by) on file_groups to authenticated;
grant update (name) on file_groups to authenticated;
grant insert (id, group_id, project_id, name, received, created_by) on file_items to authenticated;
grant update (name, received) on file_items to authenticated;
