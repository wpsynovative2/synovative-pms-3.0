-- =============================================================================
-- A property can have more than one client contact. Run after
-- 0022_content_stage.sql.
--
-- A developer rarely sends one person: the marketing head, the site sales
-- manager and a coordinator may all speak for the same tower. The list lives in
-- property_clients, ordered by position.
--
-- properties.client_id is kept, as the *first* contact on that list. The Drive
-- route names the folder tree after it (Clients / <company> / <client> /
-- <property>), and existing OBCs and projects already point at it, so the app
-- writes both: the list here, and its first entry there.
-- =============================================================================

create table if not exists property_clients (
  property_id uuid not null references properties (id) on delete cascade,
  -- Deleting a contact takes them off every property they were listed on.
  client_id   uuid not null references clients (id) on delete cascade,
  position    integer not null default 0,
  primary key (property_id, client_id)
);

create index if not exists property_clients_client_idx on property_clients (client_id);

-- Every property that already names a contact keeps them, as the only one.
insert into property_clients (property_id, client_id, position)
select id, client_id, 0 from properties where client_id is not null
on conflict do nothing;

alter table property_clients enable row level security;

-- Same rule as the property itself and its unit mix (0014): everyone reads,
-- the CRM keepers write.
drop policy if exists property_clients_read on property_clients;
create policy property_clients_read on property_clients
  for select to authenticated using (is_active_member());

drop policy if exists property_clients_write on property_clients;
create policy property_clients_write on property_clients for all to authenticated
  using (can_manage_crm()) with check (can_manage_crm());

notify pgrst, 'reload schema';
