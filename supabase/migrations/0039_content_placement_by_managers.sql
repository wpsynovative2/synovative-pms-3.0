-- A piece's placement (SMM or WhatsApp Share) can be changed from its page by
-- the global managers: Super Admin, Admin and Managers. The writer still sets it
-- in the piece's form.
--
-- Plain updates to content_bank stay the writer's alone (content_bank_update),
-- so it goes through this function, as the delivery date does (0012). A placement
-- is always one of the two: guard_content_placement (0004) refuses clearing it
-- once something is written, so this function never clears it either.
--
-- Mirrors canSetContentPlacement in lib/permissions.ts.

create or replace function set_content_placement(p_content_id uuid, p_placement content_placement)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_global_manager() then
    raise exception 'Only a Super Admin, an Admin or a Manager can change the placement.'
      using errcode = '42501';
  end if;
  if p_placement is null then
    raise exception 'Pick the content placement: SMM or WhatsApp Share.' using errcode = '23502';
  end if;
  update content_bank set placement = p_placement where id = p_content_id;
  if not found then
    raise exception 'That piece no longer exists.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function set_content_placement(uuid, content_placement) from public;
grant execute on function set_content_placement(uuid, content_placement) to authenticated;

notify pgrst, 'reload schema';
