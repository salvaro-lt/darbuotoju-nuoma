import type { Metadata } from "next"
import { Caveat } from "next/font/google"
import { brand } from "@/brand"
import { SigningPage } from "./_components/signing-page"

// Typed signatures are drawn in this hand-written face (canvas → PNG), so it ships with the page.
const hand = Caveat({ subsets: ["latin", "latin-ext"], weight: ["500"], variable: "--font-hand" })

export const metadata: Metadata = { title: brand.name, robots: { index: false, follow: false }, referrer: "no-referrer" }

/**
 * Public signing page (`/sign/<token>`, built in convex/documents.ts). No
 * session: the token in the link proves the signer, and Convex checks it on
 * every call. The page reveals nothing for an unknown token.
 */
export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return (
    <div className={hand.variable}>
      <SigningPage token={decodeURIComponent(token)} handFont={hand.style.fontFamily} />
    </div>
  )
}
