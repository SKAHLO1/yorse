import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Gavel, Loader2, Lock, Scale, Sparkles, Undo2, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { JobStatus } from "@/lib/types"

type Style = { label: string; className: string; icon: typeof Clock; spin?: boolean }

const GREEN = "bg-emerald-50 text-emerald-700 ring-emerald-600/15"
const BLUE = "bg-indigo-50 text-indigo-700 ring-indigo-600/15"
const AMBER = "bg-amber-50 text-amber-700 ring-amber-600/20"
const RED = "bg-red-50 text-red-700 ring-red-600/15"
const GREY = "bg-slate-100 text-slate-600 ring-slate-500/15"

const STYLES: Record<JobStatus, Style> = {
  open: { label: "Open · accepting applications", className: GREEN, icon: Sparkles },
  pending_acceptance: { label: "Awaiting acceptance", className: GREY, icon: Clock },
  declined: { label: "Declined", className: GREY, icon: XCircle },
  cancelled: { label: "Cancelled", className: GREY, icon: XCircle },
  awaiting_funding: { label: "Awaiting funding", className: AMBER, icon: Clock },
  funded: { label: "Funded", className: GREEN, icon: Lock },
  submitted: { label: "AI verifying", className: BLUE, icon: Loader2, spin: true },
  proposed: { label: "AI verdict · challenge window", className: BLUE, icon: Scale },
  challenged: { label: "Challenged · AI jury", className: AMBER, icon: Gavel },
  released: { label: "Released", className: GREEN, icon: CheckCircle2 },
  refunded: { label: "Refunded", className: GREY, icon: Undo2 },
  disputed: { label: "Disputed", className: RED, icon: AlertTriangle },
  resolved_release: { label: "Resolved · released", className: GREEN, icon: CheckCircle2 },
  resolved_refund: { label: "Resolved · refunded", className: GREY, icon: Undo2 },
}

export function StatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  const s = STYLES[status] ?? { label: status, className: GREY, icon: CircleDashed }
  const Icon = s.icon
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset", s.className, className)}>
      <Icon className={cn("size-3.5", s.spin && "animate-spin [animation-duration:2.5s]")} />
      {s.label}
    </span>
  )
}

export const statusLabel = (s: JobStatus) => STYLES[s]?.label ?? s
