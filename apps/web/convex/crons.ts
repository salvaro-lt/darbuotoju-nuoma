// Scheduled jobs. One line per job.
import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

const crons = cronJobs()

// Staffing invoicing: payment reminders via n8n (stage 1 at +3 days overdue, stage 2 at +14).
crons.daily("staffing-invoicing payment reminders", { hourUTC: 6, minuteUTC: 0 }, internal.invoicing._dailyReminders, {})

export default crons
