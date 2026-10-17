-- System Inventory (0011) tells a person when a workstation is allotted to
-- them or taken back. Its own file: Postgres cannot use a new enum value in
-- the transaction that adds it. Run before 0011.

alter type notification_type add value if not exists 'inventory_assigned';
