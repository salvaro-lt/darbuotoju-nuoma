// Resend inbound (`email.received`) for every inbox. Set up by Gavimas → Integracijos.
import { ingestRoutes } from "@/lib/ingest-routes"

export const dynamic = "force-dynamic"
export const { POST, GET } = ingestRoutes.resend
