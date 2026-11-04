-- The name someone gives a task's thumbnail. It is optional, shown under the image,
-- and also names the file on Drive, where every project shares one folder (0026).

alter table tasks add column thumbnail_name text not null default '';

notify pgrst, 'reload schema';
