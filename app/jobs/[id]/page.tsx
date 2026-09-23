"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useParams } from "next/navigation"
import { AlertTriangle, ArrowLeft, Gavel, Scale } from "lucide-react"
import { AppShell } from "@/components/app/app-shell"
import { ApplicationsPanel } from "@/components/app/applications-panel"
import { ApplyDialog } from "@/components/app/feed"
import { UserChip } from "@/components/app/user-bits"
import {
  CancelJob,
  ComplaintForm,
  FundEscrow,
  NonDeliveryDispute,
  RespondToTerms,
  ReviewForm,
  SubmitDeliverable,
  VerificationStatus,
} from "@/components/app/job-actions"
import { ComplaintItem, fmtDate, OnchainCard, ReviewItem, SubmissionsCard, TermsCard, Timeline, TxLink, VerdictCard } from "@/components/app/job-parts"
import { StatusBadge } from "@/components/app/status-badge"
import { useAuth } from "@/components/auth-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api, errorText } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { COMPLAINABLE, TERMINAL, type FeedItem, type JobDetail } from "@/lib/types"

export default function JobPage() {
  return (
    <AppShell>
      <JobView />
    </AppShell>
  )
}

function JobView() {
  const { id } = useParams<{ id: string }>()
  const { me } = useAuth()
  const q = useQuery({
    queryKey: ["job", id],
    queryFn: () => api<JobDetail>(`/jobs/${id}`),
    enabled: !!me,
    // Poll while the AI/chain step is in flight.
    refetchInterval: (query) => (query.state.data?.job.status === "submitted" && query.state.data.job.verification.state === "running" ? 4000 : false),
  })

  if (q.isLoading || !me) return <Skeleton className="h-96 w-full" />
  if (q.error)
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Could not load job</AlertTitle>
        <AlertDescription>{errorText(q.error)}</AlertDescription>
      </Alert>
    )
  const detail = q.data!
  const { job, viewerRole: role } = detail
  const counterpart = (role === "client" ? job.freelancerEmail : job.clientEmail) ?? "the other party"
  const current = detail.verifications.find((v) => v.id === job.verification.verificationId)
  const myReview = detail.reviews.find((r) => r.reviewerUid === me.uid)

  return (
    <div className="space-y-6">
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Dashboard
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-brand text-2xl font-bold break-words">{job.title}</h1>
          <p className="text-sm text-muted-foreground">
            {role ? `You are the ${role === "freelancer" ? "developer" : role}` : "Open listing"} · created {fmtDate(job.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-lg">{job.amountUsdc} USDC</span>
          <StatusBadge status={job.status} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          {/* --- Open public listing --- */}
          {job.status === "open" && role === "client" && <ApplicationsPanel detail={detail} />}
          {job.status === "open" && !role && <VisitorApply detail={detail} />}

          {/* --- Next action for this viewer --- */}
          {role === "freelancer" && job.status === "pending_acceptance" && <RespondToTerms detail={detail} />}
          {role === "client" && job.status === "pending_acceptance" && <Waiting text={`Waiting for ${job.freelancerEmail} to accept the terms.`} />}
          {role === "client" && job.status === "awaiting_funding" && <FundEscrow detail={detail} />}
          {role === "freelancer" && job.status === "awaiting_funding" && <Waiting text="Waiting for the client to fund the escrow. Don't start work until it's funded." />}
          {role === "freelancer" && job.status === "funded" && <SubmitDeliverable detail={detail} />}
          {role === "client" && job.status === "funded" && (
            <Card>
              <CardHeader>
                <CardTitle>Escrow funded</CardTitle>
                <CardDescription>The freelancer can now submit. You'll see the AI verdict and reasoning here.</CardDescription>
              </CardHeader>
              <CardContent>
                <NonDeliveryDispute detail={detail} />
              </CardContent>
            </Card>
          )}
          {job.status === "submitted" && <VerificationStatus detail={detail} />}
          {role === "client" && ["open", "pending_acceptance", "awaiting_funding"].includes(job.status) && <CancelJob detail={detail} />}

          {/* --- Outcome banners --- */}
          {job.status === "released" && (
            <Alert className="border-brand-teal/40">
              <Scale className="h-4 w-4 text-brand-teal" />
              <AlertTitle>Escrow released to the freelancer</AlertTitle>
              <AlertDescription>
                The AI verified every acceptance criterion at or above the confidence threshold. <TxLink hash={job.lastChainAction?.txHash} label="release transaction" />
              </AlertDescription>
            </Alert>
          )}
          {job.status === "disputed" && job.dispute && (
            <Alert className="border-brand-orange/50">
              <AlertTriangle className="h-4 w-4 text-brand-orange" />
              <AlertTitle>In dispute — awaiting admin resolution</AlertTitle>
              <AlertDescription>
                <p>
                  {job.dispute.source === "ai" ? "The AI check did not meet the release rule: " : `Opened by ${job.dispute.source}: `}
                  {job.dispute.reason}
                </p>
                {job.dispute.source === "ai" && <p className="mt-1">The full AI reasoning and unmatched criteria are shown below.</p>}
              </AlertDescription>
            </Alert>
          )}
          {job.resolution && (
            <Alert className={job.resolution.outcome === "release" ? "border-brand-teal/40" : ""}>
              <Gavel className="h-4 w-4" />
              <AlertTitle>Dispute resolved: {job.resolution.outcome === "release" ? "paid to the freelancer" : "refunded to the client"}</AlertTitle>
              <AlertDescription>
                <p className="whitespace-pre-wrap">{job.resolution.notes}</p>
                <p className="mt-1 text-xs">
                  {fmtDate(job.resolution.at)} · <TxLink hash={job.resolution.txHash} label="resolution transaction" />
                </p>
              </AlertDescription>
            </Alert>
          )}

          {current && job.status !== "submitted" && (
            <Card>
              <CardHeader>
                <CardTitle>Latest AI verdict</CardTitle>
              </CardHeader>
              <CardContent>
                <VerdictCard v={current} current />
              </CardContent>
            </Card>
          )}

          <TermsCard job={job} />
          <SubmissionsCard submissions={detail.submissions} verifications={detail.verifications} currentId={job.currentSubmissionId} />

          {/* --- Complaints & reviews --- */}
          {COMPLAINABLE.includes(job.status) && (
            <Card>
              <CardHeader>
                <CardTitle>Feedback</CardTitle>
                <CardDescription>Reviews are visible to both parties. Complaints go privately to Yorse admins.</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue={TERMINAL.includes(job.status) ? "review" : "complaint"}>
                  <TabsList>
                    <TabsTrigger value="review">Reviews ({detail.reviews.length})</TabsTrigger>
                    <TabsTrigger value="complaint">My complaints ({detail.complaints.length})</TabsTrigger>
                  </TabsList>
                  <TabsContent value="review" className="space-y-3 pt-3">
                    {detail.reviews.map((r) => (
                      <ReviewItem key={r.id} r={r} />
                    ))}
                    {TERMINAL.includes(job.status) ? (
                      !myReview && <ReviewForm detail={detail} counterpart={counterpart} />
                    ) : (
                      <p className="text-sm text-muted-foreground">Reviews open once the job is completed.</p>
                    )}
                  </TabsContent>
                  <TabsContent value="complaint" className="space-y-3 pt-3">
                    {detail.complaints.map((c) => (
                      <ComplaintItem key={c.id} c={c} />
                    ))}
                    <ComplaintForm detail={detail} />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="space-y-6">
          {detail.client && (
            <Card className="gap-3">
              <CardHeader>
                <CardTitle className="text-sm">Posted by</CardTitle>
              </CardHeader>
              <CardContent>
                <UserChip user={detail.client} role="client" />
              </CardContent>
            </Card>
          )}
          {role && <OnchainCard detail={detail} />}
          {role && <Timeline events={detail.events} />}
        </aside>
      </div>
    </div>
  )
}

/** What someone browsing the feed sees on an open listing. */
function VisitorApply({ detail }: { detail: JobDetail }) {
  const { job } = detail
  const mine = detail.myApplication
  const item: FeedItem = {
    id: job.id,
    title: job.title,
    deliverableDescription: job.deliverableDescription,
    acceptanceCriteriaCount: job.acceptanceCriteria.length,
    amountUsdc: job.amountUsdc,
    dueDate: job.dueDate,
    createdAt: job.createdAt,
    applicationCount: job.applicationCount,
    client: detail.client!,
    myApplicationStatus: mine?.status ?? null,
    isMine: false,
  }
  const applied = mine && mine.status !== "withdrawn"
  return (
    <Card className="border-brand-teal/30">
      <CardHeader>
        <CardTitle>{applied ? "You applied to this job" : "Open to applications"}</CardTitle>
        <CardDescription>
          {applied
            ? "The employer decides who to hire. If they pick you, you'll accept the terms and they'll fund the escrow."
            : `${job.applicationCount} developer${job.applicationCount === 1 ? " has" : "s have"} applied so far. Your application is visible only to the employer.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        {applied ? (
          <>
            <Badge variant="outline" className="border-brand-teal/40 text-brand-teal">
              {mine!.status}
            </Badge>
            <p className="text-sm text-muted-foreground">Applied {fmtDate(mine!.createdAt)}</p>
          </>
        ) : (
          <ApplyDialog item={item} />
        )}
      </CardContent>
    </Card>
  )
}

function Waiting({ text }: { text: string }) {
  return (
    <Alert>
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  )
}
