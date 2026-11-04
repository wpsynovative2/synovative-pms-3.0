-- What the 3D team records on its work (Archi-3d.md §3).
--
-- A task says which category of work it is and which software it is done in. The
-- forms require both, but the columns stay nullable: a task may have been in the
-- project before it was marked 3D, and it stays valid until someone next edits it.
--
-- Groups and tasks both carry the same three free-text notes. They are optional.
--
-- A 3D project's tasks belong to the 3D Artists department, so the form no longer
-- asks. An older project marked 3D keeps the tasks it has, in whichever department
-- they are. Mirrors TaskFormModal / ProjectFormModal and THREE_D_CATEGORIES /
-- THREE_D_SOFTWARE in lib/master-data.ts.

alter table tasks
  add column three_d_category  text,
  add column three_d_software  text,
  add column client_supe_notes text not null default '',
  add column lead_note         text not null default '',
  add column general_notes     text not null default '';

alter table tasks add constraint tasks_three_d_category_check
  check (three_d_category in ('Modeling', 'Texture', 'Lighting'));
alter table tasks add constraint tasks_three_d_software_check
  check (three_d_software in ('Blender', 'Unreal'));

alter table task_groups
  add column client_supe_notes text not null default '',
  add column lead_note         text not null default '',
  add column general_notes     text not null default '';

-- task_groups is written column by column (0022), so the new ones need naming.
grant insert (client_supe_notes, lead_note, general_notes) on task_groups to authenticated;
grant update (client_supe_notes, lead_note, general_notes) on task_groups to authenticated;

create or replace function guard_3d_task_department()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- A task already there keeps its department until someone tries to change it.
  if tg_op = 'UPDATE'
     and new.department = old.department
     and new.project_id is not distinct from old.project_id then
    return new;
  end if;
  if is_3d_project(new.project_id) then
    raise exception 'A 3D project''s tasks belong to the 3D Artists department.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger tasks_guard_3d_department before insert or update of department, project_id on tasks
  for each row when (new.project_id is not null and new.department <> '3D Artists')
  execute function guard_3d_task_department();

notify pgrst, 'reload schema';
