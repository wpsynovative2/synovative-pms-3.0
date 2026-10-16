-- Phone numbers in the CRM are for Super Admin, Admin and Managers only.
--
--   * companies.phone, clients.mobile and clients.whatsapp can no longer be
--     selected by the browser: select is granted column by column, those
--     three left out. Everything else reads as before.
--   * crm_phone_numbers() hands them back to global managers, and returns
--     nothing for anyone else.
--
-- Writing is unchanged: whoever may add or edit a company or client still can,
-- and the app only sends a number when the editor is allowed to see it.
-- Mirrors canSeeCrmPhones in lib/permissions.ts.

revoke select on companies from anon, authenticated;
grant select (
  id, name, legal_name, gstin, pan, rera_promoter_id, address, city, website,
  email, logo_url, account_owner_id, status, created_by, created_at, updated_at,
  nature
) on companies to authenticated;

revoke select on clients from anon, authenticated;
grant select (
  id, company_id, full_name, designation, email, role, status, created_by,
  created_at, updated_at
) on clients to authenticated;

create or replace function crm_phone_numbers()
returns table (kind text, id uuid, phone text, whatsapp text)
language sql stable security definer set search_path = public as $$
  select 'company', c.id, c.phone, ''::text
    from companies c
   where is_global_manager() and c.phone <> ''
  union all
  select 'client', k.id, k.mobile, k.whatsapp
    from clients k
   where is_global_manager() and (k.mobile <> '' or k.whatsapp <> '');
$$;

revoke all on function crm_phone_numbers() from public;
grant execute on function crm_phone_numbers() to authenticated;

notify pgrst, 'reload schema';
