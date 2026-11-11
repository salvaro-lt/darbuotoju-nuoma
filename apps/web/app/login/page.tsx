import type { Metadata } from "next"
import { brand } from "@/brand"
import { Notice, PrimaryLink, SignOutButton } from "@/components/auth/ui"
import { AuthShell } from "@/components/auth/auth-shell"
import { getT } from "@/lib/i18n/server"

export const metadata: Metadata = { title: `${brand.name}` }

type State = "no-access" | "jwt-template" | "error"

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ invite?: string; state?: string; op?: string }> }) {
  const { invite, state: rawState, op } = await searchParams
  const { t } = await getT()
  const state = (["no-access", "jwt-template", "error"] as const).find((s) => s === rawState) as State | undefined
  const signInHref = invite ? `/sign-in?invite=${encodeURIComponent(invite)}` : "/sign-in"
  const operation = op && /^[A-Za-z0-9_-]{8,64}$/.test(op) ? op : null

  return (
    <AuthShell>
      <h1 className="font-stencil-title text-[2.6rem]">{invite ? t("invite.title") : t("signIn.title")}</h1>
      <p className="-mt-2 text-muted-foreground">{invite ? t("invite.lead") : t("signIn.lead")}</p>

      {state === "no-access" && (
        <Notice tone="info" title={t("state.noAccess.title")}>
          <p>{t("state.noAccess.body")}</p>
          {operation && <OperationId label={t("state.operation")} id={operation} />}
        </Notice>
      )}
      {state === "jwt-template" && (
        <Notice tone="warning" title={t("state.jwt.title")}>
          <p>{t("state.jwt.body")}</p>
        </Notice>
      )}
      {state === "error" && (
        <Notice tone="danger" title={t("state.error.title")}>
          <p>{t("state.error.body")}</p>
          {operation && <OperationId label={t("state.operation")} id={operation} />}
        </Notice>
      )}

      {state === "no-access" ? (
        // Signing in again would be refused the same way: the next step is another email.
        <SignOutButton primary>{t("state.signOut")}</SignOutButton>
      ) : (
        <>
          <PrimaryLink href={signInHref}>{invite ? t("invite.button") : state ? t("state.retry") : t("signIn.button")}</PrimaryLink>
          {state === "jwt-template" ? (
            <SignOutButton>{t("state.signOut")}</SignOutButton>
          ) : (
            <p className="text-sm text-muted-foreground">{invite ? t("invite.wrongEmail") : t("signIn.help")}</p>
          )}
        </>
      )}
    </AuthShell>
  )
}

function OperationId({ label, id }: { label: string; id: string }) {
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {label} <code className="select-all font-mono">{id}</code>
    </p>
  )
}
