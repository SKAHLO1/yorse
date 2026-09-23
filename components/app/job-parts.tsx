"use client"

import { AlertTriangle, Bot, CheckCircle2, ExternalLink, FileText, Link as LinkIcon, Star, XCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { Complaint, Job, JobDetail, JobEvent, Review, Submission, Verification } from "@/lib/types"
import { addrUrl, isTxHash, shortAddr, txUrl } from "@/lib/web3"

export const fmtDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

export function TxLink({ hash, label }: { hash?: string | null; label?: string }) {
  if (!isTxHash(hash)) return null
  return (
    <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-brand-teal hover:underline">
      {label ?? shortAddr(hash)} <ExternalLink className="size-3" />
    </a>
  )
}

export function TermsCard({ job }: { job: Job }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agreed terms</CardTitle>
        <CardDescription>What the AI verifies the deliverable against.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="whitespace-pre-wrap text-muted-foreground">{job.deliverableDescription}</p>
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Acceptance criteria</div>
          <ol className="list-decimal space-y-1 pl-5">
            {job.acceptanceCriteria.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <Meta label="Amount" value={`${job.amountUsdc} USDC`} />
          <Meta label="Due" value={new Date(job.dueDate).toLocaleDateString()} />
          <Meta label="Client" value={job.clientEmail} sub={<a className="font-mono hover:underline" href={addrUrl(job.clientWallet)} target="_blank" rel="noreferrer">{shortAddr(job.clientWallet)}</a>} />
          <Meta
            label="Developer"
            value={job.freelancerEmail ?? "Not chosen yet"}
            sub={
              job.freelancerWallet ? (
                <a className="font-mono hover:underline" href={addrUrl(job.freelancerWallet)} target="_blank" rel="noreferrer">
                  {shortAddr(job.freelancerWallet)}
                </a>
              ) : (
                "accepting applications"
              )
            }
          />
        </dl>
      </CardContent>
    </Card>
  )
}

function Meta({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium" title={value}>
        {value}
      </dd>
      {sub && <dd className="text-muted-foreground">{sub}</dd>}
    </div>
  )
}

export function OnchainCard({ detail }: { detail: JobDetail }) {
  const oc = detail.onchain
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="text-sm">On-chain escrow</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {"error" in oc ? (
          <p className="text-destructive-foreground">Could not read chain: {oc.error}</p>
        ) : (
          <>
            <Row k="State" v={<Badge variant="outline">{oc.state}</Badge>} />
            {oc.state !== "None" && <Row k="Locked" v={`${(Number(oc.amount) / 1e6).toFixed(2)} USDC`} />}
          </>
        )}
        <Row k="Contract" v={<a className="font-mono hover:underline" href={addrUrl(detail.escrowAddress)} target="_blank" rel="noreferrer">{shortAddr(detail.escrowAddress)}</a>} />
        <Row k="Job key" v={<span className="font-mono">{shortAddr(detail.job.onchainJobId)}</span>} />
        {detail.job.fundTxHash && <Row k="Funding tx" v={<TxLink hash={detail.job.fundTxHash} />} />}
        {detail.job.lastChainAction && (
          <Row
            k="Last relayer call"
            v={
              <span className={cn(detail.job.lastChainAction.state === "failed" && "text-destructive-foreground")}>
                {detail.job.lastChainAction.type} · {detail.job.lastChainAction.state} <TxLink hash={detail.job.lastChainAction.txHash} />
              </span>
            }
          />
        )}
        {detail.job.lastChainAction?.state === "failed" && <p className="rounded bg-destructive/10 p-2 text-destructive-foreground">{detail.job.lastChainAction.error}</p>}
      </CardContent>
    </Card>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  )
}

/** Always shows the model's reasoning and criteria, never a bare score. */
export function VerdictCard({ v, current }: { v: Verification; current?: boolean }) {
  if (v.status === "error") {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <div className="flex items-center gap-2 font-medium text-destructive-foreground">
          <AlertTriangle className="size-4" /> AI verification failed — no verdict was produced
        </div>
        <p className="mt-2 text-muted-foreground">{v.error}</p>
        <Attempts v={v} />
        <p className="mt-2 text-xs text-muted-foreground">{fmtDate(v.createdAt)}</p>
      </div>
    )
  }
  const r = v.result!
  const released = v.decision === "release"
  return (
    <div className={cn("rounded-lg border p-4 text-sm", released ? "border-brand-teal/40 bg-brand-teal/5" : "border-brand-orange/40 bg-brand-orange/5")}>
      <div className="flex flex-wrap items-center gap-2">
        <Bot className="size-4 text-muted-foreground" />
        <span className="font-medium">AI verdict: {r.verdict}</span>
        <span className="text-muted-foreground">·</span>
        <span className="font-medium">Decision: {released ? "release escrow" : "send to dispute"}</span>
        {current && <Badge variant="outline">current</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">
          {v.provider}:{v.model}
        </span>
      </div>
      <div className="mt-3">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Confidence {Math.round(r.confidence * 100)}%</span>
          <span>release threshold {Math.round(v.threshold * 100)}%</span>
        </div>
        <div className="relative mt-1 h-2 rounded-full bg-muted">
          <div className={cn("h-2 rounded-full", r.confidence >= v.threshold ? "bg-brand-teal" : "bg-brand-orange")} style={{ width: `${r.confidence * 100}%` }} />
          <div className="absolute top-[-3px] h-3.5 w-px bg-foreground/60" style={{ left: `${v.threshold * 100}%` }} />
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Reasoning</div>
        <p className="whitespace-pre-wrap leading-relaxed">{r.reasoning}</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <CriteriaList title="Matched" items={r.matched_criteria} ok />
        <CriteriaList title="Unmatched" items={r.unmatched_criteria} />
      </div>
      {v.decisionReason && <p className="mt-3 rounded bg-background/60 p-2 text-xs text-muted-foreground">Decision rule: {v.decisionReason}</p>}
      {v.evidence && (
        <p className="mt-2 text-xs text-muted-foreground">
          Evidence: {v.evidence.fetched ? "fetched" : "not fetched"}
          {v.evidence.note ? ` — ${v.evidence.note}` : ""}
        </p>
      )}
      <Attempts v={v} />
      <p className="mt-2 text-xs text-muted-foreground">{fmtDate(v.createdAt)}</p>
    </div>
  )
}

function Attempts({ v }: { v: Verification }) {
  const failed = v.attempts.filter((a) => !a.ok)
  if (!failed.length) return null
  return (
    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
      {failed.map((a, i) => (
        <li key={i}>
          ↳ {a.provider}:{a.model} failed{v.status === "completed" ? ", fell back" : ""}: {a.error}
        </li>
      ))}
    </ul>
  )
}

function CriteriaList({ title, items, ok }: { title: string; items: string[]; ok?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">None</p>
      ) : (
        <ul className="space-y-1">
          {items.map((c, i) => (
            <li key={i} className="flex gap-2">
              {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-teal" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-brand-orange" />}
              <span>{c}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function SubmissionsCard({ submissions, verifications, currentId }: { submissions: Submission[]; verifications: Verification[]; currentId: string | null }) {
  if (!submissions.length) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Submissions & AI verdicts</CardTitle>
        <CardDescription>Every submission and every verification attempt, newest first.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {submissions.map((s) => {
          const vs = verifications.filter((v) => v.submissionId === s.id)
          return (
            <div key={s.id} className="space-y-3">
              <div className="rounded-lg border border-border p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Submitted {fmtDate(s.createdAt)}</span>
                  {s.id === currentId && <Badge variant="outline">current</Badge>}
                  {s.onchainTxHash ? <TxLink hash={s.onchainTxHash} label="recorded on-chain" /> : <span className="text-destructive-foreground">not recorded on-chain</span>}
                </div>
                {s.deliverableUrl && (
                  <a href={s.deliverableUrl} target="_blank" rel="noreferrer noopener" className="mt-2 flex items-center gap-1.5 break-all text-brand-teal hover:underline">
                    <LinkIcon className="size-3.5 shrink-0" /> {s.deliverableUrl}
                  </a>
                )}
                {s.fileReference && (
                  <p className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                    <FileText className="size-3.5" /> {s.fileReference}
                  </p>
                )}
                <p className="mt-2 whitespace-pre-wrap">{s.description}</p>
                {s.notes && <p className="mt-2 whitespace-pre-wrap text-muted-foreground">Notes: {s.notes}</p>}
              </div>
              {vs.map((v) => (
                <VerdictCard key={v.id} v={v} />
              ))}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

const EVENT_TONE: Record<string, string> = {
  released: "bg-brand-teal",
  resolved: "bg-brand-teal",
  disputed: "bg-brand-orange",
  ai_error: "bg-destructive",
  chain_error: "bg-destructive",
  funding_mismatch: "bg-destructive",
}

export function Timeline({ events }: { events: JobEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative space-y-4 border-l border-border pl-5">
          {events.map((e) => (
            <li key={e.id} className="text-sm">
              <span className={cn("absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-muted-foreground", EVENT_TONE[e.type])} />
              <div>{e.message}</div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{fmtDate(e.at)}</span>
                <span>· {e.actorRole}</span>
                {typeof e.data?.txHash === "string" && <TxLink hash={e.data.txHash} />}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

export function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex" aria-label={`${n} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn("size-3.5", i <= n ? "fill-brand-orange text-brand-orange" : "text-muted-foreground")} />
      ))}
    </span>
  )
}

export function ReviewItem({ r, children }: { r: Review; children?: React.ReactNode }) {
  return (
    <div className={cn("rounded-lg border border-border p-3 text-sm", r.status === "hidden" && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2">
        <Stars n={r.rating} />
        <span className="text-xs text-muted-foreground">
          {r.reviewerEmail} ({r.reviewerRole}) → {r.revieweeEmail}
        </span>
        {r.status === "hidden" && <Badge variant="outline">hidden by admin</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">{fmtDate(r.createdAt)}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap">{r.comment}</p>
      {r.moderationNote && <p className="mt-1 text-xs text-muted-foreground">Moderation note: {r.moderationNote}</p>}
      {children}
    </div>
  )
}

export const COMPLAINT_CATEGORIES: Record<Complaint["category"], string> = {
  quality: "Work quality",
  communication: "Communication",
  payment: "Payment",
  ai_verdict: "AI verdict",
  conduct: "Conduct",
  other: "Other",
}

export function ComplaintItem({ c, children }: { c: Complaint; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{COMPLAINT_CATEGORIES[c.category]}</Badge>
        <Badge variant={c.status === "open" ? "destructive" : "secondary"}>{c.status.replace("_", " ")}</Badge>
        <span className="text-xs text-muted-foreground">
          {c.filedByEmail} ({c.filedByRole}) against {c.againstEmail}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">{fmtDate(c.createdAt)}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap">{c.description}</p>
      {c.adminNotes && <p className="mt-1 text-xs text-muted-foreground">Admin notes: {c.adminNotes}</p>}
      {children}
    </div>
  )
}
