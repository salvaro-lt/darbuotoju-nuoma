import { brand } from "@/brand"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("")

const SIZE = { sm: "size-8 text-xs", md: "size-11 text-base" } as const

/** The client's logo, or a monogram from its name until a logo is set in brand.ts. */
export function BrandMark({ size = "sm", className }: { size?: keyof typeof SIZE; className?: string }) {
  return (
    <Avatar className={cn("rounded-lg", SIZE[size], className)} aria-hidden="true">
      {brand.logo && <AvatarImage src={brand.logo} alt="" className="object-contain" />}
      <AvatarFallback className="rounded-lg bg-primary font-semibold text-primary-foreground">{initials(brand.name)}</AvatarFallback>
    </Avatar>
  )
}
