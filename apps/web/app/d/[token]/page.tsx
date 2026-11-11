import type { Metadata } from "next"
import { brand } from "@/brand"
import { SharedPackagePage } from "./_components/shared-package"

export const metadata: Metadata = { title: brand.name, robots: { index: false, follow: false }, referrer: "no-referrer" }

/**
 * Public download page of a client document package (`/d/<token>`, DIG-113).
 * No session: the token proves the client and expires; Convex checks it on
 * every call and logs each opening. Unknown tokens reveal nothing.
 */
export default async function SharedPackageRoute({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <SharedPackagePage token={decodeURIComponent(token)} />
}
