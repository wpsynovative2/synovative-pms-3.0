# Synovative PMS

An in-house project management system for a digital marketing agency serving
real-estate companies in Mumbai. Built to the spec in [Doc.md](Doc.md) — one web
app for every employee, whose menus, pages and actions adapt to the signed-in
user's role.

```bash
npm install
npm run dev      # http://localhost:3000
```

Sign in with any demo account from the login screen — tap a role chip to fill the
form. Each one shows a different slice of the permission matrix.

| Role                | Email                     | Password       |
| ------------------- | ------------------------- | -------------- |
| Super Admin         | `super@synovative.in`     | `super123`     |
| Admin               | `admin@synovative.in`     | `admin123`     |
| Manager             | `manager@synovative.in`   | `manager123`   |
| HR Admin            | `hr@synovative.in`        | `hr123`        |
| Team Leader         | `karan@synovative.in`     | `karan123`     |
| Accounts & Finance  | `finance@synovative.in`   | `finance123`   |
| Team Member         | `ashirwad@synovative.in`  | `ashirwad123`  |

The user menu in the top-right also switches between accounts without signing
out, which is the quickest way to see how the same screen changes by role.

---

## What's here

All ten modules from the PRD:

| Module | Route | PRD |
| ------ | ----- | --- |
| Dashboard (running timer, your week, review queue) | `/dashboard` | §11.4 |
| Projects + project detail with tasks, time, expenses, team, activity | `/projects` | §7 |
| Project tasks with the full submission/review lifecycle | `/tasks` | §9, §12 |
| Individual tasks | `/individual-tasks` | §10 |
| Project expenses and the Accounts & Finance verification queue | `/expenses` | §8 |
| Workload with per-person capacity | `/workload` | §14 |
| Vendors directory | `/vendors` | §15 |
| Project & task templates | `/templates` | §13 |
| Reports & analytics (time, delivery, rework, spend) | `/reports` | §16 |
| Working calendar | `/calendar` | §5.4 |
| Users | `/users` | §6 |
| In-app notifications | `/notifications` | §17 |

Behaviour worth pointing at specifically:

- **One timer per user (§11.3.1).** Starting a second timer offers to close the
  first; the pause dialog implements both PRD options — *Done for the day* and
  *Working on a different project*, which stops here and starts there in one step.
- **Auto-stop at 11:59 PM (§11.3.4).** Applied on load in this build; the
  `pg_cron` job is in `supabase/migrations/0003_jobs.sql` for the real backend.
- **Working calendar (§5.4)** drives every task date picker — past dates,
  Sundays, 2nd/4th Saturdays and holidays are disabled and labelled, and HR
  overrides re-open specific days.
- **Project date bounds (§9.1).** Task dates outside the project window are
  disabled in the picker, not just rejected on submit.
- **Rejection reassigns (§12.2).** Status resets to Not Started, the due date can
  move, and every earlier submission, review and time log stays in the history.
- **Expense authority comes from the department, not the role (§4.1)** — anyone
  in Accounts & Finance can verify.

### Design

Only the colour theme and font family come from the reference site (§3):
`#17131F` base, `#5F3CA7` brand accent, with semantic status colours alongside.
Everything is defined as Tailwind v4 tokens in [`app/globals.css`](app/globals.css).

**Font (§20, still open):** the reference site's exact family was not confirmed,
so Inter is the stand-in. It is one line to change — swap the `next/font` import
in [`app/layout.tsx`](app/layout.tsx); every surface reads the `--font-app-sans`
token, so nothing else needs touching.

---

## How it's put together

```
app/
  (app)/            Signed-in surfaces, behind the auth gate
  login/            Sign-in
components/
  layout/           Sidebar, topbar, notification bell, running-timer strip
  task/             Task detail, form, timer, pause/submit/review dialogs
  project/ expense/ Their respective forms
  ui/               Primitives, modal/drawer, selects, working-calendar date picker, rich text
lib/
  types.ts          Domain model
  master-data.ts    Departments, services, statuses, status colours (§5)
  permissions.ts    The §4.2 matrix as functions
  calendar.ts       Working-calendar rules and date formatting (§5.4)
  time.ts           Session maths — start/stop only, elapsed computed (§11.3.5)
  analytics.ts      Project stats, workload, report aggregates (§7.2, §14, §16)
  store.tsx         State, mutations, notification fan-out
supabase/migrations/
  0001_schema.sql   Tables, constraints, aggregate views and RPCs
  0002_rls.sql      Row Level Security — the §4.2 matrix, enforced
  0003_jobs.sql     pg_cron: 11:59 PM auto-stop, due/overdue, pruning
```

### Data layer

This build runs entirely in the browser: state lives in `lib/store.tsx` and
persists to `localStorage`, seeded with a realistic Mumbai agency dataset so
every screen has something to show. That makes the whole app runnable and
reviewable without provisioning anything.

`lib/store.tsx` is the single seam. Every mutation goes through it, and each one
maps to a table or RPC in `supabase/migrations/`:

| Store function | Supabase equivalent |
| -------------- | ------------------- |
| `startTimer` / `pauseTimer` / `switchTimer` | `start_timer()`, `pause_timer()` RPCs |
| `submitTask` | `submit_task()` RPC |
| `reviewTask` | `review_task()` RPC |
| `reviewExpense` | `review_expense()` RPC |
| `createProject` / `createTask` / … | plain inserts under RLS |
| `projectStats` (in `analytics.ts`) | `project_overview()` RPC |

### Moving to Supabase

1. Create a project, then run the three migrations in order (SQL editor, or
   `supabase db push`). `0003_jobs.sql` needs `pg_cron` enabled first.
2. Add `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=…
   NEXT_PUBLIC_SUPABASE_ANON_KEY=…
   SUPABASE_SERVICE_ROLE_KEY=…        # server-side user creation only (§6)
   NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=…
   CLOUDINARY_API_KEY=…
   CLOUDINARY_API_SECRET=…
   ```
3. Replace the bodies of the `lib/store.tsx` functions with Supabase calls. The
   signatures and the components above them do not change.
4. Point the expense form's file input at a Cloudinary signed upload and store
   the returned `secure_url` in `expenses.attachment_url`.

The RLS policies are the real permission boundary — `lib/permissions.ts` only
decides what to show. Both were written from the same §4.2 table.

### Free-tier notes (§19)

Already reflected in the schema: aggregate views and `project_overview()` collapse
the project header into one call, timer writes happen only on start/pause/stop,
`one_running_timer_per_user` is a partial unique index rather than a read-then-write,
notifications carry a `(profile_id, read, created_at)` index for the unread badge,
and old read notifications are pruned weekly. Master data (`departments`,
`services`) is static and cached client-side. Realtime is intended for the
current user's notification stream only.

---

## Scripts

```bash
npm run dev      # Turbopack dev server
npm run build    # production build
npm run start    # serve the build
npm run lint     # eslint
```
