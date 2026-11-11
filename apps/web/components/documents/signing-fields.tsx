"use client"
// Shared bits for signing screens: role colours and how a filled value looks on the page.
import type { SigningField, SigningValue } from "@digimuza/documents/signing"
import { Calendar, Check, Mail, PenLine, Signature, SquareCheck, Type, UserRound, type LucideIcon } from "lucide-react"
import type { CSSProperties } from "react"

/** One hue per signer role, in role order. Mid lightness: readable as border, fill at low alpha. */
const ROLE_HUES = [252, 152, 52, 332, 200, 292, 100, 20, 230, 170]

export const roleColor = (role: number, alpha = 1) => `oklch(0.58 0.15 ${ROLE_HUES[role % ROLE_HUES.length]} / ${alpha})`
/** Text on a role-tinted box: same hue, dark enough for 4.5:1 on white pages. */
export const roleInk = (role: number) => `oklch(0.4 0.13 ${ROLE_HUES[role % ROLE_HUES.length]})`

export const FIELD_ICON: Record<SigningField["type"], LucideIcon> = {
  signature: Signature,
  initials: PenLine,
  text: Type,
  name: UserRound,
  email: Mail,
  date: Calendar,
  checkbox: SquareCheck,
}

/** Absolute position of a field inside its page box. */
export const boxStyle = (f: Pick<SigningField, "x" | "y" | "w" | "h">): CSSProperties => ({
  left: `${f.x * 100}%`,
  top: `${f.y * 100}%`,
  width: `${f.w * 100}%`,
  height: `${f.h * 100}%`,
})

/** A filled value drawn the way the signed PDF will show it. `pxHeight` is the box height on screen. */
export function FieldValue({ field, value, pxHeight }: { field: SigningField; value: SigningValue; pxHeight: number }) {
  if (field.type === "checkbox") return value ? <Check className="size-full p-[10%] text-[oklch(0.3_0.08_260)]" strokeWidth={3} aria-hidden="true" /> : null
  if (typeof value !== "string" || !value) return null
  // A signature is a small inline data URL: next/image adds nothing here.
  // eslint-disable-next-line @next/next/no-img-element
  if (field.type === "signature" || field.type === "initials") return <img src={value} alt="" className="size-full object-contain" draggable={false} />
  return (
    <span className="flex size-full items-center overflow-hidden px-0.5 whitespace-nowrap text-[oklch(0.3_0.08_260)]" style={{ fontSize: Math.max(8, Math.min(pxHeight * 0.62, 16)) }}>
      {value}
    </span>
  )
}
