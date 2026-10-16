-- A project can speak for several of the company's contacts, not just one.
--
-- projects.client_ids holds them in order. client_id stays as the first of
-- them, so everything that already reads it (OBC push-down, the recurring
-- copies, the Drive tree) keeps working, and a trigger keeps the two in step
-- whichever one a writer sets. Mirrors Project.clientIds in lib/types.ts.

alter table projects add column if not exists client_ids uuid[] not null default '{}';

update projects set client_ids = array[client_id]
 where client_id is not null and cardinality(client_ids) = 0;

create or replace function sync_project_clients()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if cardinality(new.client_ids) = 0 and new.series_source_id is not null then
      -- A recurring copy takes its blueprint's contacts.
      select p.client_ids into new.client_ids from projects p where p.id = new.series_source_id;
      new.client_ids := coalesce(new.client_ids, '{}');
    end if;
    if cardinality(new.client_ids) = 0 and new.client_id is not null then
      new.client_ids := array[new.client_id];
    end if;
    new.client_id := new.client_ids[1];
    return new;
  end if;

  if new.client_ids is distinct from old.client_ids then
    new.client_id := new.client_ids[1];
  elsif new.client_id is distinct from old.client_id then
    if new.client_id is null then
      -- The first contact was removed (or deleted); the next one steps up.
      new.client_ids := array_remove(old.client_ids, old.client_id);
      new.client_id := new.client_ids[1];
    else
      -- Something that only knows client_id (an OBC edit) set it outright.
      new.client_ids := array[new.client_id];
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists projects_sync_clients on projects;
create trigger projects_sync_clients
  before insert or update of client_id, client_ids on projects
  for each row execute function sync_project_clients();

-- A deleted contact leaves every project it was on, not only those where it
-- was first (the foreign key only covers client_id).
create or replace function drop_deleted_client_from_projects()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update projects set client_ids = array_remove(client_ids, old.id)
   where old.id = any (client_ids);
  return old;
end;
$$;

drop trigger if exists clients_leave_projects on clients;
create trigger clients_leave_projects
  after delete on clients
  for each row execute function drop_deleted_client_from_projects();

notify pgrst, 'reload schema';
