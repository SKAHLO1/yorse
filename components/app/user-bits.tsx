"use client"

import Link from "next/link"
import { useState } from "react"
import { Bot, Star } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PublicUser, RatingSummary } from "@/lib/types"

const SIZES = { sm: "size-7 text-[11px]", md: "size-9 text-sm", lg: "size-16 text-xl" } as const

/** Brand-tinted initials, derived from the name so a person keeps the same colour. */
function initialsOf(name: string) {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase()
}

const PALETTE = ["#5C1F38", "#E85D3D", "#17B0A6", "#3f3f46", "#7c3aed"]

export function UserAvatar({ user, size = "md", className }: { user: Pick<PublicUser, "displayName" | "photoUrl" | "uid" | "isAgent">; size?: keyof typeof SIZES; className?: string }) {
  const [broken, setBroken] = useState(false)
  const name = user.displayName || "Unknown"
  const colour = PALETTE[[...user.uid].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length]
  const base = cn("shrink-0 overflow-hidden rounded-full", SIZES[size], className)

  if (user.isAgent) {
    return (
      <span className={cn(base, "flex items-center justify-center bg-brand-teal/15 text-brand-teal ring-1 ring-brand-teal/40")} aria-label="AI agent">
        <Bot className="size-[55%]" />
      </span>
    )
  }
  if (user.photoUrl && !broken) {
    // Provider-hosted (Google) avatars; referrerPolicy keeps Google from rejecting the request.
    return <img src={user.photoUrl} alt="" onError={() => setBroken(true)} referrerPolicy="no-referrer" className={cn(base, "object-cover")} />
  }
  return (
    <span className={cn(base, "flex items-center justify-center font-medium text-white")} style={{ backgroundColor: colour }} aria-hidden>
      {initialsOf(name)}
    </span>
  )
}

/** Star average + count. Shows "No ratings yet" rather than implying a zero score. */
export function Rating({ summary, label, className }: { summary?: RatingSummary; label?: string; className?: string }) {
  if (!summary || summary.count === 0 || summary.average === null) {
    return <span className={cn("text-xs text-muted-foreground", className)}>No ratings yet</span>
  }
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", className)}>
      <Star className="size-3.5 fill-brand-orange text-brand-orange" />
      <span className="font-medium text-foreground">{summary.average.toFixed(1)}</span>
      <span className="text-muted-foreground">
        ({summary.count}
        {label ? ` ${label}` : ""})
      </span>
    </span>
  )
}

export function Stars({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn("inline-flex", className)} aria-label={`${n} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn("size-3.5", i <= n ? "fill-brand-orange text-brand-orange" : "text-muted-foreground")} />
      ))}
    </span>
  )
}

export function AgentBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border border-brand-teal/40 px-1.5 py-px text-[10px] font-medium text-brand-teal", className)}>
      <Bot className="size-3" /> AI agent
    </span>
  )
}

/** Avatar + name, linking to the person's public profile. */
export function UserChip({
  user,
  role = "freelancer",
  size = "md",
  showRating = true,
  className,
}: {
  user: PublicUser
  /** Which side's rating to show: a job poster is rated as a client. */
  role?: "client" | "freelancer"
  size?: keyof typeof SIZES
  showRating?: boolean
  className?: string
}) {
  return (
    <Link href={`/u/${user.uid}`} className={cn("flex min-w-0 items-center gap-2.5 hover:opacity-90", className)}>
      <UserAvatar user={user} size={size} />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{user.displayName}</span>
          {user.isAgent && <AgentBadge />}
        </span>
        {showRating && <Rating summary={role === "client" ? user.ratingAsClient : user.ratingAsFreelancer} />}
      </span>
    </Link>
  )
}
