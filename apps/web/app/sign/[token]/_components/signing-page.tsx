"use client"
import type { SigningSession } from "@digimuza/documents"
import { isImageField, type SigningField, type SigningValue } from "@digimuza/documents/signing"
import { systemErrorOf } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { ArrowRight, CircleCheck, Clock, Download, FileX2, Hourglass, LinkIcon, Loader2, Ban } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import { toast } from "sonner"
import { brand } from "@/brand"
import { BrandMark } from "@/components/brand-mark"
import { PdfPages } from "@/components/documents/pdf-pages"
import { boxStyle, FIELD_ICON, FieldValue, roleColor, roleInk } from "@/components/documents/signing-fields"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"
import { MESSAGES, type Locale, type MessageKey } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"
import { SignaturePad } from "./signature-pad"

type Full = Exclude<SigningSession, { state: "not_found" | "unavailable" }>
type Tr = (k: MessageKey) => string

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
const order = (a: SigningField, b: SigningField) => a.page - b.page || a.y - b.y || a.x - b.x
const filled = (v: SigningValue | undefined) => v !== undefined && v !== "" && v !== false

/** The external signer's page: one task, the document itself, nothing else. */
export function SigningPage({ token, handFont }: { token: string; handFont: string }) {
  const cookie = useT().locale
  const session = useQuery(api.documents.getSigningSession, { token })
  const locale: Locale = session && "locale" in session ? session.locale : cookie
  const t: Tr = (k) => MESSAGES[locale][k]

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  if (session === undefined)
    return (
      <Shell t={t}>
        <div className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-8">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="aspect-[1/1.414] w-full rounded-none" />
        </div>
      </Shell>
    )

  if (session.state === "not_found" || session.state === "unavailable")
    return <Notice t={t} icon={<LinkIcon />} title={t(`sign.public.${session.state}.title`)} body={t(`sign.public.${session.state}.body`)} />

  const full = session as Full
  const doc = full.submissionName
  if (full.state === "waiting") return <Notice t={t} icon={<Hourglass />} title={t("sign.public.waiting.title")} body={t("sign.public.waiting.body")} doc={doc} />
  if (full.state === "cancelled") return <Notice t={t} icon={<Ban />} title={t("sign.public.cancelled.title")} body={t("sign.public.cancelled.body").replace("{name}", full.senderName)} doc={doc} />
  if (full.state === "expired") return <Notice t={t} icon={<Clock />} title={t("sign.public.expired.title")} body={t("sign.public.expired.body").replace("{name}", full.senderName)} doc={doc} />
  if (full.state === "declined") return <Notice t={t} icon={<FileX2 />} title={t("sign.public.declined.title")} body={t("sign.public.declined.body")} doc={doc} />
  if (full.state === "completed") return <Completed t={t} session={full} />
  return <Signing key={token} t={t} token={token} session={full} handFont={handFont} />
}

function Shell({ t, children, bar }: { t: Tr; children: ReactNode; bar?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex min-h-14 w-full max-w-5xl flex-wrap items-center gap-3 px-4 py-2">
          <BrandMark size="sm" />
          <span className="truncate text-sm font-semibold tracking-tight">{brand.name}</span>
          {bar}
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
      <footer className="px-4 py-6 text-center text-xs text-muted-foreground">{t("sign.public.footer")}</footer>
    </div>
  )
}

function Notice({ t, icon, title, body, doc, children }: { t: Tr; icon: ReactNode; title: string; body: string; doc?: string; children?: ReactNode }) {
  return (
    <Shell t={t}>
      <div className="mx-auto my-auto flex w-full max-w-md flex-col items-start gap-4 px-6 py-16">
        <span className="flex size-11 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border [&>svg]:size-5">{icon}</span>
        <div className="grid gap-2">
          {doc && <p className="text-sm text-muted-foreground">{doc}</p>}
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
          <p className="text-muted-foreground">{body}</p>
        </div>
        {children}
      </div>
    </Shell>
  )
}

function Completed({ t, session }: { t: Tr; session: Full }) {
  return (
    <Notice
      t={t}
      icon={<CircleCheck className="text-primary" />}
      title={t("sign.public.done.title")}
      body={session.signedUrl ? t("sign.public.done.ready") : session.allDone ? t("sign.public.done.preparing") : t("sign.public.done.others")}
      doc={session.submissionName}
    >
      {session.signedUrl ? (
        <Button asChild>
          <a href={session.signedUrl} target="_blank" rel="noreferrer">
            <Download /> {t("sign.public.download")}
          </a>
        </Button>
      ) : (
        session.allDone && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> {t("sign.public.done.building")}
          </p>
        )
      )}
    </Notice>
  )
}

function Signing({ t, token, session, handFont }: { t: Tr; token: string; session: Full; handFont: string }) {
  const markOpened = useMutation(api.documents.markSigningOpened)
  const submit = useMutation(api.documents.submitSignature)
  const decline = useMutation(api.documents.declineSignature)
  const opened = useRef(false)
  const mine = useMemo(() => session.fields.filter((f) => f.role === session.role).sort(order), [session.fields, session.role])
  const [values, setValues] = useState<Record<string, SigningValue>>(() => {
    const v: Record<string, SigningValue> = {}
    for (const f of mine) {
      const given = session.values[f.id]
      if (given !== undefined) v[f.id] = given
      else if (f.type === "name" && session.signerName) v[f.id] = session.signerName
      else if (f.type === "email") v[f.id] = session.signerEmail
      else if (f.type === "date") v[f.id] = today()
    }
    return v
  })
  const [editing, setEditing] = useState<SigningField | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [busy, setBusy] = useState(false)
  const [invalid, setInvalid] = useState<string[]>([])

  useEffect(() => {
    if (opened.current) return
    opened.current = true
    void markOpened({ token, userAgent: navigator.userAgent }).catch(() => undefined)
  }, [markOpened, token])

  const required = mine.filter((f) => f.required)
  const done = required.filter((f) => filled(values[f.id])).length
  const next = mine.find((f) => f.required && !filled(values[f.id])) ?? null
  const lastImage = (kind: SigningField["type"]) => {
    const f = mine.find((x) => x.type === kind && typeof values[x.id] === "string" && values[x.id])
    return f ? (values[f.id] as string) : null
  }

  function open(f: SigningField) {
    if (f.type === "checkbox") return setValues((v) => ({ ...v, [f.id]: !v[f.id] }))
    setEditing(f)
  }

  function goNext() {
    if (!next) return setConfirming(true)
    document.querySelector(`[data-field="${next.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })
    window.setTimeout(() => open(next), 250)
  }

  function set(f: SigningField, value: SigningValue) {
    setValues((v) => ({ ...v, [f.id]: value }))
    setInvalid((xs) => xs.filter((x) => x !== f.id))
    setEditing(null)
  }

  const reason = (e: unknown) => {
    const se = systemErrorOf(e)
    if (se?.code === "VALIDATION") setInvalid(se.fields ?? [])
    toast.error(se ? t(`error.${se.code}` as MessageKey) : t("error.unknown"), { description: se?.operationId ? `${t("state.operation")} ${se.operationId}` : undefined })
  }

  async function finish() {
    setBusy(true)
    try {
      const payload = Object.fromEntries(Object.entries(values).filter(([k, v]) => mine.some((f) => f.id === k) && filled(v)))
      await submit({ token, values: payload, userAgent: navigator.userAgent })
      setConfirming(false)
    } catch (e) {
      reason(e)
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  async function doDecline(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const text = String(new FormData(e.currentTarget).get("reason") ?? "").trim()
    if (!text) return
    setBusy(true)
    try {
      await decline({ token, reason: text })
      setDeclining(false)
    } catch (err) {
      reason(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell
      t={t}
      bar={
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-sm text-muted-foreground tabular-nums sm:inline" aria-live="polite">
            {t("sign.public.progress").replace("{done}", String(done)).replace("{total}", String(required.length))}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setDeclining(true)}>
            {t("sign.public.decline")}
          </Button>
          <Button size="sm" onClick={goNext}>
            {next ? (done === 0 ? t("sign.public.start") : t("sign.public.next")) : t("sign.public.finish")} <ArrowRight />
          </Button>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-3xl px-4 pt-8 pb-4">
        <p className="text-sm text-muted-foreground">{t("sign.public.invitedBy").replace("{name}", session.senderName)}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance">{session.submissionName}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("sign.public.signingAs")} <span className="font-medium text-foreground">{session.signerName || session.signerEmail}</span>
          {session.roleName && ` · ${session.roleName}`}
        </p>
        {session.message && <p className="mt-4 max-w-[65ch] rounded-lg bg-background px-4 py-3 text-sm whitespace-pre-line ring-1 ring-border">{session.message}</p>}
        <p className="mt-4 text-sm text-muted-foreground sm:hidden tabular-nums">{t("sign.public.progress").replace("{done}", String(done)).replace("{total}", String(required.length))}</p>
      </div>

      <div className="mx-auto w-full max-w-3xl px-2 pb-10 sm:px-4">
        <PdfPages
          url={session.fileUrl}
          pages={session.pages}
          maxWidth={760}
          overlay={(page) =>
            session.fields
              .filter((f) => f.page === page.index)
              .map((f) => {
                const px = f.h * page.height
                if (f.role !== session.role) {
                  const v = session.values[f.id]
                  return filled(v) ? (
                    <div key={f.id} className="absolute" style={boxStyle(f)}>
                      <FieldValue field={f} value={v!} pxHeight={px} />
                    </div>
                  ) : null
                }
                const v = values[f.id]
                const has = filled(v)
                const Icon = FIELD_ICON[f.type]
                const isNext = next?.id === f.id
                const bad = invalid.includes(f.id)
                return (
                  <button
                    key={f.id}
                    type="button"
                    data-field={f.id}
                    onClick={() => open(f)}
                    aria-label={`${f.label || t(`sign.field.${f.type}` as MessageKey)}${f.required ? ` (${t("sign.public.required")})` : ""}`}
                    className={cn(
                      "absolute flex items-center justify-center overflow-hidden rounded-[3px] transition-[background-color,box-shadow] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      !has && "border-[1.5px] border-dashed",
                      bad && "border-destructive",
                    )}
                    style={{
                      ...boxStyle(f),
                      borderColor: bad ? undefined : roleColor(f.role),
                      background: has ? roleColor(f.role, 0.06) : roleColor(f.role, isNext ? 0.2 : 0.1),
                      color: roleInk(f.role),
                      boxShadow: isNext ? `0 0 0 3px ${roleColor(f.role, 0.3)}` : undefined,
                    }}
                  >
                    {has ? (
                      <FieldValue field={f} value={v!} pxHeight={px} />
                    ) : (
                      px >= 18 && (
                        <span className="flex min-w-0 items-center gap-1 px-1 text-[11px] font-medium">
                          <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">{f.label || t(`sign.field.${f.type}` as MessageKey)}</span>
                          {f.required && <span aria-hidden="true">*</span>}
                        </span>
                      )
                    )}
                  </button>
                )
              })
          }
        />
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle>{editing.label || t(`sign.field.${editing.type}` as MessageKey)}</DialogTitle>
                {isImageField(editing.type) && <DialogDescription>{t("sign.public.padLead")}</DialogDescription>}
              </DialogHeader>
              {isImageField(editing.type) ? (
                <SignaturePad
                  text={{
                    draw: t("sign.public.pad.draw"),
                    type: t("sign.public.pad.type"),
                    clear: t("sign.public.pad.clear"),
                    drawHint: t("sign.public.pad.hint"),
                    typeLabel: t("sign.public.pad.typeLabel"),
                    usePrevious: t("sign.public.pad.previous"),
                    apply: t("sign.public.pad.apply"),
                    cancel: t("sign.cancel"),
                    empty: t("sign.public.pad.empty"),
                  }}
                  initials={editing.type === "initials"}
                  defaultText={editing.type === "initials" ? initialsOf(session.signerName) : session.signerName}
                  handFont={handFont}
                  previous={lastImage(editing.type)}
                  onDone={(png) => set(editing, png)}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <TextForm t={t} field={editing} value={typeof values[editing.id] === "string" ? (values[editing.id] as string) : ""} onSave={(v) => set(editing, v)} onCancel={() => setEditing(null)} />
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("sign.public.confirm.title")}</DialogTitle>
            <DialogDescription>{t("sign.public.confirm.body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {t("sign.public.confirm.review")}
            </Button>
            <Button disabled={busy} onClick={() => void finish()}>
              {busy && <Loader2 className="animate-spin" />} {t("sign.public.confirm.sign")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={declining} onOpenChange={setDeclining}>
        <DialogContent>
          <form onSubmit={doDecline} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("sign.public.declineTitle")}</DialogTitle>
              <DialogDescription>{t("sign.public.declineBody").replace("{name}", session.senderName)}</DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="decline-reason">{t("sign.public.declineReason")}</FieldLabel>
              <Textarea id="decline-reason" name="reason" required maxLength={1000} rows={3} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDeclining(false)}>
                {t("sign.cancel")}
              </Button>
              <Button type="submit" variant="destructive" disabled={busy}>
                {t("sign.public.declineSubmit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Shell>
  )
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase())
    .join("")

function TextForm({ t, field, value, onSave, onCancel }: { t: Tr; field: SigningField; value: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(value)
  const type = field.type === "email" ? "email" : field.type === "date" ? "date" : "text"
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(v.trim())
      }}
    >
      <Field>
        <FieldLabel htmlFor="field-value" className="sr-only">
          {field.label || t(`sign.field.${field.type}` as MessageKey)}
        </FieldLabel>
        <Input id="field-value" type={type} value={v} onChange={(e) => setV(e.target.value)} required={field.required} maxLength={field.type === "email" ? 254 : 1000} autoFocus autoComplete={field.type === "name" ? "name" : field.type === "email" ? "email" : "off"} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("sign.cancel")}
        </Button>
        <Button type="submit">{t("sign.public.pad.apply")}</Button>
      </DialogFooter>
    </form>
  )
}

