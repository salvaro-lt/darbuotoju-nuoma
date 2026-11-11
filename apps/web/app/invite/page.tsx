import { redirect } from "next/navigation"
import { AuthShell } from "@/components/auth/auth-shell"
import { InviteSymbol, PrimaryLink } from "@/components/auth/ui"
import { getT } from "@/lib/i18n/server"

/**
 * Landing page for invite links (`/invite?token=…`, built in convex/system.ts).
 * The token is only checked when it is redeemed in `completeSignIn`, after the
 * invitee proves their email, so this page reveals nothing about the invite.
 */
export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams
  if (!token) redirect("/login")
  const { t } = await getT()
  return (
    <AuthShell>
      <InviteSymbol />
      <h1 className="text-3xl font-semibold tracking-tight">{t("invite.title")}</h1>
      <p className="-mt-2 text-muted-foreground">{t("invite.lead")}</p>
      <PrimaryLink href={`/sign-in?invite=${encodeURIComponent(token)}`}>{t("invite.button")}</PrimaryLink>
      <p className="text-sm text-muted-foreground">{t("invite.note")}</p>
    </AuthShell>
  )
}
