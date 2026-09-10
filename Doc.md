# Agency PMS — Product Requirements Document

**Product:** Project Management System (PMS)
**Client context:** In-house web app for a digital marketing agency serving real-estate companies in Mumbai
**Version:** 1.2 — all open questions resolved

---

## 1. Overview

A single web application used by every employee. The same app adapts its menus, pages and actions to the logged-in user's role.

**Modules**

1. Projects (with Tasks as a child module)
2. Individual Tasks
3. Project Expenses
4. Project & Task Templates
5. Workload
6. Vendors
7. Reports & Analytics
8. User Management
9. Working Calendar
10. Notifications (in-app)

---

## 2. Tech Stack

| Layer          | Technology          |
| -------------- | ------------------- |
| Framework      | Next.js             |
| Language       | TypeScript          |
| Styling        | Tailwind CSS        |
| Database       | Supabase PostgreSQL |
| Authentication | Supabase Auth       |
| Media uploads  | Cloudinary          |
| Hosting        | Vercel              |

Start on the Supabase free tier and optimise API usage (see §19).

---

## 3. Design Reference

Use **only the colour theme and font family** from https://synovative.vercel.app/. Layout and components are designed independently.

| Token                  | Value                       | Source                 |
| ---------------------- | --------------------------- | ---------------------- |
| Base / dark background | `#17131F`                   | Site `theme-color`     |
| Brand accent (purple)  | `#5F3CA7`                   | Site brand graphics    |
| Font family            | **TBD — confirm from site** | Site `next/font` setup |

Semantic status colours (§5.3) sit alongside the brand palette.

---

## 4. Roles & Permissions

### 4.1 Roles

| Role           | Scope          | Notes                                                                                               |
| -------------- | -------------- | --------------------------------------------------------------------------------------------------- |
| Super Admin    | Global         | Full access; the only role that can delete users or assign the Admin role                           |
| Admin          | Global         |                                                                                                     |
| Manager        | Global         |                                                                                                     |
| HR Admin       | Global         | Users (add / edit) and the working calendar                                                         |
| Project Leader | Per project    | Chosen when a project is created; any user can be one. Creates tasks only inside their own projects |
| Team Leader    | Per department | One employee can lead multiple departments. Sees all tasks of their departments                     |
| Team Member    | Own tasks      |                                                                                                     |

Expense approval belongs to members of the **Accounts & Finance** department (a department, not a separate role).

### 4.2 Permission Matrix

✓ = allowed · – = not allowed

| Action                                                        | Super Admin                           | Admin    | Manager  | HR Admin | Project Leader  | Team Leader        | Team Member |
| ------------------------------------------------------------- | ------------------------------------- | -------- | -------- | -------- | --------------- | ------------------ | ----------- |
| Add users                                                     | ✓                                     | ✓        | –        | ✓        | –               | –                  | –           |
| Edit users                                                    | ✓                                     | ✓        | –        | ✓        | –               | –                  | –           |
| Delete users                                                  | ✓                                     | –        | –        | –        | –               | –                  | –           |
| Assign the Admin role                                         | ✓                                     | –        | –        | –        | –               | –                  | –           |
| Manage working calendar                                       | ✓                                     | –        | –        | ✓        | –               | –                  | –           |
| Create projects                                               | ✓                                     | ✓        | ✓        | –        | –               | –                  | –           |
| Edit / delete any project                                     | ✓                                     | ✓        | ✓        | –        | –               | –                  | –           |
| Edit / delete own project                                     | ✓                                     | ✓        | ✓        | –        | ✓               | –                  | –           |
| Create tasks in a project                                     | ✓                                     | ✓        | ✓        | –        | ✓ (own project) | ✓                  | –           |
| View all projects                                             | ✓                                     | ✓        | ✓        | –        | –               | ✓                  | –           |
| View all tasks of a department                                | ✓                                     | ✓        | ✓        | –        | –               | Own departments    | –           |
| View projects where user has ≥ 1 task (incl. all tasks in it) | ✓                                     | ✓        | ✓        | ✓        | ✓               | ✓                  | ✓           |
| Edit a project task (all fields)                              | ✓                                     | ✓        | ✓        | –        | ✓ (own project) | Tasks they created | –           |
| Update status + add remarks on own task                       | ✓                                     | ✓        | ✓        | ✓        | ✓               | ✓                  | ✓           |
| Create / edit individual tasks                                | ✓                                     | ✓        | ✓        | –        | –               | ✓                  | –           |
| Start / pause / submit timer                                  | Assignee                              | Assignee | Assignee | Assignee | Assignee        | Assignee           | Assignee    |
| Review project task submissions                               | ✓                                     | ✓        | ✓        | –        | ✓ (own project) | –                  | –           |
| Review individual task submissions                            | ✓                                     | ✓        | ✓        | –        | –               | –                  | –           |
| Add project expenses                                          | –                                     | –        | –        | –        | ✓ (own project) | –                  | –           |
| Approve / reject expenses                                     | Accounts & Finance department members |          |          |          |                 |                    |             |
| Manage templates                                              | ✓                                     | ✓        | –        | –        | –               | –                  | –           |
| Workload                                                      | ✓                                     | ✓        | ✓        | –        | –               | Own departments    | –           |
| Reports & Analytics                                           | ✓                                     | ✓        | ✓        | –        | –               | Own departments    | –           |
| In-app notifications                                          | ✓                                     | ✓        | ✓        | ✓        | ✓               | ✓                  | ✓           |

---

## 5. Master Data

### 5.1 Departments

1. Graphic Designers
2. Videographers / Video Editors / Motion Graphics
3. Social Media Marketing
4. Project Managers
5. Performance Marketers
6. 3D Artists
7. Website Developers
8. Business Development Executives
9. Inside Sales Executives
10. Accounts & Finance
11. Human Resources & Admin
12. Content Writers / Copywriters / Brand Strategists

### 5.2 Services

Duplicates in the original list ("AI Video Production & Digital Presenter Creation" and "Influencer Artist") have been removed.

1. Social Media Management Services
2. Facebook Ads Campaign
3. Google Ads
4. YouTube Ads
5. Static Creative Design
6. Video Editing
7. Brochure Design and Conceptualization
8. Drone Shoot and Edit
9. Hosting
10. Logo Design
11. Website Design and Development
12. Drone Rental
13. Leads Automation
14. Site Branding and Conceptualization
15. Campaign Design
16. Hoarding Printing and Installation
17. Motion Graphics
18. Hoarding Design and Conceptualization
19. Hoarding Design and Edits
20. SEO Service
21. Brand PPT Creation
22. Creative Post
23. Festival and Event Creative
24. Reel Editing
25. Video Shoot & Editing
26. Design and Conceptualization
27. Storyboard Video
28. Voice-Over
29. Videography & Photography
30. Channel Partner Kit
31. Website Annual Renewal
32. Domain
33. Website Maintenance
34. CP Meet Campaign
35. Landing Page
36. Social Account Setup
37. Licensed Images
38. Performance Marketing
39. Influencer Artist
40. 3D Walkthrough Animation
41. CGI Video
42. Monthly Retainer
43. Pamphlet Design
44. Newspaper Insertion
45. AI Video Production & Digital Presenter Creation
46. Project Launch Campaign Design
47. General Campaign Design
48. Online Reputation Management (ORM)
49. Bhoomi Pooja Event
50. Corporate Brand Identity & Communication

### 5.3 Status & Priority Values

**Project status:** Planning · Active · On Hold · Completed · Cancelled · Archived

**Priority (projects & tasks):** Low · Medium · High · Critical

**Task status and colours**

| Status           | Colour    | Meaning                                  | Set by                         |
| ---------------- | --------- | ---------------------------------------- | ------------------------------ |
| Not Started      | Grey      | Assigned, timer not started              | System (on assign / reassign)  |
| In Progress      | Blue      | Work under way (timer running or paused) | Assignee                       |
| Submitted        | Amber     | Awaiting review                          | Assignee (via submission form) |
| Changes Required | Orange    | Sent back to assignee                    | Reviewer                       |
| Rejected         | Red       | Rejected and reassigned (§12.2)          | Reviewer                       |
| Approved         | Green     | Accepted — task complete                 | Reviewer                       |
| Overdue (flag)   | Red badge | Due date passed and not Approved         | System                         |

While In Progress, a small indicator shows whether the timer is **Running** or **Paused**.

### 5.4 Working Calendar

Managed by Super Admin and HR Admin. Applies to every task date picker (start date and due date).

1. Disable all past dates.
2. Disable all Sundays.
3. Disable the 2nd and 4th Saturday of every month.
4. Disable company holidays.
5. HR Admin can mark any non-working day as a working day (override) and can add holidays.

---

## 6. User Management

| Action       | Who                          |
| ------------ | ---------------------------- |
| Add users    | Super Admin, Admin, HR Admin |
| Edit users   | Super Admin, Admin, HR Admin |
| Delete users | Super Admin only             |

**Add / edit user form**

| Field              | Type            | Required     | Notes                                                                               |
| ------------------ | --------------- | ------------ | ----------------------------------------------------------------------------------- |
| Full name          | Text            | Yes          |                                                                                     |
| Email              | Email           | Yes          | Unique; used as login ID                                                            |
| Temporary password | Password        | Yes (on add) | User must change it at first login (recommended)                                    |
| Role               | Dropdown        | Yes          | Manager, HR Admin, Team Leader, Team Member. **Admin** appears only for Super Admin |
| Department(s)      | Dropdown (§5.1) | Yes          | Multi-select when role is Team Leader                                               |

Notes:

- Users are created server-side through Supabase Auth.
- Deactivating a user is recommended over hard deletion so task history, time logs and reviews are preserved.

---

## 7. Projects

### 7.1 Create / Edit Project

Created by Super Admin, Admin or Manager. Can start blank or from a project template (§13).

| Field                   | Type                | Required | Notes                                 |
| ----------------------- | ------------------- | -------- | ------------------------------------- |
| Project name            | Text                | Yes      |                                       |
| Project colour          | Colour picker       | Yes      | Preset swatches + custom `#hex` input |
| Client name             | Text                | Yes      |                                       |
| Requirements / Services | Multi-select (§5.2) | Yes      |                                       |
| Start date              | Date                | Yes      |                                       |
| Deadline                | Date                | Yes      | Must be on or after start date        |
| Description             | Rich text           | No       |                                       |
| Status                  | Dropdown (§5.3)     | Yes      | Default: Planning                     |
| Priority                | Dropdown (§5.3)     | Yes      |                                       |
| Project Leader          | Single select       | Yes      | Any user, Super Admin to Team Member  |
| Team Members            | Multi-select        | No       |                                       |
| Project expenses        | Line items          | No       | See §8                                |

Reference: `image.png`

### 7.2 Project Detail Page

Reference: `image-1.png`

- Header: name, colour, client, status, priority, project leader, start date, deadline
- **Progress bar:** approved tasks ÷ total tasks
- **Total time spent:** sum of all time logs across all tasks in the project
- Team members
- Task timeline (§9.3)
- Expenses tab (§8)

---

## 8. Project Expenses

**Flow:** Project Leader adds expense → Accounts & Finance verifies → Approve or Reject.

Used for outside vendors such as drone videographers, property-shoot models, etc.

| Field               | Type                    | Required  | Notes                         |
| ------------------- | ----------------------- | --------- | ----------------------------- |
| Vendor              | Select (Vendors module) | Yes       |                               |
| Expense description | Text                    | Yes       | e.g. drone video shoot        |
| Amount (₹)          | Number                  | Yes       |                               |
| Expense date        | Date                    | Yes       |                               |
| Bill / attachment   | File                    | No        |                               |
| Status              | System                  | —         | Pending → Approved / Rejected |
| Finance remarks     | Text                    | On reject |                               |
| Reviewed by / at    | System                  | —         |                               |

Rules:

- The Project Leader can edit or delete an expense only while it is Pending.
- The project shows total expenses split into Approved and Pending.

---

## 9. Project Tasks

### 9.1 Create / Edit Task

Created by Super Admin, Admin, Manager, the project's Project Leader, or any Team Leader.

| Field           | Type            | Required | Notes                                                                  |
| --------------- | --------------- | -------- | ---------------------------------------------------------------------- |
| Task title      | Text            | Yes      |                                                                        |
| Description     | Rich text       | No       |                                                                        |
| Department      | Dropdown (§5.1) | Yes      |                                                                        |
| Assigned to     | Dropdown        | Yes      | Lists only users in the selected department                            |
| Status          | Dropdown (§5.3) | Yes      | Default: Not Started                                                   |
| Priority        | Dropdown (§5.3) | Yes      |                                                                        |
| Start date      | Date            | Yes      | Working calendar (§5.4) + within project dates                         |
| Due date        | Date            | Yes      | Working calendar (§5.4) + within project dates; on or after start date |
| Estimated hours | Number          | Yes      |                                                                        |
| Tags            | Text            | No       | Comma-separated, stored as a list                                      |

**Date validation:** task start and due dates must fall between the project's start date and deadline. Dates outside that range are disabled in the picker.

### 9.2 Ordering

Tasks are shown in creation order — first created, first shown.

### 9.3 Display

Vertical timeline; each node is coloured by its task status (§5.3).

```
│
● Task 1
│
● Task 2
│
● Task 3
│
```

### 9.4 Team Member Access on Their Own Task

| Can                                                                                   | Cannot                                                                                    |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Update work status (Not Started → In Progress → Submitted) via Start / Pause / Submit | Change title, description, department, assignee, priority, dates, estimated hours or tags |
| Add remarks for the reviewer                                                          | Set Approved, Changes Required or Rejected (reviewers only)                               |

Remarks appear as a thread on the task, visible to everyone who can see the task.

---

## 10. Individual Tasks

Same fields, time tracking, submission and review flow as project tasks, but:

- No parent project
- No project leader
- No project-date range check (only the working calendar applies)

**Create / edit:** Super Admin, Admin, Manager, Team Leader.
Project Leaders cannot create individual tasks — they create tasks only inside their own projects.

**Review:** any one of Super Admin, Admin, Manager.

---

## 11. Time Tracking

### 11.1 Timer Controls

| Button | Shown when                                            | Action                                                |
| ------ | ----------------------------------------------------- | ----------------------------------------------------- |
| Start  | Not Started, or after Changes Required / reassignment | Starts a session; status → In Progress                |
| Pause  | Timer running                                         | Opens the pause dialog (§11.2)                        |
| Resume | Timer paused                                          | Starts a new session                                  |
| Submit | In Progress                                           | Stops the timer and opens the submission form (§12.1) |

### 11.2 Pause Dialog

| Option                            | Meaning             | What happens                                                                                                                                                                 |
| --------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Done for the day               | Working hours ended | Current session stops with reason "End of day". Task stays In Progress (Paused). User resumes on the next working day.                                                       |
| 2. Working on a different project | Switching work      | User selects a project, then one of their own tasks in it. Current session stops with reason "Switched to <project>", and the timer on the selected task starts immediately. |

### 11.3 Rules

1. Only one timer can run per user. Starting a timer on another task while one is running opens the pause dialog first.
2. Each session stores start time, end time and end reason (End of day / Switched / Submitted / Auto-stopped).
3. Total time per task = sum of all its sessions, including rework after Changes Required.
4. **Auto-stop:** any timer still running at **11:59 PM** is stopped automatically. The session ends with reason "Auto-stopped", the task stays In Progress (Paused), and the assignee gets an in-app notification.
5. Store only start and stop timestamps; compute elapsed time in the browser — no per-second database writes.

### 11.4 Running Timer on Dashboard

The user's dashboard shows their currently running task at the top: task title, project name, live elapsed time, and **Pause** / **Submit** buttons. This makes a forgotten timer easy to spot before the 11:59 PM auto-stop.

---

## 12. Task Submission & Review

### 12.1 Submission (by assignee)

| Output location | Fields                                                     |
| --------------- | ---------------------------------------------------------- |
| Google Drive    | Drive link (required, valid URL) + Description (rich text) |
| WhatsApp        | Description (rich text) only                               |

On submit: timer stops, status becomes Submitted.

### 12.2 Review

- **Project tasks:** any one of Project Leader (own project), Manager, Admin, Super Admin.
- **Individual tasks:** any one of Manager, Admin, Super Admin.

| Decision         | Extra fields                                                                                                     | Result                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Approve          | Remarks (rich text)                                                                                              | Status → Approved                                                                          |
| Changes Required | Source: Client / Project Leader + Remarks (rich text)                                                            | Status → Changes Required; same assignee reworks and resubmits                             |
| Reject           | Source: Client / Project Leader + Remarks (rich text) + New assignee (department → user; can be the same person) | Task is **reassigned** to the selected user; status → Not Started; due date can be updated |

After reassignment, the earlier submissions, reviews and time logs stay in the task history.

### 12.3 Submission History

Every submission and review is kept and shown as a chronological timeline on the task:

```
│
● Rejected — reassigned to <user>
│
● Changes Required
│
● Approved
│
```

Each entry shows: decision, source (client / project leader), reviewer, date & time, remarks, the submission's link and description, and the new assignee for rejections.

---

## 13. Project & Task Templates

Managed (create / update / delete) by Super Admin and Admin.

- **Project template:** project defaults plus an ordered list of tasks. A project template can also be saved without tasks.
- **Task template:** a standalone reusable task.
- **Using a project template:** the creator fills in the project form (pre-filled from the template) and all template tasks are created together with the project. Assignees and dates are set during creation.

---

## 14. Workload

Reference: `image-2.png`

**Access:** Super Admin, Admin, Manager (all departments); Team Leader (own departments only).

Per-user view of assigned tasks and estimated hours by day / week, filterable by department, with over-allocated users highlighted.

---

## 15. Vendors

Directory of outside vendors (name, service type, contact, rate) used when adding project expenses.

---

## 16. Reports & Analytics

**Access:** Super Admin, Admin, Manager (all departments); Team Leader (own departments only).

- Time spent by project, user and department
- Estimated vs actual hours
- On-time vs overdue task completion
- Changes Required / Rejected counts, split by client vs project leader
- Reassignment count per task and per user
- Project expenses by project, vendor and month

---

## 17. Notifications (In-App)

Channel: in-app only — bell icon with unread count, notification list, mark as read.

| Event                                                    | Recipient                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Task assigned or reassigned                              | New assignee                                                                         |
| Task submitted                                           | Project Leader (project tasks) / Super Admin, Admins and Managers (individual tasks) |
| Review decision (Approved / Changes Required / Rejected) | Assignee                                                                             |
| Remark added by assignee                                 | Project Leader (project tasks) / Super Admin, Admins and Managers (individual tasks) |
| Expense added                                            | Accounts & Finance department members                                                |
| Expense approved / rejected                              | Project Leader                                                                       |
| Task due tomorrow / overdue                              | Assignee                                                                             |
| Timer auto-stopped at 11:59 PM                           | Assignee                                                                             |

---

## 18. Filters

Provide filters wherever lists appear.

| Screen           | Filters                                                                    |
| ---------------- | -------------------------------------------------------------------------- |
| Projects         | Status, priority, client, service, project leader, team member, date range |
| Tasks            | Status, priority, department, assignee, due date range, tags               |
| Individual Tasks | Status, priority, department, assignee, due date range                     |
| Expenses         | Status, project, vendor, date range                                        |
| Workload         | Department, user, date range                                               |
| Reports          | Date range, project, department, user                                      |
| Notifications    | Read / unread, type                                                        |

---

## 19. Supabase Free-Tier Guidelines

- Enforce role access with Row Level Security policies, not only in the UI.
- Paginate every list.
- Compute project totals (time spent, progress, expenses) with SQL views or RPC functions — one call instead of many.
- Timer writes only on start, pause and stop (§11).
- Run the 11:59 PM auto-stop as a scheduled database job (Supabase `pg_cron`), set to India time (IST = UTC + 5:30).
- Cache master data (departments, services) on the client.
- Use a Realtime subscription only for the current user's notifications; fetch everything else on demand.

---

## 20. Pending

1. **Font family:** confirm from the reference site (§3).
