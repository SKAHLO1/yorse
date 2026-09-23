import { cn } from "@/lib/utils"

export const YORSE_COLORS = {
  orange: "#E85D3D",
  maroon: "#5C1F38",
  teal: "#17B0A6",
} as const

/** The circular check mark from the Yorse logo. */
export function YorseMark({ className, title = "Yorse" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={cn("w-6 h-6 shrink-0", className)} role="img" aria-label={title}>
      <circle cx="50" cy="50" r="50" fill={YORSE_COLORS.orange} />
      <circle cx="50" cy="50" r="44.5" fill={YORSE_COLORS.maroon} />
      <path
        d="M27.5 50.5 L43.2 67 L74.5 32.5"
        fill="none"
        stroke={YORSE_COLORS.teal}
        strokeWidth="11.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Mark + "yorse" wordmark. `tone="dark"` is for dark backgrounds (the maroon
 * letters become white so they stay legible); `tone="light"` matches the
 * original artwork on white.
 */
export function YorseLogo({
  className,
  markClassName,
  tone = "dark",
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
        <span className="font-brand font-bold tracking-tight text-lg">
          <span style={{ color: YORSE_COLORS.orange }}>y</span>
          <span style={{ color: tone === "dark" ? "#FFFFFF" : YORSE_COLORS.maroon }}>orse</span>
        </span>
        {showTagline && (
          <span className="font-brand text-[9px] tracking-[0.3em] mt-1" style={{ color: YORSE_COLORS.teal }}>
            AI-VERIFIED ESCROW
          </span>
        )}
      </span>
    </span>
  )
}
