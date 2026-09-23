"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { AlertTriangle, ArrowLeft, Gavel } from "lucide-react"
import { AppShell } from "@/components/app/app-shell"
import { VerificationStatus } from "@/components/app/job-actions"
import { ComplaintItem, fmtDate, OnchainCard, ReviewItem, SubmissionsCard, TermsCard, Timeline, TxLink } from "@/components/app/job-parts"
import { ComplaintModeration, ReviewModeration } from "@/components/app/moderation"
import { StatusBadge } from "@/components/app/status-badge"
import { useAuth } from "@/components/auth-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { api, errorText } from "@/lib/api"
import type { JobDetail } from "@/lib/types"
import { shortAddr } from "@/lib/web3"

export default function AdminJobPage() {
  return (
    <AppShell adminOnly>
      <AdminJob />
    </AppShell>
  )
}

function AdminJob() {
  const { id } = useParams<{ id: string }>()
  const { me } = useAuth()
  const q = useQuery({ queryKey: ["job", id, "admin"], queryFn: () => api<JobDetail>(`/admin/jobs/${id}`), enabled: !!me?.admin })

  if (q.isLoading) return <Skeleton className="h-96 w-full" />
  if (q.error)
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>{errorText(q.error)}</AlertDescription>
      </Alert>
    )
  const detail = q.data!
  const { job } = detail
  const canAdminDispute = job.status === "funded" || (job.status === "submitted" && (job.verification.state === "error" || job.pendingDecision === "dispute"))

  return (
    <div className="space-y-6">
      <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Admin
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-brand text-2xl font-bold break-words">{job.title}</h1>
          <p className="text-sm text-muted-foreground">
            {job.clientEmail} ({shortAddr(job.clientWallet)}) → {job.freelancerEmail} ({shortAddr(job.freelancerWallet)}) · job {job.id}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-lg">{job.amountUsdc} USDC</span>
          <StatusBadge status={job.status} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          {job.status === "disputed" && <ResolvePanel detail={detail} />}
          {job.status === "submitted" && <VerificationStatus detail={detail} admin />}
          {canAdminDispute && <AdminDispute detail={detail} />}
          {job.resolution && (
            <Alert>
              <Gavel className="h-4 w-4" />
              <AlertTitle>
                Resolved: {job.resolution.outcome} by {job.resolution.adminEmail}
              </AlertTitle>
              <AlertDescription>
                <p className="whitespace-pre-wrap">{job.resolution.notes}</p>
                <p className="mt-1 text-xs">
                  {fmtDate(job.resolution.at)} · <TxLink hash={job.resolution.txHash} />
                </p>
              </AlertDescription>
            </Alert>
          )}

          <TermsCard job={job} />
          <SubmissionsCard submissions={detail.submissions} verifications={detail.verifications} currentId={job.currentSubmissionId} />

          <Card>
            <CardHeader>
              <CardTitle>Complaints ({detail.complaints.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {detail.complaints.length === 0 && <p className="text-sm text-muted-foreground">None filed.</p>}
              {detail.complaints.map((c) => (
                <ComplaintItem key={c.id} c={c}>
                  <ComplaintModeration c={c} />
                </ComplaintItem>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Reviews ({detail.reviews.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {detail.reviews.length === 0 && <p className="text-sm text-muted-foreground">None posted.</p>}
              {detail.reviews.map((r) => (
                <ReviewItem key={r.id} r={r}>
                  <ReviewModeration r={r} />
                </ReviewItem>
              ))}
            </CardContent>
          </Card>
        </div>
        <aside className="space-y-6">
          <OnchainCard detail={detail} />
          <Timeline events={detail.events} />
        </aside>
      </div>
    </div>
  )
}

function ResolvePanel({ detail }: { detail: JobDetail }) {
  const { job } = detail
  const qc = useQueryClient()
  const [outcome, setOutcome] = useState<"release" | "refund">("refund")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = detail.verifications[0]?.result

  async function resolve() {
    const who = outcome === "release" ? `pay ${job.amountUsdc} USDC to ${job.freelancerEmail}` : `refund ${job.amountUsdc} USDC to ${job.clientEmail}`
    if (!confirm(`This sends an on-chain transaction to ${who}. It cannot be undone. Continue?`)) return
    setBusy(true)
    setError(null)
    try {
      await api(`/admin/jobs/${job.id}/resolve`, { body: { outcome, notes } })
      toast.success("Dispute resolved on-chain")
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "admin" || q.queryKey[0] === "job" })
    } catch (e) {
      setError(errorText(e))
      await qc.invalidateQueries({ queryKey: ["job", job.id] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="border-brand-orange/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gavel className="size-4 text-brand-orange" /> Resolve dispute
        </CardTitle>
        <CardDescription>
          {job.dispute?.source === "ai" ? "AI did not meet the release rule" : `Opened by ${job.dispute?.source}`}: {job.dispute?.reason}
          {latest && latest.unmatched_criteria.length > 0 && <> · Unmatched: {latest.unmatched_criteria.join("; ")}</>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup value={outcome} onValueChange={(v) => setOutcome(v as "release" | "refund")} className="grid gap-2 sm:grid-cols-2">
          <Label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[[data-state=checked]]:border-brand-teal">
            <RadioGroupItem value="release" className="mt-0.5" />
            <span>
              <span className="block font-medium">Release to freelancer</span>
              <span className="text-xs text-muted-foreground">{job.freelancerEmail} receives {job.amountUsdc} USDC</span>
            </span>
          </Label>
          <Label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[[data-state=checked]]:border-brand-orange">
            <RadioGroupItem value="refund" className="mt-0.5" />
            <span>
              <span className="block font-medium">Refund client</span>
              <span className="text-xs text-muted-foreground">{job.clientEmail} gets {job.amountUsdc} USDC back</span>
            </span>
          </Label>
        </RadioGroup>
        <div className="space-y-2">
          <Label htmlFor="notes">Resolution notes (shown to both parties)</Label>
          <Textarea id="notes" rows={3} minLength={10} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Explain the decision with reference to the terms and evidence." />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="break-words">{error}</AlertDescription>
          </Alert>
        )}
        <Button onClick={resolve} disabled={busy || notes.trim().length < 10} variant={outcome === "refund" ? "destructive" : "default"}>
          {busy ? "Sending transaction…" : outcome === "release" ? "Resolve: release to freelancer" : "Resolve: refund client"}
        </Button>
      </CardContent>
    </Card>
  )
}

function AdminDispute({ detail }: { detail: JobDetail }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Move to dispute</CardTitle>
        <CardDescription>For non-delivery or a submission the AI cannot evaluate. Calls escrow.dispute(); you can then resolve it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
        {error && <p className="text-sm text-destructive-foreground">{error}</p>}
        <Button
          variant="outline"
          disabled={busy || reason.trim().length < 10}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              await api(`/admin/jobs/${detail.job.id}/dispute`, { body: { reason } })
              await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "admin" || q.queryKey[0] === "job" })
            } catch (e) {
              setError(errorText(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? "Sending…" : "Open dispute"}
        </Button>
      </CardContent>
    </Card>
  )
}
