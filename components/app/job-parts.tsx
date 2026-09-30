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

const BARE = "gap-4 border-0 py-0 shadow-none [&>[data-slot=card-content]]:px-0 [&>[data-slot=card-header]]:px-0"

export function TermsCard({ job, bare = false }: { job: Job; bare?: boolean }) {
  return (
    <Card className={bare ? BARE : "shadow-soft"}>
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
  const deadline = !("error" in oc) && oc.state === "Proposed" && oc.challengeDeadline ? new Date(oc.challengeDeadline * 1000).toISOString() : null
  return (
    <Card className="gap-3 shadow-soft">
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
            {oc.proposed && oc.proposed !== "None" && <Row k="AI proposal" v={oc.proposed} />}
            {deadline && <Row k="Challenge until" v={fmtDate(deadline)} />}
            {oc.bond && oc.bond !== "0" && <Row k="Challenge bond" v={`${(Number(oc.bond) / 1e6).toFixed(2)} USDC`} />}
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
  const decisionLabel = v.decision === "release" ? "propose release" : v.decision === "refund" ? "propose refund" : v.decision === "escalate" ? "send to the AI jury" : "send to dispute"
  return (
    <div className={cn("rounded-lg border p-4 text-sm", released ? "border-brand-teal/40 bg-brand-teal/5" : "border-brand-orange/40 bg-brand-orange/5")}>
      <div className="flex flex-wrap items-center gap-2">
        <Bot className="size-4 text-muted-foreground" />
        <span className="font-medium">AI verdict: {r.verdict}</span>
        <span className="text-muted-foreground">·</span>
        <span className="font-medium">Decision: {decisionLabel}</span>
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
      {v.evidence?.screenshots && v.evidence.screenshots.length > 0 && <WhatTheAiSaw shots={v.evidence.screenshots} />}
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

/** The deliverable as a real browser rendered it, exactly as the vision model received it. */
function WhatTheAiSaw({ shots }: { shots: NonNullable<Verification["evidence"]["screenshots"]> }) {
  return (
    <div className="mt-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">What the AI saw</div>
      <div className="flex items-start gap-3 overflow-x-auto">
        {shots.map((s) => (
          <figure
            key={s.label}
            className={cn("block shrink-0 overflow-hidden rounded-md border bg-background", s.label === "desktop" ? "w-64 sm:w-80" : "w-24 sm:w-28")}
            title={`${s.label} ${s.width}×${s.height} · keccak ${s.hash}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:${s.mimeType};base64,${s.base64}`} alt={`${s.label} screenshot of the deliverable`} className="max-h-72 w-full object-cover object-top" />
            <div className="border-t px-2 py-1 text-[10px] text-muted-foreground">
              {s.label} · {s.width}px
            </div>
          </figure>
        ))}
      </div>
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

export function SubmissionsCard({
  submissions,
  verifications,
  currentId,
  bare = false,
}: {
  submissions: Submission[]
  verifications: Verification[]
  currentId: string | null
  bare?: boolean
}) {
  if (!submissions.length) return null
  return (
    <Card className={bare ? BARE : "shadow-soft"}>
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
  released: "bg-emerald-500 ring-emerald-100",
  resolved: "bg-emerald-500 ring-emerald-100",
  refunded: "bg-slate-400 ring-slate-100",
  proposed: "bg-indigo-500 ring-indigo-100",
  challenged: "bg-amber-500 ring-amber-100",
  escalated: "bg-amber-500 ring-amber-100",
  jury_ruling: "bg-indigo-500 ring-indigo-100",
  disputed: "bg-orange-500 ring-orange-100",
  ai_error: "bg-red-500 ring-red-100",
  jury_error: "bg-red-500 ring-red-100",
  chain_error: "bg-red-500 ring-red-100",
  funding_mismatch: "bg-red-500 ring-red-100",
}

/** Vertical job history: a green rail with one dot per event, newest last. */
export function Timeline({ events, bare = false }: { events: JobEvent[]; bare?: boolean }) {
  const list = (
    <ol className="relative space-y-5 pl-7">
      <span className="absolute bottom-2 left-[7px] top-2 w-0.5 rounded bg-emerald-100" aria-hidden />
      {events.map((e, i) => (
        <li key={e.id} className="relative text-sm">
          <span
            className={cn(
              "absolute -left-7 top-1 size-4 rounded-full ring-4",
              EVENT_TONE[e.type] ?? "bg-emerald-500 ring-emerald-100",
              i === events.length - 1 && "animate-pulse",
            )}
          />
          <div className="font-medium leading-snug">{e.message}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{fmtDate(e.at)}</span>
            <span>· {e.actorRole}</span>
            {typeof e.data?.txHash === "string" && <TxLink hash={e.data.txHash} />}
          </div>
        </li>
      ))}
      {!events.length && <li className="text-sm text-muted-foreground">No activity yet.</li>}
    </ol>
  )
  if (bare) return list
  return (
    <Card className="shadow-soft">
      <CardHeader>
        <CardTitle className="text-base">Timeline</CardTitle>
      </CardHeader>
      <CardContent>{list}</CardContent>
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
