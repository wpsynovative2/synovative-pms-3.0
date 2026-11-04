# 3D Module — architecture

A module where 3D Artists run their projects as numbered groups of tasks: a
project holds groups T1, T2 … Tn, and each group holds tasks T1.1, T1.2 … T1.n.
A project can run step by step (SBS), and any task can take its start date and
deadline from one or more other tasks.

**Status:** built. Migrations `0021_task_dependency_links.sql`,
`0022_3d_task_groups.sql`, `0023_3d_no_content_tasks.sql` and
`0024_3d_task_details.sql`, `0025_3d_cam_shots.sql`, `0026_3d_task_thumbnail.sql` and `0027_3d_thumbnail_name.sql`; pages `/3d-projects` and `/3d-projects/[id]`. Section 9
records the decisions behind it, and section 8 what is left for later.

The module is shown only to the **3D Artists department, Super Admin, Admin,
Manager and the Business Development Executives department**.

---

## 1. The structure

This is the shape the whole module follows. There are exactly two levels under
a project.

```
3D Project
│
├── T1   (group)
│   ├── T1.1   (task)
│   ├── T1.2   (task)
│   ├── T1.3   (task)
│   ├── T1.4   (task)
│   └── T1.n   (task)
│
├── T2   (group)
│   ├── T2.1   (task)
│   ├── T2.2   (task)
│   └── T2.n   (task)
│
├── ...
│
└── Tn   (group)
    ├── Tn.1   (task)
    ├── Tn.2   (task)
    ├── Tn.3   (task)
    └── Tn.n   (task)
```

The same shape filled in. The names are invented, to show how it reads:

```
Skyline Towers — Walkthrough                     (project)
│
├── T1  Modelling                                (group)   2/3 approved
│   ├── T1.1  Tower exterior       Riya    Approved
│   ├── T1.2  Podium and landscape Arjun   Approved
│   └── T1.3  Sample flat interior Riya    In Progress
│
├── T2  Texturing and lighting                   (group)   0/2 approved
│   ├── T2.1  Exterior materials   Arjun   Not Started
│   └── T2.2  Day and dusk lighting Riya   Not Started
│
└── T3  Animation and render                     (group)   0/3 approved
    ├── T3.1  Camera paths         Kabir   Not Started
    ├── T3.2  Final render         Kabir   Not Started
    └── T3.3  Edit and sound       Kabir   Not Started
```

| Level | What it is | Holds its own |
| --- | --- | --- |
| **Project** | An ordinary project, marked as 3D | Client chain, window, Leader, members, Drive folder |
| **Group** (T1) | A named, numbered container | Name and number only. Progress and dates are worked out from its tasks |
| **Task** (T1.1) | An ordinary task, filed in a group | Assignee, dates, timer, submissions, reviews, remarks |

Work happens only on tasks. A group has no assignee, timer or review, so nobody
starts or submits "T1" itself.

**No content tasks.** A 3D project holds standard tasks only: the forms do not offer
content tasks, it has no Content Bank tab, and the database refuses a new one
(`0023`). An older project marked 3D keeps any it already has. They stay untouched
on its ordinary project page, and do not appear in the module.

**What a 3D task and group ask for (`0024`).**

| Field | On | Rule |
| --- | --- | --- |
| Department | Task | Not asked. Always 3D Artists, and the database refuses another on a new task |
| Task category | Task | Required by the forms: Modeling, Texture, Lighting or Cam shots |
| Shots brief (rich text), Camera angles | Task | Cam shots only (`0025`), and then required by the forms. Cleared if the category changes to another |
| Software | Task | Required by the forms: Blender or Unreal |
| Thumbnail | Task | Optional, in every category (`0026`). The browser compresses it to a JPEG, at most 1600 px on its longest side, before it goes to Drive |
| Thumbnail name | Task | Optional (`0027`). Shown under the image, and names the file on Drive |
| Client Supe Notes, 3D Lead Note, General Notes | Group and task | Optional rich text. When a project is created, its opening tasks skip these; they are added from the task form |

Thumbnails all go in one Drive folder, **3D Thumbnails**, inside 3D Operation Work,
made the first time one is uploaded. The task stores the file's id and link. The
files stay private, so the app serves them itself (`/api/drive/thumbnails/[id]`) to
anyone who can read the task. A thumbnail that is replaced or removed stays on Drive.

A 3D project's page filters its tasks by search, task category, software, status,
priority, group and assignee. Nothing is saved, a group with no match is hidden, and
a group's progress still counts all its tasks.

A 3D task's description is labelled "Brief description". A task from before its
project was marked 3D keeps its department, and is asked for its category and
software the next time it is edited.

---

## 2. Where it sits in the app

The module adds one level to the chain the app already uses, and leaves
everything around it as it is.

```
Company → Client → Property → OBC → Project → [ Group ] → Task → (time, submission, review)
                                                  ▲
                                                  └── the only new level
```

```
                         ┌─────────────────────────────┐
  3D Artists ───────────▶│  /3d-projects  (new page)   │
                         │  Projects → T1 → T1.1       │
                         └──────────────┬──────────────┘
                                        │ same rows
                                        ▼
  Everyone else ────────▶ ┌───────────────────────────┐
  (managers, leaders)     │  projects  ·  tasks       │
                          └─────────────┬─────────────┘
                                        │ so these keep working, unchanged
        ┌───────────┬───────────┬───────┴───┬─────────────┬─────────────┐
        ▼           ▼           ▼           ▼             ▼             ▼
     My Tasks     Timer      Review      Workload      Reports    Notifications
```

**Why ordinary tasks and not a separate set of 3D tables.** A task already
carries its timer, submit and review cycle, reassignment, dependencies, working
day dates and notifications. Separate tables would mean rebuilding all of that.
They would also split the timer: the one-running-timer rule is an index on
`time_sessions`, whose sessions point at `tasks`, so an artist could run a timer
in each system at once. Workload and Reports would also stop counting 3D work.

---

## 3. Data model

Two new tables and four new columns. One existing column, `tasks.depends_on_task_id`,
is replaced.

```
┌──────────────────────────────┐
│ projects            existing │
│──────────────────────────────│
│ + is_3d  boolean             │
│ + next_group_number          │
└───────┬──────────────┬───────┘
        │ 1            │ 1
        │              │
        │ 0..n         │
┌───────▼───────────────────┐  │
│ task_groups           NEW │  │
│───────────────────────────│  │
│ id                        │  │
│ project_id                │  │
│ number            → T[1]  │  │
│ name                      │  │
│ next_task_number          │  │
│ created_by, created_at    │  │
└───────┬───────────────────┘  │
        │ 0..1                 │ 0..n
        │                      │
        │ 0..n                 │
┌───────▼──────────────────────▼───┐
│ tasks                   existing │
│──────────────────────────────────│
│ + group_id      nullable         │
│ + group_number  → T1.[3]         │
└───────┬──────────────────────────┘
        │ existing, unchanged
        ├── time_sessions
        ├── submissions
        ├── reviews
        └── remarks
```

**Links between tasks.** Each link is one row, so a task can wait on several:

```
                ┌──────────────────────────┐
 T3.1 ──────────▶ task_dependencies    NEW ◀────────── T1.3
 (the task      │──────────────────────────│           T2.2
  that waits)   │ task_id                  │           (the tasks
                │ depends_on_task_id       │            it waits on)
                └──────────────────────────┘

 T3.1 waits on T1.3     →   one row
 T3.1 waits on T2.2     →   one row
```

This replaces `tasks.depends_on_task_id`, which can hold only one link. Existing
links are copied across, and then the column is dropped, so there is only one
place to read them from. `tasks.duration_days` and `projects.step_by_step` stay
as they are.

Rules the migration has to enforce:

| Rule | How |
| --- | --- |
| A task's group is in the task's own project | Composite foreign key: `tasks (group_id, project_id)` → `task_groups (id, project_id)` |
| An individual task cannot be in a group | Check: `group_id is null or project_id is not null`. The foreign key alone skips any row where `project_id` is null |
| Each number is used once | Unique on `task_groups (project_id, number)` and `tasks (group_id, group_number)` |
| Two people adding at once get different numbers | A trigger takes the next number from a counter on the parent row (`next_group_number`, `next_task_number`), which also locks it |
| A number is never reused | Same counters: deleting T1.4 does not make the next task T1.4 again, and the same goes for T3 |
| A link joins two different standard tasks in the same project | Trigger on `task_dependencies`, which also walks every link to refuse a loop |
| The same link cannot be added twice | Primary key on `task_dependencies (task_id, depends_on_task_id)` |
| A task with links has its days to complete | The same trigger, because a check constraint cannot look across tables |
| A group with tasks cannot be deleted | The foreign key refuses it. It is deferred to commit, so deleting a whole project still works: its groups and tasks both cascade, and a check at the end of a statement could run before the tasks had gone |

**Ungrouped tasks are allowed.** `group_id` stays nullable, and those tasks show
under an "Ungrouped" heading. Tasks reach a project in several ways (the project
form, an OBC conversion, a template), and this lets those paths keep working
untouched.

**Numbers are shown, not typed into titles.** `T1.3` is put together on screen
from the two numbers, so renaming a group or task cannot break it.

---

## 4. How a group's progress is worked out

Nothing here is stored. It is calculated from the group's tasks each time, so it
cannot drift out of step.

```
T1  Modelling      2/3 approved    12 Nov → 28 Nov    In Progress
                   ▲               ▲                  ▲
                   │               │                  │
       approved ÷ all tasks        │                  │
                                   │                  │
              earliest start → latest due             │
                                                      │
                                     see the table below
```

| Group shows | When |
| --- | --- |
| **Not Started** | It has no tasks, or none has begun and at least one is free to start |
| **Waiting** | None has begun, and every task in it is waiting on another task |
| **In Progress** | At least one task has begun, and not all are Approved |
| **Done** | It has tasks and all of them are Approved |
| **Overdue** marker, shown alongside | Any task in it is overdue. A waiting task is never overdue |
| **Past deadline** marker, shown alongside | Any task in it is due after the project deadline |

A waiting task's dates are projections, so a group's dates can move until the
tasks before it are approved.

---

## 5. How tasks move and wait on each other

### One task

Exactly today's task flow. Nothing here is new.

```
 create
    │
    ▼
┌─────────────┐  Start   ┌─────────────┐  Submit  ┌───────────┐
│ Not Started │─────────▶│ In Progress │─────────▶│ Submitted │
└─────────────┘          └─────────────┘          └─────┬─────┘
       ▲                        ▲                       │
       │                        │ Start                 │ reviewer decides
       │                 ┌──────┴───────────┐           │
       │                 │ Changes Required │◀──────────┤
       │                 └──────────────────┘           │
       │  reassigned     ┌──────────────────┐           │
       └─────────────────│ Rejected         │◀──────────┤
                         └──────────────────┘           │
                         ┌──────────────────┐           │
                         │ Approved  (done) │◀──────────┤
                         └──────────────────┘           │
                         ┌──────────────────┐           │
                         │ Waiting for      │◀──────────┘
                         │ Client Response  │
                         └──────────────────┘
                 parked until the reviewer settles it
                 as one of the three above
```

### A task that waits on another

A task can take its start date and deadline from other tasks, by extending the
existing dependency feature (`0014`). Its dates are worked out rather than
picked: you choose the tasks it waits on and give it a number of working days.

**Waiting on one task:**

```
T1.2  Podium and landscape        due 20 Nov
  │
  │ T1.3 waits on T1.2, days to complete: 6
  ▼
T1.3  Sample flat interior

  Before T1.2 is approved (projected)     Start 20 Nov  →  Due 27 Nov
  T1.2 approved on 21 Nov (real dates)    Start 21 Nov  →  Due 28 Nov
                                                           Sunday 22 Nov skipped
```

**Waiting on several tasks.** It starts when the *last* of them is approved:

```
T1.3  Sample flat interior    due 28 Nov ──┐
                                           ├──▶ T3.1  Camera paths
T2.2  Day and dusk lighting   due  9 Dec ──┘          days to complete: 3

  Neither approved (projected)            Start  9 Dec  →  Due 12 Dec
  T1.3 approved on 30 Nov                 Start  9 Dec  →  Due 12 Dec
                                          still waiting on T2.2
  T2.2 approved on 10 Dec (real dates)    Start 10 Dec  →  Due 14 Dec
                                          ready to start, Sunday 13 Dec skipped
```

| | Start date | Deadline |
| --- | --- | --- |
| **Until the last one is approved** | The latest due date among those not yet approved (a projection) | Start + days to complete, in working days |
| **Once the last one is approved** | The day of that approval | Start + days to complete, in working days |

While a task is waiting:

- It cannot be timed or submitted, and it is never overdue.
- It shows every task it is still waiting on: `Waiting on T1.3, T2.2`.
- Its projected dates move whenever a task it waits on moves, all the way down
  the chain.
- Its assignee is notified once, when the last task is approved and it is ready
  to start.
- Its dates may run past the project deadline. That is flagged, not squeezed to
  fit.

What it can wait on:

- Any standard task in the same project, including one in another group.
- One task or several, and several tasks may wait on the same one.
- Never on something that is already waiting on it, because that would be a loop.
- Individual tasks never wait.

### Normal project and SBS project

A project is one or the other, using the existing **SBS — step by step** switch.

**Normal project.** Each task has its own dates unless you link it to another:

```
T1.1  own dates ──┬──▶ T1.2  waits on T1.1
                  │
                  └──▶ T1.3  waits on T1.1 ──▶ T2.1  waits on T1.3

T2.2  own dates ─────┐
                     ├──▶ T3.1  waits on T2.1 and T2.2
T2.1 ────────────────┘
```

**SBS project.** One chain runs through the whole project in number order and
crosses from group to group. Only the first task has its own dates. Every other
task takes its dates from the one before it, and you give it only its days to
complete.

```
T1:  T1.1 ▶ T1.2 ▶ T1.3
                     │
       ┌─────────────┘
       ▼
T2:  T2.1 ▶ T2.2
              │
       ┌──────┘
       ▼
T3:  T3.1 ▶ T3.2 ▶ T3.3

T1.1 has its own dates. Every task after it waits on the one before.
```

Ungrouped tasks stay outside the chain. In an SBS project, a
task can still be changed from its own task form. It can wait on a different task,
which lets some work run side by side, or on extra tasks as well as the one before
it:

```
T2.1 ▶ T2.2 ▶ T3.1     T3.1 waits on T2.2, its place in the chain
               ▲
T1.2 ──────────┘       and also on T1.2, added by hand
```

### What 3D needs that SBS does not do today

Today's SBS assumes tasks are only ever added at the end. Groups break that
assumption, because a task can be added to an earlier group at any time. These
two rules are new, and apply to 3D projects only, so other SBS projects behave as
they do now.

**Adding a task.** Today a new task defaults to waiting on the last one *created*
(`chainTail`). In a 3D project it has to follow number order instead:

```
Adding T1.4 when T2.2 already exists:

  Today's rule     T1.3 ▶ T2.1 ▶ T2.2 ▶ T1.4       wrong: T1.4 runs last

  Needed           T1.3 ▶ T1.4 ▶ T2.1 ▶ T2.2       T2.1 now waits on T1.4
```

- The new task waits on the task before it in number order. If its group is
  empty, that is the last task of the nearest earlier group that has tasks.
- If the next task waits on the task before, that link moves to the new task,
  and its dates and everything after it move too. Any other links it has stay.
- If the next task has already started, it is left alone. Work under way is never
  put back to waiting.

**Deleting a task.** Today, whatever waited on a deleted task is released and the
chain splits in two. In a 3D SBS project the chain closes the gap instead:

```
Deleting T1.2:

  Today's rule     T1.1     T1.3 ▶ T2.1 ...        T1.3 no longer waits on anything

  Needed           T1.1 ▶ T1.3 ▶ T2.1 ...          T1.3 now waits on T1.1
```

Whatever waited on the deleted task takes over everything the deleted task was
waiting on. Deleting the first task in the chain leaves the next one holding its
projected dates as its own, as it does today.

**Outside 3D SBS projects**, deleting a task removes only that link. If the task
that waited on it still has other links, it keeps waiting on those. If it has
none left, it is released with its projected dates, as it is today.

Both rules run in database triggers. The person adding or deleting a task may not
have the right to edit the next one, and the two changes must succeed or fail
together.

**Switching SBS on for a project that already has tasks.** This stays as it is
today: tasks already there keep their dates, and only new ones join the chain.

---

## 6. Screens

**`/3d-projects`: the list of 3D projects you can see.**

```
┌──────────────────────────────────────────────────────────────┐
│ 3D Projects                                     [+ New]      │
├──────────────────────────────────────────────────────────────┤
│ Skyline Towers — Walkthrough    3 groups  ▓▓▓░░░░░  2/8      │
│ Harbour Residences — Interiors  5 groups  ▓▓▓▓▓▓░░  14/18    │
└──────────────────────────────────────────────────────────────┘
```

**`/3d-projects/[id]`: one project, with groups that open and close.**

```
┌──────────────────────────────────────────────────────────────┐
│ Skyline Towers — Walkthrough  [SBS]     [Drive] [+ Add group]│
├──────────────────────────────────────────────────────────────┤
│ ▼ T1  Modelling              2/3 12 Nov → 28 Nov In Progress │
│    T1.1  Tower exterior         Riya   Approved              │
│    T1.2  Podium and landscape   Arjun  Approved              │
│    T1.3  Sample flat interior   Riya   In Progress  ▶ 02:14  │
│    + Add task to T1                                          │
│                                                              │
│ ▼ T2  Texturing and lighting 0/2 28 Nov → 9 Dec  Waiting     │
│    T2.1  Exterior materials     Arjun  Waiting on T1.3       │
│    T2.2  Day and dusk lighting  Riya   Waiting on T2.1       │
│    + Add task to T2                                          │
│                                                              │
│ ▶ T3  Animation and render   0/3 9 Dec → 24 Dec  Waiting     │
└──────────────────────────────────────────────────────────────┘
```

Opening a task uses the existing task detail, timer and review screens. Elsewhere
in the app (My Tasks, the review queue) a grouped task shows its number in front
of its title: `T1.3 Sample flat interior`.

**Adding or editing a task.** The form is the existing one. When a task waits on
another, its date fields are replaced by the worked-out dates, and the picker
lists tasks by number.

```
┌──────────────────────────────────────────────────────────────┐
│ Add task to T1                                               │
├──────────────────────────────────────────────────────────────┤
│ Title        Terrace garden                                  │
│ Assignee     Riya                                            │
│                                                              │
│ [on] Waits on another task                                   │
│ Waits on     [T1.3 Sample flat interior  x]  [+ Add another] │
│ Days to complete   4                                         │
│                                                              │
│ Starts the day the last of these is approved.                │
│ If approved on the due date: 28 Nov → 3 Dec                  │
└──────────────────────────────────────────────────────────────┘
```

---

## 7. Who can do what

The task workflow and SBS follow the app's existing rules. The policies on
`task_dependencies` reuse them: you can read a link if you can read its task, and
change it if you may fully edit that task. The rows marked *new* are in both
`lib/permissions.ts` and `0022`.

| Action | Who | Comes from |
| --- | --- | --- |
| See the 3D Projects page and sidebar link | 3D Artists department, global managers, Business Development | *New:* `canViewThreeD` |
| See a 3D project | Global managers, the 3D Artists' Team Leader and Business Development see all of them. An artist sees the ones they hold a task in | *New* lines in `canViewProject`, `can_see_project` and `my_project_ids`, on top of the existing rules |
| Create a 3D project | Global managers, the 3D Artists' Team Leader | *New:* `canCreateThreeDProjects`, and the `projects`, `project_services` and `project_members` policies |
| Add, edit or delete a group | Global managers, the project's Leader, the 3D Artists' Team Leader | *New:* `canManageTaskGroups` / `can_manage_task_groups()` |
| Add a task to a group | Global managers, the project's Leader, any Team Leader who can see the project | Existing `canCreateTaskInProject` |
| Turn SBS on or off | Whoever may edit the project | Existing |
| Set what a task waits on, and its days to complete | Whoever may fully edit the task | Existing `canEditTaskFully`, and new policies on `task_dependencies` |
| Time and submit a task | Its assignee, once it is no longer waiting | Existing, and `guard_waiting_task` |
| Review a task | As today | Existing `canReviewTask` |

**People outside those departments.** Hiding the module does not remove someone
from work they have been given. A person from another department sees a 3D project
on the ordinary Projects page if they lead it, hold a task in it, or are a Team
Leader listed as a member or with a task from their department in it. They do not
get the 3D Projects page, and the database refuses them everything else.

**Business Development reads, and does not change.** Seeing a 3D project gives them
what any viewer of a project reads, its expenses and comments included. It gives
them no right to edit it.

---

## 8. What gets built

| Piece | Change |
| --- | --- |
| `supabase/migrations/0021_task_dependency_links.sql` | `task_dependencies` with its policies and trigger; copy existing links across; drop `tasks.depends_on_task_id`; update `task_is_waiting`, `schedule_dependent_task`, `follow_task_dependency`, `guard_waiting_task` and `generate_recurring_occurrences` |
| `supabase/migrations/0022_3d_task_groups.sql` | `task_groups` with its policies, `projects.is_3d` / `next_group_number`, `tasks.group_id` / `group_number`, numbering triggers, the two chain triggers (section 5), `is_3d_artist()`, `is_3d_team_leader()`, `is_3d_project()`, `can_manage_task_groups()`, the wider project visibility, the `projects`, `project_services` and `project_members` write rules |
| `lib/types.ts` | `TaskGroup`; `Project.is3d`; `Task.groupId` / `groupNumber`; `Database.taskGroups`; `Task.dependsOnTaskIds` and `waitingOnTaskIds` replace the single-link fields |
| `lib/data/db.ts` | Load groups and links in the `tasks` scope; row writers and column maps |
| `lib/store.tsx` | Add, rename and delete a group through `commit()`; write a task's links with the task |
| `lib/permissions.ts` | `canViewThreeD`, `canCreateThreeDProjects`, `canManageTaskGroups`, 3D lines in `canViewProject`, a new `navGate` entry |
| `lib/dependencies.ts` | `markWaiting`, `dependentDates` and the loop check in `dependencyCandidates` work with several links; a number-order version of `chainTail`, used for 3D projects |
| `lib/analytics.ts` | Group progress (section 4) |
| `app/(app)/3d-projects/` | The list page and the project page |
| `components/three-d/` | `task-group-card.tsx`, `group-form.tsx` |
| `components/layout/app-shell.tsx` | Sidebar link |
| `components/project/project-form.tsx` | Keeps its one-task picker, and writes the link to the new table |
| `components/task/` | Show the number on a task's title and in the *Waits on* picker; let that picker hold several tasks in 3D projects; list every waited-on task in `task-detail` and `timer-controls`; a group picker on the task form; the 3D default for *Waits on* |
| `ARCHITECTURE.md` | Add the migration to its table, and link this file |

Reused without change: the timer, submit and review functions, the SBS switch,
reassignment, notifications, the working calendar, project Drive folders (`0015`).

**This part reaches beyond the 3D module.** Waiting on several tasks changes how
dependencies are stored for every project, because keeping two systems would mean
every check reads both. Other departments' projects should behave exactly as they
do now, so `0021` is kept separate. Run both files and deploy the code together:
`tasks.depends_on_task_id` goes in `0021`, so the old code cannot save a task once
it has run.

**Left for later:**

- **Repeating 3D projects.** Recurring copies duplicate tasks, and would need to
  duplicate groups and re-point the tasks at them, so 3D projects would not offer
  *Repeat* at first.
- **3D project templates.** Templates hold a flat list of task rows, with no
  groups.
- **Moving a task between groups, and drag-to-reorder.** Both change what the
  numbers mean, so they depend on decision 2, and in an SBS project both would
  also change the chain.

---

## 9. Decisions

| # | Question | Decision |
| --- | --- | --- |
| 1 | Should 3D projects also appear in the main Projects page? | **Yes**, for whoever can see them. Managers keep one complete list |
| 2 | If T1.2 is deleted, does T1.3 keep its number? | **Yes**, numbers never change and are never reused |
| 3 | Who may manage groups? | **The 3D Artists' Team Leader**, global managers and the project's Leader |
| 4 | Who creates a 3D project? | **Global managers and the 3D Artists' Team Leader** |
| 5 | Which projects count as 3D? | **A tick-box on the project**, already on when the service is "3D Walkthrough Animation" |
| 6 | May an ordinary artist add their own task to a group? | **No**, same as other departments |
| 7 | In an SBS project, is there one chain through all the groups, or one per group? | **One chain**, T1.1 through to Tn.n |
| 8 | In an SBS project, may a task wait on something other than the task before it? | **Yes**, from its own task form |
| 9 | Can a task wait on more than one task? | **Yes**. It starts when the last of them is approved (section 5) |
| 10 | Should other departments' projects also get the several-task picker? | **Not yet**, 3D projects only. It can be opened up later without another database change |
| 11 | Who sees the module? | **3D Artists, Super Admin, Admin, Manager and Business Development Executives** |
| 12 | Can a 3D project have content tasks? | **No**. An older project marked 3D keeps any it already has, outside the module |
| 13 | Which department does a 3D task belong to? | **Always 3D Artists**; the forms do not ask. An older project marked 3D keeps the departments its tasks already have |
| 14 | What else does a 3D task ask for? | **Task category** (Modeling, Texture, Lighting, Cam shots) and **software** (Blender, Unreal), one of each, both required |
| 15 | What notes do groups and tasks carry? | **Client Supe Notes, 3D Lead Note and General Notes**, optional rich text, and editable by whoever may edit that group or task |
| 16 | What does a Cam shots task ask for? | **A shots brief (rich text) and camera angles**, both required, on top of what every 3D task asks |
| 17 | Can a 3D task have a thumbnail? | **Yes, optional, in any category.** Compressed in the browser and kept privately in one master Drive folder, with the link on the task |
