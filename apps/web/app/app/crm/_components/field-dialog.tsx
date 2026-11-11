"use client"
import type { CrmFieldView, CrmObjectView } from "@digimuza/crm"
import { FIELD_TYPES, keyFromLabel, OPTION_COLORS, type FieldSettings, type FieldType, type OptionColor } from "@digimuza/crm/fields"
import { useMutation } from "convex/react"
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react"
import { useState, type FormEvent } from "react"
import { useAction } from "@/components/app/use-action"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"
import { OPTION_DOT } from "./field-display"

interface OptionDraft {
  value: string | null
  label: string
  color: OptionColor
}

const nextColor = (used: OptionDraft[]) => OPTION_COLORS.find((c) => !used.some((o) => o.color === c)) ?? "gray"

/** New options get a readable stored value from their label; existing values never change. */
function finalizeOptions(opts: OptionDraft[]) {
  const taken = new Set(opts.map((o) => o.value).filter((v): v is string => !!v))
  return opts
    .filter((o) => o.label.trim())
    .map((o) => {
      if (o.value) return { value: o.value, label: o.label.trim(), color: o.color }
      const base = keyFromLabel(o.label) || "option"
      let v = base
      for (let i = 2; taken.has(v); i++) v = `${base}${i}`
      taken.add(v)
      return { value: v, label: o.label.trim(), color: o.color }
    })
}

/** Create a field (`field` undefined) or edit one. Key and type are fixed once created. */
export function FieldDialog({ object, objects, field, onClose }: { object: CrmObjectView; objects: CrmObjectView[]; field?: CrmFieldView; onClose: () => void }) {
  const { t } = useT()
  const create = useMutation(api.crm.createField)
  const update = useMutation(api.crm.updateField)
  const { run, busy } = useAction()
  const s = field?.settings ?? {}
  const [label, setLabel] = useState(field?.label ?? "")
  const [key, setKey] = useState("")
  const [type, setType] = useState<FieldType>(field?.type ?? "text")
  const [required, setRequired] = useState(field?.required ?? false)
  const [description, setDescription] = useState(field?.description ?? "")
  const [options, setOptions] = useState<OptionDraft[]>(s.options?.map((o) => ({ ...o })) ?? [])
  const [num, setNum] = useState({ decimals: s.decimals?.toString() ?? "", min: s.min?.toString() ?? "", max: s.max?.toString() ?? "", maxLength: s.maxLength?.toString() ?? "", scale: s.scale?.toString() ?? "5" })
  const [currency, setCurrency] = useState(s.defaultCurrency ?? "EUR")
  const [target, setTarget] = useState(s.objectKey ?? objects.find((o) => o.key !== object.key)?.key ?? object.key)
  const [inverseLabel, setInverseLabel] = useState(s.inverseLabel ?? "")
  const [invalid, setInvalid] = useState<string[]>([])
  const editing = !!field
  const isLabel = field?.key === object.labelFieldKey

  const n = (v: string) => (v.trim() === "" ? undefined : Number(v.replace(",", ".")))
  function settings(): FieldSettings {
    switch (type) {
      case "text":
        return { ...(n(num.maxLength) !== undefined ? { maxLength: n(num.maxLength)! } : {}) }
      case "number":
        return Object.fromEntries(Object.entries({ decimals: n(num.decimals), min: n(num.min), max: n(num.max) }).filter(([, v]) => v !== undefined))
      case "currency":
        return { defaultCurrency: currency.trim().toUpperCase() }
      case "select":
      case "multiSelect":
        return { options: finalizeOptions(options) }
      case "rating":
        return { scale: n(num.scale) ?? 5 }
      case "relation":
        return { objectKey: target, ...(inverseLabel.trim() ? { inverseLabel: inverseLabel.trim() } : {}) }
      default:
        return {}
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const onError = (err: { fields: string[] }) => setInvalid(err.fields)
    const res = editing
      ? await run(() => update({ fieldId: field.id as Id<"crmFields">, label, description, required: isLabel ? true : required, settings: settings() }), { success: t("crm.field.saved"), onError })
      : await run(() => create({ objectId: object.id as Id<"crmObjects">, label, type, required, settings: settings(), ...(description.trim() ? { description } : {}), ...(key.trim() ? { key: key.trim() } : {}) }), { success: t("crm.field.created"), onError })
    if (res) onClose()
  }

  const bad = (k: string) => invalid.includes(k) || undefined
  const moveOption = (i: number, d: -1 | 1) =>
    setOptions((o) => {
      const c = [...o]
      ;[c[i], c[i + d]] = [c[i + d]!, c[i]!]
      return c
    })

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[min(46rem,calc(100dvh-2rem))] flex-col gap-0 p-0 sm:max-w-lg">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle>{editing ? t("crm.field.edit") : t("crm.field.new")}</DialogTitle>
            <DialogDescription>{editing ? t("crm.field.fixed") : object.namePlural}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
            <FieldGroup className="gap-5">
              <Field data-invalid={bad("label")}>
                <FieldLabel htmlFor="fld-label">{t("crm.field.label")}</FieldLabel>
                <Input id="fld-label" required autoFocus maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="fld-type">{t("crm.field.type")}</FieldLabel>
                  <Select value={type} onValueChange={(v) => setType(v as FieldType)} disabled={editing}>
                    <SelectTrigger id="fld-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELD_TYPES.map((ft) => (
                        <SelectItem key={ft} value={ft}>
                          {t(`crm.type.${ft}` as MessageKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field data-invalid={bad("key")}>
                  <FieldLabel htmlFor="fld-key">{t("crm.field.key")}</FieldLabel>
                  {editing ? (
                    <Input id="fld-key" className="font-mono" value={field.key} readOnly disabled />
                  ) : (
                    <Input id="fld-key" className="font-mono" placeholder={keyFromLabel(label) || "field"} value={key} onChange={(e) => setKey(e.target.value)} aria-invalid={bad("key")} />
                  )}
                </Field>
              </div>

              {typeSettings()}

              <Field orientation="horizontal">
                <Switch id="fld-required" checked={isLabel || required} disabled={isLabel} onCheckedChange={setRequired} />
                <div className="grid gap-0.5">
                  <FieldLabel htmlFor="fld-required">{t("crm.field.required")}</FieldLabel>
                  <FieldDescription>{t("crm.field.requiredHint")}</FieldDescription>
                </div>
              </Field>
              <Field>
                <FieldLabel htmlFor="fld-desc">{t("crm.field.description")}</FieldLabel>
                <Input id="fld-desc" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
                <FieldDescription>{t("crm.field.descriptionHint")}</FieldDescription>
              </Field>
            </FieldGroup>
          </div>
          <DialogFooter className="border-t px-6 py-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {editing ? t("common.save") : t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )

  function typeSettings() {
    switch (type) {
      case "text":
        return (
          <Field data-invalid={bad("maxLength")}>
            <FieldLabel htmlFor="fld-maxlen">{t("crm.field.maxLength")}</FieldLabel>
            <Input id="fld-maxlen" inputMode="numeric" className="w-32 tabular-nums" placeholder="500" value={num.maxLength} onChange={(e) => setNum({ ...num, maxLength: e.target.value })} />
          </Field>
        )
      case "number":
        return (
          <div className="grid grid-cols-3 gap-3">
            {(["decimals", "min", "max"] as const).map((k) => (
              <Field key={k} data-invalid={bad(k)}>
                <FieldLabel htmlFor={`fld-${k}`}>{t(`crm.field.${k}`)}</FieldLabel>
                <Input id={`fld-${k}`} inputMode="decimal" className="tabular-nums" placeholder={k === "decimals" ? "2" : undefined} value={num[k]} onChange={(e) => setNum({ ...num, [k]: e.target.value })} />
              </Field>
            ))}
          </div>
        )
      case "currency":
        return (
          <Field data-invalid={bad("defaultCurrency")}>
            <FieldLabel htmlFor="fld-cur">{t("crm.field.currency")}</FieldLabel>
            <Input id="fld-cur" maxLength={3} className="w-24 font-mono uppercase" value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </Field>
        )
      case "rating":
        return (
          <Field data-invalid={bad("scale")}>
            <FieldLabel htmlFor="fld-scale">{t("crm.field.scale")}</FieldLabel>
            <Select value={num.scale} onValueChange={(v) => setNum({ ...num, scale: v })}>
              <SelectTrigger id="fld-scale" className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[3, 4, 5, 6, 7, 8, 9, 10].map((x) => (
                  <SelectItem key={x} value={String(x)}>
                    {x}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )
      case "relation":
        return (
          <>
            <Field data-invalid={bad("objectKey")}>
              <FieldLabel htmlFor="fld-target">{t("crm.field.target")}</FieldLabel>
              <Select value={target} onValueChange={setTarget} disabled={editing}>
                <SelectTrigger id="fld-target" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {objects.map((o) => (
                    <SelectItem key={o.key} value={o.key}>
                      {o.namePlural}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="fld-inverse">{t("crm.field.inverseLabel")}</FieldLabel>
              <Input id="fld-inverse" maxLength={80} placeholder={object.namePlural} value={inverseLabel} onChange={(e) => setInverseLabel(e.target.value)} />
              <FieldDescription>{t("crm.field.inverseLabelHint")}</FieldDescription>
            </Field>
          </>
        )
      case "select":
      case "multiSelect":
        return (
          <FieldSet data-invalid={bad("options")}>
            <FieldLegend variant="label">{t("crm.field.options")}</FieldLegend>
            <FieldDescription>{t("crm.field.optionsHint")}</FieldDescription>
            <ol className="grid gap-1.5">
              {options.map((o, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <Select value={o.color} onValueChange={(c) => setOptions((x) => x.map((y, j) => (j === i ? { ...y, color: c as OptionColor } : y)))}>
                    <SelectTrigger size="sm" className="w-14" aria-label={`${t("crm.field.optionColor")}: ${o.label}`}>
                      <span className={cn("size-2.5 rounded-full", OPTION_DOT[o.color])} aria-hidden />
                    </SelectTrigger>
                    <SelectContent>
                      {OPTION_COLORS.map((c) => (
                        <SelectItem key={c} value={c}>
                          <span className={cn("size-2.5 rounded-full", OPTION_DOT[c])} aria-hidden />
                          {t(`crm.color.${c}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input className="h-7 flex-1" aria-label={`${t("crm.field.optionLabel")} ${i + 1}`} maxLength={80} value={o.label} onChange={(e) => setOptions((x) => x.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={t("crm.field.moveUp")} disabled={i === 0} onClick={() => moveOption(i, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={t("crm.field.moveDown")} disabled={i === options.length - 1} onClick={() => moveOption(i, 1)}>
                    <ArrowDown />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={`${t("crm.field.removeOption")}: ${o.label}`} onClick={() => setOptions((x) => x.filter((_, j) => j !== i))}>
                    <X />
                  </Button>
                </li>
              ))}
            </ol>
            <Button type="button" variant="outline" size="sm" className="w-fit border-dashed" onClick={() => setOptions((x) => [...x, { value: null, label: "", color: nextColor(x) }])}>
              <Plus />
              {t("crm.field.addOption")}
            </Button>
          </FieldSet>
        )
      default:
        return null
    }
  }
}
