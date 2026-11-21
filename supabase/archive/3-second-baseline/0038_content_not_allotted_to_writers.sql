-- A piece of content is allotted to be designed (and, for a two-part piece, edited
-- into a reel). That is never the writers' desk: someone in Content Writers /
-- Copywriters / Brand Strategists cannot be made a piece's designer or reel
-- editor.
--
-- Checked on every new allotment, however it is made (allot_content() or a direct
-- write). A part that only follows its task to the task's new assignee (0014)
-- keeps its task id and is not a new allotment, so reassigning a task is never
-- refused here. Pieces already allotted to a writer stay as they are until
-- someone allots them again.
--
-- Mirrors canBeAllottedContent in lib/permissions.ts and the allot dialog.

create or replace function may_be_allotted_content(p_profile_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select not exists (
    select 1 from profile_departments
     where profile_id = p_profile_id
       and department = 'Content Writers / Copywriters / Brand Strategists'
  );
$function$;

create or replace function guard_content_allottee()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.allotted_to is not null
     and (tg_op = 'INSERT' or new.allotted_task_id is distinct from old.allotted_task_id)
     and not may_be_allotted_content(new.allotted_to)
  then
    raise exception 'A content writer cannot be allotted a piece to design.' using errcode = '22023';
  end if;
  if new.motion_allotted_to is not null
     and (tg_op = 'INSERT' or new.motion_allotted_task_id is distinct from old.motion_allotted_task_id)
     and not may_be_allotted_content(new.motion_allotted_to)
  then
    raise exception 'A content writer cannot be allotted the reel editing of a piece.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger content_bank_guard_allottee
  before insert or update of allotted_to, allotted_task_id, motion_allotted_to, motion_allotted_task_id
  on content_bank
  for each row execute function guard_content_allottee();

notify pgrst, 'reload schema';
