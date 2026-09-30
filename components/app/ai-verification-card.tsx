"use client"

import { Bot, CheckCircle2, Circle, Loader2, XCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { JobDetail } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * The design's "AI Verification" panel: a confidence ring and a per-criterion checklist.
 * Shows real state only: waiting, running (indeterminate), failed, or the stored verdict.
 */
export function AiVerificationCard({ detail }: { detail: JobDetail }) {
  const { job } = detail
  const v = detail.verifications.find((x) => x.id === job.verification.verificationId)
  const ruling = detail.rulings.find((r) => r.id === job.jury.rulingId && r.status === "completed")
  const running = job.verification.state === "running"
  const result = v?.status === "completed" ? v.result : null
  const pct = result ? Math.round(result.confidence * 100) : null
  const matched = new Set((result?.matched_criteria ?? []).map(norm))
  const unmatched = new Set((result?.unmatched_criteria ?? []).map(norm))

  const headline = running
    ? "Analyzing your submission…"
    : !job.currentSubmissionId
      ? "Waiting for a submission"
      : v?.status === "error"
        ? "Verification failed; no verdict yet"
        : result
          ? decisionText(v?.decision ?? null)
          : "Queued for verification"
  const sub = running
    ? "Checking the deliverable against the agreed terms."
    : result
      ? `${v?.provider}:${v?.model}${v?.evidence?.screenshots?.length ? " · saw screenshots" : ""}`
      : "The AI checks each acceptance criterion against the delivered work."

  return (
    <Card className="gap-4 shadow-soft">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="size-4 text-brand-green" /> AI verification
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-4">
          <Ring pct={pct} running={running} threshold={v?.threshold ?? 0.85} />
          <div className="min-w-0">
            <div className="text-sm font-medium">{headline}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>
          </div>
        </div>
        <ul className="space-y-2">
          {job.acceptanceCriteria.map((c, i) => {
            const n = norm(c)
            const ok = [...matched].some((m) => m === n || m.includes(n))
            const bad = !ok && [...unmatched].some((m) => m === n || m.includes(n))
            return (
              <li key={i} className="flex items-start justify-between gap-3 text-sm">
                <span className={cn("min-w-0", !result && "text-muted-foreground")}>{c}</span>
                {running ? (
                  <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-indigo-500" />
                ) : ok ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                ) : bad ? (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" />
                ) : (
                  <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground/50" />
                )}
              </li>
            )
          })}
        </ul>
        {ruling && (
          <div className="rounded-lg bg-accent px-3 py-2 text-xs text-brand-forest">
            AI jury: {ruling.tally.release} release · {ruling.tally.refund} refund · {ruling.tally.abstain} abstain →{" "}
            <span className="font-semibold">{ruling.outcome === "split" ? "human review" : ruling.outcome}</span>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Automated. A verdict is a proposal either side can challenge; an unsure AI hands the case to the jury.
        </p>
      </CardContent>
    </Card>
  )
}

function decisionText(d: string | null) {
  if (d === "release") return "Proposes release to the developer"
  if (d === "refund") return "Proposes a refund to the client"
  if (d === "escalate") return "Not confident: sent to the AI jury"
  return "Verdict recorded"
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.;:,]+$/, "").trim()

function Ring({ pct, running, threshold }: { pct: number | null; running: boolean; threshold: number }) {
  const r = 30
  const c = 2 * Math.PI * r
  const shown = pct ?? 0
  const pass = pct !== null && pct >= threshold * 100
  return (
    <div className="relative size-20 shrink-0">
      <svg viewBox="0 0 72 72" className={cn("size-20 -rotate-90", running && "animate-spin [animation-duration:2.5s]")}>
        <circle cx="36" cy="36" r={r} fill="none" stroke="currentColor" strokeWidth="7" className="text-muted" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          stroke={running ? "#6366f1" : pass ? "#16a34a" : "#f59e0b"}
          strokeDasharray={c}
          strokeDashoffset={running ? c * 0.7 : c * (1 - shown / 100)}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-brand text-lg font-bold">
        {running ? <Bot className="size-5 text-indigo-500" /> : pct === null ? "—" : `${pct}%`}
      </span>
    </div>
  )
}
