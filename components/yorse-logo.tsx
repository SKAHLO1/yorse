import { useId } from "react"
import { cn } from "@/lib/utils"

export const YORSE_COLORS = {
  forest: "#0E3B2B",
  green: "#16A34A",
  emerald: "#22C55E",
  mint: "#86EFAC",
} as const

/** The Yorse "Y": two leaves meeting at a stem, in the brand greens. */
export function YorseMark({ className, title = "Yorse" }: { className?: string; title?: string }) {
  const id = useId().replace(/:/g, "")
  return (
    <svg viewBox="0 0 48 48" className={cn("h-7 w-7 shrink-0", className)} role="img" aria-label={title}>
      <defs>
        <linearGradient id={`yl-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={YORSE_COLORS.mint} />
          <stop offset="1" stopColor={YORSE_COLORS.green} />
        </linearGradient>
        <linearGradient id={`yr-${id}`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={YORSE_COLORS.emerald} />
          <stop offset="1" stopColor="#15803D" />
        </linearGradient>
      </defs>
      <path d="M4 5c9 0 16.5 5.5 19.4 14.2L24 21v22h-6V24.5C11 22.3 6 15.7 4 5Z" fill={`url(#yl-${id})`} />
      <path d="M44 5c-2 10.7-7 17.3-14 19.5V43h-6V21l.6-1.8C27.5 10.5 35 5 44 5Z" fill={`url(#yr-${id})`} />
    </svg>
  )
}

/**
 * Mark + "Yorse" wordmark. `tone="dark"` is for dark backgrounds (sidebar, footer);
 * `tone="light"` is for light surfaces.
 */
export function YorseLogo({
  className,
  markClassName,
  tone = "light",
  showTagline = false,
}: {
  className?: string
  markClassName?: string
  tone?: "dark" | "light"
  showTagline?: boolean
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <YorseMark className={markClassName} />
      <span className="flex flex-col leading-none">
        <span className={cn("font-brand text-xl font-bold tracking-tight", tone === "dark" ? "text-white" : "text-[#0c1f17]")}>Yorse</span>
        {showTagline && (
          <span className={cn("mt-1 font-brand text-[9px] tracking-[0.28em]", tone === "dark" ? "text-emerald-300" : "text-brand-green")}>AI-VERIFIED ESCROW</span>
        )}
      </span>
    </span>
  )
}
