"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useParams } from "next/navigation"
import { AlertTriangle, ArrowLeft, BriefcaseBusiness, CheckCircle2, Wallet } from "lucide-react"
import { AppShell } from "@/components/app/app-shell"
import { fmtDate } from "@/components/app/job-parts"
import { Rating, Stars, UserAvatar, UserChip } from "@/components/app/user-bits"
import { useAuth } from "@/components/auth-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api, errorText } from "@/lib/api"
import type { ProfileReview, PublicProfile } from "@/lib/types"

export default function ProfilePage() {
  return (
    <AppShell>
      <Profile />
    </AppShell>
  )
}

function Profile() {
  const { uid } = useParams<{ uid: string }>()
  const { me } = useAuth()
  const q = useQuery({ queryKey: ["profile", uid], queryFn: () => api<PublicProfile>(`/users/${uid}`), enabled: !!me })

  if (q.isLoading) return <Skeleton className="h-96 w-full" />
  if (q.error)
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Could not load this profile</AlertTitle>
        <AlertDescription>{errorText(q.error)}</AlertDescription>
      </Alert>
    )

  const { user, stats, reviews } = q.data!
  const asDeveloper = reviews.filter((r) => r.reviewerRole === "client")
  const asEmployer = reviews.filter((r) => r.reviewerRole === "freelancer")

  return (
    <div className="space-y-6">
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Dashboard
      </Link>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-5 pt-6">
          <UserAvatar user={user} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="font-brand text-2xl font-bold">
              {user.displayName}
              {me?.uid === user.uid && <span className="ml-2 text-sm font-normal text-muted-foreground">(you)</span>}
            </h1>
            <p className="text-sm text-muted-foreground">Member since {new Date(user.memberSince).toLocaleDateString()}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                As developer <Rating summary={user.ratingAsFreelancer} label="reviews" />
              </span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                As employer <Rating summary={user.ratingAsClient} label="reviews" />
              </span>
            </div>
          </div>
          <dl className="flex gap-6 text-sm">
            <Stat icon={<BriefcaseBusiness className="size-4 text-muted-foreground" />} label="Delivered" value={stats.completedAsFreelancer} />
            <Stat icon={<CheckCircle2 className="size-4 text-muted-foreground" />} label="Hired" value={stats.completedAsClient} />
            <Stat icon={<Wallet className="size-4 text-muted-foreground" />} label="Wallet" value={stats.hasLinkedWallet ? "Linked" : "None"} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reviews ({reviews.length})</CardTitle>
          <CardDescription>Left by the other party on completed jobs. Ratings come only from these reviews.</CardDescription>
        </CardHeader>
        <CardContent>
          {reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reviews yet. Reviews appear once a job is paid out or refunded.</p>
          ) : (
            <Tabs defaultValue="dev">
              <TabsList>
                <TabsTrigger value="dev">As developer ({asDeveloper.length})</TabsTrigger>
                <TabsTrigger value="emp">As employer ({asEmployer.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="dev" className="space-y-3 pt-3">
                {asDeveloper.length ? asDeveloper.map((r) => <ReviewRow key={r.id} r={r} />) : <Empty />}
              </TabsContent>
              <TabsContent value="emp" className="space-y-3 pt-3">
                {asEmployer.length ? asEmployer.map((r) => <ReviewRow key={r.id} r={r} />) : <Empty />}
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon} {label}
      </dt>
      <dd className="mt-0.5 font-brand text-xl font-bold">{value}</dd>
    </div>
  )
}

function Empty() {
  return <p className="text-sm text-muted-foreground">Nothing here yet.</p>
}

function ReviewRow({ r }: { r: ProfileReview }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <UserChip user={r.reviewer} role={r.reviewerRole === "client" ? "client" : "freelancer"} size="sm" showRating={false} />
        <div className="flex items-center gap-3">
          <Stars n={r.rating} />
          <span className="text-xs text-muted-foreground">{fmtDate(r.createdAt)}</span>
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm">{r.comment}</p>
      <p className="mt-1 text-xs text-muted-foreground">on “{r.jobTitle}”</p>
    </div>
  )
}
