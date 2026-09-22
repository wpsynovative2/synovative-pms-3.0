# Synovative PMS — orientation for agents

Read this before changing anything. It explains what the app is, how it is put
together, and the handful of rules that are easy to break without noticing.

- [`Doc.md`](Doc.md) is the PRD. Code comments cite it as `§7`, `§12.2`, etc.
  When behaviour is disputed, the PRD is the intent and this file is the
  implementation.
- [`README.md`](README.md) is the human setup guide: env vars, migrations,
  first Super Admin.
- [`AGENTS.md`](AGENTS.md) carries the Next.js version warning. Heed it.

---

## 1. What the app is

An in-house project management system for a digital marketing agency serving
real-estate developers in Mumbai. **One web app for every employee** — the
navigation, the pages and the actions on them change with the signed-in user's
role and department. There is no separate admin app.

The working shape of the business:

```
Company → Client → Property → OBC → Project → Task → (time, submission, review)
```

A *Company* is a developer. A *Client* is a person at that company. A
*Property* is a project they are selling. An *OBC* ("order booking
confirmation") is a sales order raised against an accepted Zoho quote. A
manager turns an OBC into one or more *Projects*. Projects hold *Tasks*, tasks
hold time sessions, submissions and reviews. Everything downstream keeps a
foreign key back up the chain, so a running task can always be traced to the
developer who paid for it.

Work raised by hand (no sales chain) leaves `companyId` / `clientId` /
`propertyId` / `obcId` null. Both kinds coexist.

---

## 2. Stack, and what differs from your priors

| Layer | Choice |
| --- | --- |
| Framework | **Next.js 16** (App Router, Turbopack dev) |
| UI | React 19, TypeScript 5 |
| Styling | **Tailwind CSS v4** (`@tailwindcss/postcss`, no `tailwind.config.js`) |
| Data | Supabase — Postgres, Auth, Realtime, `pg_cron` |
| Uploads | Cloudinary (expense bills only) |
| Deploy | Vercel |

Next 16 conventions used here that differ from older App Router code:

- **`proxy.ts` at the repo root, not `middleware.ts`.** It exports
  `proxy(request)` and `config`. Same job: refresh the Supabase session cookie
  and redirect signed-out visitors to `/login`.
- **Typed route helpers as globals** — `LayoutProps<"/">` in
  [`app/layout.tsx`](app/layout.tsx),
  `RouteContext<"/api/admin/users/[id]">` in the dynamic API route. Do not
  hand-write `{ params: Promise<{ id: string }> }`.
- **Icons come from file conventions.** [`app/icon.png`](app/icon.png) is the
  favicon and [`app/apple-icon.png`](app/apple-icon.png) the touch icon. There
  is deliberately **no `app/favicon.ico`** — it would win over `icon.png` in
  the browser's ordering.
- Tailwind v4 has no config file. Design tokens are `@theme` custom properties
  in [`app/globals.css`](app/globals.css).

Before writing Next-specific code, read the relevant guide in
`node_modules/next/dist/docs/`. This is not optional — see `AGENTS.md`.

---

## 3. Where things live

```
app/
  layout.tsx            <html>, fonts, theme init script, metadata
  page.tsx              "/" — redirects to /dashboard or /login
  login/page.tsx        sign-in
  (app)/
    layout.tsx          auth gate → <AppShell>
    loading.tsx         route-level loading state
    <module>/page.tsx   one page per module (see §4 of README)
  api/
    admin/users/        add / edit / delete users (service role, self-checked)
    uploads/sign/       Cloudinary signature — secret stays server-side
    drive/property-folders/  creates a property's Drive tree
    zoho/quotes/        reads one quote for the OBC form
components/
  layout/               app shell, toaster, setup notice, first-sign-in
  ui/                   design system: primitives, selects, modal, popover,
                        date-picker, rich-text, recurrence-picker, loader, icons
  task/                 task list, detail, form, dialogs, timer controls
  project/project-form.tsx
  expense/, content/, collab/
lib/
  types.ts              the whole domain model — start here
  store.tsx             client state + every mutation (the big one, ~2k lines)
  data/db.ts            Supabase rows ⇄ app shapes, scoped loaders
  permissions.ts        §4.2 matrix as functions (UI only)
  master-data.ts        departments, services, statuses, colour/label maps
  calendar.ts           working-day maths (§5.4)
  recurrence.ts         repeat rules
  analytics.ts          project stats, workload, reports
  time.ts               timer maths and formatting
  supabase/             browser / server / service-role clients, route auth
  google/, zoho/, uploads.ts, theme.ts
supabase/migrations/    numbered, run in order — the real schema and security
scripts/create-admin.mjs
proxy.ts                session refresh + routing (Next 16 "middleware")
```

Rule of thumb: **business rules live in `lib/` and in SQL; pages compose.**
A page that starts growing rules is a smell — put them in `lib/permissions.ts`
(for what the UI shows) and in a migration (for what is actually allowed).

---

## 4. Domain model

[`lib/types.ts`](lib/types.ts) is the single source of truth for shapes and is
worth reading in full before any non-trivial change. Highlights:

**People.** `User` has a `role` (`super_admin`, `admin`, `manager`, `hr_admin`,
`team_leader`, `team_member`) *and* a list of `departments`. Both matter — see
§5. "Project Leader" is **not** a role; it is a per-project field (`leaderId`).

**Project.** Name, colour, client name, services, window (`startDate` →
`deadline`), status, priority, optional `leaderId`, `memberIds`, optional
`recurrence` / `series`, and the nullable CRM chain.

**Task.** Belongs to a project, or `projectId: null` for an *individual task*
(§10). Carries its own history inline: `sessions` (timer), `submissions`,
`reviews`, `remarks`. Statuses: `Not Started → In Progress → Submitted →`
`{ Approved | Changes Required | Rejected | Waiting for Client Response }`.

**Templates.** `ProjectTemplate` holds `TaskTemplateItem[]`, whose dates are
*offsets in working days* (`startOffsetDays`, `durationDays`) rather than real
dates — they resolve against whatever project window they are applied to.

**CRM.** `Company`, `Client`, `Property` (with `PropertyConfig[]` unit mix and
Drive folders), `Obc` (with `ObcItem[]` quoted lines).

**Content Bank.** `ContentEntry` — one written piece (on-pic copy, caption,
body/brief, reference links), filed against a project and usually a task, with
a `billingType` (`Count` | `Extra`) and an `allottedTo` person.

**Collaboration.** `Comment` and `MeetingMinutes` hang off any `CollabEntity`
(`company | client | property | obc | project | task`) via
[`components/collab/collab-panel.tsx`](components/collab/collab-panel.tsx).

`Database` at the bottom of the file is "everything the signed-in user may
see", and is exactly what the store holds.

---

## 5. Permissions — three layers, and which one is real

This is the part most likely to be got wrong.

| Layer | Where | Status |
| --- | --- | --- |
| Row Level Security | `supabase/migrations/*.sql` | **The real boundary.** Every browser read and write runs as the signed-in user. |
| `SECURITY DEFINER` functions | same | Workflow steps re-check their own rule (timer, submit, review, expense verdict). |
| `lib/permissions.ts` | client | **Convenience only.** Decides what to render and enable. Never a security control. |

**Any change to who may do what has to be made in both places.** Changing only
`lib/permissions.ts` produces a button that fails with a Postgres `42501`; the
store turns that into "You don't have permission to do that." Changing only
SQL leaves the UI hiding something the user is now allowed to do.

### Rights that come from the *department*, not the role

Four of these, all modelled the same way — a `u.departments.includes(...)`
helper on the client and an `is_*()` SQL function on the server:

| Department | Right | Client | SQL |
| --- | --- | --- | --- |
| Accounts & Finance | verify expenses | `isFinance` | `is_finance()` |
| Business Development Executives | keep CRM records, raise OBCs | `isBusinessExec` | `is_business_exec()` |
| Content Writers / Copywriters / Brand Strategists | write Content Bank | `isContentWriter` | `is_content_writer()` |
| Social Media Marketing | write Content Bank | `isSocialMediaMarketer` | `is_smm()` |

The last two are combined into `canWriteContent()` / `can_write_content()`.
No role overrides a department right — a Super Admin who is not in Accounts &
Finance still cannot verify an expense.

### Visibility rules worth knowing

- `canViewProject` / `can_see_project`: global managers see everything; a
  Project Leader sees theirs; **anyone holding ≥ 1 task in a project sees all
  of that project's tasks**; a Team Leader additionally sees every project
  their department has work in. Being listed in `memberIds` grants nothing on
  its own.
- `assignedTaskScope`: the `/tasks` page lists only *your* tasks for everyone
  except global managers. Wider access still exists where the work needs it
  (the project page, the review queue).
- `canReviewTask` ≠ `isMyReviewQueue`. A Super Admin *may* review anything;
  their queue is only what they allotted plus projects they lead.
- Content Bank reads follow the project **plus** the allottee — someone can be
  handed a piece before they have any task on that project.
- Account seniority (`outranksAccount`): HR Admin cannot edit an Admin or
  Super Admin; Admin cannot edit a Super Admin. Enforced again in
  [`app/api/admin/users/[id]/route.ts`](app/api/admin/users/[id]/route.ts).

`navGate(user)` at the bottom of `permissions.ts` decides the sidebar.

---

## 6. The data layer

### `lib/store.tsx`

A hand-rolled store on `useSyncExternalStore` — no Redux, no React Query. It is
the only place that writes to Supabase from the browser.

**Reads are scoped.** `Scope` in [`lib/data/db.ts`](lib/data/db.ts) groups
tables that change together: `master`, `users`, `projects`, `tasks`,
`expenses`, `vendors`, `templates`, `calendar`, `notifications`, `links`,
`crm`, `content`, `collab`. On sign-in the `CORE_SCOPES` load first
(`master, users, projects, tasks, calendar`) and the rest stream in behind the
first render. A save refetches only the scopes it touched.

**Writes are optimistic and ordered.** Every mutation calls:

```ts
commit(scopes, optimisticDbUpdate, async (client) => { /* supabase calls */ })
```

which applies the change to the screen immediately, queues the write behind
every earlier write (`chain`), and on failure shows a toast and reloads the
affected scopes — which undoes the optimistic change. A `writeEpoch` counter
stops an in-flight refetch from overwriting a newer optimistic state.
**Never write to Supabase outside `commit`**, or the screen and the database
drift apart.

**Refreshes.** After your own saves; when a Realtime notification arrives
(meaning someone else changed work you can see); and on tab focus if the last
full refresh was over a minute ago. Realtime is subscribed **for the current
user's notifications only** — a free-tier budget decision (§19).

**Errors.** `friendlyError()` maps Postgres codes to sentences people can act
on (`42501` → permission, `23503` → still in use, `one_running_timer_per_user`
→ pause the other timer first). Add to it rather than surfacing raw messages.

### `lib/data/db.ts`

The snake_case ⇄ camelCase bridge, plus:

- `loadScopes()` and the per-scope loaders.
- `fetchAll()` pages through PostgREST's 1000-row cap; its `order` columns must
  be collectively unique or rows repeat across pages.
- `*_COLUMNS` maps + `patchColumns()` — used so a partial update only sends the
  columns that actually changed.
- Row writers (`projectRow`, `taskRow`, `obcItemRow`, `seriesColumns`, …).

Notifications are capped at the newest 300 in memory.

---

## 7. Workflows with real rules

**Timer (§11).** One running timer per user, enforced by a partial unique
index rather than a read-then-write. Starting a second offers to close the
first. The pause dialog implements both PRD options — *Done for the day* and
*Working on a different project*, which stops here and starts there in one
step. A `pg_cron` job stops everything at 23:59 IST and notifies the assignee;
the task stays In Progress.

**Submit → review (§12).** `submit_task()` closes the open session and sets
`Submitted`. `review_task()` applies one of four decisions. **Rejection
reassigns**: status resets to `Not Started`, the due date may move, and every
earlier submission, review and time log is kept. `Waiting for Client Response`
parks the task until the reviewer settles it.

**Expenses (§8).** Only the Project Leader files one; anyone in Accounts &
Finance verifies it. Bills upload straight from the browser to Cloudinary using
a signature from `/api/uploads/sign`.

**Working calendar (§5.4).** `lib/calendar.ts` + the `holidays` /
`working_overrides` tables. Past dates, Sundays and holidays are **disabled and
labelled in the picker**, not merely rejected on submit. HR overrides re-open
specific days. Task dates are also bounded by the project window (§9.1). Use
`addWorkingDays` / `nextWorkingDay` / `snapToWorkingDay`, never raw date maths.

**Recurrence.** A repeating project or individual task stores a
`RecurrenceSeries` on the *source*, which is occurrence #1 and the template
every later copy is made from. Generated occurrences carry a `SeriesLink` back.
A `pg_cron` job at 00:05 IST materialises what is due. Pausing skips the dates
it covers rather than banking them. Only Super Admin / Admin / Manager may set
a rule (`canSetRecurrence`).

**Templates → project (§13).** Applying a template on the create-project form
pre-fills the project *and* seeds an editable list of task rows. Rows follow
the project window as the start date moves, until someone sets a date by hand
(`datesPinned`), which stops that row tracking. The project and all its tasks
are written in **one** call — `createProjectWithTasks` — not a project plus N
task inserts.

**OBC → work, service by service.** `submitObc()`, then each quoted line is
allotted: `convertObc()` raises a project (with its opening tasks) for the
lines picked in the drawer, and `allotObcItems()` points lines at an individual
task already created. `obc_items.project_id` / `.task_id` record where each
line went — one or the other, never both, enforced by a check constraint — so
the list can report "4 projects · 1 task, 5 of 5 services". One OBC can spawn
several projects; `obc.projectId` names only the first. The OBC reads as
Converted only once no line is still waiting: raising work sets that
explicitly, and losing an allotment (a project deleted, blanking its lines by
foreign key) downgrades it through a trigger, because whoever deleted it need
not be a manager. On screen the status enum is relabelled: `Draft` stays Draft, `Submitted` reads **"Unallotted"**, `Converted`
reads **"Allotted"** — see `OBC_STATUS_LABEL` in `lib/master-data.ts`. The
stored enum is unchanged; do not rename it without a migration, because
triggers and existing rows depend on the words.

**Content Bank.** Written by Content Writers and Social Media Marketing,
against a project they hold a task on. The library page groups entries under
their project. A piece can be allotted to anyone active, on the project or not;
the allottee gets a notification and can read that piece.

---

## 8. The database

`supabase/migrations/` is numbered and **append-only**. Never edit a shipped
migration — add the next number. Two practical reasons: deployed databases have
already run the old file, and Postgres cannot use a new enum value in the same
transaction that adds it (which is why [`0013_crm_enums.sql`](supabase/migrations/0013_crm_enums.sql)
exists as a file of its own).

| File | What it adds |
| --- | --- |
| `0001_schema.sql` | Tables, enums, master data, aggregate views |
| `0002_rls.sql` | RLS = the §4.2 matrix, plus the workflow functions |
| `0003_jobs.sql` | `pg_cron`: auto-stop, reminders, notification pruning |
| `0004_recurrence.sql` | Repeats and their daily generator |
| `0005_app_support.sql` | Profile guards, server-side notifications, Realtime |
| `0006_operational_links.sql` | Link groups and links |
| `0007_account_guards.sql` | Account seniority |
| `0008_task_visibility.sql` | Team Leaders lose blanket read access |
| `0009_review_outcomes.sql` | "Waiting for Client Response" |
| `0010_flexible_assignment.sql` | Optional leader/assignee, new overdue rule |
| `0011_capacity_and_task_home.sql` | Per-person daily capacity |
| `0012_recurrence_pause.sql` | Pausing a repeat |
| `0013_crm_enums.sql` | The `content_allotted` notification type |
| `0014_crm_modules.sql` | Companies → OBCs, Content Bank, comments, minutes |
| `0015`–`0017` | OBC line details, quote name, master-data admin |
| `0018_content_authors.sql` | SMM writes content; allottee can read it |
| `0019_obc_service_allotment.sql` | OBC lines carry the project or task raised for them |

**Scheduled jobs** (pg_cron schedules in UTC; IST = UTC+5:30):

| Job | IST | Cron |
| --- | --- | --- |
| `auto-stop-timers-2359-ist` | 23:59 | `29 18 * * *` |
| `due-and-overdue-0900-ist` | 09:00 | `30 3 * * *` |
| `generate-recurring-occurrences-0005-ist` | 00:05 | `35 18 * * *` |
| `prune-old-notifications` | weekly | `0 20 * * 0` |

**Triggers** fire notifications server-side (`notify_task_assignment`,
`notify_remark`, `notify_expense_added`, `notify_content_allotment`) and guard
invariants (`guard_profile_update`, `guard_recurrence`, `guard_obc_conversion`).
Do not duplicate a trigger's notification in `store.tsx`.

---

## 9. UI conventions

**Theme.** Only the colour palette and fonts come from the reference site
(§3). Everything is a Tailwind v4 token in [`app/globals.css`](app/globals.css)
— `bg-surface-2`, `text-ink-faint`, `border-line-soft`, `bg-st-approved`,
`text-brand-ink`, and so on. **Components never hard-code a colour.** Light and
dark are the same tokens redefined under `:root[data-theme="light"]`; an inline
script in `app/layout.tsx` applies the saved choice before first paint.

**Primitives.** [`components/ui/primitives.tsx`](components/ui/primitives.tsx)
has `Button`, `Card`, `Field`, `Input`, `Select`, `Badge`, `Tabs`, `StatTile`,
`PageHeader`, `EmptyState`, `Avatar`, `cx`. Reach for these before writing new
markup; a page that invents its own button is drifting.

**Everything that floats is portalled into `<body>`** — dropdowns through
[`components/ui/popover.tsx`](components/ui/popover.tsx), and `Modal`,
`FullScreen` and `Drawer` through `overlayPortal()` in
[`components/ui/modal.tsx`](components/ui/modal.tsx). This is not decoration:
`position: fixed` is only measured against the viewport while nothing above it
establishes a containing block, and a transform (or the compositing hint a
browser adds for an element *animating* one, as `animate-fade-up` does) creates
exactly that. A Modal written inside a Drawer was being laid out against the
drawer, so `inset-0` meant the drawer's 672px column. Do not un-portal these,
and do not replace a Popover with an absolutely positioned div.

Layering, once everything is a sibling of `<body>`: Drawer `z-40`, Modal and
FullScreen `z-50`, Popover `z-[80]`, Toaster `z-[90]`. The sidebar's `z-100`
collapse button is harmless because its `sticky` parent makes its own stacking
context.

**Loading.** One animation everywhere:
[`components/ui/loader.tsx`](components/ui/loader.tsx) — `Loader`,
`LoadingScreen`, `ButtonLoader` — over the `.pms-loader` figure in
`globals.css`. It is sized by `--loader-size` and paints in `currentColor`, so
it works in a button label or on a boot screen. The module deliberately does
**not** import from `primitives.tsx`: primitives is a `"use client"` module, and
everything it exports becomes a client reference, which would break the
server-rendered `app/(app)/loading.tsx`.

**Dates and durations** always go through `formatDate` / `formatDuration` /
`DurationField`, so eight hours reads the same everywhere.

**Comment style.** Comments in this codebase explain *why*, cite the PRD
section, and are written in prose. Match that; do not add restating comments.

---

## 10. External integrations

All three are optional — the app degrades rather than breaking.

| Service | Used for | Without it |
| --- | --- | --- |
| Cloudinary | expense bill uploads | everything works except attaching bills |
| Google Drive | a property's media folder tree | "Create Directory" is disabled |
| Zoho CRM | pulling quote lines onto an OBC | OBC lines are typed by hand |

Each has a server route that checks the caller first
([`lib/supabase/route-auth.ts`](lib/supabase/route-auth.ts) → `requireCaller`)
and never lets a secret reach the browser. The Drive route reads folder names
from the database rather than the request, so a caller cannot build folders for
a property they cannot see. The Zoho route re-checks the Business Development
department server-side.

The **service-role key** is used in exactly two places: the `/api/admin/users`
routes (after `requireCaller` has checked the caller's role and seniority) and
`scripts/create-admin.mjs`. Never import `getAdminSupabase()` anywhere else.

Supabase logins belong to the whole Supabase project. If another app shares it,
its users can sign in here only once a PMS profile exists. Deactivating or
deleting someone in PMS removes PMS access only — it never disables a login
another app may rely on.

---

## 11. Working in this repo

```bash
npm run dev         # Turbopack dev server
npm run build       # production build — run this before calling work done
npm run typecheck   # tsc --noEmit
npm run lint        # eslint (react-hooks rules are enforced, see below)
npm run create-admin -- --email you@x.in --name "You" --password "..."
```

Traps worth naming:

1. **`setState` inside `useEffect` is an eslint error here**
   (`react-hooks/set-state-in-effect`). Derive with `useMemo` or adjust state in
   the event handler instead. This bites whenever you want "keep B in sync with
   A".
2. **Permission changes need SQL too** (§5). A new migration, not an edit.
3. **Don't bypass `commit()`** in `store.tsx` (§6).
4. **Working days, not calendar days** — `addWorkingDays`, not `addDays`, for
   anything a person is expected to deliver on.
5. **The OBC status enum is load-bearing.** Relabel on screen, do not rename in
   the database.
6. Line endings in the working tree are CRLF via git autocrlf; write files with
   LF and let git normalise.
7. The `AGENTS.md` Next.js block is regenerated by `next dev` — commit it with
   your work rather than trying to remove it.

---

## 12. Known discrepancies

Things the docs claim that the code does not (yet) do — do not "fix" the code
to match without asking, and do not trust these lines in `README.md`:

- **`project_overview()`, `task_totals`, `project_stats` and
  `project_expense_totals` exist in SQL but nothing in the client calls them.**
  Project statistics are computed in [`lib/analytics.ts`](lib/analytics.ts) from
  tables already in memory. The README's free-tier note still describes the
  views as collapsing the project header into one call; they do not, today.
  Either wiring them up or dropping the claim would be a real change — ask
  first.
- `README.md` lists `/obcs` as "converted into projects" language in places the
  UI now calls allotted / unallotted. Cosmetic, but if you touch OBC copy,
  make the two agree.

Not a discrepancy, though it looks like one:
[`app/(app)/individual-tasks/page.tsx`](app/(app)/individual-tasks/page.tsx) is
a deliberate redirect to `/tasks?type=individual`. Individual tasks moved under
Tasks in `0011`, and notifications written before the move still point at the
old path. Leave it.
