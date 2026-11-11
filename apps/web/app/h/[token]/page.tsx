import type { Metadata } from "next"
import { brand } from "@/brand"
import { WorkerHoursPage } from "./_components/worker-hours"

export const metadata: Metadata = { title: brand.name, robots: { index: false, follow: false }, referrer: "no-referrer" }

/**
 * A worker's personal hours page (`/h/<token>`, DIG-111), like the signing
 * page: no session, the token in the link proves the worker and Convex checks
 * it on every call. An unknown token reveals nothing.
 */
export default async function WorkerHours({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <WorkerHoursPage token={decodeURIComponent(token)} />
}
