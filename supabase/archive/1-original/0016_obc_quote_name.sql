-- =============================================================================
-- An OBC is known by its quote, not by a serial number.
-- Run after 0015_obc_line_details.sql.
--
-- "OBC-0002" means nothing to the sales team; "Raunak" is what they called the
-- deal in Zoho and what they will search for here. The generated code stays as
-- the fallback for an OBC raised by hand with no quote behind it, and as the
-- stable handle nothing else can collide with.
-- =============================================================================

alter table obcs
  add column if not exists zoho_quote_name text not null default '';
