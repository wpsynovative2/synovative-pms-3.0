-- =============================================================================
-- A content task arrives with its pieces already laid out. Run after
-- 0025_content_allotment_task.sql.
--
-- "Five reels" used to be a task with a target and an empty list; the writer
-- added pieces until the bar filled. Now the five exist the moment the task
-- does - "<task> Count 1" ... "<task> Count 5" - and the writer fills them in.
-- Anything written beyond the target is an *extra*, and reads as "3/5 + 2".
--
--   * content_bank.title  - every piece has a name now, not only a caption.
--   * content_bank.slot   - 1..content_count for the pieces the task asked
--                           for; null for extras and for library pieces.
--
-- The database keeps the slots in step with the task, because the people who
-- raise tasks (managers) may not write content, and the person who may (the
-- assignee) is not the one creating it:
--   * a slot belongs to the task's assignee, so they can fill it in; an empty
--     slot follows the task when it is handed to someone else, a written one
--     stays with whoever wrote it;
--   * raising the target adds slots, lowering it removes *empty* slots from
--     the end - written work is never deleted;
--   * renaming the task renames slots still carrying the generated title;
--   * a slot cannot be deleted while it is part of the target - clear it.
-- =============================================================================

alter table content_bank
  add column if not exists title text not null default '',
  add column if not exists slot  integer check (slot is null or slot >= 1);

create unique index if not exists content_bank_task_slot_unique
  on content_bank (task_id, slot) where slot is not null;

-- Has anything been written in this piece? Mirrors isContentEmpty in
-- lib/types.ts: rich text counts as empty once its tags are stripped.
create or replace function content_is_empty(c content_bank)
returns boolean language sql immutable as $$
  select btrim(regexp_replace(coalesce(c.on_pic, ''), '<[^>]*>|&nbsp;', '', 'g')) = ''
     and btrim(regexp_replace(coalesce(c.description, ''), '<[^>]*>|&nbsp;', '', 'g')) = ''
     and btrim(coalesce(c.caption, '')) = ''
     and coalesce(array_length(c.reference_links, 1), 0) = 0;
$$;

create or replace function content_slot_title(p_task_title text, p_slot integer)
returns text language sql immutable as $$
  select left(btrim(p_task_title), 180) || ' Count ' || p_slot;
$$;

-- Bring one task's slots in line with its kind, target, assignee and title.
create or replace function sync_content_slots(p_task_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t tasks%rowtype;
  n integer;
begin
  select * into t from tasks where id = p_task_id;
  if not found or t.project_id is null then
    return;
  end if;

  if t.kind <> 'content' then
    -- No longer a batch: empty slots go, written ones become ordinary pieces.
    delete from content_bank c
     where c.task_id = t.id and c.slot is not null and content_is_empty(c);
    update content_bank set slot = null where task_id = t.id and slot is not null;
    return;
  end if;

  -- Lowering the target: empty slots past it go, written ones become extras.
  delete from content_bank c
   where c.task_id = t.id and c.slot > t.content_count and content_is_empty(c);
  update content_bank set slot = null
   where task_id = t.id and slot > t.content_count;

  -- Raising it, or a new task: create whatever is missing.
  for n in 1 .. t.content_count loop
    if not exists (select 1 from content_bank where task_id = t.id and slot = n) then
      insert into content_bank
        (project_id, task_id, slot, title, type, billing_type, created_by)
      values
        (t.project_id, t.id, n, content_slot_title(t.title, n),
         'Static Design', 'Count', t.assignee_id);
    end if;
  end loop;

  -- Empty slots are the assignee's to fill.
  update content_bank c
     set created_by = t.assignee_id
   where c.task_id = t.id and c.slot is not null and content_is_empty(c)
     and c.created_by is distinct from t.assignee_id;
end;
$$;

create or replace function tasks_sync_content_slots()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.kind is not distinct from old.kind
       and new.content_count is not distinct from old.content_count
       and new.assignee_id is not distinct from old.assignee_id
       and new.title is not distinct from old.title then
      return null;
    end if;
    -- Slots still wearing the generated name follow a renamed task.
    if new.title is distinct from old.title then
      update content_bank
         set title = content_slot_title(new.title, slot)
       where task_id = new.id and slot is not null
         and title = content_slot_title(old.title, slot);
    end if;
  end if;
  perform sync_content_slots(new.id);
  return null;
end;
$$;

drop trigger if exists tasks_content_slots on tasks;
create trigger tasks_content_slots
  after insert or update of kind, content_count, assignee_id, title on tasks
  for each row execute function tasks_sync_content_slots();

-- A deleted task takes its empty slots with it; written pieces stay in the
-- library, as they always did (task_id is set null by the foreign key).
create or replace function tasks_drop_empty_slots()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from content_bank c
   where c.task_id = old.id and c.slot is not null and content_is_empty(c);
  return old;
end;
$$;

drop trigger if exists tasks_drop_content_slots on tasks;
create trigger tasks_drop_content_slots
  before delete on tasks
  for each row execute function tasks_drop_empty_slots();

-- A slot is part of what the task asked for; it is cleared, not deleted.
-- The functions above remove slots themselves and are let through.
create or replace function guard_content_slot_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.slot is not null and pg_trigger_depth() = 1 and auth.uid() is not null then
    raise exception 'This piece is one the task asked for. Clear it instead of deleting it.'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists content_bank_guard_slot_delete on content_bank;
create trigger content_bank_guard_slot_delete
  before delete on content_bank
  for each row execute function guard_content_slot_delete();

-- --------------------------------------------------------------- backfill --

-- Pieces already written on a content task fill its slots first, oldest
-- first; anything past the target stays an extra. Then the gaps are created.
with ranked as (
  select c.id,
         row_number() over (partition by c.task_id order by c.created_at, c.id) as n,
         t.content_count,
         t.title as task_title
    from content_bank c
    join tasks t on t.id = c.task_id
   where t.kind = 'content' and c.slot is null
     and not exists (select 1 from content_bank s where s.task_id = t.id and s.slot is not null)
)
update content_bank c
   set slot = r.n,
       title = case when btrim(c.title) = '' then content_slot_title(r.task_title, r.n::integer)
                    else c.title end
  from ranked r
 where c.id = r.id and r.n <= r.content_count;

do $$
declare
  v_id uuid;
begin
  for v_id in select id from tasks where kind = 'content' and project_id is not null loop
    perform sync_content_slots(v_id);
  end loop;
end
$$;

comment on column content_bank.title is
  'The piece''s name. Slots are named "<task> Count <n>"; the writer may rename them.';
comment on column content_bank.slot is
  'Which of the content task''s target pieces this is (1..content_count). Null for extras and library pieces.';

notify pgrst, 'reload schema';
