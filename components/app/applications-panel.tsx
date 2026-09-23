"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { AlertTriangle, ExternalLink, Users } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { api, errorText } from "@/lib/api"
import type { Application, JobDetail } from "@/lib/types"
import { cn } from "@/lib/utils"
import { fmtDate } from "./job-parts"
import { UserChip } from "./user-bits"

const STATUS_STYLE: Record<Application["status"], string> = {
  pending: "",
  selected: "border-brand-teal/40 text-brand-teal",
  rejected: "text-muted-foreground",
  withdrawn: "text-muted-foreground",
}

/** Client-side view of who applied to a public job, with the choice of who to hire. */
export function ApplicationsPanel({ detail }: { detail: JobDetail }) {
  const jobId = detail.job.id
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const apps = useQuery({
    queryKey: ["job", jobId, "applications"],
    queryFn: () => api<{ applications: Application[] }>(`/jobs/${jobId}/applications`).then((r) => r.applications),
  })

  const select = useMutation({
    mutationFn: (applicationId: string) => api(`/jobs/${jobId}/applications/${applicationId}/select`, { body: {} }),
    onSuccess: async () => {
      toast.success("Developer selected. They now accept the terms, then you fund the escrow.")
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["job", jobId] }),
        qc.invalidateQueries({ queryKey: ["jobs"] }),
        qc.invalidateQueries({ queryKey: ["feed"] }),
      ])
    },
    onError: (e) => setError(errorText(e)),
  })

  const open = detail.job.status === "open"
  const list = apps.data ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4 text-brand-teal" /> Applications ({list.length})
        </CardTitle>
        <CardDescription>
          {open ? "Pick one developer. The others are told the job is taken, and the listing leaves the feed." : "This job is no longer open to applications."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {apps.isLoading && <Skeleton className="h-24 w-full" />}
        {apps.error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{errorText(apps.error)}</AlertDescription>
          </Alert>
        )}
        {!apps.isLoading && !list.length && <p className="text-sm text-muted-foreground">No applications yet. Your listing is live in the feed.</p>}
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="break-words">{error}</AlertDescription>
          </Alert>
        )}
        {list.map((a) => (
          <div key={a.id} className={cn("rounded-lg border border-border p-4", a.status === "selected" && "border-brand-teal/40 bg-brand-teal/5")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              {a.applicant ? <UserChip user={a.applicant} /> : <span className="text-sm">{a.applicantEmail}</span>}
              <div className="flex items-center gap-2">
                {a.status !== "pending" && (
                  <Badge variant="outline" className={STATUS_STYLE[a.status]}>
                    {a.status}
                  </Badge>
                )}
                {open && a.status === "pending" && (
                  <Button size="sm" disabled={select.isPending} onClick={() => select.mutate(a.id)}>
                    {select.isPending ? "Selecting…" : "Select"}
                  </Button>
                )}
              </div>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm">{a.message}</p>
            {a.portfolioUrl && (
              <a href={a.portfolioUrl} target="_blank" rel="noreferrer noopener" className="mt-2 inline-flex items-center gap-1 break-all text-xs text-brand-teal hover:underline">
                {a.portfolioUrl} <ExternalLink className="size-3" />
              </a>
            )}
            <p className="mt-2 text-xs text-muted-foreground">Applied {fmtDate(a.createdAt)}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
