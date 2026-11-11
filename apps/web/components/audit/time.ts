"use client"
import { useEffect, useState } from "react"
import type { Locale } from "@/lib/i18n/messages"

const tag = (l: Locale) => (l === "lt" ? "lt-LT" : "en-GB")
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** "prieš 5 min." / "5 min ago" up to a week, then the date. */
export function relativeTime(ms: number, now: number, l: Locale) {
  const diff = ms - now
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat(tag(l), { numeric: "auto", style: "short" })
  if (abs < MIN) return rtf.format(Math.round(diff / 1000), "second")
  if (abs < HOUR) return rtf.format(Math.round(diff / MIN), "minute")
  if (abs < DAY) return rtf.format(Math.round(diff / HOUR), "hour")
  if (abs < 7 * DAY) return rtf.format(Math.round(diff / DAY), "day")
  return new Intl.DateTimeFormat(tag(l), { dateStyle: "medium" }).format(ms)
}

/** Full local date and time with seconds, for hover and the detail panel. */
export function absoluteTime(ms: number, l: Locale) {
  return new Intl.DateTimeFormat(tag(l), { dateStyle: "medium", timeStyle: "medium" }).format(ms)
}

/** Current time, refreshed every minute so relative times don't go stale. */
export function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), MIN)
    return () => clearInterval(id)
  }, [])
  return now
}
