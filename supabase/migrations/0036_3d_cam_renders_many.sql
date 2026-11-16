-- A cam renders several things (Archi-3d.md §10): any mix of groups, sub-groups and
-- tasks filed in them, where 0035 allowed one. It is ready to render once every
-- task they cover is approved, worked out on screen as before.
--
-- The links are lists on the cam's own row rather than a table of their own, so
-- task_versions (0031) sees a change to them without being rewritten. A list cannot
-- carry a foreign key, so two triggers keep it honest: one checks what is written,
-- and one takes a deleted group or task out of every list that names it, as the
-- `on delete set null` of 0035 did.
--
-- Mirrors Task.renderGroupIds / renderTaskIds and camReadiness in lib/shorts.ts.

alter table tasks
  add column render_group_ids uuid[] not null default '{}',
  add column render_task_ids  uuid[] not null default '{}';

drop trigger tasks_guard_cam_render on tasks;

update tasks set render_group_ids = array[render_group_id] where render_group_id is not null;
update tasks set render_task_ids  = array[render_task_id]  where render_task_id  is not null;

alter table tasks drop constraint tasks_cam_only_fields;
alter table tasks drop constraint tasks_render_one_thing;
-- Takes their foreign keys and indexes with them.
alter table tasks drop column render_group_id, drop column render_task_id;

alter table tasks add constraint tasks_cam_only_fields check (
  short_id is not null
  or (frames is null and render_group_ids = '{}' and render_task_ids = '{}')
);

-- Read on every delete of a group or task, by the clean-up below.
create index tasks_render_group_ids_idx on tasks using gin (render_group_ids);
create index tasks_render_task_ids_idx on tasks using gin (render_task_ids);

-- Everything a cam renders is in its own project: a group or sub-group, or a task
-- filed in one. Named once each.
create or replace function guard_cam_render()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if exists (
    select 1 from unnest(new.render_group_ids) x
     where not exists (
       select 1 from task_groups g where g.id = x and g.project_id = new.project_id)
  ) then
    raise exception 'A cam renders groups in its own project.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(new.render_task_ids) x
     where not exists (
       select 1 from tasks t
        where t.id = x and t.project_id = new.project_id and t.group_id is not null)
  ) then
    raise exception 'A cam renders tasks filed in groups of its own project.'
      using errcode = '22023';
  end if;
  if cardinality(new.render_group_ids) <> (select count(distinct x) from unnest(new.render_group_ids) x)
     or cardinality(new.render_task_ids) <> (select count(distinct x) from unnest(new.render_task_ids) x)
  then
    raise exception 'A cam names each thing it renders once.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger tasks_guard_cam_render before insert or update of render_group_ids, render_task_ids on tasks
  for each row when (new.render_group_ids <> '{}' or new.render_task_ids <> '{}')
  execute function guard_cam_render();

-- A deleted group or task leaves every cam that rendered it; the cam stays.
create or replace function drop_cam_render_links()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_table_name = 'task_groups' then
    update tasks set render_group_ids = array_remove(render_group_ids, old.id)
     where render_group_ids @> array[old.id];
  else
    update tasks set render_task_ids = array_remove(render_task_ids, old.id)
     where render_task_ids @> array[old.id];
  end if;
  return null;
end;
$function$;

create trigger task_groups_drop_cam_renders after delete on task_groups
  for each row execute function drop_cam_render_links();
create trigger tasks_drop_cam_renders after delete on tasks
  for each row execute function drop_cam_render_links();

notify pgrst, 'reload schema';
