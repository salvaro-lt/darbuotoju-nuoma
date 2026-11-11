"use client"
import { useMutation, useQuery } from "convex/react"
import { Ban, Clock, Download, FileText, LinkIcon, TriangleAlert } from "lucide-react"
import { useEffect, useRef, type ReactNode } from "react"
import { brand } from "@/brand"
import { BrandMark } from "@/components/brand-mark"
import { PageHeader } from "@/components/app/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import { MESSAGES, type MessageKey } from "@/lib/i18n/messages"

const fmt = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** The client's view of a sent package: the team, each document's validity, the files and one ZIP. */
export function SharedPackagePage({ token }: { token: string }) {
  const pkg = useQuery(api.compliance.getSharedPackage, { token })
  const open = useMutation(api.compliance.openSharedPackage)
  const logged = useRef(false)
  const locale = pkg?.state === "ok" && pkg.language === "lt" ? "lt" : "en"
  const t = (k: MessageKey) => MESSAGES[locale][k]

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  useEffect(() => {
    if (pkg?.state !== "ok" || logged.current) return
    logged.current = true
    void open({ token, kind: "view", userAgent: navigator.userAgent }).catch(() => undefined)
  }, [pkg?.state, open, token])

  if (pkg === undefined)
    return (
      <Shell>
        <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-8">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      </Shell>
    )

  if (pkg.state !== "ok") {
    const icon = pkg.state === "expired" ? <Clock /> : pkg.state === "revoked" ? <Ban /> : <LinkIcon />
    return (
      <Shell>
        <div className="mx-auto my-auto flex w-full max-w-md flex-col items-start gap-4 px-6 py-16">
          <span className="flex size-11 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border [&>svg]:size-5">{icon}</span>
          <h1 className="text-2xl font-semibold tracking-tight">{t(`compliance.share.${pkg.state}.title` as MessageKey)}</h1>
          <p className="text-muted-foreground">{t(`compliance.share.${pkg.state}.body` as MessageKey)}</p>
        </div>
      </Shell>
    )
  }

  const p = pkg.project
  return (
    <Shell>
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <PageHeader
          title={t("compliance.share.title")}
          lead={`${p.code} · ${p.name} · ${p.clientName} · ${p.city}, ${p.country}`}
          actions={
            <Button asChild>
              <a href={`/d/${encodeURIComponent(token)}/zip`}>
                <Download />
                {t("compliance.share.zip")}
              </a>
            </Button>
          }
        />
        <p className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{fmt(t("compliance.share.from"), { company: pkg.companyName || brand.name })}</span>
          <span>{fmt(t("compliance.share.validUntil"), { date: day(pkg.expiresAt) })}</span>
        </p>
        {pkg.missing.length > 0 && (
          <div className="mb-4 rounded-lg border border-marking bg-marking/15 px-4 py-3 text-sm">
            <div className="mb-1 flex items-center gap-2 font-medium">
              <TriangleAlert className="size-4" aria-hidden />
              {t("compliance.share.missing")}
            </div>
            <ul className="list-disc pl-5">
              {pkg.missing.map((g, i) => (
                <li key={i}>
                  {g.workerName}: {locale === "lt" ? g.document : (g.documentEn ?? g.document)} ({t(`compliance.send.reason.${g.reason}` as MessageKey)})
                </li>
              ))}
            </ul>
          </div>
        )}
        <Card>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-48">{t("compliance.readiness.worker")}</TableHead>
                  <TableHead>{t("compliance.requirements.document")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pkg.members.map((m) => (
                  <TableRow key={m.workerName}>
                    <TableCell className="align-top">
                      <div className="font-medium">{m.workerName}</div>
                      <div className="text-xs text-muted-foreground">{m.tradeName}</div>
                    </TableCell>
                    <TableCell>
                      <ul className="grid gap-1.5 text-sm">
                        {m.documents.map((d, i) => (
                          <li key={i} className="flex flex-wrap items-center gap-2">
                            <span className="min-w-40 font-medium">{locale === "lt" ? d.name : (d.nameEn ?? d.name)}</span>
                            {d.status === "missing" || d.status === "expired" ? (
                              <Badge variant="outline" className="border-destructive text-destructive">
                                {t(d.status === "missing" ? "compliance.package.missing" : "compliance.package.expired")}
                              </Badge>
                            ) : (
                              <span className="tabular-nums text-muted-foreground">
                                {t("compliance.package.validUntil")}: {d.expiresAt ?? t("compliance.package.noExpiry")}
                              </span>
                            )}
                            {d.url && (
                              <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                <FileText className="size-3.5" aria-hidden />
                                {d.fileName ?? t("compliance.share.open")}
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex min-h-14 w-full max-w-5xl items-center gap-3 px-4 py-2">
          <BrandMark size="sm" />
          <span className="truncate text-sm font-semibold tracking-tight">{brand.name}</span>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  )
}
