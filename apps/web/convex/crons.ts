// Scheduled jobs. One line per job; each job decides itself whether to act.
import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

const crons = cronJobs()

// Logistics: daily warnings to coordinators of projects with the digest switched on (06:00 UTC).
crons.daily("logistics daily warnings", { hourUTC: 6, minuteUTC: 0 }, internal.logistics._dailyDigest)

export default crons
