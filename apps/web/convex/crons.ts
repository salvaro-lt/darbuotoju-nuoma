// Scheduled jobs. Staffing areas: one line each.
import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

const crons = cronJobs()

// Timesheets: remind clients whose timesheet is late (07:00 UTC, n8n dr-nuoma-tabelio-priminimas).
crons.daily("timesheets late client reminders", { hourUTC: 7, minuteUTC: 0 }, internal.timesheets._dailyReminders)

export default crons
