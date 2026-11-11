// Scheduled jobs. One line per job; each job decides itself whether to act.
import { cronJobs, makeFunctionReference } from "convex/server"
import { internal } from "./_generated/api"

const crons = cronJobs()

// Logistics: daily warnings to coordinators of projects with the digest switched on (06:00 UTC).
crons.daily("logistics daily warnings", { hourUTC: 6, minuteUTC: 0 }, internal.logistics._dailyDigest)
// Timesheets: remind clients whose timesheet is late (07:00 UTC, n8n dr-nuoma-tabelio-priminimas).
crons.daily("timesheets late client reminders", { hourUTC: 7, minuteUTC: 0 }, internal.timesheets._dailyReminders)
// staffing-compliance: daily digest of documents expiring in 60 / 30 days or expired (n8n → planner).
crons.daily("staffing-compliance expiry digest", { hourUTC: 5, minuteUTC: 0 }, internal.compliance._dailyDigest)
// staffing-compliance: document packages queued by the assistant (its tools cannot schedule) → n8n dr-nuoma-dokumentu-paketas.
crons.interval("staffing-compliance document packages", { seconds: 15 }, internal.compliance._drainPackages)
// Staffing invoicing: payment reminders via n8n (stage 1 at +3 days overdue, stage 2 at +14).
crons.daily("staffing-invoicing payment reminders", { hourUTC: 6, minuteUTC: 0 }, internal.invoicing._dailyReminders, {})
// Staffing invoicing: billing periods ended > 7 days ago without an issued invoice → the director (n8n dr-nuoma-pranesimas).
crons.daily("staffing-invoicing missing invoices", { hourUTC: 6, minuteUTC: 30 }, internal.invoicing._dailyChainCheck, {})
// n8n module (convex/n8n.ts, by name): approved assistant writes (n8nOps outbox) → n8n;
// refresh of the dr-nuoma-tagged workflow cache (inbox link pickers, delivery routing).
crons.interval("n8n ops", { seconds: 10 }, makeFunctionReference<"action">("n8n:_drain"), {})
crons.interval("n8n workflow sync", { minutes: 5 }, makeFunctionReference<"action">("n8n:_syncWorkflows"), {})
// Mail: queued email replies (mail.reply_to_email outbox) → Resend (convex/replies.ts).
crons.interval("mail replies", { seconds: 10 }, makeFunctionReference<"action">("replies:_drain"), {})

export default crons
