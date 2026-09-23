"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"
import { CalendarDays, CheckCircle2, ListChecks, Radio, Users } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/components/auth-provider"
import { api, errorText } from "@/lib/api"
import type { FeedItem } from "@/lib/types"
import { cn } from "@/lib/utils"
import { UserChip } from "./user-bits"

const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`
  return `${Math.round(mins / 1440)}d ago`
}

export function useFeed(limit = 20) {
  const { me } = useAuth()
  return useQuery({
    queryKey: ["feed", limit],
    queryFn: () => api<{ feed: FeedItem[] }>(`/feed?limit=${limit}`).then((r) => r.feed),
    enabled: !!me,
    refetchInterval: 30_000, // keep the feed live without hammering the backend
  })
}

/** Homepage live feed of recently posted public jobs. */
export function LiveFeed({ limit = 6, showAllLink = true }: { limit?: number; showAllLink?: boolean }) {
  const feed = useFeed(limit)
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-brand text-lg font-bold">
            <Radio className="size-4 text-brand-teal" /> Recently posted
          </h2>
          <p className="text-sm text-muted-foreground">Open jobs from employers across Yorse. Apply to any that fit.</p>
        </div>
        {showAllLink && (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/feed">Browse all</Link>
          </Button>
        )}
      </div>

      {feed.error && (
        <Alert variant="destructive">
          <AlertTitle>Could not load the feed</AlertTitle>
          <AlertDescription>{errorText(feed.error)}</AlertDescription>
        </Alert>
      )}
      {feed.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      ) : !feed.data?.length ? (
        <Card className="border-dashed">
          <CardHeader className="items-center text-center">
            <CardTitle className="text-base">No open jobs right now</CardTitle>
            <CardDescription>When an employer lists a job publicly it shows up here for everyone.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {feed.data.map((item) => (
            <FeedCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  )
}

export function FeedCard({ item }: { item: FeedItem }) {
  const applied = item.myApplicationStatus === "pending" || item.myApplicationStatus === "selected"
  return (
    <Card className="gap-3">
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <UserChip user={item.client} role="client" />
          <span className="whitespace-nowrap text-xs text-muted-foreground">{ago(item.createdAt)}</span>
        </div>
        <div>
          <Link href={`/jobs/${item.id}`} className="font-medium hover:underline">
            {item.title}
          </Link>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.deliverableDescription}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="font-mono text-sm text-foreground">{item.amountUsdc} USDC</span>
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="size-3.5" /> due {new Date(item.dueDate).toLocaleDateString()}
          </span>
          <span className="inline-flex items-center gap-1">
            <ListChecks className="size-3.5" /> {item.acceptanceCriteriaCount} criteria
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" /> {item.applicationCount} applied
          </span>
        </div>
        <div className="flex items-center gap-2">
          {item.isMine ? (
            <Badge variant="outline">Your listing</Badge>
          ) : applied ? (
            <Badge variant="outline" className="border-brand-teal/40 text-brand-teal">
              <CheckCircle2 className="size-3.5" /> {item.myApplicationStatus === "selected" ? "You were selected" : "Applied"}
            </Badge>
          ) : (
            <ApplyDialog item={item} />
          )}
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/jobs/${item.id}`}>View details</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function ApplyDialog({ item, className }: { item: FeedItem; className?: string }) {
  const qc = useQueryClient()
  const { me } = useAuth()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState("")
  const [portfolioUrl, setPortfolio] = useState("")
  const [error, setError] = useState<string | null>(null)

  const apply = useMutation({
    mutationFn: () => api(`/jobs/${item.id}/applications`, { body: { message, portfolioUrl: portfolioUrl || null } }),
    onSuccess: async () => {
      toast.success("Application sent. The employer will see it on their job.")
      setOpen(false)
      setMessage("")
      await Promise.all([qc.invalidateQueries({ queryKey: ["feed"] }), qc.invalidateQueries({ queryKey: ["job", item.id] })])
    },
    onError: (e) => setError(errorText(e)),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className={className}>
          Apply
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply to “{item.title}”</DialogTitle>
          <DialogDescription>
            {item.amountUsdc} USDC · due {new Date(item.dueDate).toLocaleDateString()}. Only the employer sees your application.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            setError(null)
            apply.mutate()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="msg">Why you're a fit</Label>
            <Textarea id="msg" required minLength={20} maxLength={2000} rows={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Relevant experience, how you'd approach the acceptance criteria, and when you can start." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pf">Portfolio link (optional)</Label>
            <Input id="pf" type="url" value={portfolioUrl} onChange={(e) => setPortfolio(e.target.value)} placeholder="https://github.com/you" />
          </div>
          {!me?.walletAddress && (
            <Alert className="border-brand-orange/40">
              <AlertDescription>Link a wallet first — employers can only hire a linked wallet.</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription className={cn("break-words")}>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="submit" disabled={apply.isPending || message.trim().length < 20}>
              {apply.isPending ? "Sending…" : "Send application"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
