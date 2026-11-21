-- A 3D group or sub-group can be deleted with everything in it (Archi-3d.md §1).
-- Deleting a group takes its sub-groups, and deleting a sub-group takes its tasks,
-- with their time, submissions, reviews, remarks and links, as deleting a task one
-- by one would. Until now both were refused while anything was left in them.
--
-- Whoever may manage a project's groups may do this (task_groups_delete,
-- can_manage_task_groups, 0022), including the 3D Artists' Team Leader for tasks
-- someone else created: the cascade does not ask tasks_delete. In a step-by-step
-- project the chain closes over the gap as each task goes (close_chain_gap, 0022).
--
-- Mirrors deleteTaskGroup in lib/store.tsx and the confirm on the 3D project page.

-- Cascading needs no deferral: whichever of a project's groups and tasks goes
-- first, the rest follow.
alter table tasks drop constraint tasks_group_fkey;
alter table tasks add constraint tasks_group_fkey
  foreign key (group_id, project_id) references task_groups (id, project_id)
  on delete cascade;

alter table task_groups drop constraint task_groups_parent_fkey;
alter table task_groups add constraint task_groups_parent_fkey
  foreign key (parent_id, project_id) references task_groups (id, project_id)
  on delete cascade;

notify pgrst, 'reload schema';
