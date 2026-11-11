"use client"
import type { CrmObjectView } from "@digimuza/crm"
import { useMutation } from "convex/react"
import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"
import { useAction } from "@/components/app/use-action"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"
import { FieldInput } from "./field-input"
import { recordHref } from "./use-crm"

/**
 * Quick create. Prefill with `initial` (a kanban column's stage, the company a
 * person is added from). Server-side validation errors mark their fields.
 */
export function RecordFormDialog({
  object,
  open,
  onOpenChange,
  initial,
  initialLabels,
  openAfterCreate,
}: {
  object: CrmObjectView
  open: boolean
  onOpenChange: (v: boolean) => void
  initial?: Record<string, unknown>
  initialLabels?: Record<string, string>
  openAfterCreate?: boolean
}) {
  const { t } = useT()
  const router = useRouter()
  const create = useMutation(api.crm.createRecord)
  const { run, busy } = useAction()
  const [values, setValues] = useState<Record<string, unknown>>(initial ?? {})
  const [invalid, setInvalid] = useState<string[]>([])

  function reset(next: boolean) {
    if (next) {
      setValues(initial ?? {})
      setInvalid([])
    }
    onOpenChange(next)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const payload = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined))
    const res = await run(() => create({ objectKey: object.key, values: payload }), { success: t("crm.record.created"), onError: (err) => setInvalid(err.fields) })
    if (!res) return
    onOpenChange(false)
    if (openAfterCreate) router.push(recordHref(object.key, res.recordId))
  }

  // Title first, then the rest in the admin's order.
  const fields = [...object.fields].sort((a, b) => Number(b.key === object.labelFieldKey) - Number(a.key === object.labelFieldKey))

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="flex max-h-[min(44rem,calc(100dvh-2rem))] flex-col gap-0 p-0 sm:max-w-lg">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle>
              {t("crm.newRecord")}: {object.nameSingular}
            </DialogTitle>
            {object.description && <DialogDescription>{object.description}</DialogDescription>}
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2">
            <FieldGroup className="gap-5">
              {fields.map((f, i) => {
                const id = `new-${object.key}-${f.key}`
                const bad = invalid.includes(f.key)
                return (
                  <Field key={f.id} data-invalid={bad || undefined} orientation={f.type === "boolean" ? "horizontal" : "vertical"}>
                    <FieldLabel htmlFor={id}>
                      {f.label}
                      {f.required && <span className="text-xs font-normal text-muted-foreground">({t("crm.required")})</span>}
                    </FieldLabel>
                    <FieldInput
                      id={id}
                      field={f}
                      value={values[f.key]}
                      relationLabel={initialLabels?.[f.key]}
                      autoFocus={i === 0}
                      invalid={bad}
                      onChange={(v) => {
                        setValues((s) => ({ ...s, [f.key]: v ?? undefined }))
                        if (bad) setInvalid((x) => x.filter((k) => k !== f.key))
                      }}
                    />
                    {f.description && <FieldDescription>{f.description}</FieldDescription>}
                  </Field>
                )
              })}
            </FieldGroup>
          </div>
          <DialogFooter className="border-t px-6 py-4">
            <Button type="button" variant="ghost" onClick={() => reset(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
