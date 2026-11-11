// Scheduled jobs. One line per job; staffing areas add theirs below.
import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

const crons = cronJobs()

// staffing-compliance: daily digest of documents expiring in 60 / 30 days or expired (n8n → planner).
crons.daily("staffing-compliance expiry digest", { hourUTC: 5, minuteUTC: 0 }, internal.compliance._dailyDigest)

export default crons
