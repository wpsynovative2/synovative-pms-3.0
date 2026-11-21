-- Clients are private to the people who deal with them.
--
--   * A client's name: Super Admin, Admin, Manager, Business Development and
--     Accounts & Finance. Everyone else gets no rows from clients, so nothing
--     can name one, whatever a screen does.
--   * The rest - mobile, WhatsApp and the Clients module with its emails: the
--     same people less Managers. The numbers are enforced here, by
--     crm_phone_numbers(). Email, designation and role share the row a Manager
--     reads, so for them the limit is on screen.
--
-- Projects, tasks and properties keep their client ids, which say nothing
-- without the row they point at. Company phone numbers are unchanged.
-- Mirrors canSeeClients / canSeeClientDetails in lib/permissions.ts.

create or replace function can_see_clients()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select is_global_manager() or is_business_exec() or is_finance();
$function$;

create or replace function can_see_client_details()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select auth_role() in ('super_admin', 'admin') or is_business_exec() or is_finance();
$function$;

drop policy clients_read on clients;
create policy clients_read on clients for select to authenticated
  using ((select is_active_member()) and (select can_see_clients()));

-- As in 0013, but for who gets a client's numbers.
create or replace function crm_phone_numbers()
returns table (kind text, id uuid, phone text, whatsapp text)
language sql stable security definer set search_path = public as $$
  select 'company', c.id, c.phone, ''::text
    from companies c
   where (is_global_manager() or is_business_exec()) and c.phone <> ''
  union all
  select 'client', k.id, k.mobile, k.whatsapp
    from clients k
   where can_see_client_details() and (k.mobile <> '' or k.whatsapp <> '');
$$;

revoke all on function crm_phone_numbers() from public;
grant execute on function crm_phone_numbers() to authenticated;

notify pgrst, 'reload schema';
