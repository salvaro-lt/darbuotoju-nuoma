import "server-only"
import { createIngestRoutes } from "@digimuza/system-core/ingest/next"
import { getPublicEnv } from "@/env"

/** Gavimas: /api/ingest/resend (Resend `email.received`, signed). Convex decides everything (convex/ingest.ts). */
export const ingestRoutes = createIngestRoutes({ convexUrl: () => getPublicEnv().CONVEX_URL })
