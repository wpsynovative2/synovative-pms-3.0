-- A 3D task can carry a thumbnail image, whatever its category. The image is on
-- Drive, in one folder for every project (agency-drive.ts, thumbnailsFolderId), and
-- the task holds where it is.
--
-- These columns are written by people, so the id alone proves nothing: the route
-- that serves a thumbnail checks that a task the caller can read names it, and that
-- the file really sits in that folder (/api/drive/thumbnails/[id]).

alter table tasks
  add column thumbnail_file_id text,
  add column thumbnail_url     text;

-- Shown as a link, so it can only ever be a link to a file on Drive.
alter table tasks add constraint tasks_thumbnail_url_check
  check (thumbnail_url ~ '^https://drive\.google\.com/file/d/[A-Za-z0-9_-]+/view$');

-- The serving route finds the task by the file, on every image shown.
create index tasks_thumbnail_file_id_idx on tasks (thumbnail_file_id)
  where thumbnail_file_id is not null;

notify pgrst, 'reload schema';
