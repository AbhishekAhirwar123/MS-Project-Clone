# Neo Project vs Microsoft Project: parity analysis and roadmap

Status key: **Done** = works like MS Project. **Partial** = exists but differs. **Missing** = not present.
Reference: Microsoft Project Desktop (Professional 2021 / Plan 3 feature set). Server-only features (Project Server, Project Online, PWA, Teams) are out of scope.

## 1. Scheduling engine and logic

| MS Project behaviour | Neo Project | Status |
|---|---|---|
| Auto-scheduled tasks (CPM forward/backward pass) | `OP.schedule` in `src/core/core.js` | Done |
| **Manually scheduled tasks** (user-typed start/finish/duration are never moved; text values like "TBD" allowed) | none | Missing |
| Schedule from project start **or from finish date** (backward scheduling) | start only | Missing |
| Link types FS/SS/FF/SF with lag and lead | done | Done |
| Lag as **percentage** of predecessor duration (`FS+50%`) and **elapsed** lag (`+2ed`) | working days only | Missing |
| Duration units: minutes, hours, days, weeks, months, **elapsed** (`ed`, `ew`), **estimated** (`?`) | d/w/h parse, stored as working days | Partial |
| Hour-level scheduling (start/finish times, 8:00-17:00, lunch break) | whole days only | Missing |
| **Base calendars** (Standard, 24 Hours, Night Shift), custom calendars, work weeks, exceptions, "Change Working Time" | one Mon-Fri calendar + holiday list | Partial |
| **Task calendars** (task ignores resource calendar option) | none | Missing |
| **Resource calendars** (own work week, vacations) | work days + vacation dates | Partial |
| Constraints: ASAP, ALAP, SNET, SNLT, FNET, FNLT, MSO, MFO, deadline | done | Done |
| Constraint-conflict handling ("honor constraint dates" option) | flagged only | Partial |
| Task types (fixed units / work / duration) and effort-driven | `taskOps.ts` | Done |
| Task splitting | splits[] | Done |
| **Inactive tasks** (kept in plan, excluded from schedule) | none | Missing |
| **Task path** (driving predecessors / successors highlighting) | none | Missing |
| Critical path: total slack, free slack, multiple critical paths, slack threshold option | single threshold (slack 0) | Partial |
| Summary tasks roll up; links to summaries | done | Done |
| **Subprojects / master projects**, cross-project links | stub menu item only | Missing |
| Resource leveling (priority, delay, within slack, level by day/week, clear leveling) | serial leveling, no options | Partial |
| Overtime work, overtime rate | none | Missing |
| **Resource pools / shared resources** | none | Missing |
| Reschedule uncompleted work, Move Project, Update Project | Update as scheduled only | Partial |
| Status date, % complete, % work complete, **physical % complete**, actual work, remaining work, actual duration, remaining duration | % complete only | Partial |
| Timephased actuals (enter work per day) | none | Missing |
| Auto-calc of cost/work actuals option | always automatic | Partial |

## 2. Costs and earned value

| Feature | Status |
|---|---|
| Standard rate, cost per use, rate-change table | Done |
| **Cost rate tables A-E**, overtime rate, per-assignment rate table | Missing |
| **Cost accrual** (start / prorated / end) | Missing |
| Fixed cost + **fixed cost accrual** | Fixed cost done, accrual missing |
| Material and cost resources | Done |
| **Budget resources** and budget cost/work | Project budget number only |
| Baseline 0-10 (**multiple baselines**), interim plans, save baseline for selected tasks | one baseline, whole project |
| Earned value (PV, EV, AC, SV, CV, SPI, CPI, EAC, VAC) | Done |
| **TCPI**, ETC, EV calculation method (% complete vs physical % complete) | Missing |
| Variance columns (start/finish/duration/work/cost) | Partial (no work/duration variance) |

## 3. Views (MS Project has ~20 built-in)

| View | Status |
|---|---|
| Gantt Chart | Done |
| Task Board / Sprint Board | Partial (single board, no sprints) |
| Network Diagram | Done (no box-style editor) |
| Resource Sheet | Done |
| Timeline | Done (basic) |
| **Calendar** (monthly task calendar) | Missing |
| **Tracking Gantt** (baseline vs actual bars) | Partial (baseline toggle only) |
| **Detail Gantt**, **Leveling Gantt**, **Multiple Baselines Gantt** | Missing |
| **Task Usage**, **Resource Usage** (timephased work/cost grids) | Resource Usage partial (heatmap only) |
| **Resource Graph** | Missing |
| **Team Planner** | Missing |
| **Task Form / Task Details Form / Task Name Form**, **Resource Form** | Drawer only |
| **Task Sheet**, Task Entry (Gantt + form) | grid only |
| Relationship Diagram | Missing |
| **Combination / split views** (top + details pane) | Missing |
| Custom views, View Definition | Missing |
| Zoom (timescale tiers, minutes to years), **timescale dialog** with tiers and non-working time shading | single-tier zoom |
| Gridlines, **progress lines**, current-date line, bar styles dialog, text styles, layout options, drawing tool, **Format Painter** | Partial |

## 4. Tables, fields, filters, groups

| Feature | Status |
|---|---|
| Built-in tables (Entry, Cost, Schedule, Tracking, Variance, Work, Summary, Usage, Baseline) | Column picker only, no named tables |
| Custom tables | Missing |
| **Custom fields**: Text1-30, Number1-20, Date, Duration, Cost, Flag, Start/Finish 1-10, Outline Code 1-10 | text and number only |
| **Formulas** and **graphical indicators** in custom fields, **lookup tables** (drop-down values) | Missing |
| **Outline codes**, **custom WBS code format** (WBS Code Definition) | WBS auto-numbered only |
| Filters: built-in (~50), **Custom Filter** dialog with AND/OR, **AutoFilter** on every column, **Highlight** filters | 11 fixed filters |
| Grouping: multi-level with intervals, **Group By** dialog | single level |
| Sort: multi-key (up to 3), permanent renumbering | single key |
| **Find / Replace / Go To**, **Fill Down**, copy/paste cells with formats, **Paste Special** | Missing |
| **Insert Column** with any of ~400 fields, column title/alignment/width dialogs | ~40 fields |

## 5. Task and resource commands (ribbon parity)

Task tab: **Manually Schedule / Auto Schedule**, **Inspect**, **Respect Links**, **Inactivate**, **Mode**, Summary, Deliverable, **Information (Task Information dialog with Predecessors, Resources, Advanced, Notes, Custom Fields tabs)**, Notes, Details, Add to Timeline, **Format Painter**, Clear formatting, font and fill styles. Resource tab: **Resource Pool, Resource Information dialog, Resource Assignment dialog (Assign Resources: units, cost, Replace, Remove, Graphs)**, Add Resources (from Address Book / Enterprise), Notes, Details, Level Selection / Resource / All, Leveling Options dialog. Project tab: **Change Working Time, WBS definitions, Calculate Project, Set Baseline for selected tasks, Links Between Projects, Project Information dialog with Statistics, Custom Fields dialog (full), Move Project, Spelling, Compare Projects**.

Status: dialogs and toggles for Inspect, Inactivate, Respect Links, Deliverable, Change Working Time, Leveling Options, Calculate Project, WBS definition, Compare Projects are **Missing**. The basic commands (indent, outdent, link, unlink, milestone, recurring task, move, delete) are **Done**.

## 6. Reports

MS Project has ~25 built-in visual reports (Dashboard: Project Overview, Burndown, Cost Overview, Work Overview, Upcoming Tasks, Critical Tasks, Late Tasks, Milestones; Resources; Costs; In Progress; plus a Custom Report editor with charts, tables, images, text boxes and field-linked cells).

Neo Project: 10 fixed reports, no **burndown**, no **Cash Flow**, no **Resource Cost Overview**, no **Upcoming Tasks**, no custom report editor. **Partial**.

## 7. Files, import, export and interoperability

| Feature | Status |
|---|---|
| Open/save native file | `.neoproject` JSON, Done |
| **Open and save `.mpp`** | Missing (binary format; no maintained open JS library) |
| **MS Project XML (`.xml`) import/export** | **Done** (`src/lib/mspxml.ts`): tasks, outline, durations incl. elapsed, links with lag units, constraints, deadlines, manual/inactive, calendar and exceptions, resources with rate units, assignments. Not carried over: baselines, timephased data, extended attributes, task/resource calendars, cross-project links (reported as warnings). Written to the MSPDI schema but not yet opened in MS Project itself, so check a real file before relying on it. |
| `.mpt` templates, project templates | 4 built-in templates |
| Excel import/export with field mapping, **Import Wizard** | export, simple paste import |
| CSV | Done |
| Export to PDF, XPS, image | print + PNG/SVG |
| **Outlook / Excel task sync**, macros (VBA), **Organizer** | Missing; out of scope |
| Password protect, read-only recommended, file properties | Missing |

## 8. Application chrome and UX

Ribbon, Backstage, undo/redo (one level in MS Project, many in Neo Project), status bar, keyboard shortcuts, dark mode are in place. Missing: **Quick Access Toolbar**, **Tell Me / search box**, right-click **context menus** (Task, Resource, column header, bar), **Task Information dialog on double-click**, **Project Information dialog with Statistics**, **Options dialog** (Schedule, Calculation, Display, General, Advanced), **Undo list**, **Zoom slider**, row **drag-and-drop** reorder, **Task Inspector pane**, **wizards**.

## 9. Phase 1 status (engine fidelity)

**Done and covered by tests (`src/core/core.test.ts`):**
- Manually scheduled tasks (typed start, optional typed finish; links and constraints never move them; conflict flagged; successors still follow). Task Mode column, ribbon buttons, drawer, drag-to-move.
- Inactive tasks (excluded from dates, cost, work, earned value, resource load and the critical path; their outgoing links stop driving others). Active column, ribbon button, strike-through row, dimmed bar.
- Lag as percent (`FS+50%`) and elapsed days (`SS+2ed`), plus `w`/`h`/`ew` units in the Predecessors cell and a unit selector in the drawer.
- Durations in minutes, hours, days, weeks, months and elapsed days/weeks (`3ed`); elapsed tasks run through weekends and holidays. A trailing `?` is accepted.
- Project calendar: any work week and named exception ranges that switch days off **or on** (Project › Change Working Time). Old holiday lists are migrated.
- Schedule from finish date (works backwards, every task as late as possible) and a configurable critical-slack threshold (Project Information).
- Start and Finish cells are editable (manual tasks store the typed date; auto tasks get a Start/Finish No Earlier Than constraint).

**Not done yet (still in Phase 1 scope):**
- Named base calendars (Standard / 24 Hours / Night Shift) and **task calendars**; resource calendars still use work days and vacations only. This needs the engine to schedule in calendar days instead of project working-day indexes, so it is its own change.
- Hour-level scheduling (start and finish times). Fractional days are supported, times of day are not.
- The estimated-duration flag (`?`) is parsed but not stored or displayed.
- A "Calculate Project" switch (the plan always recalculates automatically).

## 10. Roadmap (recommended order)

| Phase | Theme | Contents | Why first |
|---|---|---|---|
| **1** | **Engine fidelity** | manual scheduling, inactive tasks, % and elapsed lag, duration units and elapsed durations, base/task/resource calendars + Change Working Time, schedule from finish, project Options, Calculate Project, multiple critical-path threshold | Everything else depends on these dates being right |
| **2** | **Tracking and costs** | actual/remaining work and duration, physical % complete, timephased actuals, baselines 0-10 + per-task baselining, overtime, cost rate tables A-E, accrual, TCPI/ETC | Needed for real status reporting |
| **3** | **Dialogs and editing UX** | Task Information, Resource Information, Assign Resources, Project Information, Options, Change Working Time dialogs; context menus; Find/Replace/Go To; Fill Down; Format Painter; multi-key sort | Day-to-day parity with MS Project |
| **4** | **Views** | Calendar, Tracking Gantt, Task Usage, Resource Usage (timephased), Resource Graph, Team Planner, forms, split/combination views, timescale dialog, progress lines | Largest visible gap |
| **5** | **Fields, filters, tables** | full custom fields with formulas/indicators/lookup, outline codes, WBS definition, custom tables/filters/groups, AutoFilter, Highlight | Power-user parity |
| **6** | **Interop and reports** | MS Project XML import/export, custom report editor, remaining visual reports, Excel import wizard, compare projects | Moves real MS Project plans in and out |
| **7** | **Advanced** | subprojects and cross-project links, resource pools, macros-lite, Organizer | Rare in practice |

Not planned: `.mpp` binary read/write (no reliable open implementation; use XML), Project Server/Online, VBA, Outlook integration.
