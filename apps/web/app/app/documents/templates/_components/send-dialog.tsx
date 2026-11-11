"use client"
import { useMutation } from "convex/react"
import { ArrowRight, Send } from "lucide-react"
import Link from "next/link"
import { useState, type FormEvent } from "react"
import { CopyButton } from "@/components/audit/copy-button"
import { roleColor } from "@/components/documents/signing-fields"
import { useAction } from "@/components/app/use-action"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import { submissionHref } from "../../_components/use-documents"

interface Signer {
  name: string
  email: string
}
type Sent = { submissionId: string; links: { role: number; email: string; url: string }[]; emailed: boolean }

/** Sends a template to one signer per role. Afterwards shows each active signer's link once. */
export function SendDialog({
  open,
  onOpenChange,
  templateId,
  templateName,
  roles,
  rolesWithFields,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  templateId: string
  templateName: string
  roles: string[]
  rolesWithFields: number[]
}) {
  const { t, locale } = useT()
  const send = useMutation(api.documents.sendSubmission)
  const { run, busy } = useAction()
  const [signers, setSigners] = useState<Signer[]>(() => roles.map(() => ({ name: "", email: "" })))
  const [name, setName] = useState(templateName)
  const [ordered, setOrdered] = useState(false)
  const [message, setMessage] = useState("")
  const [days, setDays] = useState("30")
  const [lang, setLang] = useState<"lt" | "en">(locale)
  const [sendEmail, setSendEmail] = useState(true)
  const [invalid, setInvalid] = useState<string[]>([])
  const [sent, setSent] = useState<Sent | null>(null)

  const needed = new Set(rolesWithFields)
  const set = (i: number, patch: Partial<Signer>) => setSigners((s) => roles.map((_, j) => ({ ...(s[j] ?? { name: "", email: "" }), ...(j === i ? patch : {}) })))

  function close(next: boolean) {
    onOpenChange(next)
    if (!next) {
      // Reset after the closing animation.
      setTimeout(() => {
        setSent(null)
        setInvalid([])
      }, 200)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const submitters = roles
      .map((_, role) => ({ role, name: signers[role]?.name.trim() ?? "", email: signers[role]?.email.trim() ?? "" }))
      .filter((s) => s.email || needed.has(s.role))
    const res = await run(
      () =>
        send({
          templateId: templateId as Id<"docTemplates">,
          name: name.trim() || undefined,
          submitters,
          ordered,
          message: message.trim() || undefined,
          expiresInDays: Number.parseInt(days, 10) || 0,
          locale: lang,
          sendEmail,
        }),
      { onError: (err) => setInvalid(err.fields) },
    )
    if (res) setSent({ submissionId: res.submissionId, links: res.links, emailed: sendEmail })
  }

  const bad = (i: number, what: "email" | "name") => invalid.some((f) => f === `submitters.${i}.${what}` || (what === "email" && f === `roles.${i}`))

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        {sent ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("sign.send.doneTitle")}</DialogTitle>
              <DialogDescription>{sent.emailed ? t("sign.send.doneEmailed") : t("sign.send.doneManual")}</DialogDescription>
            </DialogHeader>
            <ul className="grid gap-2">
              {sent.links.map((l) => (
                <li key={l.url} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: roleColor(l.role) }} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{roles[l.role]}</p>
                    <p className="truncate text-xs text-muted-foreground">{l.email}</p>
                  </div>
                  <CopyButton value={l.url} label={t("sign.send.link")} />
                </li>
              ))}
            </ul>
            {ordered && sent.links.length < roles.length && <p className="text-xs text-muted-foreground">{t("sign.send.orderedNote")}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)}>
                {t("sign.close")}
              </Button>
              <Button asChild>
                <Link href={submissionHref(sent.submissionId)}>
                  {t("sign.send.open")} <ArrowRight />
                </Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("sign.send.title")}</DialogTitle>
              <DialogDescription>{t("sign.send.lead")}</DialogDescription>
            </DialogHeader>
            <FieldGroup className="max-h-[60vh] gap-4 overflow-y-auto pr-1">
              <Field>
                <FieldLabel htmlFor="send-name">{t("sign.send.name")}</FieldLabel>
                <Input id="send-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
              </Field>
              {roles.map((role, i) => (
                <fieldset key={i} className="grid gap-2 rounded-lg border p-3">
                  <legend className="flex items-center gap-2 px-1 text-sm font-medium">
                    <span className="size-2.5 rounded-full" style={{ background: roleColor(i) }} aria-hidden="true" />
                    {role}
                    {!needed.has(i) && <span className="font-normal text-muted-foreground">· {t("sign.send.optional")}</span>}
                  </legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      aria-label={`${role}: ${t("sign.send.signerName")}`}
                      placeholder={t("sign.send.signerName")}
                      value={signers[i]?.name ?? ""}
                      onChange={(e) => set(i, { name: e.target.value })}
                      aria-invalid={bad(i, "name") || undefined}
                      maxLength={120}
                    />
                    <Input
                      type="email"
                      aria-label={`${role}: ${t("sign.send.signerEmail")}`}
                      placeholder={t("sign.send.signerEmail")}
                      value={signers[i]?.email ?? ""}
                      onChange={(e) => set(i, { email: e.target.value })}
                      aria-invalid={bad(i, "email") || undefined}
                      required={needed.has(i)}
                    />
                  </div>
                </fieldset>
              ))}
              <Field>
                <FieldLabel htmlFor="send-message">{t("sign.send.message")}</FieldLabel>
                <Textarea id="send-message" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={3} placeholder={t("sign.send.messagePlaceholder")} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="send-days">{t("sign.send.expiry")}</FieldLabel>
                  <Input id="send-days" type="number" min={0} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
                  <FieldDescription>{t("sign.send.expiryHint")}</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="send-lang">{t("sign.send.language")}</FieldLabel>
                  <Select value={lang} onValueChange={(v) => setLang(v as "lt" | "en")}>
                    <SelectTrigger id="send-lang" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lt">Lietuvių</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              {roles.length > 1 && (
                <Field orientation="horizontal">
                  <Switch id="send-ordered" checked={ordered} onCheckedChange={setOrdered} />
                  <div>
                    <FieldLabel htmlFor="send-ordered">{t("sign.send.ordered")}</FieldLabel>
                    <FieldDescription>{t("sign.send.orderedHint")}</FieldDescription>
                  </div>
                </Field>
              )}
              <Field orientation="horizontal">
                <Switch id="send-email" checked={sendEmail} onCheckedChange={setSendEmail} />
                <div>
                  <FieldLabel htmlFor="send-email">{t("sign.send.email")}</FieldLabel>
                  <FieldDescription>{t("sign.send.emailHint")}</FieldDescription>
                </div>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                {t("sign.cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                <Send /> {t("sign.send.submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
