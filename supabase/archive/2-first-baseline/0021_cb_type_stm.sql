-- Two CB types for a static creative that is then turned into motion: "Static
-- to Motion" and its festival twin "Festival STM". They behave the same; only
-- the name differs. Such a piece is allotted twice (0022): the static design,
-- then the reel editing.
--
-- On its own because a new enum value cannot be used in the same transaction
-- that adds it - run this before 0022.

alter type cb_type add value if not exists 'Static to Motion';
alter type cb_type add value if not exists 'Festival STM';
