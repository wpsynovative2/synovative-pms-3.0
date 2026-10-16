# System Inventory — architecture

A module that records every piece of IT hardware Synovative owns: what it is,
its details, a unique ID for each piece, where it is right now, who is
responsible for it, and everything that ever happened to it.

**Status:** design only. No SQL, tests or app code exist yet. Section 15 lists
the decisions to settle before building; section 16 lists what changed from
the two earlier drafts.

---

## 1. What it answers

The test of the design is whether these are one click away:

- What is in **WS-012**, and who has it?
- Where is **SYN-RAM-0031** now, and where has it been?
- Do we have a **spare 16 GB DDR4** stick, and which shelf is it on?
- Which **warranties end** this month?
- What must **Rohan hand back** before he is deactivated?
- Which machines have **less than 16 GB RAM or no SSD**? (upgrade planning)
- Does **what is on the floor match the register**? (annual check)

---

## 2. Words used in this document

| Term | Meaning |
| --- | --- |
| **Asset** | Any tracked physical item with its own asset ID: a RAM stick, a cabinet, a laptop, a monitor. |
| **Category** | The kind of asset (RAM, Monitor…). Decides the ID prefix, where it can go, its spec fields and its default slots. |
| **Model** | A product in the catalogue: manufacturer + name + specs. Many assets share one model. |
| **Host** | An asset that holds parts: a **Cabinet** (system unit) or a **Laptop**. |
| **Workstation** | A desk setup. Not hardware itself; it groups a cabinet, monitors and peripherals, and is assigned to a person. |
| **Location** | A place where unplaced things are kept or sent: "Store room · Shelf B", "Out for repair". |
| **Position** | Where an asset is now. Exactly one of: inside a host, at a workstation, with a person, at a location (section 3). |
| **Assignment** | A period during which a person is responsible for a workstation or an issued asset, with a start, an end and an acknowledgement. |
| **Status** | Lifecycle state: Active, Under repair, Retired, Disposed, Lost. |
| **Event** | One line of history. Written only by the database. |
| **Operation** | One user action, which can write several events (a swap writes three). |
| **Inventory manager** | Whoever may change the register: Super Admin, Admin, and the Human Resources & Admin department (section 10). |

---

## 3. How things fit together

```
Workstation  WS-012  "Design bay · Desk 4"          → assigned to: Neha Choudhari
├── Cabinet   SYN-CAB-0012  Cooler Master Q300L
│   ├── Motherboard  SYN-MBD-0012  ASUS B550M               (1 of 1)
│   ├── Processor    SYN-PRC-0012  Ryzen 5 5600             (1 of 1)
│   ├── RAM          SYN-RAM-0031  Kingston Fury 16 GB DDR4 (1 of 4 — from the motherboard)
│   ├── RAM          SYN-RAM-0032  Kingston Fury 16 GB DDR4 (2 of 4)
│   ├── Storage      SYN-STO-0019  512 GB NVMe SSD
│   ├── GPU          SYN-GPU-0007  RTX 3060 12 GB
│   └── PSU          SYN-PSU-0012  650 W
├── Monitor   SYN-MON-0021  Dell P2422H 24"
├── Monitor   SYN-MON-0022  Dell P2422H 24"
├── Keyboard  SYN-KBD-0012
├── Mouse     SYN-MOU-0012
└── UPS       SYN-UPS-0004

Laptop  SYN-LAP-0003  Dell Latitude 5440            → issued to: Rohan (no desk)
└── RAM  SYN-RAM-0090  8 GB SO-DIMM (upgrade)       (1 of 1 — from the laptop's model)

Store room · Shelf B                                (stock)
├── RAM      SYN-RAM-0040  Kingston Fury 16 GB DDR4    Spare
└── Monitor  SYN-MON-0030  Dell P2422H 24"             Spare
```

### Position: exactly one place

| Position | Column | Responsible person | Example |
| --- | --- | --- | --- |
| Installed in a host | `parent_asset_id` | whoever holds the host | RAM in SYN-CAB-0012 |
| Placed at a workstation | `workstation_id` | the desk's assignee | Monitor at WS-012 |
| Issued to a person | `issued_to` | that person | Laptop with Rohan |
| In stock at a location | `location_id` | nobody — it's spare | RAM on Shelf B |

- Hosts never go inside other hosts, so the tree is never deeper than
  **workstation → host → part**. That keeps every query simple and makes loops
  impossible.
- Moving a host moves everything in it, because parts point at the host, not
  at the desk.
- The responsible person for a part is worked out from its host, never stored
  on the part: a RAM stick in Neha's cabinet is Neha's because the cabinet is
  at her desk.

### Current state and its record

Two things describe who holds something, and they have different jobs:

| | Where | Job |
| --- | --- | --- |
| **Now** | `inventory_assets.issued_to`, `workstations.assigned_to` | The truth about the present. Fast to read, and the one-place rule needs `issued_to` on the asset row. |
| **The record** | `inventory_assignments` | Every period: start, end, acknowledgement, return condition. Answers "who had it in March?" and is what a person acknowledges. |

Only the functions in section 7 change either, always both in the same
transaction. A deferred constraint trigger, `inventory_assignment_in_step`,
refuses any transaction that leaves them disagreeing (an open assignment
without the matching column, or the reverse), and the tests check it.

### Status and position

| Status | Position | Shown in the app as |
| --- | --- | --- |
| Active | exactly one | **In use** (in a host, at a desk, with a person) or **Spare** (at a location) |
| Under repair | exactly one: where it was found faulty while diagnosed, or a location such as "Out for repair" | Under repair |
| Retired | exactly one location (it sits in store until disposed) | Retired |
| Disposed | none; final | Disposed |
| Lost | none | Lost |

Allowed changes:

| From | Can become |
| --- | --- |
| Active | Under repair, Retired, Lost |
| Under repair | Active, Retired, Lost |
| Retired | Active (back in use), Disposed, Lost |
| Lost | Active (found — needs a location), Disposed (written off) |
| Disposed | Nothing; final |

- A host must be empty before it is retired, disposed or marked lost.
- An under-repair asset can only move to a location until it is fixed; it
  can't be installed, placed or issued.

---

## 4. Categories, models and specs

### Categories (seeded, editable)

| Category | Prefix | Holds parts | Goes inside | At a desk | Issued to a person | QR label | Key specs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Cabinet (system unit) | `CAB` | ✓ | — | ✓ | | ✓ | Form factor, colour |
| Laptop | `LAP` | ✓ | — | ✓ (docked) | ✓ | ✓ | Processor, built-in RAM, storage, screen, free RAM / storage slots |
| Processor | `PRC` | | Cabinet | | | | Cores, threads, clocks, socket |
| Motherboard | `MBD` | | Cabinet | | | | Socket, RAM slots, RAM type, max RAM, M.2 slots |
| RAM | `RAM` | | Cabinet, Laptop | | | | Capacity, DDR type, speed, DIMM / SO-DIMM |
| Storage ("ROM") | `STO` | | Cabinet, Laptop | | | | NVMe SSD / SATA SSD / HDD, capacity |
| Graphics card | `GPU` | | Cabinet | | | | Chipset, VRAM |
| Power supply | `PSU` | | Cabinet | | | | Wattage, 80+ rating |
| Monitor | `MON` | | — | ✓ | ✓ | ✓ | Size, resolution, panel, refresh |
| Keyboard | `KBD` | | — | ✓ | ✓ | | Wired / wireless |
| Mouse | `MOU` | | — | ✓ | ✓ | | Wired / wireless |
| UPS | `UPS` | | — | ✓ | | ✓ | VA rating |
| Accessory | `ACC` | | — | ✓ | ✓ | | Headphones / webcam / speaker / dock |
| Other | `OTH` | | — | ✓ | ✓ | ✓ | Description |

- **Laptops:** built-in (soldered) RAM and storage are specs on the laptop's
  model. Only removable parts added later (an extra SO-DIMM, a second SSD) are
  tracked as separate assets inside the laptop.
- **New categories** (printer, router, phone, camera, CCTV…) are added in the
  module's Settings tab by Super Admin or Admin: name, 3-letter prefix, the
  placement ticks above, spec fields and default slots. No code change.

### Spec fields

Each category carries its fields as a schema:

```json
[
  { "key": "capacity_gb", "label": "Capacity", "type": "number", "unit": "GB", "required": true },
  { "key": "ram_type",    "label": "Type",     "type": "select", "options": ["DDR3", "DDR4", "DDR5"], "required": true },
  { "key": "speed_mhz",   "label": "Speed",    "type": "number", "unit": "MHz" },
  { "key": "form",        "label": "Form",     "type": "select", "options": ["DIMM", "SO-DIMM"] }
]
```

- The **form** is drawn from this schema, and the **database** checks every
  model against the same schema (`inventory_spec_errors(category, specs)`):
  required fields present, numbers are numbers, choices come from the list, no
  unknown keys. Screen and database can't disagree.
- Numbers are stored as numbers with a fixed unit (GB, MHz, W), so "machines
  with less than 16 GB RAM" is a real query, not a text search.
- **Changing a schema later.** Saving a category's schema re-checks every model
  of that category in the same statement. If any model would fail, the save is
  refused with the list ("3 models are missing Speed: …"). Adding an optional
  field or a new choice always succeeds; making a field required means filling
  it on existing models first. Removing a field also removes that key from
  every model of the category, logged as one operation.

### Models (the catalogue)

| Field | Notes |
| --- | --- |
| Category, manufacturer, name | Unique together, ignoring case and spaces |
| Part number | Optional (helps reorders) |
| Specs | Checked against the category schema |
| Slots | Hosts only, optional. Overrides the category's default slots (section below) |
| Default warranty (months) | Fills each asset's warranty end from its purchase date |
| Minimum spares | Below this, the Stock tab and a digest flag it |

Spare counts, filters, the one-line spec summary on a desk card
("Ryzen 5 5600 · 32 GB · 512 GB SSD · RTX 3060") and reordering all come from
models.

### Slot limits

Limits come from, in order: the **installed motherboard** (RAM only), then the
**host's model**, then the **category default**.

| Host | Category default |
| --- | --- |
| Cabinet | 1 motherboard, 1 processor, 1 PSU, 2 GPUs, 6 storage, RAM = the installed motherboard's `ram_slots`, or 4 with no motherboard recorded |
| Laptop | 1 RAM, 1 storage. A model with two free SO-DIMM slots says so on the model |

The guard checks every change that affects a limit, not only installs:

- Installing a part beyond the limit is refused.
- **Installing a motherboard** with fewer RAM slots than the sticks already in
  the cabinet is refused ("SYN-CAB-0012 holds 4 × RAM; this motherboard has 2
  slots").
- **Removing a motherboard** is refused if more RAM is left than the fallback
  of 4.
- Changing a host model's slots, or a category's default, is refused while any
  host would end up over its new limit.

### Compatibility warnings (screen only)

When installing, the app **warns** (does not block) if: the processor socket
differs from the motherboard's; the RAM type (DDR4/DDR5) or form (DIMM /
SO-DIMM) doesn't match the motherboard or laptop; total RAM exceeds the
motherboard's maximum. Warnings, not rules, because older parts will often be
entered with incomplete specs.

---

## 5. Asset IDs and labels

- **Format:** `SYN-<PREFIX>-<0001>`, e.g. `SYN-RAM-0031`. Desks: `WS-001`.
- **Generated by the database** from a counter per category
  (`inventory_categories.next_number`), taken under a row lock so two people
  adding at once never get the same number.
- **Never reused.** A number is spent once taken, even if the record is later
  deleted as a mistake, so a deleted mistake leaves a gap. Gaps are expected
  and harmless; reuse is what would break printed labels.
- **Never cut off.** After 9999 it grows to five digits. Plain `lpad(n, 4)`
  would turn 10000 into `1000`; the tests cover this.
- **Tag and category are locked** once saved, so the prefix can never lie. A
  wrong category is fixed by deleting the mistaken record and entering it
  again; if it already has history, retire it with a note and re-enter it.
- **Serial number** is stored separately and must be unique when filled in
  (ignoring case and spaces). Leave it blank for cheap peripherals that all
  print the same serial.
- **Physical labels** only on categories ticked "QR label": cabinets, laptops,
  monitors, UPS, Other. A sticker on a RAM stick inside a closed cabinet helps
  nobody; internal parts are identified by their manufacturer serial.
- **The QR code holds a link with the tag**, `https://<pms-domain>/a/SYN-CAB-0012`,
  not the database ID, so labels outlive any data migration. Scanning opens
  the asset after login.
- If machines already carry old stickers, the old number goes in an optional
  `legacy_tag` field and stays searchable (decision 6).

---

## 6. Database

### Migration files

Append-only, numbered after the baseline (`0001`–`0008`):

| File | Holds |
| --- | --- |
| `0009_inventory_notification_types.sql` | The new `notification_type` values (`inventory_assigned`, `inventory_returned`, `inventory_digest`). Its own file because Postgres can't use a new enum value in the transaction that adds it |
| `0010_system_inventory.sql` | Phase 1: tables, rules, tag generation, history triggers, functions, Row Level Security, grants, category seed, digest jobs |
| `0011_…` onwards | One file per later phase: purchases and costs, repairs, disposals, audits |

Add each to the "Folded into" style table in ARCHITECTURE.md §8 once shipped.

### Phase 1 tables

**`inventory_categories`** — `code` (= prefix, primary key, 3 capital
letters), `name`, `is_host`, `installs_in` (host codes), `at_workstation`,
`issuable`, `labelled`, `spec_schema`, `slots`, `next_number` (not writable
from the app), `sort_order`, `active`.

**`inventory_models`** — `id`, `category`, `manufacturer`, `name`,
`part_number`, `specs`, `slots` (hosts only), `warranty_months`, `min_spare`,
`active`, `notes`, `created_by`, `created_at`, `updated_at`.

**`inventory_locations`** — `id`, `name`, `parent_id` (Office → Floor → Room),
`kind` (site / floor / room / store / external), `active`, `sort_order`.
Seeded with "Store room" and "Out for repair" (external).

**`workstations`** — `id`, `code` (WS-001, generated), `name`, `location_id`,
`assigned_to` (current; see section 3), `archived_at`, `notes`, audit columns.

**`inventory_assets`**

| Column | Notes |
| --- | --- |
| `id` | uuid |
| `asset_tag` | Generated, unique, locked |
| `legacy_tag` | Optional; searchable |
| `category` | Locked after saving |
| `model_id` | Composite foreign key `(model_id, category)`, so an asset's model is always of the asset's category |
| `serial_number` | Unique when filled, ignoring case and spaces |
| `condition` | new / good / fair / faulty |
| `status` | active / under_repair / retired / disposed / lost |
| `parent_asset_id`, `workstation_id`, `issued_to`, `location_id` | The position — see section 3 |
| `purchase_date`, `warranty_until` | Warranty filled from the model |
| `last_verified_at` | Set by physical verification (phase 3) |
| `notes`, `created_by`, `created_at`, `updated_at` | |

**`inventory_assignments`** — `id`, `workstation_id` *or* `asset_id` (exactly
one), `profile_id`, `profile_name` (snapshot), `started_at`, `ended_at`,
`assigned_by`, `ended_by`, `acknowledged_at`, `return_condition`, `notes`. At
most one open assignment per desk and per asset (partial unique indexes).

**`inventory_events`** (history) — `id`, `at`, `actor`, `actor_name`
(snapshot), `operation_id`, `asset_id`, `workstation_id`, `profile_id`,
`kind`, `from_place`, `to_place`, `changes`, `note`.

- `kind`: added, edited, installed, placed, issued, stocked, removed, status,
  assigned, unassigned, acknowledged, archived, restored, deleted, verified.
- `from_place` / `to_place` are snapshots with a readable label
  (`{"type":"asset","label":"SYN-CAB-0012","workstation_id":…}`), so history
  still reads correctly after things move or are renamed.
- A desk's history includes parts that left it, through
  `from_place.workstation_id`.
- `changes` holds edits as `{"serial_number": ["DL-1", "DL-1A"]}`.

### People who leave or are removed

PMS can deactivate or delete a profile. The inventory has to survive both:

| Reference | On profile delete | Why |
| --- | --- | --- |
| `inventory_assets.issued_to`, `workstations.assigned_to`, open assignments | **restrict** | Someone holding equipment can't vanish from the register |
| History (`inventory_events.actor`, `profile_id`) and closed assignments | **set null**, with the `*_name` snapshot kept | History stays readable: "Returned by Rohan Mehta" |
| `created_by`, `assigned_by`, `ended_by` | set null | As elsewhere in the schema |

**Deactivation** is guarded by its own trigger, `inventory_guard_deactivation`,
on `profiles` (a new trigger — `guard_profile_update` in the baseline is not
edited). Turning `active` off for someone who still holds a desk or an issued
asset is refused with the list: "Rohan Mehta still holds SYN-LAP-0003 and
SYN-MON-0030. Return them from System Inventory first." Triggers fire for the
service-role key too, so this also holds for `/api/admin/users`. Decision 7
asks whether this should block (as designed) or only warn.

### Rules the database enforces

| Rule | How |
| --- | --- |
| Active, under-repair and retired assets are each in exactly one place; disposed and lost are nowhere; retired is only at a location | Check constraint `inventory_asset_position` |
| Each category only goes where its ticks allow (inside which hosts, at a desk, to a person) | Trigger `inventory_guard_asset` |
| Hosts never go inside anything | Category check + same trigger |
| Slot limits, including motherboard installs and removals (section 4) | Same trigger, which locks the host row so two people can't fill the last slot at once |
| Nothing is installed into a host that isn't active; a host can't be retired, disposed or lost while it holds parts | Same trigger |
| Disposed is final | Same trigger |
| Only the status changes in section 3 | `inventory_set_status` |
| Under-repair assets only move to a location | `inventory_move` |
| Tags generated, never reused, never cut off; tag and category locked | Tag trigger + guard trigger |
| An asset's model is of the same category | Composite foreign key |
| Model specs match the category schema; a schema change can't strand models | `inventory_spec_errors`, on model save and on category schema save |
| Desks and assets go only to active people | Guard triggers |
| One open assignment per desk and per asset | Partial unique indexes |
| Assignments and the current columns agree | Deferred constraint trigger `inventory_assignment_in_step` |
| A desk is archived only when empty and unassigned | Trigger `inventory_guard_workstation` |
| Nobody holding equipment is deactivated | Trigger `inventory_guard_deactivation` |
| Every move, status change, assignment and edit is logged with who, when, operation and note | `after` triggers; nobody can write to `inventory_events` |
| Position, status and assignment change only through the functions below | Grants (next section) |
| Only mistakes are deleted | `inventory_delete_mistake`: Super Admin, and only if the asset was never placed, moved, assigned or changed status |

### Grants

Supabase gives `anon` and `authenticated` **every** privilege on a new table by
default. The migration starts by revoking all of it on every inventory table,
then grants only:

| Table | `authenticated` may |
| --- | --- |
| `inventory_assets` | select; insert none (assets are added by `inventory_add_assets`); update only `model_id`, `serial_number`, `legacy_tag`, `condition`, `purchase_date`, `warranty_until`, `notes` |
| `inventory_models`, `inventory_locations` | select, insert, update (RLS limits writes to inventory managers) |
| `inventory_categories` | select; insert and update of every column except `next_number` (RLS: Super Admin / Admin) |
| `workstations` | select; insert; update only `name`, `location_id`, `notes` |
| `inventory_assignments` | select; update only `notes` |
| `inventory_events` | select only |

`anon` gets nothing. Every function is `revoke all … from public` then
`grant execute … to authenticated`, as `start_content_piece` is in `0007_rls`.
Internal helpers (`inventory_begin`, `inventory_log_event`, `inventory_place`,
the trigger functions) get no execute grant at all. The tests check each line
of this table.

### Read rules (Row Level Security)

| Who | Reads |
| --- | --- |
| `can_view_inventory()` (section 10) | Everything except costs |
| Team Leader (decision 3) | The holdings of people in their departments |
| Anyone else | Their own: assets issued to them, at a desk assigned to them, and **parts inside a host** that is either |

The own-items rule has to look through hosts, so it is a set-returning helper,
`my_inventory_asset_ids()`, used in the policy as
`id = any ((select my_inventory_asset_ids())::uuid[])` — evaluated once per
query, not once per row (ARCHITECTURE.md §11, trap 2). The same pattern covers
workstations and assignments.

### Functions the app calls

| Function | Does |
| --- | --- |
| `inventory_add_assets(model, count, serials[], one position, condition, purchase_date, note)` | Registers 1–200 assets of one model in one go, each with its own tag; fills warranty; opens an assignment if issued to a person |
| `inventory_move(asset, exactly one destination, note)` | Install, place, issue or put back in stock. Closes and opens personal assignments as needed |
| `inventory_set_status(asset, status, location?, note)` | Lifecycle changes; with a location, also moves it there |
| `inventory_swap(out, in, out_location, out_status = under_repair, note)` | Replaces a part in one action; the spare takes the exact slot |
| `inventory_assign_workstation(desk, person or null, note)` | Assigns, reassigns or unassigns a desk |
| `inventory_archive_workstation(desk)` / `inventory_restore_workstation(desk)` | Archive only when empty and unassigned |
| `inventory_acknowledge(assignment)` | The holder confirms receipt (holder only) |
| `inventory_return_all(person, location, condition, note)` | Clearance before deactivation: unassigns their desk(s) and returns every issued item |
| `inventory_delete_mistake(asset)` | Super Admin only |

All are `security definer`, `set search_path to 'public'`, and each re-checks
its own permission, as the existing workflow functions do.

**How history knows who and why.** Every function starts with
`inventory_begin(note)`, which checks permission and stores an operation ID
and the note in transaction-local settings. The history trigger reads them,
plus `auth.uid()` for the actor. Nested calls (a swap calls move twice) share
the outer operation. An event with no actor (a maintenance script) shows as
"System".

**Errors are sentences.** Functions raise messages written for the screen —
"SYN-CAB-0012 already holds 2 × RAM (limit 2)", "Remove the parts inside
SYN-CAB-0012 before marking it retired". `friendlyError()` in `lib/store.tsx`
passes unknown messages through unchanged, **except** ones containing
"already exists", "duplicate key", "permission denied" or "foreign key", which
it replaces with a generic line. Inventory messages must avoid those phrases.

### Size

Even 200 desks × ~13 parts is under 3,000 assets. The whole register loads
into the store comfortably (`fetchAll` pages past PostgREST's 1,000-row cap;
order by `asset_tag`, which is unique). History and closed assignments are
**not** loaded up front; drawers fetch them when opened.

---

## 7. Workflows

**New purchase arrives**
1. (Phase 2) Record the purchase: vendor, invoice, file.
2. Add assets: pick the model (or create it), enter the quantity, scan
   serials into the grid, choose the store location.
3. (Phase 2) Print QR labels for the labelled ones.

**Build or rebuild a PC**
1. Open the cabinet (or add it). Empty slots show as "RAM 2 / 4".
2. Install parts from spares; compatible models are offered first.
3. Place the cabinet at a workstation.

**New joiner**
1. Assign a workstation, or issue a laptop.
2. They get a notification and see it on their Profile.
3. They tap **Acknowledge**. Handovers unacknowledged after 3 days show on the
   Overview and in the daily digest.

**Faulty part**
1. In the cabinet, choose **Swap** on the faulty part, pick a spare.
2. One operation: the faulty part goes to "Out for repair" as Under repair;
   the spare takes its slot. Both moves share the note ("RAM fault").

**Repair** (phase 2)
1. Open a repair: issue, vendor, warranty claim or not.
2. Close it: repaired → Active, back in stock; beyond repair → Retired.

**Desk moves**
- Reassign the workstation to someone else, or move the cabinet to another
  workstation; its parts go with it.

**Someone leaves**
1. The People tab and the person's drawer show "IT assets: 2 held" with the
   list. HR Admin can see this (section 10).
2. An inventory manager receives them back: **Return all** (or one by one),
   recording condition, into a store location.
3. Only then can the person be deactivated in Users (decision 7).

**Retire and dispose**
1. Retire (must be empty first; it goes to a store location).
2. (Phase 2) Dispose: method, party, amount, certificate. For storage drives
   and laptops, **data wipe must be confirmed** before disposal is accepted —
   these drives hold client files.
3. E-waste goes to an authorised recycler; keep their certificate on the
   record.

**Physical verification** (phase 3, once a year or on demand)
1. Start an audit for some or all locations.
2. Walk the floor with a phone, scanning QR labels desk by desk.
3. Close it: found items get `last_verified_at`; missing and misplaced ones
   are listed for follow-up (move, or mark Lost).

---

## 8. App

### Where it lives

| Piece | File |
| --- | --- |
| Page | `app/(app)/inventory/page.tsx` |
| QR target | `app/(app)/a/[tag]/page.tsx` → opens the asset. Read the Next.js 16 guide on dynamic route params in `node_modules/next/dist/docs/` before writing it |
| Sidebar | **Admin** group in `components/layout/app-shell.tsx`, "System Inventory", shown when `navGate(u).inventory` |
| Types | `InventoryCategory`, `SpecField`, `InventoryModel`, `InventoryLocation`, `Workstation`, `InventoryAsset`, `InventoryAssignment`, `InventoryEvent` in `lib/types.ts`; the `Database` type gains their arrays. No hard-coded category list: categories come from the database |
| Loading | New scope `inventory` in `lib/data/db.ts` (deferred, not core): categories, models, locations, workstations, assets, open assignments. RLS decides how much each person gets back. History on demand |
| Writes | `inventoryActions` in `lib/store.tsx`, every one through `commit(["inventory"], …)`. Moves, status, assignments and swaps call the functions in section 6; models, locations, categories and descriptive edits are ordinary table writes. The optimistic update applies the plain move; the database re-checks every rule, and a refusal reloads the scope, undoing it |
| Permissions | `canViewInventory`, `canManageInventory`, `canSeeInventoryCosts`, `canEditInventoryCategories` in `lib/permissions.ts`, matching the SQL functions of the same names |
| Components | `components/inventory/` |

### Screens

**System Inventory page, tabs:**

1. **Overview:** counts by status, spares below minimum, warranties ending in
   30 days, desks without a user, unacknowledged handovers, assets held by
   people leaving. Phase 2 adds open repairs; phase 3 the last verification
   date.
2. **Workstations:** one card per desk: code, name, location, assignee, the
   one-line spec summary, monitors. Filters: assigned / free, location,
   department (from the assignee), person.
3. **Assets:** every asset: tag, category, model, key specs, where it is
   (part → host → desk → person), status, warranty. Search by tag, legacy tag,
   serial, model. Filters by category, status, location, "warranty ends in 30
   days". Export (decision 11).
4. **Stock:** spares grouped by model, with count against minimum and where
   they are: "3 × Kingston Fury 16 GB DDR4 — Store room · min 2".
5. **People:** each person with their desk and issued items, pending
   acknowledgements.
6. **Settings:** models and locations (inventory managers); categories
   (Super Admin, Admin). Kept inside the module rather than in Master Data,
   because Master Data is Super Admin only and inventory managers need to
   reach models and locations.

Phase 2 adds **Purchases** (cost viewers only) and **Repairs**; phase 3 adds
**Audits**.

**Drawers:** Workstation (build view with slots, assign, history), Asset
(details, specs from the model, position, actions, history), Person (holdings,
return all), Model (specs, assets of this model, spares).

**Add assets form:** model (or create one inline) → quantity → serial grid
that works with a USB barcode scanner (each scan + Enter fills a row and moves
down) → position → purchase date.

**Profile → My equipment:** the user's desk with its spec summary, issued
items, and the **Acknowledge** button.

**Phone use:** the `/a/<tag>` page and the audit screen must work well on a
phone, since both are used standing at a desk.

**UI conventions:** colours from the tokens in `app/globals.css` only;
statuses use the existing badge styles.

---

## 9. New dependencies

None is in `package.json` today, so each needs your go-ahead (decision 11):

| Need | Package | When | Note |
| --- | --- | --- | --- |
| Excel import and export | `exceljs` | Phase 1, step 7 | Loaded with `import()` only on the import / export screens, so it doesn't weigh down other pages. CSV-only avoids it |
| QR codes | `qrcode` | Phase 2 | Small; generates SVG for the label sheet |

---

## 10. Permissions

This app has six roles (`super_admin`, `admin`, `manager`, `hr_admin`,
`team_leader`, `team_member`), and some rights come from the **department**
instead (ARCHITECTURE.md §5). The inventory uses both, the same way.

### From the department

| Department | Right | Client | SQL |
| --- | --- | --- | --- |
| Human Resources & Admin | Manage the inventory (add, edit, move, assign, swap, repair, retire) | `canManageInventory` | `can_manage_inventory()` |
| Accounts & Finance | See costs, invoices, purchases | `isFinance` (existing) | `is_finance()` (existing) |

### By role

| Can… | Super Admin | Admin | Manager | HR Admin | Team Leader | Team Member |
| --- | --- | --- | --- | --- | --- | --- |
| See the register and history | ✓ | ✓ | ✓ read-only | ✓ read-only | own + team (decision 3) | own items |
| Manage the inventory | ✓ | ✓ | | | | |
| Dispose | ✓ | ✓ | | | | |
| Edit categories | ✓ | ✓ | | | | |
| See costs, invoices, purchases | ✓ | ✓ | | | | |
| Delete a mistaken record | ✓ | | | | | |
| Acknowledge own handover | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Plus the department rights above, for anyone in those departments whatever
their role.

- **Manager** is a global manager in this app (`isGlobalManager`) and sees
  every project, so read-only on the whole register matches how it works
  elsewhere.
- **HR Admin** sees everything read-only because people leaving go through HR.
- The SQL helpers: `can_view_inventory()`, `can_manage_inventory()`,
  `can_edit_inventory_categories()` and `can_see_inventory_costs()`, each mirrored
  in `lib/permissions.ts` under the camelCase name. **Any change goes in both
  places**, with a new migration for the SQL side.
- `navGate(u).inventory` is true for everyone: a Team Member opens it to see
  their own equipment. The tabs they can't use are hidden.

---

## 11. Notifications

| What | Who | When | Type |
| --- | --- | --- | --- |
| Desk assigned / unassigned, item issued | The person | Immediately | `inventory_assigned` |
| Item returned | The person | Immediately | `inventory_returned` |
| Handovers not acknowledged after 3 days | Inventory managers | Daily digest | `inventory_digest` |
| Warranties ending in the next 30 days | Inventory managers | Weekly digest — one message listing the count, linking to the filtered Assets tab | `inventory_digest` |
| Spares below minimum for a model | Inventory managers | Daily digest, only when the list changed since the last one | `inventory_digest` |
| Repair open more than 14 days (phase 2) | Inventory managers | Daily digest | `inventory_digest` |
| Physical verification due (12 months since the last) (phase 3) | Super Admin, Admin | Monthly | `inventory_digest` |

- The immediate ones are written by triggers on `inventory_assignments`, the
  same way `notify_task_assignment` works. Don't also write them from
  `store.tsx`.
- Digests are one function, `notify_inventory_digest()`, scheduled with
  pg_cron like `notify_website_renewals` (09:20 IST, `50 3 * * *`). Add it to
  the jobs table in ARCHITECTURE.md §8.
- "Only when changed" needs a remembered fingerprint of the last list: a
  one-row-per-kind table, `inventory_digest_state`, holding a hash.

---

## 12. Reports and exports

- **Fixed-asset register** for Finance and auditors: tag, category, model,
  serial, purchase date, invoice, vendor, cost, location, holder, status,
  last verified. Costs and invoices appear only for cost viewers.
- **Fleet health:** machines older than 4 years, below 16 GB RAM, without an
  SSD; GPUs by department — for upgrade planning.
- **Holdings** by person and by department.
- **Repair cost** by asset and by model — to decide repair versus replace
  (phase 2).
- **Disposal register** with certificates and wipe confirmations (phase 2).
- **Depreciation** (phase 3): a view using the method and rates Finance sets,
  not hard-coded.

---

## 13. Later phases: tables

| Phase | Table | Holds |
| --- | --- | --- |
| 2 | `inventory_purchases` | Vendor (→ existing `vendors`), invoice number and date, subtotal, GST, total, invoice file (decision 12), optional Zoho Books bill reference |
| 2 | `inventory_asset_costs` | `asset_id`, `purchase_id`, unit cost excluding GST. A separate table because Row Level Security works on rows, not columns; its read rule is `can_see_inventory_costs()` |
| 2 | `inventory_repairs` | Asset, opened / closed, issue, vendor, under warranty?, cost, outcome (repaired / part replaced / beyond repair). Opening sets Under repair; closing sets Active or Retired |
| 2 | `inventory_disposals` | Asset, date, method (sold / e-waste recycler / scrapped / returned to vendor / donated), party, amount recovered, certificate file, **data wiped (yes/no, method, by whom)**, approved by |
| 3 | `inventory_audits`, `inventory_audit_lines` | A physical check: scope (locations), who, when; per asset: expected position, found / missing / found elsewhere, scanned by, at |

---

## 14. Build order

**Phase 1 — register and track** (ship this first)

1. **Tests first.** Write `supabase/tests/inventory.test.sql`: a stand-in for
   `auth.uid()` and a few profiles in each role and department, then one check
   per rule in section 6 (positions, placement, slot limits including
   motherboard installs and removals, status changes, tags past 9999, schema
   changes, assignments in step, deactivation guard, every grant, the read
   rules for each role). Run it with `psql -v ON_ERROR_STOP=1` on a scratch
   database. There is no test harness in the repo yet; this file starts one.
2. Migrations `0009` and `0010`. Every test passes before any app code.
3. Types, permissions, the `inventory` scope, store actions.
4. Settings: models and locations (categories come seeded).
5. Assets tab, Add assets form, Asset drawer.
6. Workstations tab and drawer: build view, slots, compatibility warnings,
   assigning.
7. Stock and People tabs, Profile "My equipment" with Acknowledge, assignment
   notifications, Return all.
8. Import, if there's an existing list (decision 5): one row per asset →
   preview with errors per row → nothing is written until every row passes.
   Missing models are listed for review, not created silently.

**Phase 2 — money and lifecycle**

Purchases and costs, repairs, disposal with the wipe record, QR labels and the
`/a/<tag>` page, the digests, the Overview tab.

**Phase 3 — control**

Physical verification, reports and exports, depreciation view.

Every step ends with `npm run build` and `npm run lint` passing; every
migration ends with the tests passing. ARCHITECTURE.md gets a short section on
the module once phase 1 ships.

---

## 15. Decisions

### Settled by this design (say if you disagree)

- **"ROM" = storage** (SSD / HDD), as in "8 GB RAM / 256 GB ROM". The category
  is called Storage, with "ROM" as a search alias.
- **Laptops** are their own host category: issued to a person, or placed at a
  desk when docked.
- **Keyboards and mice** are tracked one by one. It's cheap with models, and
  needed when they're issued for home use.
- **Disposal** is Super Admin and Admin only.
- **Processor prefix is `PRC`**, because in most Indian offices "CPU" means
  the cabinet.

### Still open

1. **Who runs inventory day to day?** Designed as the **Human Resources &
   Admin** department. If only one person there should, use a grant list
   (`inventory_managers` table) instead — a new pattern for this app.
2. **Employees see their own equipment and acknowledge handovers?**
   Recommended: yes.
3. **Team Leaders:** see their departments' people's holdings read-only, or
   only their own? Recommended: their departments'.
4. **Costs:** record purchase cost and invoices (phase 2)? Designed as
   visible to Super Admin, Admin and Accounts & Finance.
5. **Existing list:** is there an Excel sheet of current PCs to import? Share
   its columns and the importer will map them.
6. **Old labels:** do machines already carry stickers in another format? If
   yes, they go in `legacy_tag`.
7. **Deactivation:** refuse to deactivate someone who still holds equipment
   (as designed), or only warn and list it on the Overview?
8. **Locations:** the list of floors, rooms and store areas, and whether
   there's more than one office.
9. **Laptop slots:** confirm 1 RAM / 1 storage as the default, overridden per
   model.
10. **Who adds categories:** Super Admin and Admin (as designed), or Super
    Admin only, like Master Data?
11. **New packages:** OK to add `exceljs` (import / export) and `qrcode`
    (labels)? Without `exceljs`, import and export are CSV only.
12. **Invoice and certificate files** (phase 2). These must not be public.
    Recommended: a **private Supabase Storage bucket**, whose access rule is
    the same `can_see_inventory_costs()` function — new to this app, which
    uploads only to Cloudinary today. The alternative is Cloudinary's
    authenticated delivery, which needs a server route to sign each view and
    repeats the permission check in TypeScript.

---

## 16. What changed from the earlier drafts

From **v1** (the first draft of this file):

| v1 | Now | Why |
| --- | --- | --- |
| Brand, model and specs typed on every part | Model catalogue | Ten identical RAM sticks were typed ten times, and "16GB" / "16 GB" split the spare counts |
| Categories and spec fields hard-coded in `lib/types.ts`; specs JSON unchecked | Categories are data, specs checked by the database | New kinds of hardware without a deploy; no bad data |
| Desktops only | Laptops as hosts; items issued to a person | WFH equipment had nowhere to go |
| One `status` mixing place and state | Lifecycle status separate from position | "Lost" and "Disposed" couldn't be expressed; status and place could disagree |
| Spares had no location | Locations | "Spare, but where?" |
| Allotment as a column, history only in events | Assignments with acknowledgement and return condition | "Who had it in March?", proof of handover, clearance when someone leaves |
| No slot limits | Slot limits | A cabinet could be given three motherboards |
| Field edits not logged | Every edit logged, grouped by operation | Corrections left no trace |
| `on delete set null` freed parts silently | Archive, never delete; only mistakes deleted | Parts ended up nowhere |
| Price on each part | Purchases and a separate costs table (phase 2) | RLS can't hide a column; one invoice for 20 parts |
| Only Super Admin and Admin manage | Human Resources & Admin department manages; Finance sees costs | The day-to-day person needn't be a system Admin |
| No repairs, disposal or audit | Repair log, disposal with data wipe, physical verification | An audit-proof register |
| Prefix `CPU` | `PRC` | "CPU" means the cabinet in most Indian offices |

From **v2** (`Archi-inventory-v2.md`):

| v2 | Now | Why |
| --- | --- | --- |
| Said the reference SQL and 54 tests were written and passing | Status: design only; tests written first, in the repo | Those files don't exist in the repo |
| Roles "Manager" and "Employee"; HR Admin and Team Leader missing | The six real roles, plus department rights | Matches `lib/permissions.ts`; Manager here is a global manager |
| `inventory_staff` grants for manager and cost viewer | Department rights: Human Resources & Admin, and the existing `is_finance()` | The app's existing pattern for rights like these |
| Exit clearance tied to an HR exit checklist and final settlement | Tied to deactivation, guarded by a trigger | The app has no exit workflow; deactivation is the real hook |
| Desk assignee stored twice, with no rule keeping the two in step | "Now" on the row, "the record" in assignments, kept in step by a constraint | Says which is the truth, and enforces it |
| "Gap-free and never reused" | Never reused; gaps expected | Deleting a mistake makes a gap; both can't be true |
| Spec schema edits unaddressed | Schema save re-checks every model | A new required field would strand existing models |
| Slot limits checked on install only | Motherboard installs and removals too; laptop slots per model | A 2-slot board could go into a cabinet with 4 sticks |
| "Under repair: at most one place"; retired "or none" | Exactly one place for both | An asset with no position is untraceable |
| Own-items read rule not specified | Looks through hosts, evaluated once per query | Parts inside your cabinet are yours |
| Invoice files in a "private Storage bucket" | Decision 12 | The app uploads to Cloudinary today, with public links |
| Excel and QR assumed | Listed as new packages (decision 11) | Neither is installed |
| Profile delete not covered | Restrict while holding; history keeps name snapshots | History must survive people leaving |
| Grants described in a sentence | Grant table per table, tested | Supabase's default grants are the easy trap |
