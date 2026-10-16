-- The notification the Websites module (0020) sends ahead of a site's annual
-- renewal. On its own because a new enum value cannot be used in the same
-- transaction that adds it - run this before 0020.

alter type notification_type add value if not exists 'website_renewal';
