-- A project template could only lay out ordinary tasks, so every content
-- batch ("5 reels, 3 statics") had to be raised by hand on each project. A
-- template task can now be a content task, with its count and the CB type of
-- each piece (0015), and the project form creates it as one.
--
-- task_templates takes the same columns because both tables are read and
-- written through one row shape; standalone task templates stay standard.

alter table project_template_tasks
  add column if not exists kind          text      not null default 'standard',
  add column if not exists content_count integer   not null default 0,
  add column if not exists content_types cb_type[] not null default '{}';

alter table task_templates
  add column if not exists kind          text      not null default 'standard',
  add column if not exists content_count integer   not null default 0,
  add column if not exists content_types cb_type[] not null default '{}';

alter table project_template_tasks
  drop constraint if exists project_template_tasks_kind_check,
  add constraint project_template_tasks_kind_check
    check (kind = any (array['standard'::text, 'content'::text])),
  drop constraint if exists project_template_tasks_content_count_check,
  add constraint project_template_tasks_content_count_check check (content_count >= 0);

alter table task_templates
  drop constraint if exists task_templates_kind_check,
  add constraint task_templates_kind_check
    check (kind = any (array['standard'::text, 'content'::text])),
  drop constraint if exists task_templates_content_count_check,
  add constraint task_templates_content_count_check check (content_count >= 0);

notify pgrst, 'reload schema';
