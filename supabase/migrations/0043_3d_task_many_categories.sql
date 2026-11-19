-- A 3D task can be several categories of work and use several pieces of software
-- at once: Modeling and Texture, in Blender and Unreal. Both become lists.
--
-- * three_d_category (one value, 0024) becomes three_d_categories (text[]); a task
--   that had one keeps it as a one-item list, an empty one gets '{}'.
-- * three_d_software becomes a text[] under the same name.
-- * Each list may only hold the known values (THREE_D_CATEGORIES with Cam shots,
--   THREE_D_SOFTWARE in lib/master-data.ts), and never the same one twice. The
--   forms require at least one of each on a 3D task; a cam has Cam shots and no
--   software. The columns stay '{}' on every other task.
--
-- tasks has no column grants and no view or function names these columns, so
-- nothing else changes. task_versions fingerprints t::text, so the new shape
-- syncs by itself.

alter table tasks drop constraint if exists tasks_three_d_category_check;
alter table tasks drop constraint if exists tasks_three_d_software_check;

alter table tasks
  alter column three_d_category type text[]
    using case when three_d_category is null then '{}'::text[] else array[three_d_category] end,
  alter column three_d_software type text[]
    using case when three_d_software is null then '{}'::text[] else array[three_d_software] end;

alter table tasks
  alter column three_d_category set default '{}',
  alter column three_d_category set not null,
  alter column three_d_software set default '{}',
  alter column three_d_software set not null;

alter table tasks rename column three_d_category to three_d_categories;

create or replace function text_array_distinct(p text[])
 returns boolean
 language sql
 immutable
as $function$
  select cardinality(p) = (select count(distinct x) from unnest(p) x);
$function$;

alter table tasks add constraint tasks_three_d_categories_check
  check (three_d_categories <@ array['Modeling', 'Texture', 'Lighting', 'Cam shots']::text[]
         and text_array_distinct(three_d_categories));
alter table tasks add constraint tasks_three_d_software_check
  check (three_d_software <@ array['Blender', 'Unreal']::text[]
         and text_array_distinct(three_d_software));

notify pgrst, 'reload schema';
