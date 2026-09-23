"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"
import { AlertTriangle, ArrowRight } from "lucide-react"
import { AppShell } from "@/components/app/app-shell"
import { ComplaintItem, fmtDate, ReviewItem } from "@/components/app/job-parts"
import { ComplaintModeration, ReviewModeration } from "@/components/app/moderation"
import { StatusBadge, statusLabel } from "@/components/app/status-badge"
import { useAuth } from "@/components/auth-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api, errorText } from "@/lib/api"
import type { Complaint, Job, JobStatus, Review } from "@/lib/types"

const ALL_STATUSES: JobStatus[] = ["open", "pending_acceptance", "awaiting_funding", "funded", "submitted", "disputed", "released", "resolved_release", "resolved_refund", "declined", "cancelled"]

export default function AdminPage() {
  return (
    <AppShell adminOnly>
      <Admin />
    </AppShell>
  )
}

function Admin() {
  const { me } = useAuth()
  const enabled = !!me?.admin
  const overview = useQuery({ queryKey: ["admin", "overview"], queryFn: () => api("/admin/overview"), enabled })
  const disputed = useQuery({ queryKey: ["admin", "jobs", "disputed"], queryFn: () => api<{ jobs: Job[] }>("/admin/jobs?status=disputed").then((r) => r.jobs), enabled })
  const o = overview.data

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-brand text-2xl font-bold">Admin</h1>
        <p className="text-sm text-muted-foreground">Resolve disputes, inspect job histories, and moderate complaints and reviews.</p>
      </div>
      {overview.error && <ErrorAlert error={overview.error} />}

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Disputes to resolve" value={o?.jobs.byStatus.disputed ?? 0} loading={overview.isLoading} tone="orange" />
        <Stat label="Open complaints" value={o?.complaints.open ?? 0} loading={overview.isLoading} tone="orange" />
        <Stat label="Need attention" value={o?.attention.length ?? 0} loading={overview.isLoading} />
        <Stat label="Total jobs" value={o?.jobs.total ?? 0} loading={overview.isLoading} />
      </div>

      {o?.attention.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Jobs stuck in verification</AlertTitle>
          <AlertDescription>
            AI or chain step failed. Open to retry or move to dispute:{" "}
            {o.attention.map((id: string) => (
              <Link key={id} href={`/admin/jobs/${id}`} className="mr-2 font-mono underline">
                {id.slice(0, 8)}
              </Link>
            ))}
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="disputes">
        <TabsList className="flex-wrap">
          <TabsTrigger value="disputes">Disputes ({disputed.data?.length ?? "…"})</TabsTrigger>
          <TabsTrigger value="jobs">All jobs</TabsTrigger>
          <TabsTrigger value="complaints">Complaints</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
        </TabsList>
        <TabsContent value="disputes" className="pt-3">
          <Disputes jobs={disputed.data} loading={disputed.isLoading} error={disputed.error} />
        </TabsContent>
        <TabsContent value="jobs" className="pt-3">
          <AllJobs enabled={enabled} />
        </TabsContent>
        <TabsContent value="complaints" className="pt-3">
          <Complaints enabled={enabled} />
        </TabsContent>
        <TabsContent value="reviews" className="pt-3">
          <Reviews enabled={enabled} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Stat({ label, value, loading, tone }: { label: string; value: number; loading: boolean; tone?: "orange" }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`mt-1 font-brand text-2xl font-bold ${tone === "orange" && value > 0 ? "text-brand-orange" : ""}`}>{loading ? "…" : value}</div>
      </CardContent>
    </Card>
  )
}

function ErrorAlert({ error }: { error: unknown }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription>{errorText(error)}</AlertDescription>
    </Alert>
  )
}

function Disputes({ jobs, loading, error }: { jobs?: Job[]; loading: boolean; error: unknown }) {
  if (error) return <ErrorAlert error={error} />
  if (loading) return <Skeleton className="h-40 w-full" />
  if (!jobs?.length) return <Empty text="No open disputes." />
  return (
    <div className="space-y-3">
      {jobs.map((j) => (
        <Link key={j.id} href={`/admin/jobs/${j.id}`} className="block rounded-xl border border-brand-orange/30 bg-card p-4 transition-colors hover:bg-accent/40">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium">{j.title}</span>
            <span className="font-mono text-sm">{j.amountUsdc} USDC</span>
            <span className="text-xs text-muted-foreground">
              {j.clientEmail} → {j.freelancerEmail}
            </span>
            <span className="ml-auto flex items-center gap-1 text-sm text-brand-teal">
              Review & resolve <ArrowRight className="size-4" />
            </span>
          </div>
          {j.dispute && (
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="text-foreground">{j.dispute.source === "ai" ? "AI" : j.dispute.source}:</span> {j.dispute.reason}
              <span className="ml-2 text-xs">· {fmtDate(j.dispute.at)}</span>
            </p>
          )}
        </Link>
      ))}
    </div>
  )
}

function AllJobs({ enabled }: { enabled: boolean }) {
  const [status, setStatus] = useState<string>("all")
  const q = useQuery({
    queryKey: ["admin", "jobs", status],
    queryFn: () => api<{ jobs: Job[] }>(`/admin/jobs${status === "all" ? "" : `?status=${status}`}`).then((r) => r.jobs),
    enabled,
  })
  return (
    <div className="space-y-3">
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {ALL_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {statusLabel(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {q.error ? (
        <ErrorAlert error={q.error} />
      ) : q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !q.data?.length ? (
        <Empty text="No jobs match." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead className="hidden md:table-cell">Parties</TableHead>
                <TableHead className="text-right">USDC</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.map((j) => (
                <TableRow key={j.id}>
                  <TableCell className="max-w-56">
                    <Link href={`/admin/jobs/${j.id}`} className="block truncate font-medium hover:underline">
                      {j.title}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    {j.clientEmail}
                    <br />→ {j.freelancerEmail}
                  </TableCell>
                  <TableCell className="text-right font-mono">{j.amountUsdc}</TableCell>
                  <TableCell>
                    <StatusBadge status={j.status} />
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{fmtDate(j.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function Complaints({ enabled }: { enabled: boolean }) {
  const [status, setStatus] = useState("open")
  const q = useQuery({
    queryKey: ["admin", "complaints", status],
    queryFn: () => api<{ complaints: Complaint[] }>(`/admin/complaints${status === "all" ? "" : `?status=${status}`}`).then((r) => r.complaints),
    enabled,
  })
  return (
    <div className="space-y-3">
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All complaints</SelectItem>
          <SelectItem value="open">Open</SelectItem>
          <SelectItem value="under_review">Under review</SelectItem>
          <SelectItem value="resolved">Resolved</SelectItem>
          <SelectItem value="dismissed">Dismissed</SelectItem>
        </SelectContent>
      </Select>
      {q.error ? (
        <ErrorAlert error={q.error} />
      ) : q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !q.data?.length ? (
        <Empty text="No complaints here." />
      ) : (
        q.data.map((c) => (
          <ComplaintItem key={c.id} c={c}>
            <Link href={`/admin/jobs/${c.jobId}`} className="mt-2 inline-block text-xs text-brand-teal hover:underline">
              Job: {c.jobTitle} →
            </Link>
            <ComplaintModeration c={c} />
          </ComplaintItem>
        ))
      )}
    </div>
  )
}

function Reviews({ enabled }: { enabled: boolean }) {
  const [status, setStatus] = useState("all")
  const q = useQuery({
    queryKey: ["admin", "reviews", status],
    queryFn: () => api<{ reviews: Review[] }>(`/admin/reviews${status === "all" ? "" : `?status=${status}`}`).then((r) => r.reviews),
    enabled,
  })
  return (
    <div className="space-y-3">
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All reviews</SelectItem>
          <SelectItem value="published">Published</SelectItem>
          <SelectItem value="hidden">Hidden</SelectItem>
        </SelectContent>
      </Select>
      {q.error ? (
        <ErrorAlert error={q.error} />
      ) : q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !q.data?.length ? (
        <Empty text="No reviews here." />
      ) : (
        q.data.map((r) => (
          <ReviewItem key={r.id} r={r}>
            <Link href={`/admin/jobs/${r.jobId}`} className="mt-2 inline-block text-xs text-brand-teal hover:underline">
              Job: {r.jobTitle} →
            </Link>
            <ReviewModeration r={r} />
          </ReviewItem>
        ))
      )}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <Card className="border-dashed">
      <CardHeader className="text-center">
        <CardDescription>{text}</CardDescription>
      </CardHeader>
    </Card>
  )
}
