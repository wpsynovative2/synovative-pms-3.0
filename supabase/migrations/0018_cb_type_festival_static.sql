-- A CB type for a festival creative that stays static: "Festival Static". It
-- is one piece, allotted once like Static Design; only Festival STM goes on to
-- reel editing (is_stm_type).
--
-- On its own because a new enum value cannot be used in the same transaction
-- that adds it.

alter type cb_type add value if not exists 'Festival Static';
