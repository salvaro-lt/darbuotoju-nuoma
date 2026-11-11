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
