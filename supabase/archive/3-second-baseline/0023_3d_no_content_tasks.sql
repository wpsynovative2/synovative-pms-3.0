-- A 3D project holds no content tasks (Archi-3d.md §1): the forms no longer offer
-- them, and this stops anything else raising one.
--
-- Only a new content task is refused. An older project marked 3D keeps the content
-- tasks it already has, untouched and still open on its ordinary project page, but
-- they cannot be split, since a split raises a new task.

create or replace function guard_3d_content_task()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if is_3d_project(new.project_id) then
    raise exception 'A 3D project cannot have content tasks.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger tasks_guard_3d_content before insert on tasks
  for each row when (new.kind = 'content' and new.project_id is not null)
  execute function guard_3d_content_task();

notify pgrst, 'reload schema';
