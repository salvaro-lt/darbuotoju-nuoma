// Scheduled jobs. Functions are referenced by name so this file does not depend
// on a regenerated `_generated/api` (and on modules owned elsewhere).
import { cronJobs, makeFunctionReference } from "convex/server"

const crons = cronJobs()

/** n8n: approved assistant writes (n8nOps outbox) → n8n. */
crons.interval("n8n ops", { seconds: 10 }, makeFunctionReference<"action">("n8n:_drain"), {})
/** n8n: refresh the cache of workflows tagged adedesign (inbox link pickers, delivery routing). */
crons.interval("n8n workflow sync", { minutes: 5 }, makeFunctionReference<"action">("n8n:_syncWorkflows"), {})
/** Mail: queued email replies (mail.reply_to_email outbox) → Resend. */
crons.interval("mail replies", { seconds: 10 }, makeFunctionReference<"action">("replies:_drain"), {})

export default crons
