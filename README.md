# Synovative PMS

An in-house project management system for a digital marketing agency serving
real-estate companies in Mumbai. Built to the spec in [Doc.md](Doc.md) — one web
app for every employee, whose menus, pages and actions adapt to the signed-in
user's role.

Working on the code? [ARCHITECTURE.md](ARCHITECTURE.md) is the orientation
guide — domain model, permission layers, the store, and the rules that are easy
to break.

**Stack (§2):** Next.js 16 · TypeScript · Tailwind CSS v4 · Supabase (Postgres,
Auth, Realtime, `pg_cron`) · Cloudinary for expense bills · deploys to Vercel.

---

## Setting it up

### 1. Supabase project

Create a project at [supabase.com](https://supabase.com) (the free tier is enough
to start, §19). Under **Database → Extensions**, enable **`pg_cron`**.

### 2. Environment

```bash
cp .env.example .env.local
```

| Variable | Where it comes from | Used by |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API | browser + server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API (`anon` key) | browser + server |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API (`service_role`) — **secret** | server only: user management, `create-admin` |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | Cloudinary dashboard — optional | server only: signing bill uploads |
| `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` / `GOOGLE_DRIVE_PARENT_FOLDER_ID` | Google Cloud service account — optional | server only: creating a property's Drive folders |
| `ZOHO_CLIENT_ID` / `_CLIENT_SECRET` / `_REFRESH_TOKEN` | Zoho API console — optional | server only: reading quotes onto an OBC |

Without the Supabase values the app shows a setup screen instead of failing.
Without Cloudinary, everything works except attaching bills to expenses.

### 3. Database

Run the files in [`supabase/migrations`](supabase/migrations) **in order** — paste
each into the Supabase **SQL editor**, or use `supabase db push` with the CLI:

| File | What it does |
| --- | --- |
| `0001_schema.sql` | Tables, master data (departments, services), aggregate views |
| `0002_rls.sql` | Row Level Security — the §4.2 permission matrix, enforced — and the workflow functions (timer, submit, review, expense verdict) |
| `0003_jobs.sql` | `pg_cron`: 11:59 PM auto-stop, due / overdue reminders, notification pruning |
| `0004_recurrence.sql` | Repeating projects & individual tasks, and their daily generator |
| `0005_app_support.sql` | Profile-edit guard, server-side notifications, members-only reads, Realtime |
| `0006_operational_links.sql` | Operational links: groups and links, managers edit / everyone reads |
| `0007_account_guards.sql` | Account seniority: an HR Admin can't edit an Admin or a Super Admin, an Admin can't edit a Super Admin |
| `0008_task_visibility.sql` | Team Leaders lose blanket read access: a project needs at least one of your tasks in it |
| `0009_review_outcomes.sql` | The "Waiting for Client Response" review outcome and task status |
| `0010_flexible_assignment.sql` | Optional Project Leader and assignee, department-wide Team Leader visibility, and the new overdue rule |
| `0011_capacity_and_task_home.sql` | Per-person daily capacity, and individual tasks moving under `/tasks` |
| `0012_recurrence_pause.sql` | Pausing a repeat, which skips the dates it covers rather than banking them |
| `0013_crm_enums.sql` | The `content_allotted` notification type (its own file — Postgres can't use a new enum value in the transaction that adds it) |
| `0014_crm_modules.sql` | Companies, Clients, Properties, OBCs and the Content Bank, plus Comments and Minutes of Meeting, and their RLS |
| `0015_obc_line_details.sql` | OBC lines carry Zoho's short and brief descriptions instead of rate and amount — pricing stays in Zoho |
| `0016_obc_quote_name.sql` | OBCs are known by their Zoho quote name; the generated code stays as the fallback and stable handle |
| `0017_master_data_admin.sql` | A Super Admin can add and retire departments and services; foreign keys still refuse to drop a name in use |
| `0018_content_authors.sql` | Social Media Marketing writes in the Content Bank alongside Content Writers, and a piece can be allotted to — and read by — someone with no task on the project |
| `0019_obc_service_allotment.sql` | An OBC is allotted service by service: each quoted line records the project or individual task raised for it, and the OBC is Allotted only once none is left |
| `0020_obc_delivery_services.sql` | The estimate and the work split in two: `obc_items` stays the Zoho estimate (reference), and `obc_services` is the delivery list a Business Development Executive writes by hand and a manager raises work from |
| `0021_content_tasks.sql` | Content tasks: one task carrying N pieces, each submitted by its writer and approved, rejected or sent back on its own; the task approves itself once the batch stands |
| `0022_content_stage.sql` | A piece carries a production stage (Ready To Move, Design Completed, Scheduled, Cancelled, Carry Forwarded), and can be allotted or moved on from the piece itself by more people than its writer |

### 4. The first Super Admin

```bash
npm install
npm run create-admin -- --email you@synovative.in --name "Your Name" --password "a-strong-password"
```

Sign in at `/login`. Everyone else is added from **Users** by a Super Admin,
Admin or HR Admin (§6): they get a temporary password and must choose their own
at first sign-in. If an email already has a Supabase login (see below), PMS
access is attached to it and its password is left alone; pass `--reset-password`
to the script to change it deliberately.

### 5. Run

```bash
npm run dev          # http://localhost:3000
npm run build && npm run start
```

### 6. Deploy (Vercel)

Import the repo, add the same environment variables in **Project Settings →
Environment Variables**, and deploy. In Supabase, add the production URL under
**Authentication → URL Configuration**.

---

## What's here

All ten modules from the PRD:

| Module | Route | PRD |
| ------ | ----- | --- |
| Dashboard (running timer, your week, review queue) | `/dashboard` | §11.4 |
| Projects + project detail with tasks, time, expenses, team, activity | `/projects` | §7 |
| Project tasks with the full submission/review lifecycle | `/tasks` | §9, §12 |
| Individual tasks — under Tasks, via its type filter | `/tasks?type=individual` | §10 |
| Project expenses and the Accounts & Finance verification queue | `/expenses` | §8 |
| Workload with per-person capacity | `/workload` | §14 |
| Vendors directory | `/vendors` | §15 |
| Project & task templates | `/templates` | §13 |
| Reports & analytics (time, delivery, rework, spend) | `/reports` | §16 |
| Working calendar | `/calendar` | §5.4 |
| Users | `/users` | §6 |
| In-app notifications | `/notifications` | §17 |
| Operational links — shared Google Drive links in groups | `/links` | — |
| Recurrence — every repeating project and individual task | `/recurrence` | — |
| Companies — the real-estate developer master | `/companies` | — |
| Clients — the people at each company | `/clients` | — |
| Real estate properties — unit mix and Google Drive media folders | `/properties` | — |
| New OBCs — the estimate from Zoho plus the delivery list, allotted service by service | `/obcs` | — |
| Content Bank — written by Content Writers and Social Media Marketing, filed under its project | `/content-bank` | — |

Behaviour worth pointing at specifically:

- **One timer per user (§11.3.1).** Starting a second timer offers to close the
  first; the pause dialog implements both PRD options — *Done for the day* and
  *Working on a different project*, which stops here and starts there in one step.
- **Auto-stop at 11:59 PM (§11.3.4)** runs in the database as a `pg_cron` job
  pinned to IST (`0003_jobs.sql`), and notifies the assignee.
- **Working calendar (§5.4)** drives every task date picker — past dates,
  Sundays and holidays are disabled and labelled, and HR
  overrides re-open specific days.
- **Project date bounds (§9.1).** Task dates outside the project window are
  disabled in the picker, not just rejected on submit.
- **Repeating projects and individual tasks.** Super Admin, Admin and Manager
  can set a Google Calendar-style repeat — Daily, Weekly on a day, Monthly on a
  date or the nth/last weekday, Annually, Every weekday, or Custom (every N
  days/weeks/months/years, chosen weekdays, ending never / on a date / after N
  times). The original is occurrence #1 and the template: each repeat is a fresh
  copy of the project and its tasks (or of the task), with dates moved and
  snapped to working days, created by a `pg_cron` job at 00:05 IST on the day
  it's due (`0004_recurrence.sql`).
- **Rejection reassigns (§12.2).** Status resets to Not Started, the due date can
  move, and every earlier submission, review and time log stays in the history.
- **Expense authority comes from the department, not the role (§4.1)** — anyone
  in Accounts & Finance can verify.
- **One loading animation.** Every wait in the app — the boot screen, a route
  still resolving, a button mid-save, an upload — shows the same four-dot
  figure, defined once in [`app/globals.css`](app/globals.css) as `.pms-loader`
  and wrapped by [`components/ui/loader.tsx`](components/ui/loader.tsx). It
  paints in `currentColor` and scales from a 11px button glyph to a full screen.

- **Operational links.** Shared Google Drive folders and files filed under named
  groups. Super Admin, Admin and Manager add, edit, rename and delete (a new
  group can be created right from the Add link form); everyone else can open
  and copy them. Enforced by RLS in `0006_operational_links.sql`.

### Design

Only the colour theme and font family come from the reference site (§3),
synovative.vercel.app. Everything is defined as Tailwind v4 tokens in
[`app/globals.css`](app/globals.css); components never hard-code a colour.

- **Light and dark themes.** The sun / moon button in the top bar (and on the
  login screen) switches between them, like the reference site's toggle. Dark
  uses the `#17131F` ground; light uses the site's warm paper palette
  (`#F6F2EA` ground, `#2A2135` ink). Both share the `#5F3CA7` brand. The choice
  is saved per browser; with none saved, the OS preference decides. An inline
  script in `app/layout.tsx` applies it before first paint, so there is no flash.
- **Fonts (§20, resolved):** Nunito for text and Fredoka for headings, as on the
  reference site, plus JetBrains Mono for timers and figures.
- **Dropdowns** (date pickers, selects) render through
  [`components/ui/popover.tsx`](components/ui/popover.tsx) into the page root,
  so no card, modal or drawer can clip or cover them.

---

## How it's put together

```
app/
  (app)/              Signed-in screens
  login/              Sign-in
  api/admin/users/    Add / edit / delete users (service role, permission-checked)
  api/uploads/sign/   Signs Cloudinary uploads — the secret never reaches the browser
proxy.ts              Refreshes the session cookie; sends signed-out visitors to /login
components/           Layout, task, project, expense and UI components
lib/
  store.tsx           Client state for the signed-in user, backed by Supabase
  data/db.ts          Table ⇄ app-shape mapping, scoped loaders
  supabase/           Browser, server and service-role clients
  permissions.ts      The §4.2 matrix as functions (for what the UI shows)
  calendar.ts         Working-calendar rules (§5.4)
  recurrence.ts       Repeat rules
  time.ts / analytics.ts   Time maths, project stats, workload, reports
scripts/create-admin.mjs   First Super Admin
supabase/migrations/       Schema, RLS, jobs
```

**Security.** Row Level Security in Postgres is the real boundary: every read and
write from the browser runs as the signed-in user and is checked against the
§4.2 matrix. `lib/permissions.ts` only decides what to show. Workflow steps
(start/pause timer, submit, review, expense verdicts) go through `SECURITY
DEFINER` functions that re-check the rule themselves. The service-role key is
used only by the `/api/admin/users` routes (after checking the caller's role) and
the `create-admin` script.

**Data flow.** On sign-in the app loads everything the user may see; each save
updates the screen immediately, is written to Supabase in order, and then
refetches only the affected area. If a save fails, the user sees why and the
screen reverts. The user's own notifications arrive live over Realtime (§19);
other data refreshes after your saves, when a notification arrives, and when
you come back to the tab.

**Shared Supabase projects.** Supabase logins belong to the whole project. If
another app uses the same project, its users can sign in here only once a PMS
profile is created for them, and the directory-style tables are readable only
by active PMS members. Deactivating or deleting someone in PMS removes PMS
access only — it never disables a login another app may rely on.

### Free-tier notes (§19)

Aggregate views and `project_overview()` collapse the project header into one
call, timer writes happen only on start/pause/stop, `one_running_timer_per_user`
is a partial unique index rather than a read-then-write, notifications carry a
`(profile_id, read, created_at)` index for the unread badge, and old read
notifications are pruned weekly. Master data (`departments`, `services`) is
cached client-side. Realtime is used for the current user's notifications only.

---

## Scripts

```bash
npm run dev            # Turbopack dev server
npm run build          # production build
npm run start          # serve the build
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npm run create-admin   # first Super Admin (see above)
```
