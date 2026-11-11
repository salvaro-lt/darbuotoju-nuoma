"use client"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n/client"
import { NativeSelect, useTradeName, useTrades } from "./staffing-ui"

export interface RateRow {
  tradeId: string
  eur: string
}

/** Hourly rates per trade, edited in EUR (stored in cents). */
export function RatesEditor({ rows, onChange }: { rows: RateRow[]; onChange: (rows: RateRow[]) => void }) {
  const { t } = useT()
  const trades = useTrades() ?? []
  const tradeName = useTradeName()
  return (
    <div className="grid gap-2">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <NativeSelect className="flex-1" aria-label={t("staffing.team.trade")} value={r.tradeId} onChange={(v) => onChange(rows.map((x, j) => (j === i ? { ...x, tradeId: v } : x)))}>
            <option value="" />
            {trades.map((tr) => (
              <option key={tr.id} value={tr.id}>
                {tr.code} · {tradeName(tr)}
              </option>
            ))}
          </NativeSelect>
          <Input className="w-28" inputMode="decimal" aria-label={t("staffing.common.rate")} placeholder={t("staffing.common.rate")} value={r.eur} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, eur: e.target.value } : x)))} />
          <Button type="button" variant="ghost" size="icon" aria-label={t("staffing.common.delete")} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <X />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => onChange([...rows, { tradeId: "", eur: "" }])}>
        <Plus />
        {t("staffing.common.addRate")}
      </Button>
    </div>
  )
}
