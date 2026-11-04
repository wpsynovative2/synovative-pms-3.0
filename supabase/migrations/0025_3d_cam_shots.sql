-- A fourth category of 3D task, Cam shots, which asks for two more things: a brief
-- for the shots (rich text, like a task's description) and the camera angles.
--
-- The forms require both when the category is Cam shots and clear them when it
-- changes to another, so they stay empty on every other task. Mirrors
-- THREE_D_CATEGORIES and CAM_SHOTS_CATEGORY in lib/master-data.ts.

alter table tasks drop constraint tasks_three_d_category_check;
alter table tasks add constraint tasks_three_d_category_check
  check (three_d_category in ('Modeling', 'Texture', 'Lighting', 'Cam shots'));

alter table tasks
  add column shots_brief   text not null default '',
  add column camera_angles text not null default '';

notify pgrst, 'reload schema';
