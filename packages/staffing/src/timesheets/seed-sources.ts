// DIG-111 demo data, part of `timesheets:_seedDemo` (after the base timesheet seed):
// - personal links for every NDS / BST worker (fixed tokens: `/h/demo-pavyzdys-…`),
// - a week and a half of NDS worker self-entries with a few disagreements and
//   two "nesutinku" marks,
// - a BST client export read from a PDF (factory scan log: 20+ lines a day of
//   13 minutes per welder), filed from email and waiting for review,
// - dispute cases since September: the client re-checked approved months
//   (~6 000 € open) and two resolved ones.
// Idempotent on its own: skipped when worker links exist.
import type { GenericDatabaseWriter } from "convex/server"
import { projectSellRate } from "../operations"
import { addDays, addMonths, fold } from "../pure"
import type { ProjectDoc, WorkerDoc } from "../shared"
import type { TimesheetsDataModel } from "./operations"
import { aggregateRawRows, disputeAmountCents, isoWeek, roundHours, weekday, type DisputeKind, type DisputeStatus, type RawClientRow } from "./pure"

type Db = GenericDatabaseWriter<TimesheetsDataModel>

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
const hex = (n: number, len: number) => n.toString(16).padStart(8, "0").slice(0, len)

/** The demo link token of a worker: readable and stable across reseeds (`demo-pavyzdys-1a2b3c4d5e6f`). */
export function demoWorkerToken(w: { firstName: string; lastName: string }): string {
  const slug = fold(w.lastName).replace(/[^a-z]/g, "").slice(0, 24) || "worker"
  return `demo-${slug}-${hex(hash(`${w.firstName} ${w.lastName}`), 8)}${hex(hash(w.lastName + w.firstName), 4)}`
}

export async function seedTimesheetsSources(db: Db, a: { nds: ProjectDoc; bst: ProjectDoc; today: string; thisMonday: string; clientName: (w: WorkerDoc) => string; now: number }): Promise<{ links: number; workerEntries: number; disputes: number; rawRows: number }> {
  if (await db.query("staffing_timesheets_workerLinks").first()) return { links: 0, workerEntries: 0, disputes: 0, rawRows: 0 }
  const { nds, bst, today, thisMonday, now } = a
  const yesterday = addDays(today, -1)
  const w1 = addDays(thisMonday, -7)

  const teamOf = async (p: ProjectDoc) => {
    const xs = (
      await db
        .query("staffing_assignments")
        .withIndex("by_project", (q) => q.eq("projectId", p._id))
        .collect()
    ).filter((x) => x.status === "active" || x.status === "ended" || x.status === "confirmed")
    const out: { w: WorkerDoc; x: (typeof xs)[number] }[] = []
    for (const x of xs) {
      const w = await db.get("staffing_workers", x.workerId)
      if (w) out.push({ w, x })
    }
    return out
  }
  const ndsTeam = await teamOf(nds)
  const bstTeam = await teamOf(bst)

  // ---------------------------------------------------------------- personal links
  let links = 0
  for (const { w } of [...ndsTeam, ...bstTeam]) {
    if (await db.query("staffing_timesheets_workerLinks").withIndex("by_worker", (q) => q.eq("workerId", w._id)).first()) continue
    await db.insert("staffing_timesheets_workerLinks", { workerId: w._id, token: demoWorkerToken(w), createdAt: now - 10 * 86_400_000, createdBy: "seed", ...(w.email ? { lastSentAt: now - 10 * 86_400_000, lastSentTo: w.email, lastSendStatus: "sent" as const } : {}) })
    links++
  }

  // ---------------------------------------------------------------- NDS worker self-entries (last week + this week)
  let workerEntries = 0
  const find = (last: string) => ndsTeam.find((t) => t.w.lastName === last)
  const special = new Map<string, { hours?: number; note?: string; flag?: string }>()
  const key = (w: WorkerDoc | undefined, date: string) => `${w?._id}|${date}`
  // Coordinator forgot 2 h overtime; worker and client agree on 10.
  special.set(key(find("Pavyzdys")?.w, addDays(w1, 1)), { hours: 10, note: "2 val. viršvalandžių – baigėm bloką B14" })
  // Client counts 0.5 h less; worker disagrees.
  special.set(key(find("Testenko")?.w, addDays(w1, 3)), { flag: "Dirbau iki 16:30, kortelę nuskenavau išeidamas. Klientas parašė 7,5 val." })
  // Client missed the whole Friday.
  special.set(key(find("Próbny")?.w, addDays(w1, 4)), { flag: "Penktadienį dirbau visą dieną bloke B15, kliento tabelyje manęs nėra." })
  const odd = ndsTeam.find((t) => !["Pavyzdys", "Testenko", "Próbny"].includes(t.w.lastName) && t.x.startDate <= thisMonday)
  // The worker writes 2 h more than anyone else (sat in the container waiting).
  if (odd && thisMonday <= yesterday) special.set(key(odd.w, thisMonday), { hours: 10, note: "Laukėm konteineryje, kol atveš detales" })

  const own = await db
    .query("staffing_timesheets_entries")
    .withIndex("by_project_date", (q) => q.eq("projectId", nds._id).gte("date", w1).lte("date", yesterday))
    .collect()
  for (const e of own) {
    const s = special.get(`${e.workerId}|${e.date}`)
    // Not everybody notes every day.
    if (!s && hash(`${e.workerId}${e.date}`) % 7 === 0) continue
    const total = s?.hours ?? e.regularHours + e.overtimeHours
    await db.insert("staffing_timesheets_workerEntries", {
      assignmentId: e.assignmentId,
      projectId: e.projectId,
      workerId: e.workerId,
      date: e.date,
      regularHours: Math.min(total, 8),
      overtimeHours: roundHours(Math.max(0, total - 8)),
      ...(s?.note ? { note: s.note } : {}),
      ...(s?.flag ? { disagree: { comment: s.flag, at: Date.parse(`${addDays(e.date, 9)}T17:20:00Z`) > now ? now - 3_600_000 : Date.parse(`${addDays(e.date, 9)}T17:20:00Z`) } } : {}),
      updatedAt: Date.parse(`${e.date}T17:05:00Z`),
    })
    workerEntries++
  }
  for (const l of await db.query("staffing_timesheets_workerLinks").collect()) if (ndsTeam.some((t) => t.w._id === l.workerId)) await db.patch("staffing_timesheets_workerLinks", l._id, { lastActivityAt: now - 5 * 3_600_000 })

  // ---------------------------------------------------------------- BST: a scan-log PDF from email, pending review (week W-3)
  const w3 = addDays(thisMonday, -21)
  const bstOwn = await db
    .query("staffing_timesheets_entries")
    .withIndex("by_project_date", (q) => q.eq("projectId", bst._id).gte("date", w3).lte("date", addDays(w3, 6)))
    .collect()
  const bstWorkers = new Map(bstTeam.map((t) => [t.w._id as string, t.w]))
  const raw: RawClientRow[] = []
  let deviation = false
  for (const e of bstOwn.sort((x, y) => x.date.localeCompare(y.date) || x.workerId.localeCompare(y.workerId))) {
    const w = bstWorkers.get(e.workerId)
    if (!w) continue
    const name = a.clientName(w)
    const minutes = (e.regularHours + e.overtimeHours) * 60
    // One welder's Wednesday is two scans short (the client pays 0.5 h less).
    const short = !deviation && weekday(e.date) === 2 && minutes >= 480
    if (short) deviation = true
    const parts = minutes >= 300 ? (short ? 18 : 20) : Math.floor(minutes / 26)
    for (let i = 0; i < parts; i++) raw.push({ name, date: e.date, minutes: 13, ref: `Teil 47${String(hash(w.lastName) % 90 + 10)}-${String(i + 1).padStart(2, "0")} · Zelle W${(i % 4) + 1}` })
    const rest = minutes - 13 * (minutes >= 300 ? 20 : parts)
    if (rest > 0) {
      raw.push({ name, date: e.date, minutes: Math.ceil(rest / 2), ref: "Rüstzeit / Setup" })
      raw.push({ name, date: e.date, minutes: Math.floor(rest / 2), ref: "Reinigung, Kranwartezeit" })
    }
  }
  const client = await db.get("staffing_clients", bst.clientId)
  const from = client?.contacts.find((c) => c.email)?.email ?? "pm@bst.example"
  const received = Date.parse(`${addDays(w3, 8)}T07:42:00Z`)
  const subject = `Stundennachweis KW${isoWeek(w3)} – ${bst.code}`
  const fileName = `BST_Produktionsprotokoll_KW${isoWeek(w3)}.pdf`
  const sheetId = await db.insert("staffing_timesheets_clientSheets", {
    projectId: bst._id,
    periodFrom: w3,
    periodTo: addDays(w3, 6),
    source: "pdf",
    status: "ready",
    fileName,
    rows: aggregateRawRows(raw),
    rawRows: raw,
    nameMap: [],
    receivedAt: received,
    createdBy: "email",
    review: "pending",
    email: { from, subject, receivedAt: received },
  })
  await db.insert("staffing_timesheets_intake", {
    emailKey: `demo-${bst.code}-${w3}`,
    inboxAddress: "tabeliai@demo.local",
    from,
    subject,
    receivedAt: received,
    attachments: [{ name: fileName, type: "application/pdf", size: 184_211 }],
    status: "imported",
    clientId: bst.clientId,
    projectId: bst._id,
    matchedBy: "project_code",
    sheetId,
    createdAt: received,
    createdBy: "seed",
  })
  // An email the system could not place: no project code, sender unknown.
  await db.insert("staffing_timesheets_intake", {
    emailKey: "demo-unmatched",
    inboxAddress: "tabeliai@demo.local",
    from: "planning@werft-noord.example",
    fromName: "Werft Noord – Planning",
    subject: "Urenstaat week " + isoWeek(addDays(thisMonday, -7)),
    receivedAt: now - 26 * 3_600_000,
    attachments: [{ name: "urenstaat.pdf", type: "application/pdf", size: 96_310 }],
    status: "no_match",
    createdAt: now - 26 * 3_600_000,
    createdBy: "seed",
  })

  // ---------------------------------------------------------------- disputes since September (BST, the stubborn client)
  let disputes = 0
  const september = addMonths(`${today.slice(0, 7)}-01`, -2)
  // Workers on the project since before September first.
  const picks = [...bstTeam].sort((x, y) => x.x.startDate.localeCompare(y.x.startDate) || x.w.lastName.localeCompare(y.w.lastName))
  const day = (offset: number) => addDays(september, offset)
  const at = (date: string, hour = 9) => Math.min(now - 3_600_000, Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`))
  const cases: { t: (typeof bstTeam)[number] | undefined; from: string; to: string; kind: DisputeKind; status: DisputeStatus; targetEur: number; title: string; timeline: { date: string; kind: "created" | "status" | "note"; status?: DisputeStatus; note?: string }[] }[] = [
    {
      t: picks[0],
      from: september,
      to: addDays(addMonths(september, 1), -1),
      kind: "client_recheck",
      status: "waiting_client",
      targetEur: 2800,
      title: "Klientas po patvirtinimo pakartotinai patikrino rugsėjo tabelį",
      timeline: [
        { date: day(41), kind: "created", status: "open", note: "Klientas atsiuntė patikslintą rugsėjo išrašą: 7 dienos be registracijos elektroninėje sistemoje. Rugsėjo tabelį jie buvo patvirtinę." },
        { date: day(43), kind: "note", note: "Darbuotojas sako, kad kortelę buvo pamiršęs, įleido apsaugos darbuotojas. Turime jo kalendorių su valandomis." },
        { date: day(44), kind: "status", status: "waiting_client", note: "Išsiųstas darbuotojo kalendorius ir mūsų tabelis, prašome apsaugos įrašų." },
      ],
    },
    {
      t: picks[1],
      from: addMonths(september, 1),
      to: addDays(addMonths(september, 2), -1),
      kind: "client_recheck",
      status: "open",
      targetEur: 1900,
      title: "Spalio tabelis: klientas nubraukė viršvalandžius",
      timeline: [{ date: day(63), kind: "created", status: "open", note: "Klientas pripažįsta tik 8 val. per dieną, nors viršvalandžius vietoje patvirtino meistras žodžiu." }],
    },
    {
      t: picks[2],
      from: addDays(september, 14),
      to: addDays(september, 44),
      kind: "client_recheck",
      status: "open",
      targetEur: 1300,
      title: "Krano operatoriaus prastovos – klientas nemoka laukimo",
      timeline: [
        { date: day(50), kind: "created", status: "open", note: "Klientas nurašė laukimo valandas, kai neveikė kranas." },
        { date: day(52), kind: "note", note: "Paprašyti kliento krano gedimų žurnalo." },
      ],
    },
    {
      t: picks[3],
      from: addDays(september, 21),
      to: addDays(september, 27),
      kind: "mismatch",
      status: "resolved_compensated",
      targetEur: 260,
      title: "Sumaišytos dienos – kompensuota darbuotojui",
      timeline: [
        { date: day(30), kind: "created", status: "open" },
        { date: day(36), kind: "status", status: "resolved_compensated", note: "Klientas įrodymų neturi, darbuotoju tikime – skirtumas sumokėtas iš mūsų." },
      ],
    },
    {
      t: picks[4],
      from: addDays(september, 28),
      to: addDays(september, 34),
      kind: "worker_flag",
      status: "resolved_accepted",
      targetEur: 340,
      title: "Darbuotojas nesutiko – klientas pripažino klaidą",
      timeline: [
        { date: day(37), kind: "created", status: "open", note: "Darbuotojas pažymėjo „Nesutinku“ ketvirtadieniui." },
        { date: day(40), kind: "status", status: "resolved_accepted", note: "Klientas: „Mūsų klaida“, pataisyta kitoje sąskaitoje." },
      ],
    },
  ]
  for (const c of cases) {
    if (!c.t) continue
    const rateCents = (await projectSellRate({ db }, bst._id, c.t.x.tradeId)) ?? 4500
    const hours = roundHours((c.targetEur * 100) / rateCents)
    // The disputed days: the client says 0 where we have 10 (no check-in), the last day partly.
    const lines: { date: string; worker: number | null; ours: number | null; client: number | null }[] = []
    let left = hours
    for (let d = c.from; d <= c.to && left > 0; d = addDays(d, 1)) {
      if (weekday(d) >= 5 || hash(d + c.t.w.lastName) % 3 !== 0) continue
      const gap = Math.min(10, left)
      lines.push({ date: d, worker: c.kind === "client_recheck" ? 10 : null, ours: 10, client: roundHours(10 - gap) })
      left = roundHours(left - gap)
    }
    const workdays = Array.from({ length: Math.round((Date.parse(c.to) - Date.parse(c.from)) / 86_400_000) + 1 }, (_, i) => addDays(c.from, i)).filter((d) => weekday(d) < 5).length
    const ours = roundHours(workdays * 9.5)
    const resolved = c.status !== "open" && c.status !== "waiting_client"
    const timeline = c.timeline.map((e) => ({ at: at(e.date, e.kind === "created" ? 9 : 14), by: "seed", byName: "Rūta (koordinatorė)", kind: e.kind, ...(e.status ? { status: e.status } : {}), ...(e.note ? { note: e.note } : {}) }))
    await db.insert("staffing_timesheets_disputes", {
      workerId: c.t.w._id,
      projectId: bst._id,
      periodFrom: c.from,
      periodTo: c.to,
      kind: c.kind,
      status: c.status,
      hours,
      rateCents,
      amountCents: disputeAmountCents(hours, rateCents),
      currency: bst.currency,
      title: c.title,
      sources: { worker: c.kind === "client_recheck" ? ours : null, ours, client: roundHours(ours - hours) },
      lines,
      timeline,
      createdAt: timeline[0]!.at,
      createdBy: "seed",
      updatedAt: timeline[timeline.length - 1]!.at,
      ...(resolved ? { resolvedAt: timeline[timeline.length - 1]!.at } : {}),
    })
    disputes++
  }

  return { links, workerEntries, disputes, rawRows: raw.length }
}
