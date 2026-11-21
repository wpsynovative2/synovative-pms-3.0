-- Recent changes on a project, a task and a piece of content: who did what, and
-- when - "Due date 12 Nov -> 15 Nov", "Status Ready To Design -> Design
-- Completed". Asked for on 20 Nov 2026; each record keeps its last five.
--
-- * Written only by log_change(), an after-trigger on projects, tasks and
--   content_bank, so it holds however the row is changed: the app, an RPC, a
--   trigger (an approval moving pieces, 0037) or a scheduled job.
-- * One entry per action. Everything one request changes on a row - its own
--   update and whatever triggers then do to the same row - is folded into one
--   entry (same transaction, txid_current()). A row created in that request
--   reads "created" and nothing more.
-- * Bookkeeping columns are left out (stamps, counters, recurrence cursors,
--   Drive folder ids, a piece's journey dates and its scheduled_on mirror, 0046).
--   Long text - descriptions, on pic, caption, notes, reference links - is
--   recorded as edited, without the text.
-- * changed_by is the signed-in person; null for a scheduled job or the SQL
--   editor, shown as "System".
-- * Readable by whoever can see the record itself: the policy asks the record's
--   own table, whose row level security decides. Nobody writes it directly.
-- * Deleting the record deletes its history.
--
-- Read by loadChangeLog in lib/data/db.ts; labelled by lib/change-log.ts.

create table change_log (
  id          uuid        not null default uuid_generate_v4(),
  entity_type text        not null,
  entity_id   uuid        not null,
  action      text        not null,
  -- {"due_date": ["2026-11-12", "2026-11-15"], "description": [null, null]}
  changes     jsonb       not null default '{}',
  changed_by  uuid        references profiles (id) on delete set null,
  changed_at  timestamptz not null default clock_timestamp(),
  tx          bigint      not null default txid_current(),
  constraint change_log_pkey primary key (id),
  constraint change_log_entity_type_check check (entity_type in ('project', 'task', 'content')),
  constraint change_log_action_check check (action in ('created', 'updated'))
);
create index change_log_entity_idx on change_log (entity_type, entity_id, changed_at desc);

-- How many entries each record keeps.
create or replace function change_log_keep()
 returns integer
 language sql
 immutable
as $function$
  select 5;
$function$;

create or replace function log_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_type    text := tg_argv[0];
  v_skip    text[];
  v_body    text[];
  v_old     jsonb;
  v_new     jsonb;
  v_changes jsonb := '{}';
  v_last    change_log%rowtype;
  v_merged  jsonb;
  k         text;
begin
  if tg_op = 'DELETE' then
    delete from change_log where entity_type = v_type and entity_id = old.id;
    return null;
  end if;

  if tg_op = 'UPDATE' then
    v_skip := array['id', 'created_at', 'created_by', 'updated_at'] || case v_type
      when 'project' then array[
        'recurrence_anchor', 'recurrence_cursor', 'series_source_id', 'series_index',
        'series_date', 'next_group_number', 'drive_folder_id', 'drive_csf_folder_id',
        'drive_team3d_folder_id']
      when 'task' then array[
        'recurrence_anchor', 'recurrence_cursor', 'series_source_id', 'series_index',
        'series_date', 'group_number', 'short_number', 'depends_on_task_id',
        'thumbnail_file_id', 'thumbnail_url']
      else array[
        'started_by', 'ready_at', 'allotted_at', 'completed_at', 'scheduled_on', 'slot']
    end;
    v_body := array[
      'description', 'on_pic', 'caption', 'reference_links', 'client_supe_notes',
      'shots_brief', 'camera_angles', 'lead_note', 'general_notes'];

    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    for k in select jsonb_object_keys(v_new) loop
      continue when k = any (v_skip);
      if (v_new -> k) is distinct from (v_old -> k) then
        v_changes := v_changes || jsonb_build_object(
          k,
          case when k = any (v_body) then '[null, null]'::jsonb
               else jsonb_build_array(v_old -> k, v_new -> k) end);
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null;
    end if;

    -- Already written to in this request: fold this into that entry.
    select * into v_last
      from change_log
     where entity_type = v_type and entity_id = new.id and tx = txid_current()
     order by changed_at desc
     limit 1;
    if found then
      if v_last.action = 'created' then
        return null;
      end if;
      v_merged := v_last.changes;
      for k in select jsonb_object_keys(v_changes) loop
        v_merged := v_merged || jsonb_build_object(
          k,
          jsonb_build_array(
            coalesce(v_last.changes -> k -> 0, v_changes -> k -> 0),
            v_changes -> k -> 1));
        -- Changed and changed back: nothing to show.
        if k <> all (v_body) and (v_merged -> k -> 0) is not distinct from (v_merged -> k -> 1) then
          v_merged := v_merged - k;
        end if;
      end loop;
      if v_merged = '{}'::jsonb then
        delete from change_log where id = v_last.id;
      else
        update change_log set changes = v_merged where id = v_last.id;
      end if;
      return null;
    end if;
  end if;

  insert into change_log (entity_type, entity_id, action, changes, changed_by)
  values (v_type, new.id, case when tg_op = 'INSERT' then 'created' else 'updated' end,
          v_changes, auth.uid());

  -- Keep the newest few.
  delete from change_log c
   where c.entity_type = v_type and c.entity_id = new.id
     and c.id not in (
       select x.id from change_log x
        where x.entity_type = v_type and x.entity_id = new.id
        order by x.changed_at desc, x.id desc
        limit change_log_keep());
  return null;
end;
$function$;

create trigger projects_log_change after insert or update or delete on projects
  for each row execute function log_change('project');
create trigger tasks_log_change after insert or update or delete on tasks
  for each row execute function log_change('task');
create trigger content_bank_log_change after insert or update or delete on content_bank
  for each row execute function log_change('content');

alter table change_log enable row level security;

create policy change_log_read on change_log for select to authenticated
  using (
    case entity_type
      when 'project' then exists (select 1 from projects p where p.id = entity_id)
      when 'task'    then exists (select 1 from tasks t where t.id = entity_id)
      when 'content' then exists (select 1 from content_bank c where c.id = entity_id)
      else false
    end
  );

revoke insert, update, delete on change_log from anon, authenticated;
revoke all on change_log from anon;

notify pgrst, 'reload schema';
