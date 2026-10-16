-- =============================================================================
-- "Ready To Move" reads as "Ready To Design". Run after 0026_content_slots.sql.
--
-- The first stage a piece reaches is the writer saying the copy is done and
-- the designer can start, so it is named for that. Renaming the enum value
-- keeps every row already at that stage; nothing else refers to the word.
-- =============================================================================

do $$
begin
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'content_stage' and e.enumlabel = 'Ready To Move'
  ) then
    alter type content_stage rename value 'Ready To Move' to 'Ready To Design';
  end if;
end
$$;

comment on column content_bank.stage is
  'Where the piece has got to after writing: Ready To Design, Design Completed, Scheduled, Cancelled, Carry Forwarded. Null until the writer sets it.';

notify pgrst, 'reload schema';
