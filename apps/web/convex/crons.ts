// Scheduled jobs. One line per job; each job decides itself whether to act.
import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

const crons = cronJobs()

// Logistics: daily warnings to coordinators of projects with the digest switched on (06:00 UTC).
crons.daily("logistics daily warnings", { hourUTC: 6, minuteUTC: 0 }, internal.logistics._dailyDigest)
// staffing-compliance: daily digest of documents expiring in 60 / 30 days or expired (n8n → planner).
crons.daily("staffing-compliance expiry digest", { hourUTC: 5, minuteUTC: 0 }, internal.compliance._dailyDigest)

export default crons
