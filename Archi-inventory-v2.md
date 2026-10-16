# System Inventory — architecture (v2)

A module that records every piece of IT hardware Synovative owns: what it is,
its details, a unique ID for each piece, where it is right now, who is
responsible for it, and everything that ever happened to it.

This is v2 of the design, written before any code. It keeps the good parts of
v1 (three levels, rules enforced by the database, generated asset IDs, an
append-only history) and fixes the parts that would not hold up once real
hardware, real people and real audits are involved. Section 1 lists every
change and why.

The core database rules in section 7 are already written and tested:
`inventory-core.reference.sql` (phase 1 schema) passes all 54 checks in
`inventory-core.tests.sql` on PostgreSQL 16.

Section 14 lists the decisions still open.

---

## 1. What changed from v1, and why

| # | v1 | The problem | v2 |
| --- | --- | --- | --- |
| 1 | Brand, model and specs typed on every component | Ten identical RAM sticks are typed ten times. "16GB", "16 GB" and "16gb DDR4" become three different things in filters and spare counts. | A **model catalogue**. Specs are entered once per model ("Kingston Fury 16 GB DDR4 3200"); each asset points to its model. |
| 2 | Categories and spec fields hard-coded in `lib/types.ts`; `specs` JSON not checked | Adding "Printer" needs a deploy. Any JSON is accepted, so bad data gets in quietly. | **Categories are data**, with a spec schema the database validates and the form is drawn from. Admins add categories in Settings. |
| 3 | Desktops only; laptops an open question | Laptops, and things issued to a person (WFH monitor, headset), have nowhere to go. | **Laptop is a host** like a cabinet. Any *issuable* asset can be issued straight to a person. |
| 4 | One `status` mixing *where it is* (In use / Spare) with *what state it's in* | Status and placement can disagree. "Lost" and "Disposed" can't be expressed. | **Lifecycle status** (Active, Under repair, Retired, Disposed, Lost) is separate from **position**. "In use" and "Spare" are worked out from position. |
| 5 | Spare parts have no location | "Do we have a spare 16 GB stick?" Yes — but where? | **Locations** (store room, floors, "Out for repair"). Every active asset is in exactly one of four positions (section 4). |
| 6 | Allotment is a column; its history lives in the event log | "Who had WS-012 in March?" is hard to answer. No proof of handover. Nothing for exit clearance. | An **assignments** table with start, end, acknowledgement and return condition. It drives onboarding and exit clearance. |
| 7 | No slot limits | A cabinet can be given three motherboards or nine RAM sticks. | **Slot limits** per host. The RAM limit is read from the installed motherboard. |
| 8 | Field edits not logged | Serial, spec or date corrections leave no trace. | Every edit is logged with old → new. One user action (e.g. a swap) shares one operation ID and note. |
| 9 | `on delete set null` frees parts when a cabinet or desk is deleted | With a "one place" rule this leaves parts nowhere, silently. | Hosts and desks are emptied, then **archived**, never deleted. Only a record entered by mistake can be deleted, by Super Admin. |
| 10 | Price and invoice on each component | Row Level Security works on rows, not columns, so anyone who can see a part sees its price. One invoice for 20 parts is typed 20 times. | **Purchases** (one invoice, many assets) and **costs in a separate table** with their own access rule (phase 2). |
| 11 | Only Super Admin and Admin can change anything | Whoever looks after the hardware day to day must be made a system Admin. | A grantable **Inventory manager** permission, and a **cost viewer** grant for Finance. |
| 12 | No repairs, disposal or audit | A register that can't show repairs, proper disposal or a physical check is hard to defend in an audit. | Repair log, disposal record with **data-wipe confirmation**, and **physical verification** (phases 2–3). |
| 13 | Processor prefix `CPU` | In most Indian offices "CPU" means the cabinet, not the chip. | Processor prefix is **`PRC`**. "CPU" never appears in a tag. |

---

## 2. What it answers

The test of the design is whether these are one click away:

- What is in **WS-012**, and who has it?
- Where is **SYN-RAM-0031** now, and where has it been?
- Do we have a **spare 16 GB DDR4** stick, and which shelf is it on?
- Which **warranties end** this month?
- What must **Rohan hand back** before his last day?
- Which machines have **less than 16 GB RAM or no SSD**? (upgrade planning)
- Does **what is on the floor match the register**? (annual check)

---

## 3. Words used in this document

| Term | Meaning |
| --- | --- |
| **Asset** | Any tracked physical item with its own asset ID: a RAM stick, a cabinet, a laptop, a monitor. |
| **Category** | The kind of asset (RAM, Monitor…). Decides the ID prefix, where it can go, and its spec fields. |
| **Model** | A product in the catalogue: manufacturer + model + specs. Many assets share one model. |
| **Host** | An asset that holds parts: a **Cabinet** (system unit) or a **Laptop**. |
| **Workstation** | A desk setup. Not hardware itself; it groups a cabinet, monitors and peripherals, and is assigned to a person. |
| **Location** | A place where unassigned things are kept or sent: "Store room · Shelf B", "Out for repair". |
| **Position** | Where an asset is now. Exactly one of: inside a host, at a workstation, with a person, at a location (section 4). |
| **Assignment** | A period during which a person is responsible for a workstation or an issued asset. Has a start, an end, and an acknowledgement. |
| **Status** | Lifecycle state: Active, Under repair, Retired, Disposed, Lost. |
| **Event** | One line of history. Written only by the database. |
| **Operation** | One user action, which can write several events (a swap writes three). |

---

## 4. How things fit together

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
└── RAM  SYN-RAM-0090  8 GB SO-DIMM (upgrade)

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
- The responsible person is worked out, never stored twice: a RAM stick in
  Neha's cabinet belongs to Neha because the cabinet is at her desk.

### Status and position

| Status | Position allowed | Shown in the app as |
| --- | --- | --- |
| Active | exactly one | **In use** (in a host, at a desk, with a person) or **Spare** (at a location) |
| Under repair | at most one — it can stay in the machine while diagnosed, or go to "Out for repair" | Under repair |
| Retired | a location, or none | Retired |
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

A host must be empty before it is retired, disposed or marked lost.

An under-repair asset can only move to a location until it's fixed; it can't
be installed or issued.

---

## 5. Categories, models and specs

### Categories (seeded, editable)

| Category | Prefix | Holds parts | Goes inside | At a desk | Issued to a person | QR label | Key specs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Cabinet (system unit) | `CAB` | ✓ | — | ✓ | | ✓ | Form factor, colour |
| Laptop | `LAP` | ✓ | — | ✓ (docked) | ✓ | ✓ | Processor, built-in RAM, storage, screen |
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

- **Laptops:** built-in RAM and storage are specs on the laptop's model. Only
  removable parts added later (an extra SO-DIMM, a second SSD) are tracked as
  separate assets inside the laptop.
- **New categories** (printer, router, phone, camera, drone, CCTV…) are added
  in Settings by an Admin: name, 3-letter prefix, the placement ticks above,
  and the spec fields. No code change.

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
  model against the same schema (`inventory_spec_errors`): required fields,
  numbers are numbers, choices are from the list, no unknown fields. Screen
  and database can never disagree.
- Numbers are stored as numbers with a fixed unit (GB, MHz, W), so
  "machines with less than 16 GB RAM" is a real query, not a text search.

### Models (the catalogue)

| Field | Notes |
| --- | --- |
| Category, manufacturer, name | Unique together, ignoring case and spaces |
| Part number | Optional (helps reorders) |
| Specs | Checked against the category schema |
| Default warranty (months) | Fills each asset's warranty end from its purchase date |
| Minimum spares | Below this, the Stock tab and a digest flag it |

Spare counts, filters, the one-line spec summary on a desk card
("Ryzen 5 5600 · 32 GB · 512 GB SSD · RTX 3060") and reordering all come from
models.

### Slot limits

| Host | Limits |
| --- | --- |
| Cabinet | 1 motherboard, 1 processor, 1 PSU, 2 GPUs, 6 storage, RAM = the installed motherboard's `ram_slots` (4 if no motherboard is recorded) |
| Laptop | 2 RAM, 2 storage |

Limits are data on the category, so they can be changed in Settings.

### Compatibility warnings (screen only)

When installing, the app **warns** (does not block) if: the processor socket
differs from the motherboard's; the RAM type (DDR4/DDR5) or form (DIMM /
SO-DIMM) doesn't match the motherboard or laptop; total RAM exceeds the
motherboard's maximum. Warnings, not rules, because older parts will often be
entered with incomplete specs.

---

## 6. Asset IDs and labels

- **Format:** `SYN-<PREFIX>-<0001>`, e.g. `SYN-RAM-0031`. Desks: `WS-001`.
- **Generated by the database** from a counter per category, taken under a
  row lock: no gaps, no duplicates, **never reused** (even after a mistaken
  record is deleted). After 9999 it grows to five digits instead of being cut
  off — a real bug with plain `lpad`, which would turn 10000 into 1000.
- **Tag and category are locked** once saved, so the prefix can never lie.
  A wrong category is fixed by deleting the mistaken record and entering it
  again; if it already has history, retire it with a note and re-enter it.
- **Serial number** is stored separately and must be unique when filled in
  (ignoring case and spaces). Leave it blank for cheap peripherals that all
  print the same serial.
- **Physical labels** only on categories ticked "QR label": cabinets, laptops,
  monitors, UPS. A sticker on a RAM stick inside a closed cabinet helps nobody;
  internal parts are identified by their manufacturer serial.
- **The QR code holds a link with the tag**, `https://<pms-domain>/a/SYN-CAB-0012`,
  not the database ID, so labels outlive any data migration. Scanning opens the
  asset after login.
- If machines already carry old stickers, the old number goes in an optional
  `legacy_tag` field and stays searchable (decision 6).

---

## 7. Database

### Migration files

Append-only, numbered after the latest file:

1. `00xx_inventory_notification_types.sql` — the new notification types, in
   their own file because new enum values can't be used in the same
   transaction that adds them.
2. `00xx_system_inventory.sql` — phase 1, from `inventory-core.reference.sql`
   (adapt the `profiles` column and role names).
3. One file per later phase: purchases and costs, repairs, disposals, audits.

### Phase 1 tables

**`inventory_categories`** — `code` (= prefix, primary key), `name`, `is_host`,
`installs_in` (host codes), `at_workstation`, `issuable`, `labelled`,
`spec_schema`, `slots`, `next_number` (the tag counter; not writable from the
app), `sort_order`, `active`.

**`inventory_models`** — `id`, `category`, `manufacturer`, `name`,
`part_number`, `specs`, `warranty_months`, `min_spare`, `active`, `notes`,
audit columns.

**`inventory_locations`** — `id`, `name`, `parent_id` (Office → Floor → Room),
`kind` (site / floor / room / store / external), `active`, `sort_order`.

**`workstations`** — `id`, `code` (WS-001, generated), `name`, `location_id`,
`assigned_to`, `assigned_at`, `archived_at`, `notes`, audit columns.

**`inventory_assets`**

| Column | Notes |
| --- | --- |
| `id` | uuid |
| `asset_tag` | Generated, unique, locked |
| `category` | Locked after saving |
| `model_id` | Composite foreign key `(model_id, category)`, so an asset's model is always of the asset's category |
| `serial_number` | Unique when filled |
| `condition` | new / good / fair / faulty |
| `status` | active / under_repair / retired / disposed / lost |
| `parent_asset_id`, `workstation_id`, `issued_to`, `location_id` | The position — see the one-place rule |
| `purchase_date`, `warranty_until` | Warranty filled from the model |
| `last_verified_at` | Set by physical verification (phase 3) |
| `notes`, `created_by`, `created_at`, `updated_at` | |

**`inventory_assignments`** — `id`, `workstation_id` *or* `asset_id` (exactly
one), `profile_id`, `started_at`, `ended_at`, `assigned_by`, `ended_by`,
`acknowledged_at`, `return_condition`, `notes`. At most one open assignment
per desk and per asset.

**`inventory_events`** (history) — `id`, `at`, `actor`, `operation_id`,
`asset_id`, `workstation_id`, `profile_id`, `kind`, `from_place`, `to_place`,
`changes`, `note`.

- `kind`: added, edited, installed, placed, issued, stocked, removed, status,
  assigned, unassigned, acknowledged, archived, restored, deleted, verified.
- `from_place` / `to_place` are snapshots with a readable label
  (`{"type":"asset","label":"SYN-CAB-0012","workstation_id":…}`), so history
  still reads correctly after things move or are renamed.
- A desk's history includes parts that left it, through
  `from_place.workstation_id`.
- `changes` holds edits as `{"serial_number": ["DL-1", "DL-1A"]}`.

**`inventory_staff`** — `profile_id`, `can_manage`, `can_see_costs`,
`granted_by`, `granted_at`. Grants for people who aren't Super Admin / Admin.

### Later tables

| Phase | Table | Holds |
| --- | --- | --- |
| 2 | `inventory_purchases` | Vendor (→ existing `vendors`), invoice number and date, subtotal, GST, total, invoice file in a **private** Storage bucket (not a public media URL), optional Zoho Books bill reference |
| 2 | `inventory_asset_costs` | `asset_id`, `purchase_id`, unit cost excluding GST. Separate table so its own access rule hides cost from everyone but cost viewers |
| 2 | `inventory_repairs` | Asset, opened / closed, issue, vendor, under warranty?, cost, outcome (repaired / part replaced / beyond repair). Opening sets Under repair; closing sets Active or Retired |
| 2 | `inventory_disposals` | Asset, date, method (sold / e-waste recycler / scrapped / returned to vendor / donated), party, amount recovered, certificate file, **data wiped (yes/no, method, by whom)**, approved by |
| 3 | `inventory_audits`, `inventory_audit_lines` | A physical check: scope (locations), who, when; per asset: expected position, found / missing / found elsewhere, scanned by, at |

### Rules the database enforces

| Rule | How |
| --- | --- |
| An active asset is in exactly one place; retired, disposed and lost follow the table in section 4 | Check constraint `inventory_asset_one_place` |
| Each category only goes where its ticks allow (inside which hosts, at a desk, to a person) | Trigger `inventory_guard_asset` |
| Hosts never go inside anything | Category check + same trigger |
| Slot limits, with the RAM limit from the installed motherboard | Same trigger, which locks the host row so two people can't fill the last slot at once |
| Nothing is installed into a retired, disposed or lost host; a host can't be retired while it still has parts | Same trigger |
| Disposed is final | Same trigger |
| Only allowed status changes (section 4); disposal by Super Admin / Admin only | `inventory_set_status` |
| Under-repair assets only move to a location | `inventory_move` |
| Tags generated, gap-free, never reused, never cut off; tag and category locked | Tag trigger + guard trigger |
| An asset's model is of the same category | Composite foreign key |
| Model specs match the category schema | `inventory_spec_errors`, checked on every model save |
| Desks and assets go only to active users | Guard triggers |
| One open assignment per desk and per asset | Partial unique indexes |
| A desk is archived only when empty and unassigned | Trigger `inventory_guard_workstation` |
| Every move, status change, assignment and edit is logged with who, when, operation and note | `after` triggers; nobody can write to `inventory_events` |
| Position, status and assignment change only through the functions below | Column-level grants: the app can update only `model_id`, `serial_number`, `condition`, `purchase_date`, `warranty_until`, `notes` |
| Only mistakes are deleted | `inventory_delete_mistake`: Super Admin, and only if the asset was never placed, moved, assigned or changed status |

### Functions the app calls

| Function | Does |
| --- | --- |
| `inventory_add_assets(model, count, serials[], one position, condition, purchase_date, notes)` | Registers 1–200 assets of one model in one go, each with its own tag; fills warranty; opens an assignment if issued to a person |
| `inventory_move(asset, exactly one destination)` | Install, place, issue or put back in stock. Closes and opens personal assignments as needed |
| `inventory_set_status(asset, status, location?)` | Lifecycle changes; with a location, also moves it there |
| `inventory_swap(out, in, out_location, out_status = under_repair)` | Replaces a part in one action; the spare takes the exact slot |
| `inventory_assign_workstation(desk, person or null)` | Assigns, reassigns or unassigns a desk |
| `inventory_acknowledge(assignment)` | The holder confirms receipt (holder only) |
| `inventory_return_all(person, location)` | Exit clearance: unassigns their desk(s) and returns every issued item |
| `inventory_delete_mistake(asset)` | Super Admin only |

Internal helpers (`inventory_begin`, `inventory_log_event`, `inventory_place`,
the trigger functions) can't be called from the app.

**How history knows who and why.** Every function starts with
`inventory_begin(note)`, which checks permission and stores an operation ID
and the note in transaction-local settings. The history trigger reads them,
plus `auth.uid()` for the actor. Nested calls (a swap calls move twice) share
the outer operation. An event with no actor (written by a maintenance script,
not the app) shows as "System".

**Errors are sentences.** Functions raise messages written for the screen —
"SYN-CAB-0012 already holds 2 × RAM (limit 2)", "Remove the parts inside
SYN-CAB-0012 before marking it retired" — so the app shows them as they are.

### Size

Even 200 desks × ~13 parts is under 3,000 assets. The whole register loads
into the client scope comfortably. History and closed assignments are **not**
loaded up front; drawers fetch them when opened.

---

## 8. Workflows

**New purchase arrives**
1. (Phase 2) Record the purchase: vendor, invoice, file.
2. Add assets: pick the model (or create it), enter the quantity, scan
   serials into the grid, choose the store location.
3. Print QR labels for the labelled ones.

**Build or rebuild a PC**
1. Open the cabinet (or add it). Empty slots show as "RAM 2 / 4".
2. Install parts from spares; compatible models are offered first.
3. Place the cabinet at a workstation.

**New joiner**
1. Assign a workstation, or issue a laptop.
2. They get a notification and see it on their Profile.
3. They tap **Acknowledge**. Unacknowledged handovers show on the Overview
   after 3 days.

**Faulty part**
1. In the cabinet, choose **Swap** on the faulty part, pick a spare.
2. One operation: the faulty part goes to "Out for repair" as Under repair;
   the spare takes its slot. Both moves share the note ("RAM fault").

**Repair** (phase 2)
1. Open a repair: issue, vendor, warranty claim or not.
2. Close it: repaired → back to Active in stock; beyond repair → Retired.

**Desk moves**
- Reassign the workstation to someone else, or move the cabinet to another
  workstation; its parts go with it.

**Exit clearance**
1. When HR starts an exit, the person's page and HR's exit checklist show
   "IT assets: 2 pending" with the list.
2. The inventory manager receives them back: **Return all** (or one by one),
   recording condition, into a store location.
3. Decision 7: either HR's final settlement is blocked until this is clear,
   or it's a warning.

**Retire and dispose**
1. Retire (must be empty first).
2. Dispose: method, party, amount, certificate. For storage drives and
   laptops, **data wipe must be confirmed** before disposal is accepted —
   these drives hold client files.
3. E-waste goes to an authorised recycler; keep their certificate on the
   record.

**Physical verification** (phase 3, once a year or on demand)
1. Start an audit for some or all locations.
2. Walk the floor with a phone, scanning QR labels desk by desk.
3. Close it: found items get `last_verified_at`; missing and misplaced ones
   are listed for follow-up (move, or mark Lost).

---

## 9. App

### Where it lives

| Piece | File |
| --- | --- |
| Page | `app/(app)/inventory/page.tsx` |
| QR target | `app/(app)/a/[tag]/page.tsx` → opens the asset |
| Sidebar | **ADMIN** section, "System Inventory", shown when `navGate(u).inventory` |
| Types | `InventoryCategory`, `SpecField`, `InventoryModel`, `InventoryLocation`, `Workstation`, `InventoryAsset`, `InventoryAssignment`, `InventoryEvent` in `lib/types.ts`. No `INVENTORY_SPECS` constant: categories come from the database |
| Loading | Scope `inventory` in `lib/data/db.ts`: categories, models, locations, workstations, assets, open assignments. History on demand |
| Writes | `inventoryActions` in `lib/store.tsx` through `commit()`. Moves, status, assignments and swaps call the RPC functions; master data and descriptive edits use ordinary table writes. After an RPC, refetch the affected rows |
| Permissions | `canManageInventory`, `canViewInventory`, `canSeeInventoryCosts` in `lib/permissions.ts`, matching the SQL |
| Components | `components/inventory/` |

### Screens

**System Inventory page, tabs:**

1. **Overview:** counts by status, spares below minimum, warranties ending in
   30 days, open repairs, desks without a user, unacknowledged handovers,
   last verification date.
2. **Workstations:** one card per desk: code, name, location, assignee, the
   one-line spec summary, monitors. Filters: assigned / free, location,
   department (from the assignee), person.
3. **Assets:** every asset: tag, category, model, key specs, where it is
   (part → host → desk → person), status, warranty. Search by tag, serial,
   model. Filters by category, status, location, "warranty ends in 30 days".
   Export to Excel.
4. **Stock:** spares grouped by model, with count against minimum and where
   they are: "3 × Kingston Fury 16 GB DDR4 — Store room · min 2".
5. **People:** each person with their desk and issued items, pending
   acknowledgements, and exit status.
6. **Settings:** models and locations (inventory managers); categories and
   inventory staff (Admins).

Phase 2 adds **Purchases** (cost viewers only) and **Repairs**; phase 3 adds
**Audits**.

**Drawers:** Workstation (build view with slots, assign, history), Asset
(details, specs from the model, position, actions, history), Person (holdings,
return all), Model (specs, assets of this model, spares).

**Add assets form:** model (or create one inline) → quantity → serial grid
that works with a USB barcode scanner (each scan + Enter fills a row and moves
down) → position → purchase date. Replaces v1's "add another like this".

**Profile → My equipment:** the user's desk with its spec summary, issued
items, and the **Acknowledge** button.

**Phone use:** the `/a/<tag>` page and the audit screen must work well on a
phone, since both are used standing at a desk.

---

## 10. Permissions

| Can… | Super Admin | Admin | Inventory manager | Cost viewer (Finance) | Manager | Employee |
| --- | --- | --- | --- | --- | --- | --- |
| See the register and history | ✓ | ✓ | ✓ | ✓ | decision 3 | own items only |
| Add, edit, move, assign, swap, repair, retire | ✓ | ✓ | ✓ | | | |
| Dispose | ✓ | ✓ | decision 10 | | | |
| Edit categories; grant inventory staff | ✓ | ✓ | | | | |
| See costs, invoices, purchases | ✓ | ✓ | | ✓ | | |
| Delete a mistaken record | ✓ | | | | | |
| Acknowledge own handover | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

- **Inventory manager** and **cost viewer** are rows in `inventory_staff`,
  granted by an Admin. They don't need any system role.
- As with every module, the rules live **in both places**: `lib/permissions.ts`
  decides what the screen shows; Row Level Security, column grants and the
  functions decide what is allowed.
- Supabase grants **all** privileges on new tables to `anon` and
  `authenticated` by default. The migration revokes everything first, then
  grants only reads and the specific columns listed in section 7. The tests
  check this.

---

## 11. Notifications

| What | Who | When |
| --- | --- | --- |
| Desk assigned / unassigned, item issued / returned | The person | Immediately |
| Handover not acknowledged after 3 days | Inventory managers | Daily digest |
| Warranties ending in the next 30 days | Inventory managers | Weekly digest — one message listing all, not one per asset |
| Spares below minimum for a model | Inventory managers | Daily digest, only when something changed |
| Repair open more than 14 days (phase 2) | Inventory managers | Daily digest |
| Exit started with assets still held | HR and inventory managers | When the exit starts, then daily |
| Physical verification due (12 months since the last) (phase 3) | Admins | Monthly |

Built on the same daily job pattern as website renewals.

---

## 12. Reports and exports

- **Fixed-asset register** for Finance and auditors: tag, category, model,
  serial, purchase date, invoice, vendor, cost, location, holder, status,
  last verified. Excel export.
- **Fleet health:** machines older than 4 years, below 16 GB RAM, without an
  SSD; GPUs by department — for upgrade planning.
- **Holdings** by person and by department.
- **Repair cost** by asset and by model — to decide repair versus replace.
- **Disposal register** with certificates and wipe confirmations.
- **Depreciation** (phase 3): a view using the method and rates Finance sets,
  not hard-coded.

---

## 13. Build order

**Phase 1 — register and track** (ship this first)

1. Migration from `inventory-core.reference.sql`, adapted to `profiles`.
   Run `inventory-core.tests.sql` on the local Postgres harness; all checks
   must pass before any app code.
2. Types, permissions, data loading, store actions.
3. Settings: models and locations (categories come seeded).
4. Assets tab, Add assets form, Asset drawer.
5. Workstations tab and drawer: build view, slots, compatibility warnings,
   assigning.
6. Stock and People tabs, Profile "My equipment" with Acknowledge, assignment
   notifications.
7. Excel import, if there's an existing list: one row per asset → preview
   with errors per row → nothing is written until every row passes. Missing
   models are listed for review, not created silently.

**Phase 2 — money and lifecycle**

Purchases and costs, repairs, disposal with wipe record, QR labels and the
`/a/<tag>` page, the digests, the exit-clearance link with HR, the Overview
tab.

**Phase 3 — control**

Physical verification, reports and exports, depreciation view.

Every step ends with `npm run build` and `npm run lint` passing; every
migration ends with the rule tests passing.

---

## 14. Decisions

### Settled by this design (say if you disagree)

- **"ROM" = storage** (SSD / HDD), as in "8 GB RAM / 256 GB ROM". The category
  is called Storage, with "ROM" as a search alias.
- **Category list:** start with section 5; more can be added in Settings at
  any time.
- **Laptops:** their own host category; issued to a person, or placed at a desk
  when docked.

### Still open

1. **Who runs inventory day to day?** Give that person the Inventory manager
   grant (likely someone in HR/Admin), or keep it to Super Admin and Admin?
2. **Employees see their own equipment and acknowledge handovers?**
   Recommended: yes.
3. **Managers:** no access, read-only on their own team's holdings, or
   read-only on everything? Recommended: their team's holdings.
4. **Costs:** record purchase cost and invoices? Who besides Admins sees them?
   Recommended: yes, with Finance as cost viewers.
5. **Existing list:** is there an Excel sheet of current PCs to import? Share
   its columns and the importer will map them.
6. **Old labels:** do machines already carry stickers in another format? If
   yes, they go in `legacy_tag`.
7. **Exit clearance:** block HR's final settlement until all assets are
   returned, or warn only?
8. **Locations:** the list of floors, rooms and store areas, and whether
   there's more than one office.
9. **Keyboards and mice:** track each one (as designed), or only count them as
   stock? Recommended: track each — it's cheap with models, and needed when
   they're issued for home use.
10. **Disposal:** can the Inventory manager dispose, or only Admins? Designed
    as Admins only.

---

## 15. Out of scope for now

- Software licences (Windows, Adobe, Office). They can reuse the assignments
  pattern later.
- Automatic hardware detection from the PCs. A small script could later read
  each machine's specs and match by serial.
- Repair ticketing and AMC contracts. Repairs are a log, not a workflow.
- Consumables counted by quantity (cables, adapters, toner).
- Posting depreciation into the accounts.

---

## Appendix: reference SQL and tests

| File | What it is |
| --- | --- |
| `inventory-core.reference.sql` | Phase 1: tables, rules, tag generation, history triggers, the functions, Row Level Security, column grants, category seed |
| `inventory-core.tests.sql` | 54 checks covering every rule in section 7, the permission matrix for employees, inventory managers and managers, and the history output. Loads a small stand-in for `profiles` and `auth.uid()`, then the reference SQL |

Run on an empty database with both files in one folder:

```
createdb inv_test
psql -d inv_test -v ON_ERROR_STOP=1 -f inventory-core.tests.sql
```
