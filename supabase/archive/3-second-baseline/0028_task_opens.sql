-- When someone opens a task, for the Activity tab on a person's page: what they
-- looked at, alongside the timer, submissions and reviews already on record.
--
-- Written only by log_task_open(), as the caller and only for a task they can
-- see. Reopening the same task within ten minutes adds nothing, so flicking
-- between a list and a drawer doesn't fill the table. Read by the people who
-- may open someone's page: global managers and HR (canAddUsers / isGlobalManager).

create table task_opens (
  id         uuid        not null default uuid_generate_v4(),
  profile_id uuid        not null references profiles (id) on delete cascade,
  task_id    uuid        not null references tasks (id) on delete cascade,
  opened_at  timestamptz not null default now(),
  constraint task_opens_pkey primary key (id)
);
create index task_opens_profile_opened_idx on task_opens (profile_id, opened_at desc);
create index task_opens_task_id_idx on task_opens (task_id);

create or replace function can_view_user_activity()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select auth_role() in ('super_admin', 'admin', 'manager', 'hr_admin');
$function$;

create or replace function log_task_open(p_task_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not can_see_task(p_task_id) then
    return;
  end if;
  if exists (
    select 1 from task_opens
     where profile_id = auth.uid()
       and task_id = p_task_id
       and opened_at > now() - interval '10 minutes'
  ) then
    return;
  end if;
  insert into task_opens (profile_id, task_id) values (auth.uid(), p_task_id);
end;
$function$;

alter table task_opens enable row level security;

create policy task_opens_read on task_opens for select to authenticated
  using ((select can_view_user_activity()));

revoke insert, update, delete on task_opens from anon, authenticated;
revoke all on task_opens from anon;
revoke all on function log_task_open(uuid) from public;
grant execute on function log_task_open(uuid) to authenticated;
grant execute on function can_view_user_activity() to authenticated;

-- A trail of what people looked at is only useful for a while.
select cron.schedule(
  'prune-old-task-opens',
  '10 20 * * 0',
  $job$ delete from task_opens where opened_at < now() - interval '90 days'; $job$
);

notify pgrst, 'reload schema';
