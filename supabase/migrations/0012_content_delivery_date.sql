-- Each Content Bank piece can carry the date it is to be delivered. It is set
-- from the piece's page, in place of the date it was created (which the
-- journey already shows).
--
-- set_content_delivery_date() lets the piece's writer set it, and the people
-- who plan the work: Super Admin, Admin, Managers, the project's Leader and a
-- Content Writers Team Leader. Plain updates to content_bank stay the writer's
-- alone (content_bank_update), so it goes through this function.
-- Mirrors canSetContentDelivery in lib/permissions.ts.

alter table content_bank add column if not exists delivery_date date;

comment on column content_bank.delivery_date is
  'When the piece is to be delivered. Optional; set by set_content_delivery_date().';

create or replace function set_content_delivery_date(p_content_id uuid, p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_entry content_bank%rowtype;
begin
  select * into v_entry from content_bank where id = p_content_id;
  if not found then
    raise exception 'That piece no longer exists.' using errcode = 'P0002';
  end if;
  if not (
    v_entry.created_by = auth.uid()
    or is_global_manager()
    or leads_project(v_entry.project_id)
    or is_content_team_leader()
  ) then
    raise exception 'Only the writer, the Project Leader, a Content Writers Team Leader or a manager can set the delivery date.'
      using errcode = '42501';
  end if;
  update content_bank set delivery_date = p_date where id = p_content_id;
end;
$$;

revoke all on function set_content_delivery_date(uuid, date) from public;
grant execute on function set_content_delivery_date(uuid, date) to authenticated;

notify pgrst, 'reload schema';
