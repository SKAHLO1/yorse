"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useEffect, useState } from "react"
import { isAddressEqual } from "viem"
import { useConnection } from "wagmi"
import { ArrowRight, Briefcase, Check, Copy, HardHat, Link2, Plus, Wallet } from "lucide-react"
import { AppShell } from "@/components/app/app-shell"
import { LiveFeed } from "@/components/app/feed"
import { StatusBadge } from "@/components/app/status-badge"
import { LinkWalletButton } from "@/components/app/wallet-button"
import { useAuth } from "@/components/auth-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { api, errorText } from "@/lib/api"
import { TERMINAL, type Job } from "@/lib/types"
import { cn } from "@/lib/utils"
import { shortAddr } from "@/lib/web3"

/** Which side of the marketplace the dashboard is showing. Anyone can be both; this only changes the view. */
type Mode = "hiring" | "working"
const MODE_KEY = "yorse:dashboard-mode"

export default function DashboardPage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  )
}

function Dashboard() {
  const { me } = useAuth()
  const [mode, setMode] = useState<Mode>("hiring")
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api<{ jobs: Job[] }>("/jobs").then((r) => r.jobs), enabled: !!me })

  const asClient = (jobs.data ?? []).filter((j) => j.clientUid === me?.uid)
  const asFreelancer = (jobs.data ?? []).filter((j) => j.freelancerUid === me?.uid)

  // Restore the last view; first-time users land on whichever side they already have jobs on.
  useEffect(() => {
    const saved = typeof window !== "undefined" ? (localStorage.getItem(MODE_KEY) as Mode | null) : null
    if (saved === "hiring" || saved === "working") setMode(saved)
    else if (jobs.data) setMode(asFreelancer.length > asClient.length ? "working" : "hiring")
  }, [jobs.data])

  function choose(next: Mode) {
    setMode(next)
    try {
      localStorage.setItem(MODE_KEY, next)
    } catch {
      // private browsing: the switch still works for this session
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ModeSwitch mode={mode} onChange={choose} hiringCount={asClient.length} workingCount={asFreelancer.length} />
        {mode === "hiring" && (
          <Button asChild>
            <Link href="/jobs/new">
              <Plus className="size-4" /> New job
            </Link>
          </Button>
        )}
      </div>

      <WalletCard />

      {jobs.error && (
        <Alert variant="destructive">
          <AlertTitle>Could not load jobs</AlertTitle>
          <AlertDescription>{errorText(jobs.error)}</AlertDescription>
        </Alert>
      )}

      {mode === "hiring" ? (
        <HiringDashboard jobs={asClient} loading={jobs.isLoading} />
      ) : (
        <WorkingDashboard jobs={asFreelancer} loading={jobs.isLoading} />
      )}

      <LiveFeed limit={6} />
    </div>
  )
}

function ModeSwitch({ mode, onChange, hiringCount, workingCount }: { mode: Mode; onChange: (m: Mode) => void; hiringCount: number; workingCount: number }) {
  const options: { id: Mode; label: string; sub: string; icon: typeof Briefcase; count: number }[] = [
    { id: "hiring", label: "Hiring", sub: "Jobs you pay for", icon: Briefcase, count: hiringCount },
    { id: "working", label: "Working", sub: "Jobs you deliver", icon: HardHat, count: workingCount },
  ]
  return (
    <div role="tablist" aria-label="Dashboard view" className="inline-flex rounded-xl border border-border bg-card p-1">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={mode === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-3.5 py-2 text-left transition-colors",
            mode === o.id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <o.icon className={cn("size-4", mode === o.id && "text-brand-teal")} />
          <span>
            <span className="block text-sm font-medium leading-tight">
              {o.label} {o.count > 0 && <span className="text-muted-foreground">({o.count})</span>}
            </span>
            <span className="block text-xs text-muted-foreground">{o.sub}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

function HiringDashboard({ jobs, loading }: { jobs: Job[]; loading: boolean }) {
  const escrowed = jobs.filter((j) => ["funded", "submitted", "disputed"].includes(j.status)).reduce((s, j) => s + Number(j.amountUsdc), 0)
  const toFund = jobs.filter((j) => j.status === "awaiting_funding").length
  const open = jobs.filter((j) => !["declined", "cancelled", ...TERMINAL].includes(j.status)).length

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Waiting for your funding" value={loading ? "…" : String(toFund)} highlight={toFund > 0} />
        <Stat label="Open jobs" value={loading ? "…" : String(open)} />
        <Stat label="USDC in escrow" value={loading ? "…" : escrowed.toFixed(2)} />
      </div>
      <JobList
        jobs={jobs}
        loading={loading}
        side="hiring"
        empty={{
          title: "You haven't hired anyone yet",
          body: "Create a job with the terms and acceptance criteria, then fund the escrow in USDC. The developer needs a Yorse account with a linked wallet before you can create it.",
          cta: { href: "/jobs/new", label: "Create your first job" },
        }}
      />
    </div>
  )
}

function WorkingDashboard({ jobs, loading }: { jobs: Job[]; loading: boolean }) {
  const invites = jobs.filter((j) => j.status === "pending_acceptance").length
  const toSubmit = jobs.filter((j) => j.status === "funded").length
  const earned = jobs.filter((j) => j.status === "released" || j.status === "resolved_release").reduce((s, j) => s + Number(j.amountUsdc), 0)

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Offers to review" value={loading ? "…" : String(invites)} highlight={invites > 0} />
        <Stat label="Funded, awaiting your work" value={loading ? "…" : String(toSubmit)} highlight={toSubmit > 0} />
        <Stat label="USDC earned" value={loading ? "…" : earned.toFixed(2)} />
      </div>
      <GetHiredCard />
      <JobList
        jobs={jobs}
        loading={loading}
        side="working"
        empty={{
          title: "No one has hired you yet",
          body: "Clients invite you by your Yorse email address. Share it with them, and make sure your wallet is linked so they can create the job.",
        }}
      />
    </div>
  )
}

/** What a developer needs to hand a client so they can be hired. */
function GetHiredCard() {
  const { me } = useAuth()
  const [copied, setCopied] = useState(false)
  if (!me) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Getting hired</CardTitle>
        <CardDescription>A client creates the job using your email. You then accept the terms before they fund the escrow.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <code className="rounded-md bg-muted px-2.5 py-1.5 text-sm">{me.email}</code>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            navigator.clipboard?.writeText(me.email).then(
              () => {
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              },
              () => undefined,
            )
          }}
        >
          {copied ? <Check className="size-4 text-brand-teal" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy email"}
        </Button>
        <span className={cn("text-xs", me.walletAddress ? "text-muted-foreground" : "text-brand-orange")}>
          {me.walletAddress ? `Wallet linked · ${shortAddr(me.walletAddress)}` : "Link a wallet before a client can hire you"}
        </span>
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={cn("mt-1 font-brand text-2xl font-bold", highlight && "text-brand-teal")}>{value}</div>
      </CardContent>
    </Card>
  )
}

function WalletCard() {
  const { me } = useAuth()
  const { address, isConnected } = useConnection()
  if (!me) return null
  if (me.walletAddress && (!address || isAddressEqual(me.walletAddress, address))) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Wallet className="size-4 text-brand-teal" /> Linked wallet <span className="font-mono text-foreground">{shortAddr(me.walletAddress)}</span>
        {!isConnected && <span>· connect it to fund jobs</span>}
      </p>
    )
  }
  return (
    <Alert className="border-brand-orange/40">
      <Link2 className="h-4 w-4 text-brand-orange" />
      <AlertTitle>{me.walletAddress ? "Connected wallet differs from your linked wallet" : "Link a wallet to start"}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          {me.walletAddress
            ? `Your account is linked to ${shortAddr(me.walletAddress)}. Switch to it in your wallet, or link the connected one instead.`
            : "Clients fund escrow from their linked wallet; developers are paid to theirs. Linking only asks you to sign a message — no transaction, no gas."}
        </p>
        <LinkWalletButton />
      </AlertDescription>
    </Alert>
  )
}

function JobList({
  jobs,
  loading,
  side,
  empty,
}: {
  jobs: Job[]
  loading: boolean
  side: Mode
  empty: { title: string; body: string; cta?: { href: string; label: string } }
}) {
  if (loading) return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
  if (!jobs.length) {
    return (
      <Card className="border-dashed">
        <CardHeader className="items-center text-center">
          <CardTitle className="text-base">{empty.title}</CardTitle>
          <CardDescription className="max-w-md">{empty.body}</CardDescription>
          {empty.cta && (
            <Button asChild className="mt-2">
              <Link href={empty.cta.href}>
                <Plus className="size-4" /> {empty.cta.label}
              </Link>
            </Button>
          )}
        </CardHeader>
      </Card>
    )
  }
  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
      {jobs.map((j) => (
        <Link key={j.id} href={`/jobs/${j.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-card px-4 py-3 transition-colors hover:bg-accent/40">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{j.title}</div>
            <div className="text-xs text-muted-foreground">
              {side === "hiring"
                ? j.freelancerEmail
                  ? `Developer: ${j.freelancerEmail}`
                  : `Open listing · ${j.applicationCount} applied`
                : `Client: ${j.clientEmail}`}{" "}
              · due {new Date(j.dueDate).toLocaleDateString()}
            </div>
          </div>
          <div className="font-mono text-sm">{j.amountUsdc} USDC</div>
          <StatusBadge status={j.status} />
          <ArrowRight className="size-4 text-muted-foreground" />
        </Link>
      ))}
    </div>
  )
}
