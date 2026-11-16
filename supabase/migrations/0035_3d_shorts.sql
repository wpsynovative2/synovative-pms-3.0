-- Shorts in a 3D project (Archi-3d.md §10): the films the project renders, beside
-- the work that builds them.
--
--   Shorts            one per project: title, total frames, description, notes
--   ├── SH1           a short: its share of the frames, description, notes
--   │   ├── Cam1.1    a camera: an ordinary task, with its share of the short's
--   │   └── Cam1.2    frames and the group, sub-group or task it renders
--   └── SH2
--       └── Cam2.1
--
-- A cam is a task, so its assignee, dates, timer, submissions, reviews and
-- thumbnail work as on any other (the same reasoning as groups, Archi-3d.md §2).
-- It sits outside the groups. Whether it is ready to render is worked out on
-- screen from what it renders, never stored.
--
-- Frames are not checked against their parent: going over is shown as a warning.
--
-- Mirrors ShortsPlan / Short / Task.shortId in lib/types.ts and lib/shorts.ts.

create table shorts_plans (
  project_id        uuid        not null,
  title             text        not null,
  frames            integer     not null,
  description       text        not null default '',
  client_supe_notes text        not null default '',
  lead_note         text        not null default '',
  general_notes     text        not null default '',
  next_short_number integer     not null default 1,
  created_by        uuid        not null,
  created_at        timestamptz not null default now(),
  constraint shorts_plans_pkey primary key (project_id),
  constraint shorts_plans_frames_check check (frames > 0),
  constraint shorts_plans_project_id_fkey
    foreign key (project_id) references projects (id) on delete cascade,
  constraint shorts_plans_created_by_fkey
    foreign key (created_by) references profiles (id)
);

create table shorts (
  id                uuid        not null default uuid_generate_v4(),
  project_id        uuid        not null,
  number            integer     not null,
  title             text        not null,
  frames            integer     not null,
  description       text        not null default '',
  client_supe_notes text        not null default '',
  lead_note         text        not null default '',
  general_notes     text        not null default '',
  next_cam_number   integer     not null default 1,
  created_by        uuid        not null,
  created_at        timestamptz not null default now(),
  constraint shorts_pkey primary key (id),
  constraint shorts_project_number_key unique (project_id, number),
  -- What the composite foreign key on tasks points at.
  constraint shorts_id_project_key unique (id, project_id),
  constraint shorts_frames_check check (frames > 0),
  constraint shorts_plan_fkey
    foreign key (project_id) references shorts_plans (project_id) on delete cascade,
  constraint shorts_created_by_fkey
    foreign key (created_by) references profiles (id)
);

alter table tasks
  add column short_id        uuid,
  add column short_number    integer,
  add column frames          integer,
  add column render_group_id uuid,
  add column render_task_id  uuid;

-- Deleting a short deletes its cams, as deleting a group does its tasks (0034).
alter table tasks add constraint tasks_short_fkey
  foreign key (short_id, project_id) references shorts (id, project_id) on delete cascade;
-- What it renders can go first; the cam stays, pointing at nothing.
alter table tasks add constraint tasks_render_group_fkey
  foreign key (render_group_id) references task_groups (id) on delete set null;
alter table tasks add constraint tasks_render_task_fkey
  foreign key (render_task_id) references tasks (id) on delete set null;

-- The foreign key skips a row whose project_id is null, so this says it too. A cam
-- is a standard task outside the groups.
alter table tasks add constraint tasks_cam_shape check (
  short_id is null or (project_id is not null and kind = 'standard' and group_id is null)
);
alter table tasks add constraint tasks_cam_only_fields check (
  short_id is not null
  or (frames is null and render_group_id is null and render_task_id is null)
);
alter table tasks add constraint tasks_cam_frames_check check (frames is null or frames > 0);
alter table tasks add constraint tasks_render_one_thing check (
  render_group_id is null or render_task_id is null
);
alter table tasks add constraint tasks_short_number_key unique (short_id, short_number);

create index tasks_short_id_idx on tasks (short_id) where short_id is not null;
-- Read on every delete of a group or task, for the set null above.
create index tasks_render_group_id_idx on tasks (render_group_id) where render_group_id is not null;
create index tasks_render_task_id_idx on tasks (render_task_id) where render_task_id is not null;

-- ------------------------------------------------------------- numbering --
-- As groups (0022): each number comes from a counter on the parent row, which
-- locks it, and a number is never reused.

create or replace function guard_shorts_plan()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_3d_project(new.project_id) then
    raise exception 'Only a 3D project has shorts.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger shorts_plans_guard before insert on shorts_plans
  for each row execute function guard_shorts_plan();

create or replace function assign_short_number()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update shorts_plans
     set next_short_number = next_short_number + 1
   where project_id = new.project_id
  returning next_short_number - 1 into new.number;
  if new.number is null then
    raise exception 'Set up the project''s Shorts first.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger shorts_assign_number before insert on shorts
  for each row execute function assign_short_number();

create or replace function assign_cam_number()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' and new.short_id is not distinct from old.short_id then
    new.short_number := old.short_number;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.short_id is not null then
    raise exception 'A cam stays in its short.' using errcode = '22023';
  end if;
  if new.short_id is null then
    new.short_number := null;
    return new;
  end if;

  update shorts
     set next_cam_number = next_cam_number + 1
   where id = new.short_id and project_id = new.project_id
  returning next_cam_number - 1 into new.short_number;
  if new.short_number is null then
    raise exception 'That short is not in this project.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger tasks_assign_cam_number before insert or update of short_id, short_number on tasks
  for each row execute function assign_cam_number();

-- What a cam renders is in its own project: a group, a sub-group, or a task filed
-- in one. A foreign key cannot say that.
create or replace function guard_cam_render()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.render_group_id is not null and not exists (
    select 1 from task_groups g
     where g.id = new.render_group_id and g.project_id = new.project_id
  ) then
    raise exception 'A cam renders a group in its own project.' using errcode = '22023';
  end if;
  if new.render_task_id is not null and not exists (
    select 1 from tasks t
     where t.id = new.render_task_id and t.project_id = new.project_id
       and t.group_id is not null
  ) then
    raise exception 'A cam renders a task filed in a group of its own project.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger tasks_guard_cam_render before insert or update of render_group_id, render_task_id on tasks
  for each row when (new.render_group_id is not null or new.render_task_id is not null)
  execute function guard_cam_render();

-- ---------------------------------------------------------------- who may --
-- Read as the project's groups are; written by whoever may manage its groups
-- (can_manage_task_groups, 0022). A cam is a task, so tasks' own rules apply to it.

alter table shorts_plans enable row level security;
alter table shorts enable row level security;

create policy shorts_plans_read on shorts_plans for select to authenticated
  using (((select is_global_manager()) or (project_id = any ((select my_project_ids())::uuid[]))));
create policy shorts_plans_insert on shorts_plans for insert to authenticated
  with check (can_manage_task_groups(project_id) and created_by = auth.uid());
create policy shorts_plans_update on shorts_plans for update to authenticated
  using (can_manage_task_groups(project_id))
  with check (can_manage_task_groups(project_id));
create policy shorts_plans_delete on shorts_plans for delete to authenticated
  using (can_manage_task_groups(project_id));

create policy shorts_read on shorts for select to authenticated
  using (((select is_global_manager()) or (project_id = any ((select my_project_ids())::uuid[]))));
create policy shorts_insert on shorts for insert to authenticated
  with check (can_manage_task_groups(project_id) and created_by = auth.uid());
create policy shorts_update on shorts for update to authenticated
  using (can_manage_task_groups(project_id))
  with check (can_manage_task_groups(project_id));
create policy shorts_delete on shorts for delete to authenticated
  using (can_manage_task_groups(project_id));

-- The numbers and counters belong to the triggers above, which run as the owner.
revoke insert, update on shorts_plans from authenticated;
grant insert (project_id, title, frames, description, client_supe_notes, lead_note,
              general_notes, created_by) on shorts_plans to authenticated;
grant update (title, frames, description, client_supe_notes, lead_note, general_notes)
  on shorts_plans to authenticated;

revoke insert, update on shorts from authenticated;
grant insert (id, project_id, title, frames, description, client_supe_notes, lead_note,
              general_notes, created_by) on shorts to authenticated;
grant update (title, frames, description, client_supe_notes, lead_note, general_notes)
  on shorts to authenticated;

notify pgrst, 'reload schema';
