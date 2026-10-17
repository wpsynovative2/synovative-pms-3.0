-- System Inventory: every piece of office computer hardware, where it is, and
-- who has it. Design: Archi-inventory.md. Needs 0010 first.
--
--   workstations      a desk setup, allotted to at most one person
--   inventory_items   every component - cabinets included - with a unique
--                     asset ID (SYN-RAM-0031) generated here and never reused
--   inventory_events  the history of every change, written only by triggers
--
-- Internal parts (processor, motherboard, RAM, storage, GPU, PSU) go inside a
-- cabinet; cabinets, monitors and peripherals go at a workstation; "Other"
-- goes either way. A component is in one place at most, and its status
-- follows: placed means In use, unplaced In use becomes Spare.
--
-- Super Admin and Admin manage everything. Managers see everything. Anyone
-- else sees only the workstation allotted to them and what is in it.
-- Mirrors canManageInventory / canViewInventory in lib/permissions.ts and
-- INVENTORY_CATEGORIES in lib/types.ts.

-- ------------------------------------------------------------ categories --

-- The asset ID prefix of each category; null for anything not on the list.
create or replace function inventory_category_prefix(p_category text)
returns text language sql immutable as $$
  select case p_category
    when 'Processor'    then 'CPU'
    when 'Motherboard'  then 'MBD'
    when 'RAM'          then 'RAM'
    when 'Storage'      then 'STO'
    when 'GPU'          then 'GPU'
    when 'Power supply' then 'PSU'
    when 'Cabinet'      then 'CAB'
    when 'Monitor'      then 'MON'
    when 'Keyboard'     then 'KBD'
    when 'Mouse'        then 'MOU'
    when 'UPS'          then 'UPS'
    when 'Accessory'    then 'ACC'
    when 'Other'        then 'OTH'
  end;
$$;

-- Where a category goes: 'cabinet' (inside one), 'workstation', or 'either'.
create or replace function inventory_category_place(p_category text)
returns text language sql immutable as $$
  select case
    when p_category in ('Processor', 'Motherboard', 'RAM', 'Storage', 'GPU', 'Power supply')
      then 'cabinet'
    when p_category = 'Other' then 'either'
    else 'workstation'
  end;
$$;

-- ---------------------------------------------------------------- tables --

create sequence if not exists workstation_code_seq;

create table workstations (
  id          uuid        not null default uuid_generate_v4(),
  code        text        not null,
  name        text        not null default '',
  location    text        not null default '',
  assigned_to uuid,
  assigned_at timestamptz,
  notes       text        not null default '',
  created_by  uuid        default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint workstations_pkey primary key (id),
  constraint workstations_code_key unique (code),
  constraint workstations_assigned_to_fkey
    foreign key (assigned_to) references profiles(id) on delete set null,
  constraint workstations_created_by_fkey
    foreign key (created_by) references profiles(id) on delete set null
);
create index workstations_assigned_to_idx on workstations (assigned_to);
comment on table workstations is
  'A desk setup: a cabinet, monitors and peripherals, allotted to at most one person. code (WS-001) is generated.';

-- The last number used per asset ID prefix. Never decremented, so a deleted
-- item's ID is never handed out again.
create table inventory_counters (
  prefix      text    not null,
  last_number integer not null,
  constraint inventory_counters_pkey primary key (prefix)
);

create table inventory_items (
  id             uuid          not null default uuid_generate_v4(),
  asset_tag      text          not null,
  category       text          not null,
  brand          text          not null default '',
  model          text          not null default '',
  serial_number  text          not null default '',
  specs          jsonb         not null default '{}',
  status         text          not null default 'Spare',
  cabinet_id     uuid,
  workstation_id uuid,
  purchase_date  date,
  price          numeric(12,2),
  vendor_id      uuid,
  warranty_until date,
  notes          text          not null default '',
  created_by     uuid          default auth.uid(),
  created_at     timestamptz   not null default now(),
  updated_at     timestamptz   not null default now(),
  constraint inventory_items_pkey primary key (id),
  constraint inventory_items_asset_tag_key unique (asset_tag),
  constraint inventory_items_category_check check (inventory_category_prefix(category) is not null),
  constraint inventory_items_status_check
    check (status in ('In use', 'Spare', 'Under repair', 'Retired')),
  constraint inventory_items_specs_object check (jsonb_typeof(specs) = 'object'),
  constraint inventory_items_price_check check (price is null or price >= 0),
  -- Inside a cabinet or at a workstation, never both.
  constraint inventory_items_one_place check (cabinet_id is null or workstation_id is null),
  constraint inventory_items_not_in_itself check (cabinet_id is distinct from id),
  -- Deleting a cabinet or a workstation never deletes what was in it: the
  -- parts become spare (the guard trigger sets the status).
  constraint inventory_items_cabinet_id_fkey
    foreign key (cabinet_id) references inventory_items(id) on delete set null,
  constraint inventory_items_workstation_id_fkey
    foreign key (workstation_id) references workstations(id) on delete set null,
  constraint inventory_items_vendor_id_fkey
    foreign key (vendor_id) references vendors(id) on delete set null,
  constraint inventory_items_created_by_fkey
    foreign key (created_by) references profiles(id) on delete set null
);
create index inventory_items_cabinet_idx on inventory_items (cabinet_id);
create index inventory_items_workstation_idx on inventory_items (workstation_id);
create index inventory_items_category_idx on inventory_items (category, status);
-- The manufacturer's serial catches a component entered twice. Blank is fine:
-- cheap peripherals often carry none.
create unique index inventory_items_serial_unique
  on inventory_items (lower(btrim(serial_number))) where btrim(serial_number) <> '';
comment on column inventory_items.asset_tag is
  'SYN-<prefix>-0001, generated on insert from inventory_counters; never changes and is never reused.';
comment on column inventory_items.specs is
  'Category-specific details (capacity_gb, size_inch, ...). Field list per category: INVENTORY_CATEGORIES in lib/types.ts.';

create table inventory_events (
  id             uuid        not null default uuid_generate_v4(),
  at             timestamptz not null default now(),
  actor          uuid,
  item_id        uuid,
  workstation_id uuid,
  kind           text        not null,
  subject        text        not null default '',
  from_label     text,
  to_label       text,
  note           text        not null default '',
  constraint inventory_events_pkey primary key (id),
  constraint inventory_events_actor_fkey
    foreign key (actor) references profiles(id) on delete set null,
  constraint inventory_events_item_id_fkey
    foreign key (item_id) references inventory_items(id) on delete set null,
  constraint inventory_events_workstation_id_fkey
    foreign key (workstation_id) references workstations(id) on delete set null
);
create index inventory_events_item_idx on inventory_events (item_id, at desc);
create index inventory_events_workstation_idx on inventory_events (workstation_id, at desc);
comment on table inventory_events is
  'History of the inventory, written only by triggers. subject and the labels are snapshots, so history still reads right after things move, are renamed or deleted.';

-- ----------------------------------------------------------- permissions --

create or replace function can_manage_inventory()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth_role() in ('super_admin', 'admin'), false);
$$;

create or replace function can_view_inventory()
returns boolean language sql stable security definer set search_path = public as $$
  select is_global_manager();
$$;

-- What the caller may see without can_view_inventory(): what is at a
-- workstation allotted to them, and the parts inside its cabinets.
create or replace function my_inventory_item_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(i.id), '{}')
    from inventory_items i
   where i.workstation_id in (select w.id from workstations w where w.assigned_to = auth.uid())
      or i.cabinet_id in (
           select c.id from inventory_items c
             join workstations w on w.id = c.workstation_id
            where w.assigned_to = auth.uid());
$$;

-- ---------------------------------------------------------------- labels --

create or replace function inventory_place_label(p_cabinet_id uuid, p_workstation_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_cabinet_id is not null then
      (select c.asset_tag || coalesce(' at ' || w.code, '')
         from inventory_items c left join workstations w on w.id = c.workstation_id
        where c.id = p_cabinet_id)
    when p_workstation_id is not null then
      (select w.code || case when w.name <> '' then ' ' || w.name else '' end
         from workstations w where w.id = p_workstation_id)
  end;
$$;

-- The note the calling function gave this change, if any.
create or replace function inventory_note()
returns text language sql stable as $$
  select coalesce(current_setting('inventory.note', true), '');
$$;

-- ---------------------------------------------------------------- guards --

create or replace function inventory_guard_item()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_prefix text;
  v_n      integer;
  v_place  text := inventory_category_place(new.category);
  v_host   record;
  v_moved  boolean;
begin
  if tg_op = 'INSERT' then
    -- The asset ID: one counter per prefix, taken under its row lock.
    v_prefix := inventory_category_prefix(new.category);
    insert into inventory_counters as c (prefix, last_number) values (v_prefix, 1)
      on conflict (prefix) do update set last_number = c.last_number + 1
      returning last_number into v_n;
    new.asset_tag := 'SYN-' || v_prefix || '-' || lpad(v_n::text, greatest(4, length(v_n::text)), '0');
    v_moved := true;
  else
    if new.asset_tag is distinct from old.asset_tag then
      raise exception 'An asset ID never changes.';
    end if;
    if new.category is distinct from old.category then
      raise exception 'The category of % is fixed. Delete it and add it again under the right category.',
        old.asset_tag;
    end if;
    new.updated_at := now();
    v_moved := new.cabinet_id is distinct from old.cabinet_id
            or new.workstation_id is distinct from old.workstation_id;
  end if;
  new.serial_number := btrim(new.serial_number);

  if new.cabinet_id is not null then
    if v_place = 'workstation' then
      raise exception 'A % goes at a workstation, not inside a cabinet.', lower(new.category);
    end if;
    select category, status, asset_tag into v_host from inventory_items where id = new.cabinet_id;
    if v_host.category <> 'Cabinet' then
      raise exception 'Parts can only go inside a cabinet, and % is a %.',
        v_host.asset_tag, lower(v_host.category);
    end if;
    if v_moved and v_host.status = 'Retired' then
      raise exception '% is retired; nothing can be installed in it.', v_host.asset_tag;
    end if;
  end if;
  if new.workstation_id is not null and v_place = 'cabinet' then
    raise exception 'A % goes inside a cabinet, not straight at a workstation.', lower(new.category);
  end if;

  -- Status follows placement.
  if new.cabinet_id is not null or new.workstation_id is not null then
    if new.status in ('Under repair', 'Retired') then
      raise exception '% is %. Take it out before changing that, or mark it Spare first.',
        new.asset_tag, lower(new.status);
    end if;
    new.status := 'In use';
  elsif new.status = 'In use' then
    new.status := 'Spare';
  end if;

  if new.category = 'Cabinet' and new.status = 'Retired'
     and tg_op = 'UPDATE' and exists (select 1 from inventory_items where cabinet_id = new.id) then
    raise exception 'Take the parts out of % before retiring it.', new.asset_tag;
  end if;
  return new;
end;
$$;

create trigger inventory_items_guard
  before insert or update on inventory_items
  for each row execute function inventory_guard_item();

create or replace function inventory_guard_workstation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_n bigint;
begin
  if tg_op = 'INSERT' then
    v_n := nextval('workstation_code_seq');
    new.code := 'WS-' || lpad(v_n::text, greatest(3, length(v_n::text)), '0');
  else
    if new.code is distinct from old.code then
      raise exception 'A workstation code never changes.';
    end if;
    new.updated_at := now();
  end if;
  if new.assigned_to is not null
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    if not exists (select 1 from profiles where id = new.assigned_to and active) then
      raise exception 'A workstation can only be allotted to an active member.';
    end if;
  end if;
  if tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to then
    new.assigned_at := case when new.assigned_to is null then null else now() end;
  end if;
  new.name := btrim(new.name);
  return new;
end;
$$;

create trigger workstations_guard
  before insert or update on workstations
  for each row execute function inventory_guard_workstation();

-- --------------------------------------------------------------- history --

create or replace function inventory_log_item()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_from    text;
  v_to      text;
  v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    insert into inventory_events (actor, item_id, kind, subject, to_label, note)
    values (auth.uid(), new.id, 'added', new.asset_tag,
            coalesce(inventory_place_label(new.cabinet_id, new.workstation_id), new.status),
            inventory_note());
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into inventory_events (actor, item_id, kind, subject, from_label, note)
    values (auth.uid(), null, 'deleted', old.asset_tag,
            coalesce(inventory_place_label(old.cabinet_id, old.workstation_id), old.status),
            old.category || coalesce(' ' || nullif(btrim(old.brand || ' ' || old.model), ''), ''));
    return old;
  end if;

  if new.cabinet_id is distinct from old.cabinet_id
     or new.workstation_id is distinct from old.workstation_id then
    v_from := coalesce(inventory_place_label(old.cabinet_id, old.workstation_id), old.status);
    v_to   := coalesce(inventory_place_label(new.cabinet_id, new.workstation_id), new.status);
    -- Filed under the desk it came from or went to, so a desk's history shows
    -- parts that have left it - unless that desk is the one being deleted.
    insert into inventory_events (actor, item_id, workstation_id, kind, subject, from_label, to_label, note)
    values (auth.uid(), new.id,
            (select w.id from workstations w
              where w.id = coalesce(
                new.workstation_id,
                (select c.workstation_id from inventory_items c where c.id = new.cabinet_id),
                old.workstation_id,
                (select c.workstation_id from inventory_items c where c.id = old.cabinet_id))),
            case when new.cabinet_id is not null then 'installed'
                 when new.workstation_id is not null then 'placed'
                 else 'removed' end,
            new.asset_tag, v_from, v_to, inventory_note());
  elsif new.status is distinct from old.status then
    insert into inventory_events (actor, item_id, kind, subject, from_label, to_label, note)
    values (auth.uid(), new.id, 'status', new.asset_tag, old.status, new.status, inventory_note());
  end if;

  if new.brand is distinct from old.brand then v_changed := v_changed || 'brand'::text; end if;
  if new.model is distinct from old.model then v_changed := v_changed || 'model'::text; end if;
  if new.serial_number is distinct from old.serial_number then v_changed := v_changed || 'serial number'::text; end if;
  if new.specs is distinct from old.specs then v_changed := v_changed || 'specs'::text; end if;
  if new.purchase_date is distinct from old.purchase_date then v_changed := v_changed || 'purchase date'::text; end if;
  if new.price is distinct from old.price then v_changed := v_changed || 'price'::text; end if;
  if new.vendor_id is distinct from old.vendor_id then v_changed := v_changed || 'vendor'::text; end if;
  if new.warranty_until is distinct from old.warranty_until then v_changed := v_changed || 'warranty'::text; end if;
  if new.notes is distinct from old.notes then v_changed := v_changed || 'notes'::text; end if;
  if cardinality(v_changed) > 0 then
    insert into inventory_events (actor, item_id, kind, subject, note)
    values (auth.uid(), new.id, 'edited', new.asset_tag, 'Changed ' || array_to_string(v_changed, ', '));
  end if;
  return new;
end;
$$;

create trigger inventory_items_log
  after insert or update or delete on inventory_items
  for each row execute function inventory_log_item();

create or replace function inventory_log_workstation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old text;
  v_new text;
begin
  if tg_op = 'INSERT' then
    insert into inventory_events (actor, workstation_id, kind, subject, note)
    values (auth.uid(), new.id, 'added', new.code, new.name);
  elsif tg_op = 'DELETE' then
    insert into inventory_events (actor, workstation_id, kind, subject, note)
    values (auth.uid(), null, 'deleted', old.code, old.name);
    return old;
  end if;

  if (tg_op = 'INSERT' and new.assigned_to is not null)
     or (tg_op = 'UPDATE' and new.assigned_to is distinct from old.assigned_to) then
    v_old := case when tg_op = 'UPDATE' then (select full_name from profiles where id = old.assigned_to) end;
    v_new := (select full_name from profiles where id = new.assigned_to);
    insert into inventory_events (actor, workstation_id, kind, subject, from_label, to_label, note)
    values (auth.uid(), new.id,
            case when new.assigned_to is null then 'unassigned' else 'assigned' end,
            new.code, v_old, v_new, inventory_note());

    -- Tell both people. The one who did it already knows.
    if new.assigned_to is not null and new.assigned_to is distinct from auth.uid() then
      insert into notifications (profile_id, type, title, body, href)
      values (new.assigned_to, 'inventory_assigned', 'Workstation allotted to you',
              new.code || coalesce(' (' || nullif(new.name, '') || ')', '')
                || ' is now yours. See what is in it on your profile.',
              '/profile');
    end if;
    if tg_op = 'UPDATE' and old.assigned_to is not null
       and old.assigned_to is distinct from auth.uid() then
      insert into notifications (profile_id, type, title, body, href)
      values (old.assigned_to, 'inventory_assigned', 'Workstation taken back',
              new.code || coalesce(' (' || nullif(new.name, '') || ')', '')
                || ' is no longer allotted to you.',
              '/profile');
    end if;
  end if;
  return new;
end;
$$;

create trigger workstations_log
  after insert or update or delete on workstations
  for each row execute function inventory_log_workstation();

-- ------------------------------------------------------------- functions --
-- Moves go through these, so the app never sets two placement columns itself
-- and every move can carry a note into the history.

create or replace function inventory_check_manager()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not can_manage_inventory() then
    raise exception 'Only a Super Admin or Admin can change the inventory.'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function inventory_install(p_item_id uuid, p_cabinet_id uuid, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  perform inventory_check_manager();
  perform set_config('inventory.note', coalesce(p_note, ''), true);
  update inventory_items set cabinet_id = p_cabinet_id, workstation_id = null where id = p_item_id;
  if not found then raise exception 'That component no longer exists.'; end if;
end;
$$;

create or replace function inventory_place(p_item_id uuid, p_workstation_id uuid, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  perform inventory_check_manager();
  perform set_config('inventory.note', coalesce(p_note, ''), true);
  update inventory_items set workstation_id = p_workstation_id, cabinet_id = null where id = p_item_id;
  if not found then raise exception 'That component no longer exists.'; end if;
end;
$$;

-- Take a component out (if it is anywhere) and set what it is now: Spare,
-- Under repair or Retired. Also how an unplaced component changes status.
create or replace function inventory_remove(p_item_id uuid, p_status text default 'Spare', p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  perform inventory_check_manager();
  if p_status not in ('Spare', 'Under repair', 'Retired') then
    raise exception 'A component that is taken out is Spare, Under repair or Retired.';
  end if;
  perform set_config('inventory.note', coalesce(p_note, ''), true);
  update inventory_items
     set cabinet_id = null, workstation_id = null, status = p_status
   where id = p_item_id;
  if not found then raise exception 'That component no longer exists.'; end if;
end;
$$;

create or replace function inventory_assign_workstation(p_workstation_id uuid, p_profile_id uuid, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  perform inventory_check_manager();
  perform set_config('inventory.note', coalesce(p_note, ''), true);
  update workstations set assigned_to = p_profile_id where id = p_workstation_id;
  if not found then raise exception 'That workstation no longer exists.'; end if;
end;
$$;

-- ------------------------------------------------------ row level security --

alter table workstations enable row level security;
alter table inventory_items enable row level security;
alter table inventory_events enable row level security;
alter table inventory_counters enable row level security;

create policy workstations_read on workstations for select to authenticated
  using ((select can_view_inventory()) or assigned_to = (select auth.uid()));
create policy workstations_write on workstations for all to authenticated
  using ((select can_manage_inventory()))
  with check ((select can_manage_inventory()));

create policy inventory_items_read on inventory_items for select to authenticated
  using ((select can_view_inventory()) or id = any ((select my_inventory_item_ids())::uuid[]));
create policy inventory_items_write on inventory_items for all to authenticated
  using ((select can_manage_inventory()))
  with check ((select can_manage_inventory()));

create policy inventory_events_read on inventory_events for select to authenticated
  using ((select can_view_inventory()));

-- ---------------------------------------------------------------- grants --
-- Supabase grants every privilege on a new table to anon and authenticated.
-- History is read-only to everyone; the counters are nobody's business.

revoke all on workstations, inventory_items, inventory_events, inventory_counters from anon;
revoke insert, update, delete, truncate on inventory_events from authenticated;
revoke all on inventory_counters from authenticated;

revoke all on function inventory_install(uuid, uuid, text) from public;
revoke all on function inventory_place(uuid, uuid, text) from public;
revoke all on function inventory_remove(uuid, text, text) from public;
revoke all on function inventory_assign_workstation(uuid, uuid, text) from public;
grant execute on function inventory_install(uuid, uuid, text) to authenticated;
grant execute on function inventory_place(uuid, uuid, text) to authenticated;
grant execute on function inventory_remove(uuid, text, text) to authenticated;
grant execute on function inventory_assign_workstation(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
