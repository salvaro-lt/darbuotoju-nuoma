# Logistics area (`staffing-logistics`)

"Apgyvendinimas ir transportas" (kind `business`, `dependsOn: ["staffing"]`, registers disabled; Super enables it).
Accommodation, vehicles and travel legs per project, who sleeps and rides where, the computed plan
"kas, kur, nuo kada iki kada" from the project's confirmed/active assignments, its warnings, a workwear/PPE
packing list, and coordinator notifications.

| | |
| - | - |
| Data owner | the client company (tables `staffing_logistics_*`) |
| Permissions | `staffing-logistics:plan:read`, `staffing-logistics:plan:manage` |
| Subroles | `staffing-logistics:viewer` (read), `staffing-logistics:coordinator` (read + manage) |
| Config | `defineLogistics(system, { functionsPath = "logistics", notifyWebhook? })`; env `N8N_URL`, `N8N_WEBHOOK_SECRET` (optional: without them notifications are recorded as `not_configured`), `APP_ENV`, `SUPER_USER_EMAILS` (`redirectTo` outside production), `SITE_URL` (link in the mail) |
| Cron | `internal.logistics._dailyDigest` daily (app `convex/crons.ts`): projects with "Kasdien siųsti įspėjimus" on |
| Demo data | `npx convex run logistics:_seedDemo` after `staffing:_seedDemo` (`'{"reset":true}'` wipes the logistics tables first; refuses with `APP_ENV=production`) |

Plan and checks are pure (`./pure.ts`, browser-safe as `@digimuza/staffing/logistics/pure`, tests in
`test/logistics.test.ts`): `computePlan` (beds short, worker without bed, accommodation overfull, vehicle without
a valid driver, seats short, arrival without a travel leg, unbooked leg, unknown clothing sizes, paid empty beds;
costs of the window), `autoAssignBeds`, `autoAssignSeats` (drivers first), `planSnapshot` + `diffSnapshots`
("Planas pasikeitė" since the last acknowledgment), `packingList` + `ppeKit`, `warningLine` (LT text for mails).

A driver is a worker whose assignment has `isDriver` and whose card has a valid licence (category B or higher, not
expired); `setAllocation` refuses others with `VALIDATION driver_not_eligible`.

Success: a coordinator opens `NDS-2026-07`, sees "Trūksta lovų" from the day Jānis arrives, adds a bed (or a
second flat), clicks "Paskirstyti lovas", the warning disappears; "Siųsti įspėjimus koordinatoriui" sends the rest
through the `dr-nuoma-pranesimas` webhook. Denial: a `staffing-logistics:viewer` calls `autoAssign` → `FORBIDDEN`;
with the module off every call → `FORBIDDEN`.

## Housing pool and fleet (DIG-110)

The client rents flats long-term in a region (Rotterdam + ~100 km), pays every bed whether occupied or not, and
people from one flat work on several projects. So flats and vehicles are **region resources**, not project ones.

| | |
| - | - |
| Pages | `/app/logistics/housing` (Būstų fondas), `/app/logistics/vehicles` (Transportas); sub-nav on every logistics page; the project page's "Būstai ir transportas" tab lists members housed in the pool |
| Tables | `staffing_logistics_accommodations` (`projectId` now optional; pool flats have `region`, `city`, `rooms?`, `landlord`; `startDate`–`endDate` = lease), `staffing_logistics_stays` (worker + flat + period, any project), `staffing_logistics_vehicles` (`projectId` optional; fleet vehicles have `region`, `accommodationId?` = the flat group riding it), `staffing_logistics_vehicleLogs` (date, `fuel`/`trip`/`service`, km driven, litres, cost, driver) |
| Functions | queries `housingOverview`, `fleetOverview`, `housingCosts`; mutations `saveFlat`, `saveStay`, `endStay`, `applyConsolidation`, `autoAllocateHousing`, `saveFleetVehicle`, `addVehicleLog`, `deleteVehicleLog` (`plan:read` / `plan:manage`) |
| Demo data | `npx convex run logistics:_seedHousing` after `staffing:_seedDemo` (+ optionally `logistics:_seedDemo`); `'{"reset":true}'` rebuilds; refuses with `APP_ENV=production` |

Pure and unit-tested (`./housing.ts`, browser-safe as `@digimuza/staffing/logistics/housing`, tests in
`test/housing.test.ts`):

- **Occupancy**: `flatStats` (bed-nights paid/used, cost of the window — a monthly price costs exactly that per
  calendar month — cost per occupied bed, money for empty beds), `regionTotals`, `flatFlags` (`lonely` = 1 person in
  a 3+-bed flat, `empty`, `under_occupied` < 60 % this month, `overfull`, rule breaches, `lease_ending` ≤ 30 days).
- **Grouping rules** (`groupIssues`, `canLiveTogether`): everyone in a flat shares at least one language; one gender
  per flat **only when stored** (workers have no gender field today, so it never blocks); a flat with a vehicle needs
  a resident with a valid licence (B+); flats and projects match by region (`regionOf(city)`, a city table for
  Rotterdam + 100 km; unknown cities are their own region). Nationality is a preference (`nationalityAffinity`).
- **Consolidation** (`suggestMoves`, greedy): flats under 60 % on the move date, emptiest and dearest first, are
  emptied only if *every* resident fits elsewhere in the region on every day of their stay under the rules;
  targets prefer occupied flats, the same nationality, the tightest fit; a flat that receives people is never
  emptied. Saving = the emptied flat's monthly cost.
- **Incoming team** (`allocateIncoming`): workers with a confirmed/active assignment in the region within 4 weeks
  and no bed (`incomingWorkers`) go to paid beds of occupied flats first, nationality groups together; an empty flat
  is opened only when needed; reasons for the rest (`no_free_bed`, `no_compatible_flat`, `no_flat_in_region`).
- **Vehicles** (`vehicleStats`): rent/lease share of the month + fuel + service, km, cost per km, l/100 km.

Backward compatibility: no data migration is needed. Existing project-bound flats and vehicles keep `projectId` and
work as before on the project page; the housing dashboard shows them read-only ("Projekto būstas"), with occupancy
derived from their bed allocations × assignment periods. Project plans count pool stays as beds
(`computePlan({ pooled })`), so a member housed in the pool is not "without a bed", and "Paskirstyti lovas" doesn't
give them a project bed.

### Costs per project (for invoicing / profitability)

The invoicing area owns `staffing_invoicing_costs`; logistics doesn't write it. Instead it exposes:

```ts
import { housingCostsByProject } from "@digimuza/staffing"
// No permission check inside: guard first (e.g. the invoicing cost-read permission).
const { projects, unallocatedCents, totalCents } = await housingCostsByProject(ctx, { from: "2026-11-01", to: "2026-11-30" })
// projects: [{ projectId, projectCode, projectName, accommodationCents, emptyBedCents, vehicleCents, bedNights }]
```

Rule: each day a flat's rent (empty beds included) is shared equally by the people sleeping there and charged to the
project each works on that day (`emptyBedCents` is the part paid for empty beds); an empty legacy flat goes to its
project, an empty pool flat to `unallocatedCents`. A vehicle goes to its `projectId`, else to the projects of its
flat's residents that day; fuel and service come from the log on their date. The UI gets the same numbers through
the `logistics:housingCosts` query (`plan:read`). Pure core: `allocateHousingCosts`.

Success: a coordinator opens Būstų fondas (Rotterdam), sees "1 žmogus 5 vietų bute" on Vlaardingen and 2 360 €
wasted there this month, clicks "Perkelti" (Vitalii → Dordrecht, saves 2 950 €/mėn.), then "Paskirstyti
atvykstančius": the three Filipino welders arriving in 5 days land in paid beds in Maassluis and Spijkenisse (shared
English), never with the Ukrainian-only speaker. Denial: a `staffing-logistics:viewer` calls `saveStay` /
`autoAllocateHousing` / `addVehicleLog` → `FORBIDDEN`.
