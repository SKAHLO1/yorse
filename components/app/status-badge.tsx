import { cn } from "@/lib/utils"
import type { JobStatus } from "@/lib/types"

const STYLES: Record<JobStatus, { label: string; className: string }> = {
  open: { label: "Open · accepting applications", className: "bg-brand-teal/10 text-brand-teal border-brand-teal/30" },
  pending_acceptance: { label: "Awaiting acceptance", className: "bg-zinc-800 text-zinc-300 border-zinc-700" },
  declined: { label: "Declined", className: "bg-zinc-900 text-zinc-500 border-zinc-800" },
  cancelled: { label: "Cancelled", className: "bg-zinc-900 text-zinc-500 border-zinc-800" },
  awaiting_funding: { label: "Awaiting funding", className: "bg-amber-500/10 text-amber-300 border-amber-500/30" },
  funded: { label: "Funded", className: "bg-sky-500/10 text-sky-300 border-sky-500/30" },
  submitted: { label: "Verifying", className: "bg-violet-500/10 text-violet-300 border-violet-500/30" },
  released: { label: "Released", className: "bg-brand-teal/10 text-brand-teal border-brand-teal/30" },
  disputed: { label: "Disputed", className: "bg-brand-orange/10 text-brand-orange border-brand-orange/40" },
  resolved_release: { label: "Resolved · released", className: "bg-brand-teal/10 text-brand-teal border-brand-teal/30" },
  resolved_refund: { label: "Resolved · refunded", className: "bg-zinc-800 text-zinc-200 border-zinc-600" },
}

export function StatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  const s = STYLES[status]
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", s.className, className)}>{s.label}</span>
}

export const statusLabel = (s: JobStatus) => STYLES[s].label
