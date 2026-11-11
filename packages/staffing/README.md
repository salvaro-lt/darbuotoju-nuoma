# @digimuza/staffing

Business module `staffing` ("Darbuotojai ir projektai", kind `business`, registers disabled; Super enables it).
The shared base of a staffing company's system: **workers** (trades, certificates, licences, sizes), **clients**
(and subcontractors), **projects** at client sites, and **assignments** (who works on which project, in which
trade, when). Feature areas (team formation, timesheets, invoicing, logistics, compliance) build on it.

| | |
| - | - |
| Data owner | the client company (tables `staffing_*`, certificate files in Convex storage) |
| Permissions | `staffing:worker:{read,create,update,delete}`, `staffing:client:{…}`, `staffing:project:{…}`, `staffing:assignment:{…}`, `staffing:catalog:manage` |
| Subroles | `staffing:viewer` (read all), `staffing:planner` (workers, projects, assignments; reads clients), `staffing:admin` (everything) |
| Config | `defineStaffing(system, { scanLimit })` |
| AI tools | `staffing.list_workers`, `staffing.get_worker`, `staffing.find_available_workers`, `staffing.list_projects` (read-only) |
| Demo data | `npx convex run staffing:_seedDemo` (`'{"reset":true}'` wipes first; refuses with `APP_ENV=production`) |

Success: a planner opens project `NDS-2026-07`, picks "MAG welder" and the period, sees only workers free for the
whole period with valid mandatory certificates, assigns one as `confirmed`.
Denial: a `staffing:viewer` calls `createAssignment` → `FORBIDDEN`; with the module off every call → `FORBIDDEN`.

Tests: `pnpm --filter @digimuza/staffing test` (pure helpers) and `apps/web/convex/staffing.test.ts` (access,
CRUD + overlap + availability + audit, seed).

## The contract

Everything below is exported from `@digimuza/staffing` (browser-safe subpaths: `/manifest`, `/pure`, `/tables`).
Changing a meaning here breaks the areas: add, don't change.

### Conventions

- **Dates**: ISO calendar days `YYYY-MM-DD` (strings compare as dates). Ranges are **inclusive**; a missing
  `endDate` means open-ended.
- **Money**: integer **cents** (`hourlyRateCents: 4250` = 42.50 EUR). `currency` is `"EUR"` today.
- **IDs**: typed (`v.id("staffing_workers")`; TS `WorkerId`, `ProjectId`, `TradeId`, …).
- **Errors**: `fail(code, reason, operationId, fields?)` → `ConvexError` with a stable code (`NOT_FOUND`,
  `CONFLICT`, `VALIDATION`, `FORBIDDEN`). Reasons used by the base: `worker_busy`, `project_closed`,
  `worker_inactive`, `worker_lacks_trade`, `duplicate_code`, `*_in_use`, `end_before_start`, `invalid_<field>`.

### Tables (`staffingTables`)

| Table | Key fields | Indexes |
| - | - | - |
| `staffing_trades` | `code` (unique, upper case), `nameLt`, `nameEn`, `position` | `by_code`, `by_position` |
| `staffing_certificateTypes` | `name`, `nameEn?`, `appliesTo: "worker"`, `mandatory`, `defaultValidityMonths?`, `position` | `by_name`, `by_position` |
| `staffing_workers` | `firstName`, `lastName`, `phone`, `email?`, `nationality` (ISO-2), `languages[]` (ISO-639-1), `source: own\|subcontractor`, `subcontractorClientId?`, `trades[{tradeId, level}]`, `driverLicenseCategories[]`, `driverLicenseExpiresAt?`, `clothingSizes{jacket?,trousers?,shoes?}`, `status: active\|inactive`, `notes`, `homeCountry`, `homeCity`, `searchText` (maintained) | `by_status[status,lastName]`, `by_source[source,status]`, `by_subcontractor`, search `search` |
| `staffing_workerCertificates` | `workerId`, `certificateTypeId`, `number?`, `issuedAt?`, `expiresAt?` (none = never), `fileStorageId?`, `fileName?`, `notes?` | `by_worker[workerId,certificateTypeId]`, `by_type[certificateTypeId,expiresAt]`, `by_expires[expiresAt]` |
| `staffing_clients` | `name`, `code` (unique), `kind: client\|subcontractor\|both`, `country`, `vatCode?`, `companyCode?`, `address?`, `contacts[]`, `defaultRates[{tradeId, hourlyRateCents}]`, `currency`, `paymentTermsDays`, `invoicingPeriod: weekly\|biweekly\|monthly`, `notes` | `by_code`, `by_name` |
| `staffing_projects` | `clientId`, `name`, `code` (unique), `country`, `city`, `siteAddress?`, `startDate`, `endDate?`, `status: draft\|active\|finished\|cancelled`, `coordinatorUserId?` (system-core user ID), `rates[]` (sell), `currency`, `notes` | `by_code`, `by_status[status,startDate]`, `by_client[clientId,startDate]` |
| `staffing_assignments` | `projectId`, `workerId`, `tradeId`, `startDate`, `endDate?`, `status: proposed\|confirmed\|active\|ended\|cancelled`, `isDriver`, `notes`, `createdBy` | `by_worker[workerId,startDate]`, `by_project[projectId,startDate]`, `by_status[status,startDate]` |
| `staffing_workerAvailability` | `workerId`, `kind: rest\|unavailable\|available_from`, `startDate`, `endDate?` (none = until further notice; unused for `available_from`), `note`, `createdBy` | `by_worker[workerId,startDate]`, `by_kind[kind,startDate]` |

Rules the base enforces: a `confirmed`/`active` assignment never overlaps another `confirmed`/`active` one of the
same worker (`BLOCKING_ASSIGNMENT_STATUSES`); new assignments need an active worker who has the trade and a `draft`
or `active` project. A worker may hold several certificates of one type (renewals): the one with the latest expiry
counts (`latestCertificateByType`).

### Shared operations (`src/operations.ts`)

They take any Convex ctx with `db` (`{ db: unknown }`) and **do not check permissions**: your function guards
first (`system.requirePermission(ctx, YourPermissions.x, opts(args))`), then calls them.

| Function | Returns |
| - | - |
| `getWorkerCard(ctx, workerId, { onDate? })` | `WorkerCard \| null`: worker summary + notes/sizes/licence, `certificates` (status on `onDate`, default today), `missingMandatory`, `assignments` (not cancelled), `current`, `next` |
| `listAvailableWorkers(ctx, { from, to?, trades?, minLevel?, requireValidCertsOn?, requiredCertificateTypeIds?, source?, ignoreAssignmentIds? })` | `AvailableWorker[]`: active workers with no confirmed/active assignment overlapping `[from, to]` (proposed don't block) and not away on rest / unavailable / before `available_from` on any day of it, with one of `trades` at `minLevel`+; with `requireValidCertsOn`, only those whose mandatory + required certificate types are usable that day. Each has `matchingTrades` and `requiredCertStatus` |
| `projectTeam(ctx, projectId, onDate?)` | `TeamMember[]` (assignment view + `worker: WorkerSummary`), not cancelled; with `onDate`, only those covering it |
| `workerSummaries(ctx, workerDocs, { onDate?, requiredTypeIds?, catalog? })` | summaries with trades and `certStatus` |
| `workerAssignments(ctx, workerId)` / `workerCertificates(ctx, workerId)` | raw docs |
| `assignmentViews(ctx, assignmentDocs)` | with project, client and trade names |
| `busyWorkerIds(ctx, { from, to? }, ignoreIds?)` | `Set` of worker IDs |
| `projectSellRate(ctx, projectId, tradeId)` | cents: project rate, else client default, else `null` |
| `listExpiringCertificates(ctx, { to, from?, includeExpired?, includeInactive?, limit? })` | latest certificates expiring in `[from, to]`, soonest first, with worker name |
| `loadCatalog(ctx)` | trades and certificate types (maps + ordered lists) |
| `certificateSummary(certs, catalog, onDate, requiredTypeIds?)` | `{ status, requiredStatus, missingMandatory }` |

### Pure helpers (`@digimuza/staffing/pure`, unit-tested)

`certificateStatus(cert, onDate)` → `valid | expiring60 | expiring30 | expired | missing` (no cert → `missing`; no
expiry → `valid`; ≤30 days left → `expiring30`; ≤60 → `expiring60`), `worstCertificateStatus`,
`isUsableCertificateStatus`, `latestCertificateByType`, `defaultExpiry`, `rangesOverlap`, `rangeCovers`,
`overlappingBlocking`, `isBlockingAssignment`, `currentAndNext`, `sellRateFor`, `isIsoDate`, `todayIso`, `addDays`,
`addMonths`, `daysBetween`, `toCents`, `formatCents`, `fullName`, `fold`; enums `WORKER_STATUSES`,
`WORKER_SOURCES`, `TRADE_LEVELS`, `CLIENT_KINDS`, `INVOICING_PERIODS`, `PROJECT_STATUSES`, `ASSIGNMENT_STATUSES`,
`BLOCKING_ASSIGNMENT_STATUSES`, `OPEN_PROJECT_STATUSES`, `CERTIFICATE_STATUSES`.

### Building blocks for your own functions (`src/shared.ts`)

`readerOf(ctx)` / `writerOf(ctx)` (typed db over the staffing data model; pass your own with
`DataModelOf<typeof staffingTables & typeof myTables>`), `StaffingDoc<"staffing_workers">` and `WorkerDoc`,
`ProjectDoc`, …, `actorArgs` + `opts(args)` (agents' `apiKey`), `actorId`, `fail`, `cleanText`, `cleanDate`,
`checkRange`, `cleanCode`, `cleanCountry`, `cleanCents`.

### Convex functions (`defineStaffing(system)` → `apps/web/convex/staffing.ts`)

Catalog: `listTrades`, `createTrade`, `updateTrade`, `deleteTrade`, `listCertificateTypes`, `createCertificateType`,
`updateCertificateType`, `deleteCertificateType`. Workers: `listWorkers`, `getWorker`, `findAvailableWorkers`,
`createWorker`, `updateWorker`, `deleteWorker`, `generateCertificateUploadUrl`, `getCertificateFileUrl`,
`addWorkerCertificate`, `updateWorkerCertificate`, `deleteWorkerCertificate`. Clients: `listClients`, `getClient`,
`createClient`, `updateClient`, `deleteClient`. Projects: `listProjects`, `getProject` (with team),
`createProject`, `updateProject`, `deleteProject`. Assignments: `listAssignments`, `createAssignment`,
`updateAssignment`, `deleteAssignment`. Dev: `_seedDemo` (internal). Every write audits `staffing.<object>.<verb>`
and returns `operationId`. Catalog reads need `staffing:worker:read`.

## Area: planning (`staffing-planning`, DIG-109)

Two-level planning: projects, and every worker as a timeline of their own (`src/planning/`, UI `/app/planning`).
Worker rotation lives in the base table `staffing_workerAvailability` (pure `availabilityBlocks`, operations
`blockingAvailability`, `unavailableWorkerIds`, `workerAvailability`); the area adds `staffing_planning_capacities`
(subcontractor capacity per trade with validity), `staffing_planning_clientRules` (team composition rules per client)
and `staffing_planning_feedback` (`suitable` / `unsuitable` per worker and client). Pure, unit-tested:
`planning/rules` (`evaluateTeamRules`, `applyTeamRules`: drivers per N people, English per team or flat, shared
language, housing hint) and `planning/pure` (`weeksFrom`, `weekCell`, `workerStatusOn`, `supplyDemand`,
`capacityAnswer`, `capacityReply`). The teams engine uses all of it: unsuitable workers get the blocking warning
`client_unsuitable`, the proposal keeps the client's rules, "Ko trūksta" lists subcontractor capacity. AI tool
`staffing-planning.capacity`. Demo: `npx convex run planning:_seedDemo` (after `staffing:_seedDemo` and
`teams:_seedDemo`).

## How to add an area

Areas: `teams`, `timesheets`, `invoicing`, `logistics`, `compliance`. Each is its **own module** (own ID, own
permissions), lives in this package and touches the shared files with one line each. Example for `timesheets`:

1. `packages/staffing/src/timesheets/`
   - `manifest.ts`: `export const staffingTimesheets = defineModule({ id: "staffing-timesheets", kind: "business", dependsOn: ["staffing"], permissions: [{ id: "staffing-timesheets:entry:read", … }], initialSubroles: [ … ] })` and `StaffingTimesheetsPermissions`. Permission IDs must start with the module ID; AI tool IDs with `staffing-timesheets.`.
   - `tables.ts`: `export const timesheetsTables = { staffing_timesheets_entries: defineTable({ assignmentId: v.id("staffing_assignments"), … }).index(…) }` — prefix `staffing_<area>_`, an index for every query, dates/money per the conventions.
   - `functions.ts`: `export function defineTimesheets(system: ConvexSystem) { return { … } }` with `queryGeneric` / `mutationGeneric`; guard → checks → write → `recordAudit` → `{ operationId }`. Reuse the shared operations above; never write base tables except through the base's rules (e.g. assignment overlap).
   - `ai-tools.ts` (optional): `export const timesheetsTools = [ … ] as const`.
   - `index.ts`: re-export all of it. Tests in `packages/staffing/test/timesheets.test.ts` (pure) and `apps/web/convex/timesheets.test.ts` (convex-test).
2. `packages/staffing/src/index.ts`: `export * from "./timesheets"` (and a `"./timesheets/manifest"` entry in
   `package.json` exports if the browser needs the manifest alone).
3. App, one line each:
   - `apps/web/modules/index.ts`: add `staffingTimesheets` under the "staffing areas" comment in `appModules`.
   - `apps/web/convex/schema.ts`: `...timesheetsTables,` under "Staffing areas".
   - `apps/web/convex/timesheets.ts`: `export const { … } = defineTimesheets(system)`.
   - `apps/web/convex/aiConfig.ts`: `...timesheetsTools` in the assistant's `tools`.
   - `apps/web/app/app/nav.tsx`: one `<NavItem>` inside the "Darbuotojai ir projektai" group (comment "staffing areas").
   - `apps/web/lib/i18n/messages.ts`: import `timesheetsLt/En` from a new `timesheets-messages.ts` and spread them under the "staffing areas" comments.
4. Pages under `apps/web/app/app/<area>/` with `requireSession({ permission })`, `<Can>`, `useAction`; reuse
   `app/app/staffing/_components/staffing-ui.tsx` (badges, `Period`, `NativeSelect`, `useTrades`, hrefs).
5. Codegen (`npx convex dev --once` in `apps/web`), `npx convex run system:registerSystem`, Super enables the module.

## Compliance: client document package (DIG-113)

"Agent, send these people's documents to this client": `src/compliance/package-*.ts`.

- **Rule** (`evaluatePackage`, pure): complete when every required document (country + client requirements) of
  every chosen member is valid/expiring **and** has a scan → `ready`; anything missing, expired or without a scan →
  `needs_approval` with the missing list. Expiring documents are listed as warnings only.
- **Flow**: package page `/app/compliance/projects/<id>/package` → "Siųsti klientui…" (recipients from the client's
  contacts, LT/EN/NL, team members, note, live preview) → `createPackage`. `ready` is sent at once when the project's
  "Siųsti automatiškai" switch is on, else with one click (`sendPackage`); `needs_approval` → "Siųsti vis tiek" or
  "Atšaukti". The AI tool `staffing-compliance.send_package` (approval card) sends complete packages and leaves
  incomplete ones waiting; its queue is drained by the cron `compliance:_drainPackages` (tool handlers cannot schedule).
- **Sending path: n8n** webhook `dr-nuoma-dokumentu-paketas` (`n8n/deploy.py`): `apps/web/convex/mail.ts` (Resend)
  has no attachments. The app renders subject/HTML/text; attachments are file URLs Resend fetches. Over
  `packageCapBytes` (default 15 MB) or 40 files → no attachments, a ZIP link instead. Non-production → `redirectTo`
  = first `SUPER_USER_EMAILS`. Without `N8N_URL`/`N8N_WEBHOOK_SECRET` → status `not_configured` ("Nesukonfigūruota"),
  the package stays downloadable through a link.
- **Log**: `staffing_compliance_packages` (who, when, to whom, each document with certificate id + `updatedAt`
  version, missing list, approver), `packageSends` (worker card "Paskutinį kartą siųsta klientui …"),
  `packageLinks` (SHA-256 of the token, expiry, revocation), `packageDownloads` (views and ZIP downloads).
- **Public link** `/d/<token>` (no login, default 14 days, `/d/<token>/zip` builds the ZIP server-side).
- **Demo**: `compliance:_seedDemo` adds VSB-2026-14 (complete → `ready`), a `needs_approval` package on VSB-2026-12
  and a send history; `compliance:_seedPackageLink '{"projectCode":"VSB-2026-12"}'` prints a fresh public link.
