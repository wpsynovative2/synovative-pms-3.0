-- =============================================================================
-- Account seniority (§4.2) — who may edit whose account.
-- Run after 0006_operational_links.sql.
--
-- The guard in 0005 protected Super Admin accounts only, which left an HR Admin
-- free to rename, re-role, reset or deactivate an Admin. Account management now
-- follows a ladder: Super Admin > Admin > HR Admin. Each may edit accounts at or
-- below their own level and no higher.
-- =============================================================================

-- RLS decides *whose* row can be updated; this decides *which columns*, and now
-- *whose account outranks whom*.
--   · Anyone may change their own full_name and clear must_change_password.
--   · Super Admin / Admin / HR Admin may edit other people's accounts, but only
--     up to their own level.
--   · Only a Super Admin may grant or revoke the Admin or Super Admin role.
-- Server routes run with the service role (auth.uid() is null) and re-check
-- these rules in code before writing, so they pass straight through.
create or replace function guard_profile_update()
returns trigger language plpgsql set search_path = public as $$
declare
  v_actor app_role := auth_role();
  v_manager boolean := v_actor in ('super_admin', 'admin', 'hr_admin');
begin
  if auth.uid() is null then
    return new;
  end if;

  if not v_manager then
    if new.role is distinct from old.role
       or new.active is distinct from old.active
       or new.email is distinct from old.email
       or (new.must_change_password and not old.must_change_password) then
      raise exception 'You can only change your own name and password.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.role = 'super_admin' and v_actor <> 'super_admin' then
    raise exception 'Only a Super Admin can change a Super Admin account.'
      using errcode = '42501';
  end if;

  -- An HR Admin manages staff accounts, not the people who manage them.
  if old.role = 'admin' and v_actor not in ('super_admin', 'admin') then
    raise exception 'Only a Super Admin or an Admin can change an Admin account.'
      using errcode = '42501';
  end if;

  if new.role is distinct from old.role
     and (new.role in ('admin', 'super_admin') or old.role in ('admin', 'super_admin'))
     and v_actor <> 'super_admin' then
    raise exception 'Only a Super Admin can grant or remove the Admin role.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
