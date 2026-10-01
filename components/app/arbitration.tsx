"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { erc20Abi, isAddressEqual, keccak256, stringToHex } from "viem"
import { useConnection, usePublicClient, useReadContract, useWriteContract } from "wagmi"
import { AlertTriangle, Bot, CheckCircle2, ChevronDown, Fingerprint, Gavel, Hourglass, Loader2, Scale, ShieldAlert, Users, XCircle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { api, errorText } from "@/lib/api"
import { escrowAbi } from "@/lib/escrow-abi"
import type { Commitment, JobDetail, JurorResult, OnchainJob, Role, Ruling } from "@/lib/types"
import { cn } from "@/lib/utils"
import { arbitrumFees, CHAIN, CIRCLE_USDC, shortAddr } from "@/lib/web3"
import { fmtDate, TxLink } from "./job-parts"

function useRefresh(jobId: string) {
  const qc = useQueryClient()
  return () => Promise.all([qc.invalidateQueries({ queryKey: ["job", jobId] }), qc.invalidateQueries({ queryKey: ["jobs"] })])
}

/** Seconds until `iso`, ticking every second. Negative once passed. */
export function useCountdown(iso: string | null | undefined) {
  const target = iso ? Date.parse(iso) : NaN
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!Number.isFinite(target)) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [target])
  return Number.isFinite(target) ? Math.ceil((target - now) / 1000) : null
}

const clock = (s: number) => {
  const v = Math.max(0, s)
  const h = Math.floor(v / 3600)
  const m = Math.floor((v % 3600) / 60)
  const sec = v % 60
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
}

const partyLabel = (r: Role) => (r === "freelancer" ? "developer" : "client")
const onchainOf = (d: JobDetail): OnchainJob | null => ("error" in d.onchain ? null : d.onchain)

// ------------------------------------------------------------------ process track

const STEPS = [
  { key: "verdict", label: "AI verdict" },
  { key: "window", label: "Challenge window" },
  { key: "jury", label: "AI jury" },
  { key: "settled", label: "Settled on-chain" },
] as const

/** Where this job is in the propose → challenge → jury → settle flow. */
export function ArbitrationTrack({ detail }: { detail: JobDetail }) {
  const { job } = detail
  const reachedJury = !!job.challenge || job.dispute?.source === "jury"
  const current =
    job.status === "submitted"
      ? 0
      : job.status === "proposed"
        ? 1
        : job.status === "challenged"
          ? 2
          : job.status === "disputed"
            ? 2
            : ["released", "refunded", "resolved_release", "resolved_refund"].includes(job.status)
              ? 4
              : -1
  if (current < 0) return null
  return (
    <ol className="grid grid-cols-4 gap-2 text-xs" aria-label="Arbitration progress">
      {STEPS.map((s, i) => {
        const skipped = s.key === "jury" && current === 4 && !reachedJury
        const done = i < current && !skipped
        const active = i === current
        return (
          <li key={s.key} className="space-y-1.5">
            <div className={cn("h-1.5 rounded-full", done ? "bg-brand-teal" : active ? "animate-pulse bg-brand-orange" : "bg-muted")} />
            <div className={cn("font-medium", active ? "text-foreground" : done ? "text-brand-teal" : "text-muted-foreground", skipped && "line-through")}>
              {s.key === "jury" && job.status === "disputed" && job.dispute?.source !== "client" ? "Human review" : s.label}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ------------------------------------------------------------------ proposed

export function ProposalPanel({ detail }: { detail: JobDetail }) {
  const { job, viewerRole: role, arbitration } = detail
  const refresh = useRefresh(job.id)
  const left = useCountdown(job.proposal?.deadline)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!job.proposal) return null
  const release = job.proposal.outcome === "release"
  const loser = arbitration.canChallenge
  const open = left !== null && left > 0
  const iCanChallenge = role === loser && open

  async function finalize() {
    setBusy(true)
    setError(null)
    try {
      await api(`/jobs/${job.id}/finalize`, { body: {} })
      toast.success(release ? "Finalized: funds released to the developer" : "Finalized: funds refunded to the client")
      await refresh()
    } catch (e) {
      setError(errorText(e))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="border-violet-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="size-4 text-violet-600" />
          AI proposes: {release ? `release ${job.amountUsdc} USDC to the developer` : `refund ${job.amountUsdc} USDC to the client`}
        </CardTitle>
        <CardDescription>
          No money has moved. The proposal is posted on-chain and becomes final only if the {loser ? partyLabel(loser) : "losing party"} doesn't
          challenge it in time. After that, anyone can finalize it; no one at Yorse has to approve.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ArbitrationTrack detail={detail} />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-4">
          <div>
            <div className="text-xs text-muted-foreground">{open ? "Challenge window closes in" : "Challenge window closed"}</div>
            <div className="font-mono text-3xl tabular-nums">{left === null ? "—" : clock(left)}</div>
            <div className="text-xs text-muted-foreground">{fmtDate(job.proposal.deadline)}</div>
          </div>
          <div className="space-y-1 text-right text-xs">
            <div>
              Bond to challenge: <span className="font-mono">{arbitration.bond.display} USDC</span> ({arbitration.bondBps / 100}%)
            </div>
            <div>
              Posted in <TxLink hash={job.proposal.txHash} label="proposal transaction" />
            </div>
          </div>
        </div>

        {iCanChallenge ? (
          <ChallengeForm detail={detail} />
        ) : open ? (
          <p className="text-sm text-muted-foreground">
            {role === loser
              ? "The window has closed."
              : `Waiting in case the ${loser ? partyLabel(loser) : "other party"} challenges. If they don't, the proposal settles automatically when the timer ends.`}
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Nobody challenged. Yorse's keeper finalizes this automatically, or you can do it now.</p>
            <Button onClick={finalize} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />} Finalize now
            </Button>
          </div>
        )}
        {error && <ErrorBox error={error} />}
      </CardContent>
    </Card>
  )
}

/** The losing party posts the bond from their own wallet, then puts their case to the jury. */
function ChallengeForm({ detail }: { detail: JobDetail }) {
  const { job, escrowAddress, arbitration, viewerRole: role } = detail
  const refresh = useRefresh(job.id)
  const { address, chainId, isConnected } = useConnection()
  const publicClient = usePublicClient({ chainId: CHAIN.id })
  const write = useWriteContract()
  const bond = BigInt(arbitration.bond.units)
  const myWallet = (role === "client" ? job.clientWallet : job.freelancerWallet) as `0x${string}`
  const enabled = !!address && chainId === CHAIN.id
  const balance = useReadContract({ address: CIRCLE_USDC, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: CHAIN.id, query: { enabled } })
  const allowance = useReadContract({ address: CIRCLE_USDC, abi: erc20Abi, functionName: "allowance", args: address ? [address, escrowAddress] : undefined, chainId: CHAIN.id, query: { enabled } })
  const [argument, setArgument] = useState("")
  const [phase, setPhase] = useState<"idle" | "approving" | "challenging" | "recording">("idle")
  const [error, setError] = useState<string | null>(null)
  const [tx, setTx] = useState<`0x${string}` | null>(null)

  const alreadyOnchain = onchainOf(detail)?.state === "Challenged"
  const wrongWallet = address && !isAddressEqual(address, myWallet)
  const insufficient = balance.data !== undefined && balance.data < bond
  const needsApproval = allowance.data !== undefined && allowance.data < bond

  async function run() {
    setError(null)
    try {
      if (!publicClient) throw new Error("No Arbitrum Sepolia client available")
      let hash = tx
      if (!alreadyOnchain) {
        if (needsApproval) {
          setPhase("approving")
          const h = await write.mutateAsync({ address: CIRCLE_USDC, abi: erc20Abi, functionName: "approve", args: [escrowAddress, bond], chainId: CHAIN.id, ...(await arbitrumFees(publicClient)) })
          if ((await publicClient.waitForTransactionReceipt({ hash: h })).status !== "success") throw new Error("USDC approval reverted")
          await allowance.refetch()
        }
        setPhase("challenging")
        hash = await write.mutateAsync({ address: escrowAddress, abi: escrowAbi, functionName: "challenge", args: [job.onchainJobId], chainId: CHAIN.id, ...(await arbitrumFees(publicClient)) })
        setTx(hash)
        if ((await publicClient.waitForTransactionReceipt({ hash })).status !== "success") throw new Error("challenge() reverted")
      }
      setPhase("recording")
      await api(`/jobs/${job.id}/challenge`, { body: { ...(hash ? { txHash: hash } : {}), argument: argument.trim() || null } })
      toast.success("Challenge recorded. The AI jury will hear both sides.")
      await refresh()
    } catch (e) {
      setError(errorText(e))
      await refresh()
    } finally {
      setPhase("idle")
    }
  }

  const busy = phase !== "idle"
  return (
    <div className="space-y-3 rounded-lg border border-brand-orange/40 bg-brand-orange/5 p-4">
      <div className="flex items-center gap-2 font-medium">
        <ShieldAlert className="size-4 text-brand-orange" /> Disagree? Challenge the AI
      </div>
      <p className="text-sm text-muted-foreground">
        You post a <span className="font-mono">{arbitration.bond.display} USDC</span> bond and a panel of {arbitration.juryPanel.length} independent AI models re-hears the
        case, including your argument. If the jury agrees with you, your bond comes back. If it upholds the proposal, the bond goes to the {role === "client" ? "developer" : "client"} to
        compensate for the delay.
      </p>
      <div className="space-y-2">
        <Label htmlFor="challenge-arg">Your argument to the jury (optional now; you can add it after)</Label>
        <Textarea
          id="challenge-arg"
          rows={4}
          maxLength={4000}
          value={argument}
          onChange={(e) => setArgument(e.target.value)}
          placeholder="Point to specific evidence: which criterion was judged wrongly and where the proof is."
        />
      </div>
      {!isConnected ? (
        <p className="text-sm text-muted-foreground">Connect your wallet ({shortAddr(myWallet)}) using the top bar.</p>
      ) : chainId !== CHAIN.id ? (
        <p className="text-sm text-brand-orange">Switch your wallet to Arbitrum Sepolia (top bar).</p>
      ) : wrongWallet ? (
        <p className="text-sm text-brand-orange">Connected wallet {shortAddr(address)} is not your wallet on this job ({shortAddr(myWallet)}).</p>
      ) : (
        <>
          {insufficient && !alreadyOnchain && (
            <p className="text-sm text-brand-orange">
              You need {arbitration.bond.display} USDC for the bond. Get testnet USDC at{" "}
              <a className="underline" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
                faucet.circle.com
              </a>
              .
            </p>
          )}
          {error && <ErrorBox error={error} />}
          {tx && <TxLink hash={tx} label="challenge transaction" />}
          <Button onClick={run} disabled={busy || (insufficient && !alreadyOnchain) || (argument.trim().length > 0 && argument.trim().length < 20)} variant="destructive" className="w-full">
            {busy && <Loader2 className="size-4 animate-spin" />}
            {phase === "approving"
              ? "Approve the bond in your wallet…"
              : phase === "challenging"
                ? "Confirm challenge() in your wallet…"
                : phase === "recording"
                  ? "Recording challenge…"
                  : alreadyOnchain
                    ? "Challenge found on-chain: record it"
                    : needsApproval
                      ? `1/2 Approve ${arbitration.bond.display} USDC bond, then challenge`
                      : `Challenge with ${arbitration.bond.display} USDC bond`}
          </Button>
          {argument.trim().length > 0 && argument.trim().length < 20 && <p className="text-xs text-muted-foreground">Arguments need at least 20 characters.</p>}
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ challenged

export function ChallengePanel({ detail, admin = false }: { detail: JobDetail; admin?: boolean }) {
  const { job, viewerRole: role, arbitration } = detail
  const refresh = useRefresh(job.id)
  const c = job.challenge
  const left = useCountdown(c?.argumentDeadline)
  const [argument, setArgument] = useState("")
  const [busy, setBusy] = useState<"argue" | "retry" | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!c) return null

  const myRole = role === "client" || role === "freelancer" ? role : null
  const canArgue = myRole && !c.arguments[myRole] && job.jury.state === "idle" && (left ?? 0) > 0
  const juryFailed = job.jury.state === "error"
  const chainFailed = !!job.pendingRuling && job.lastChainAction?.state === "failed"

  async function argue() {
    setBusy("argue")
    setError(null)
    try {
      await api(`/jobs/${job.id}/arguments`, { body: { argument } })
      toast.success("Argument submitted to the jury")
      setArgument("")
      await refresh()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }
  async function retry() {
    setBusy("retry")
    setError(null)
    try {
      const r = await api<{ verification: { ok: boolean; error?: string } }>(`${admin ? "/admin" : ""}/jobs/${job.id}/verify`, { body: {} })
      if (!r.verification.ok) setError(r.verification.error ?? "The jury could not rule")
      await refresh()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="border-brand-orange/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4 text-brand-orange" />
          {c.source === "party" ? `The ${partyLabel(c.challengerRole ?? "client")} challenged the AI's proposal` : "The AI wasn't confident, so the jury decides"}
        </CardTitle>
        <CardDescription>
          {c.source === "party" ? (
            <>
              A <span className="font-mono">{c.bondUsdc} USDC</span> bond is locked in escrow with the job funds. <TxLink hash={c.txHash} label="challenge transaction" />
            </>
          ) : (
            "No bond is needed when the AI escalates on its own."
          )}{" "}
          Both sides can make their case once. Then {arbitration.juryPanel.length} different AI models rule independently, and a majority decides.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ArbitrationTrack detail={detail} />
        <div className="grid gap-3 sm:grid-cols-2">
          {(["client", "freelancer"] as const).map((r) => (
            <div key={r} className="rounded-lg border p-3 text-sm">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {partyLabel(r)}'s argument {c.challengerRole === r && <Badge variant="outline">challenger</Badge>}
              </div>
              {c.arguments[r] ? <p className="whitespace-pre-wrap">{c.arguments[r]}</p> : <p className="text-muted-foreground">Not submitted yet.</p>}
            </div>
          ))}
        </div>

        {job.jury.state === "idle" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Hourglass className="size-4" />
            {(left ?? 0) > 0 ? (
              <span>
                Jury convenes in <span className="font-mono text-foreground">{clock(left!)}</span>, or as soon as both sides have argued.
              </span>
            ) : (
              <span>Argument window closed. The jury is convening…</span>
            )}
          </div>
        )}
        {canArgue && (
          <div className="space-y-2">
            <Label htmlFor="jury-arg">Your argument to the jury</Label>
            <Textarea id="jury-arg" rows={4} minLength={20} maxLength={4000} value={argument} onChange={(e) => setArgument(e.target.value)} placeholder="Cite the evidence. The jurors check your claims against it." />
            <Button onClick={argue} disabled={!!busy || argument.trim().length < 20}>
              {busy === "argue" && <Loader2 className="size-4 animate-spin" />} Submit argument
            </Button>
          </div>
        )}
        {job.jury.state === "running" && <JuryDeliberating panel={arbitration.juryPanel} />}
        {juryFailed && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>The jury could not convene, so nothing was decided</AlertTitle>
            <AlertDescription className="break-words">{job.jury.error}</AlertDescription>
          </Alert>
        )}
        {chainFailed && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>The jury ruled ({job.pendingRuling}), but the on-chain step failed</AlertTitle>
            <AlertDescription className="break-words">{job.lastChainAction?.error} Retrying re-sends only the transaction; the jury is not asked again.</AlertDescription>
          </Alert>
        )}
        {error && <ErrorBox error={error} />}
        {(juryFailed || chainFailed) && (
          <Button onClick={retry} disabled={!!busy}>
            {busy === "retry" && <Loader2 className="size-4 animate-spin" />}
            {chainFailed ? "Retry the transaction" : "Reconvene the jury"}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function JuryDeliberating({ panel }: { panel: { name: string; model: string }[] }) {
  return (
    <div className="space-y-2 rounded-lg bg-muted/40 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Gavel className="size-4 animate-pulse text-brand-orange" /> The jury is deliberating
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {panel.map((j, i) => (
          <div key={i} className="flex items-center gap-2 rounded border bg-background/50 px-2 py-1.5 text-xs">
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
            <span className="truncate font-mono">{j.model}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ jury ruling

const VOTE_STYLE: Record<string, string> = {
  release: "border-brand-teal/40 bg-brand-teal/5",
  refund: "border-brand-orange/40 bg-brand-orange/5",
  abstain: "border-muted bg-muted/30",
  failed: "border-destructive/40 bg-destructive/5",
}

export function JuryRulingCard({ ruling, onchainHash }: { ruling: Ruling; onchainHash?: string }) {
  const t = ruling.tally
  const title =
    ruling.status === "error"
      ? "The jury could not convene"
      : ruling.outcome === "split"
        ? "The jury split, so a human admin decides"
        : `The jury ruled: ${ruling.outcome === "release" ? "release to the developer" : "refund the client"}`
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gavel className="size-4" /> {title}
        </CardTitle>
        <CardDescription>
          {t.release} release · {t.refund} refund · {t.abstain} abstain{t.failed ? ` · ${t.failed} failed` : ""}. A strict majority of the whole panel is required;
          a failed juror counts against a majority, so an outage can only send a case to a human. {fmtDate(ruling.createdAt)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-3">
          {ruling.jurors.map((j, i) => (
            <JurorCard key={i} j={j} n={i + 1} />
          ))}
        </div>
        {ruling.commitment && <CommitmentCheck label="Jury ruling" commitment={ruling.commitment} onchainHash={onchainHash} />}
      </CardContent>
    </Card>
  )
}

function JurorCard({ j, n }: { j: JurorResult; n: number }) {
  const [open, setOpen] = useState(false)
  const key = !j.ok ? "failed" : (j.vote ?? "failed")
  return (
    <div className={cn("flex flex-col rounded-lg border p-3 text-sm", VOTE_STYLE[key])}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Juror {n}</span>
        <Badge variant="outline" className="capitalize">
          {j.ok ? j.vote : "failed"}
        </Badge>
      </div>
      <div className="mt-1 truncate font-mono text-xs" title={`${j.provider}:${j.model}`}>
        {j.provider}:{j.model}
      </div>
      {j.ok ? (
        <>
          <div className="mt-2 text-xs text-muted-foreground">Confidence {Math.round((j.confidence ?? 0) * 100)}%</div>
          <p className={cn("mt-2 leading-relaxed", !open && "line-clamp-4")}>{j.reasoning}</p>
          <button type="button" className="mt-1 self-start text-xs text-brand-teal hover:underline" onClick={() => setOpen((o) => !o)}>
            {open ? "Show less" : "Read full reasoning"}
          </button>
          {open && (
            <ul className="mt-2 space-y-1 text-xs">
              {j.matched_criteria.map((c, i) => (
                <li key={`m${i}`} className="flex gap-1.5">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-brand-teal" /> {c}
                </li>
              ))}
              {j.unmatched_criteria.map((c, i) => (
                <li key={`u${i}`} className="flex gap-1.5">
                  <XCircle className="mt-0.5 size-3.5 shrink-0 text-brand-orange" /> {c}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="mt-2 break-words text-xs text-muted-foreground">{j.error}</p>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ verifiable commitments

/**
 * Recomputes keccak256 of the stored record in the browser and compares it with the hash the
 * escrow contract holds. Nothing here trusts the Yorse backend's word.
 */
export function CommitmentCheck({ label, commitment, onchainHash }: { label: string; commitment: Commitment; onchainHash?: string }) {
  const computed = useMemo(() => keccak256(stringToHex(commitment.canonical)), [commitment.canonical])
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(commitment.canonical), null, 2)
    } catch {
      return commitment.canonical
    }
  }, [commitment.canonical])
  const zero = !onchainHash || /^0x0+$/.test(onchainHash)
  const matches = !zero && computed.toLowerCase() === onchainHash!.toLowerCase()
  return (
    <Collapsible className="rounded-lg border text-xs">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <Fingerprint className="size-4 text-muted-foreground" />
        <span className="font-medium">{label}</span>
        {zero ? (
          <Badge variant="outline">not on-chain yet</Badge>
        ) : matches ? (
          <Badge variant="outline" className="border-brand-teal/50 text-brand-teal">
            <CheckCircle2 className="size-3" /> matches on-chain hash
          </Badge>
        ) : (
          <Badge variant="outline" className="border-destructive/50 text-destructive-foreground">
            <XCircle className="size-3" /> does NOT match on-chain
          </Badge>
        )}
        <span className="ml-auto font-mono text-muted-foreground" title={computed}>
          {shortAddr(computed)}
        </span>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
            Inspect <ChevronDown className="size-3" />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="space-y-2 border-t p-3">
        <p className="text-muted-foreground">
          Your browser just computed <span className="font-mono">keccak256</span> of the record below and compared it with the hash stored in the escrow contract
          {zero ? "." : `: ${onchainHash}.`} Any change to the record, even a single character, would break the match.
        </p>
        <pre className="max-h-72 overflow-auto rounded bg-muted/50 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">{pretty}</pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Every commitment on this job, each checked against the contract. */
export function ProofCard({ detail }: { detail: JobDetail }) {
  const oc = onchainOf(detail)
  const { job } = detail
  const submission = detail.submissions.find((s) => s.id === job.currentSubmissionId)
  const verification = detail.verifications.find((v) => v.id === job.verification.verificationId)
  const ruling = detail.rulings.find((r) => r.id === job.jury.rulingId && r.commitment)
  if (!oc || (!submission?.commitment && !verification?.commitment)) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Fingerprint className="size-4" /> Verifiable on-chain record
        </CardTitle>
        <CardDescription>
          Before any money moves, Yorse writes a hash of each record to the escrow contract. These checks run in your browser against the contract, not the Yorse
          database.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {submission?.commitment && <CommitmentCheck label="Deliverable" commitment={submission.commitment} onchainHash={oc.deliverableHash} />}
        {verification?.commitment && <CommitmentCheck label="AI verdict" commitment={verification.commitment} onchainHash={oc.verdictHash} />}
        {ruling?.commitment && <CommitmentCheck label="Jury ruling" commitment={ruling.commitment} onchainHash={oc.rulingHash} />}
        {job.resolution?.rulingHash && (
          <div className="flex items-center gap-2 rounded-lg border p-3 text-xs">
            <Gavel className="size-4 text-muted-foreground" />
            <span className="font-medium">Admin decision</span>
            {oc.rulingHash?.toLowerCase() === job.resolution.rulingHash.toLowerCase() ? (
              <Badge variant="outline" className="border-brand-teal/50 text-brand-teal">
                <CheckCircle2 className="size-3" /> committed on-chain
              </Badge>
            ) : (
              <Badge variant="outline">pending</Badge>
            )}
            <span className="ml-auto font-mono text-muted-foreground">{shortAddr(job.resolution.rulingHash)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Outcome banner for jobs settled by the AI (unchallenged proposal or jury). */
export function SettledBanner({ detail }: { detail: JobDetail }) {
  const { job } = detail
  const release = job.status === "released"
  const byJury = !!job.challenge
  return (
    <Alert className={release ? "border-brand-teal/40" : ""}>
      <Bot className={cn("h-4 w-4", release && "text-brand-teal")} />
      <AlertTitle>
        {release ? `${job.amountUsdc} USDC released to the developer` : `${job.amountUsdc} USDC refunded to the client`}
        {byJury ? " by the AI jury" : " (proposal not challenged)"}
      </AlertTitle>
      <AlertDescription>
        {byJury
          ? job.challenge?.source === "party" && job.proposal
            ? (release ? "release" : "refund") === job.proposal.outcome
              ? `The jury upheld the AI's proposal. The ${partyLabel(job.challenge.challengerRole ?? "client")}'s ${job.challenge.bondUsdc} USDC bond went to the other side.`
              : `The jury overturned the AI's proposal. The ${partyLabel(job.challenge.challengerRole ?? "client")}'s ${job.challenge.bondUsdc} USDC bond was returned.`
            : "The AI wasn't confident, so the jury heard the case."
          : "Nobody challenged within the window, so the proposal became final."}{" "}
        <TxLink hash={job.lastChainAction?.txHash} label="settlement transaction" />
      </AlertDescription>
    </Alert>
  )
}

function ErrorBox({ error }: { error: string }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription className="break-words">{error}</AlertDescription>
    </Alert>
  )
}
