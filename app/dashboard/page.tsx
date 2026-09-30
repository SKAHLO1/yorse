"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useEffect, useState } from "react"
import { isAddressEqual } from "viem"
import { useConnection } from "wagmi"
import { AlertTriangle, ArrowRight, Briefcase, Check, CheckCircle2, Copy, HardHat, Link2, Lock, Plus, ShieldCheck, Wallet } from "lucide-react"
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

  const hour = new Date().getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
  const firstName = (me?.displayName || me?.email?.split("@")[0] || "").split(" ")[0]

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-brand text-2xl font-bold sm:text-3xl">
            {greeting}
            {firstName && `, ${firstName}`} <span aria-hidden>👋</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Here&apos;s what&apos;s happening with your jobs.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ModeSwitch mode={mode} onChange={choose} hiringCount={asClient.length} workingCount={asFreelancer.length} />
          {mode === "hiring" && (
            <Button asChild className="h-11 rounded-xl px-5">
              <Link href="/jobs/new">
                <Plus className="size-4" /> New job
              </Link>
            </Button>
          )}
        </div>
      </div>

      <WalletCard />

      {jobs.error && (
        <Alert variant="destructive">
          <AlertTitle>Could not load jobs</AlertTitle>
          <AlertDescription>{errorText(jobs.error)}</AlertDescription>
        </Alert>
      )}

      {mode === "hiring" ? <HiringDashboard jobs={asClient} loading={jobs.isLoading} /> : <WorkingDashboard jobs={asFreelancer} loading={jobs.isLoading} />}

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
    <div role="tablist" aria-label="Dashboard view" className="inline-flex rounded-xl border border-border bg-card p-1 shadow-soft">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={mode === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-3.5 py-2 text-left transition-colors",
            mode === o.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <o.icon className={cn("size-4", mode === o.id && "text-emerald-300")} />
          <span>
            <span className="block text-sm font-medium leading-tight">
              {o.label} {o.count > 0 && <span className="opacity-70">({o.count})</span>}
            </span>
            <span className="block text-xs opacity-70">{o.sub}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

const LOCKED: Job["status"][] = ["funded", "submitted", "proposed", "challenged", "disputed"]
const sumUsdc = (js: Job[]) => js.reduce((s, j) => s + Number(j.amountUsdc), 0)
const fmtUsdc = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })

function HiringDashboard({ jobs, loading }: { jobs: Job[]; loading: boolean }) {
  const escrowed = sumUsdc(jobs.filter((j) => LOCKED.includes(j.status)))
  const toFund = jobs.filter((j) => j.status === "awaiting_funding").length
  const toReview = jobs.filter((j) => j.status === "proposed" && j.proposal?.outcome === "release").length
  const open = jobs.filter((j) => !["declined", "cancelled", ...TERMINAL].includes(j.status)).length
  const completed = jobs.filter((j) => TERMINAL.includes(j.status)).length
  const disputes = jobs.filter((j) => j.status === "disputed" || j.status === "challenged").length

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Briefcase} label="Active jobs" value={loading ? "…" : String(open)} sub={toFund ? `${toFund} waiting for your funding` : "All caught up"} subTone={toFund ? "warn" : "good"} />
        <Stat icon={Lock} label="Total escrowed" value={loading ? "…" : fmtUsdc(escrowed)} unit="USDC" sub="Locked until a verdict settles" />
        <Stat icon={CheckCircle2} label="Completed" value={loading ? "…" : String(completed)} sub="Released or refunded" subTone="good" />
        <Stat
          icon={AlertTriangle}
          label="Disputes"
          value={loading ? "…" : String(disputes)}
          sub={toReview ? `${toReview} AI proposal${toReview > 1 ? "s" : ""} to review` : disputes ? "Needs review" : "None open"}
          subTone={disputes || toReview ? "bad" : "good"}
          tone="warn"
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <JobList
          jobs={jobs}
          loading={loading}
          side="hiring"
          empty={{
            title: "You haven't hired anyone yet",
            body: "Create a job with the terms and acceptance criteria, then fund the escrow in USDC. List it publicly or invite a developer by email.",
            cta: { href: "/jobs/new", label: "Create your first job" },
          }}
        />
        <PromoCard />
      </div>
    </div>
  )
}

function WorkingDashboard({ jobs, loading }: { jobs: Job[]; loading: boolean }) {
  const invites = jobs.filter((j) => j.status === "pending_acceptance").length
  const toSubmit = jobs.filter((j) => j.status === "funded").length
  const pending = sumUsdc(jobs.filter((j) => LOCKED.includes(j.status)))
  const earned = sumUsdc(jobs.filter((j) => j.status === "released" || j.status === "resolved_release"))
  const contested = jobs.filter((j) => j.status === "challenged" || j.status === "disputed" || (j.status === "proposed" && j.proposal?.outcome === "refund")).length

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Briefcase} label="Offers to review" value={loading ? "…" : String(invites)} sub={invites ? "Accept or decline the terms" : "No pending offers"} subTone={invites ? "warn" : "good"} />
        <Stat
          icon={Lock}
          label="Pending to you"
          value={loading ? "…" : fmtUsdc(pending)}
          unit="USDC"
          sub={toSubmit ? `${toSubmit} funded, awaiting your work` : "In escrow for your jobs"}
          subTone={toSubmit ? "warn" : undefined}
        />
        <Stat icon={CheckCircle2} label="Earned" value={loading ? "…" : fmtUsdc(earned)} unit="USDC" sub="Released to your wallet" subTone="good" />
        <Stat icon={AlertTriangle} label="Contested" value={loading ? "…" : String(contested)} sub={contested ? "Needs your attention" : "None open"} subTone={contested ? "bad" : "good"} tone="warn" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <JobList
          jobs={jobs}
          loading={loading}
          side="working"
          empty={{
            title: "No one has hired you yet",
            body: "Apply to public jobs in the live feed below, or share your Yorse email so a client can invite you directly.",
          }}
        />
        <div className="space-y-6">
          <GetHiredCard />
          <PromoCard />
        </div>
      </div>
    </div>
  )
}

/** The dark brand card from the design: what Yorse guarantees, with a way to learn more. */
function PromoCard() {
  return (
    <div className="relative flex min-h-64 flex-col justify-end overflow-hidden rounded-2xl bg-yorse-forest p-5 text-white shadow-float">
      <div className="absolute right-5 top-5 flex size-20 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-300 to-emerald-600 shadow-lg shadow-emerald-950/40">
        <Wallet className="size-10 text-emerald-950/80" />
        <span className="absolute -right-2 -top-2 flex size-8 items-center justify-center rounded-full bg-emerald-400 ring-4 ring-[#0b2e22]">
          <ShieldCheck className="size-4 text-emerald-950" />
        </span>
      </div>
      <h3 className="font-brand text-lg font-bold leading-snug">
        Secure. Transparent.
        <br />
        Onchain.
      </h3>
      <p className="mt-2 text-xs leading-relaxed text-emerald-100/75">
        Every verdict is hashed on-chain before money moves. Either side can challenge it, and an AI jury rehears the case.
      </p>
      <Link href="/#how" className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-brand-forest hover:bg-emerald-50">
        Learn more <ArrowRight className="size-3.5" />
      </Link>
    </div>
  )
}

/** What a developer needs to hand a client so they can be hired. */
function GetHiredCard() {
  const { me } = useAuth()
  const [copied, setCopied] = useState(false)
  if (!me) return null
  return (
    <Card className="shadow-soft">
      <CardHeader>
        <CardTitle className="text-base">Getting hired</CardTitle>
        <CardDescription>Apply to public jobs, or give a client your email so they can invite you. You accept the terms before they fund the escrow.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <code className="max-w-full truncate rounded-md bg-muted px-2.5 py-1.5 text-sm">{me.email}</code>
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
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className={cn("text-xs", me.walletAddress ? "text-muted-foreground" : "text-brand-orange")}>
          {me.walletAddress ? `Wallet linked · ${shortAddr(me.walletAddress)}` : "Link a wallet before a client can hire you"}
        </p>
      </CardContent>
    </Card>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  unit,
  sub,
  subTone,
  tone,
}: {
  icon: typeof Briefcase
  label: string
  value: string
  unit?: string
  sub?: string
  subTone?: "good" | "warn" | "bad"
  tone?: "warn"
}) {
  return (
    <Card className="gap-0 py-5 shadow-soft">
      <CardContent className="px-5">
        <div className="flex items-center gap-2.5">
          <span className={cn("flex size-8 items-center justify-center rounded-lg", tone === "warn" ? "bg-orange-50 text-orange-600" : "bg-accent text-brand-forest")}>
            <Icon className="size-4" />
          </span>
          <span className="text-sm text-muted-foreground">{label}</span>
        </div>
        <div className="mt-4 font-brand text-3xl font-bold tracking-tight">
          {value}
          {unit && <span className="ml-1.5 text-base font-semibold">{unit}</span>}
        </div>
        {sub && (
          <div className={cn("mt-1 text-xs", subTone === "good" ? "text-emerald-600" : subTone === "warn" ? "text-amber-600" : subTone === "bad" ? "text-red-600" : "text-muted-foreground")}>
            {sub}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function WalletCard() {
  const { me } = useAuth()
  const { address, isConnected } = useConnection()
  if (!me) return null
  if (me.walletAddress && (!address || isAddressEqual(me.walletAddress, address))) {
    if (isConnected) return null
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Wallet className="size-4 text-brand-teal" /> Linked wallet <span className="font-mono text-foreground">{shortAddr(me.walletAddress)}</span>
        <span>· connect it to fund jobs</span>
      </p>
    )
  }
  return (
    <Alert className="border-brand-orange/30 bg-orange-50/60">
      <Link2 className="h-4 w-4 text-brand-orange" />
      <AlertTitle>{me.walletAddress ? "Connected wallet differs from your linked wallet" : "Link a wallet to start"}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          {me.walletAddress
            ? `Your account is linked to ${shortAddr(me.walletAddress)}. Switch to it in your wallet, or link the connected one instead.`
            : "Clients fund escrow from their linked wallet; developers are paid to theirs. Linking only asks you to sign a message: no transaction, no gas."}
        </p>
        <LinkWalletButton />
      </AlertDescription>
    </Alert>
  )
}

function ago(iso: string) {
  const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (s < 60) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

const JOB_TINTS = ["bg-indigo-50 text-indigo-600", "bg-emerald-50 text-emerald-700", "bg-sky-50 text-sky-600", "bg-amber-50 text-amber-700", "bg-rose-50 text-rose-600"]

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
  return (
    <Card className="gap-0 py-0 shadow-soft">
      <div className="flex items-center justify-between px-5 pb-3 pt-5">
        <h2 className="font-brand text-lg font-bold">Recent jobs</h2>
        <Link href="/feed" className="inline-flex items-center gap-1 text-sm font-medium text-brand-green hover:underline">
          Browse jobs <ArrowRight className="size-3.5" />
        </Link>
      </div>
      {loading ? (
        <div className="space-y-2 p-5 pt-0">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : !jobs.length ? (
        <div className="flex flex-col items-center px-6 pb-10 pt-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-brand-forest">
            <Briefcase className="size-5" />
          </span>
          <h3 className="mt-3 font-medium">{empty.title}</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{empty.body}</p>
          {empty.cta && (
            <Button asChild className="mt-4 rounded-xl">
              <Link href={empty.cta.href}>
                <Plus className="size-4" /> {empty.cta.label}
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-y border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Job / {side === "hiring" ? "Developer" : "Client"}</th>
                <th className="px-3 py-2.5 font-medium">Amount</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Updated</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {jobs.map((j, i) => (
                <tr key={j.id} className="group border-b border-border last:border-0 hover:bg-accent/40">
                  <td className="px-5 py-3">
                    <Link href={`/jobs/${j.id}`} className="flex items-center gap-3">
                      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg font-brand text-sm font-bold", JOB_TINTS[i % JOB_TINTS.length])}>
                        {j.title.trim()[0]?.toUpperCase() ?? "J"}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium group-hover:text-brand-forest">{j.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {side === "hiring" ? (j.freelancerEmail ?? `Open listing · ${j.applicationCount} applied`) : j.clientEmail}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-medium">{j.amountUsdc} USDC</td>
                  <td className="px-3 py-3">
                    <StatusBadge status={j.status} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{ago(j.updatedAt)}</td>
                  <td className="pr-4">
                    <Link href={`/jobs/${j.id}`} aria-label={`Open ${j.title}`}>
                      <ArrowRight className="size-4 text-muted-foreground group-hover:text-brand-forest" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
