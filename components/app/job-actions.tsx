"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { erc20Abi, isAddressEqual } from "viem"
import { useConnection, usePublicClient, useReadContract, useWriteContract } from "wagmi"
import { AlertTriangle, Bot, CheckCircle2, Loader2, Star } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api, errorText } from "@/lib/api"
import { escrowAbi } from "@/lib/escrow-abi"
import type { Complaint, JobDetail } from "@/lib/types"
import { CHAIN, CIRCLE_USDC, shortAddr } from "@/lib/web3"
import { COMPLAINT_CATEGORIES, TxLink } from "./job-parts"

function useRefresh(jobId: string) {
  const qc = useQueryClient()
  return () => Promise.all([qc.invalidateQueries({ queryKey: ["job", jobId] }), qc.invalidateQueries({ queryKey: ["jobs"] })])
}

function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription className="break-words">{error}</AlertDescription>
    </Alert>
  )
}

// ------------------------------------------------------------------ terms

export function RespondToTerms({ detail }: { detail: JobDetail }) {
  const refresh = useRefresh(detail.job.id)
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function respond(accept: boolean) {
    setBusy(accept ? "accept" : "decline")
    setError(null)
    try {
      await api(`/jobs/${detail.job.id}/respond`, { body: { accept } })
      toast.success(accept ? "Terms accepted. The client can now fund the escrow." : "Job declined.")
      await refresh()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <ActionCard title="Review the terms" description="Accepting means you agree these criteria define done. The AI will check your submission against them.">
      <ErrorBox error={error} />
      <div className="flex gap-2">
        <Button onClick={() => respond(true)} disabled={!!busy}>
          {busy === "accept" ? "Accepting…" : "Accept terms"}
        </Button>
        <Button variant="outline" onClick={() => respond(false)} disabled={!!busy}>
          Decline
        </Button>
      </div>
    </ActionCard>
  )
}

export function CancelJob({ detail }: { detail: JobDetail }) {
  const refresh = useRefresh(detail.job.id)
  const [busy, setBusy] = useState(false)
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      disabled={busy}
      onClick={async () => {
        if (!confirm("Cancel this job? It has not been funded, so nothing moves on-chain.")) return
        setBusy(true)
        try {
          await api(`/jobs/${detail.job.id}/cancel`, { body: {} })
          await refresh()
        } catch (e) {
          toast.error(errorText(e))
        } finally {
          setBusy(false)
        }
      }}
    >
      Cancel job
    </Button>
  )
}

// ------------------------------------------------------------------ funding

export function FundEscrow({ detail }: { detail: JobDetail }) {
  const { job, escrowAddress } = detail
  const refresh = useRefresh(job.id)
  const { address, chainId, isConnected } = useConnection()
  const publicClient = usePublicClient({ chainId: CHAIN.id })
  const write = useWriteContract()
  const amount = BigInt(job.amountUnits)
  const enabled = !!address && chainId === CHAIN.id
  const balance = useReadContract({ address: CIRCLE_USDC, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: CHAIN.id, query: { enabled } })
  const allowance = useReadContract({ address: CIRCLE_USDC, abi: erc20Abi, functionName: "allowance", args: address ? [address, escrowAddress] : undefined, chainId: CHAIN.id, query: { enabled } })
  const [phase, setPhase] = useState<"idle" | "approving" | "funding" | "confirming">("idle")
  const [error, setError] = useState<string | null>(null)
  const [fundTx, setFundTx] = useState<`0x${string}` | null>(null)

  const onchainState = "error" in detail.onchain ? null : detail.onchain.state
  const alreadyFunded = onchainState === "Funded"
  const wrongWallet = address && !isAddressEqual(address, job.clientWallet)
  const insufficient = balance.data !== undefined && balance.data < amount
  const needsApproval = allowance.data !== undefined && allowance.data < amount

  async function confirm(txHash?: `0x${string}`) {
    setPhase("confirming")
    await api(`/jobs/${job.id}/fund-confirm`, { body: txHash ? { txHash } : {} })
    toast.success("Escrow funded and verified on-chain")
    await refresh()
  }

  async function run() {
    setError(null)
    try {
      if (!publicClient) throw new Error("No Arbitrum Sepolia client available")
      if (!job.freelancerWallet) throw new Error("Choose a developer before funding this job")
      if (alreadyFunded) return await confirm(fundTx ?? undefined)
      if (needsApproval) {
        setPhase("approving")
        const h = await write.mutateAsync({ address: CIRCLE_USDC, abi: erc20Abi, functionName: "approve", args: [escrowAddress, amount], chainId: CHAIN.id })
        const r = await publicClient.waitForTransactionReceipt({ hash: h })
        if (r.status !== "success") throw new Error("USDC approval reverted")
        await allowance.refetch()
      }
      setPhase("funding")
      const h = await write.mutateAsync({ address: escrowAddress, abi: escrowAbi, functionName: "fund", args: [job.onchainJobId, job.freelancerWallet as `0x${string}`, amount], chainId: CHAIN.id })
      setFundTx(h)
      const r = await publicClient.waitForTransactionReceipt({ hash: h })
      if (r.status !== "success") throw new Error("Escrow funding transaction reverted")
      await confirm(h)
    } catch (e) {
      setError(errorText(e))
      await refresh()
    } finally {
      setPhase("idle")
    }
  }

  const busy = phase !== "idle"
  return (
    <ActionCard title={`Fund escrow · ${job.amountUsdc} USDC`} description={`USDC is locked in the Yorse escrow contract until the AI verifies the work or an admin resolves a dispute. Pays ${shortAddr(job.freelancerWallet)}.`}>
      {!isConnected ? (
        <p className="text-sm text-muted-foreground">Connect your wallet ({shortAddr(job.clientWallet)}) using the top bar.</p>
      ) : chainId !== CHAIN.id ? (
        <p className="text-sm text-brand-orange">Switch your wallet to Arbitrum Sepolia (top bar).</p>
      ) : wrongWallet ? (
        <p className="text-sm text-brand-orange">Connected wallet {shortAddr(address)} is not the wallet on this job ({shortAddr(job.clientWallet)}). Switch accounts in your wallet.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-md bg-muted/50 p-2">
              <div className="text-muted-foreground">Your USDC</div>
              <div className="font-mono">{balance.data !== undefined ? (Number(balance.data) / 1e6).toFixed(2) : "…"}</div>
            </div>
            <div className="rounded-md bg-muted/50 p-2">
              <div className="text-muted-foreground">Escrow allowance</div>
              <div className="font-mono">{allowance.data !== undefined ? (Number(allowance.data) / 1e6).toFixed(2) : "…"}</div>
            </div>
          </div>
          {insufficient && !alreadyFunded && (
            <p className="text-sm text-brand-orange">
              Not enough USDC. Get testnet USDC for Arbitrum Sepolia at{" "}
              <a className="underline" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
                faucet.circle.com
              </a>
              .
            </p>
          )}
          <ErrorBox error={error} />
          {fundTx && <TxLink hash={fundTx} label="funding transaction" />}
          <Button onClick={run} disabled={busy || (insufficient && !alreadyFunded)} className="w-full">
            {busy && <Loader2 className="size-4 animate-spin" />}
            {phase === "approving"
              ? "Approve USDC in your wallet…"
              : phase === "funding"
                ? "Confirm funding in your wallet…"
                : phase === "confirming"
                  ? "Verifying escrow on-chain…"
                  : alreadyFunded
                    ? "Funds detected on-chain — confirm funding"
                    : needsApproval
                      ? `1/2 Approve ${job.amountUsdc} USDC, then fund`
                      : `Fund ${job.amountUsdc} USDC`}
          </Button>
        </>
      )}
    </ActionCard>
  )
}

// ------------------------------------------------------------------ submission

export function SubmitDeliverable({ detail }: { detail: JobDetail }) {
  const refresh = useRefresh(detail.job.id)
  const [deliverableUrl, setUrl] = useState("")
  const [fileReference, setFile] = useState("")
  const [description, setDescription] = useState("")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api<{ verification: { ok: boolean; decision?: string; stage?: string; error?: string } }>(`/jobs/${detail.job.id}/submissions`, {
        body: { deliverableUrl: deliverableUrl || null, fileReference: fileReference || null, description, notes: notes || null },
      })
      const v = r.verification
      if (v.ok) toast[v.decision === "release" ? "success" : "warning"](v.decision === "release" ? "Verified — escrow released to you" : "Moved to dispute. See the AI reasoning below.")
      else toast.error(`Submission recorded, but ${v.stage === "ai" ? "AI verification" : "the on-chain step"} failed: ${v.error}`)
      await refresh()
    } catch (err) {
      setError(errorText(err))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <ActionCard
      title="Submit your deliverable"
      description="The AI checks your submission against each acceptance criterion using the linked content as evidence. Claims in your description are not proof: link to the actual work (public repo, live URL, shared doc)."
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="url">Deliverable link</Label>
          <Input id="url" type="url" value={deliverableUrl} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/you/project or https://your-site.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="file">File reference (optional)</Label>
          <Input id="file" value={fileReference} maxLength={500} onChange={(e) => setFile(e.target.value)} placeholder="e.g. design-v2.fig, or a shared-drive URL" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sdesc">What you delivered</Label>
          <Textarea id="sdesc" required minLength={20} maxLength={5000} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Explain how each acceptance criterion is met and where to find it." />
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Textarea id="notes" maxLength={2000} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <ErrorBox error={error} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Recording on-chain and verifying with AI…
            </>
          ) : (
            "Submit for verification"
          )}
        </Button>
        {busy && <p className="text-center text-xs text-muted-foreground">This usually takes 10–40 seconds.</p>}
      </form>
    </ActionCard>
  )
}

/** Shown while status is "submitted": verification running, failed, or its chain step failed. */
export function VerificationStatus({ detail, admin = false }: { detail: JobDetail; admin?: boolean }) {
  const { job } = detail
  const refresh = useRefresh(job.id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chainFailed = job.pendingDecision && job.lastChainAction?.state === "failed"
  const aiFailed = job.verification.state === "error"
  const running = job.verification.state === "running"

  async function retry() {
    setBusy(true)
    setError(null)
    try {
      const r = await api<{ verification: { ok: boolean; error?: string } }>(`${admin ? "/admin" : ""}/jobs/${job.id}/verify`, { body: {} })
      if (!r.verification.ok) setError(r.verification.error ?? "Verification failed")
      await refresh()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ActionCard title="Verification" description="The deliverable is recorded on-chain; escrow stays locked until a verdict is applied.">
      {running && !busy && (
        <p className="flex items-center gap-2 text-sm">
          <Bot className="size-4 animate-pulse text-brand-teal" /> AI verification in progress…
        </p>
      )}
      {aiFailed && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>AI verification failed — no verdict was produced</AlertTitle>
          <AlertDescription className="break-words">{job.verification.error}</AlertDescription>
        </Alert>
      )}
      {chainFailed && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Verdict reached ({job.pendingDecision}), but the on-chain step failed</AlertTitle>
          <AlertDescription className="break-words">{job.lastChainAction?.error} Retrying re-sends only the transaction; the AI is not asked again.</AlertDescription>
        </Alert>
      )}
      <ErrorBox error={error} />
      {(aiFailed || chainFailed || (!running && job.verification.state === "idle")) && (
        <Button onClick={retry} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {chainFailed ? `Retry ${job.pendingDecision} transaction` : "Run verification again"}
        </Button>
      )}
    </ActionCard>
  )
}

export function NonDeliveryDispute({ detail }: { detail: JobDetail }) {
  const refresh = useRefresh(detail.job.id)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const overdue = new Date(detail.job.dueDate).getTime() < Date.now()
  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {overdue ? "Past due — open a dispute" : "Open a dispute"}
      </Button>
    )
  }
  return (
    <ActionCard title="Open a non-delivery dispute" description="Moves the escrow into dispute. An admin reviews and either refunds you or releases to the freelancer.">
      <Textarea rows={3} minLength={10} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What was not delivered?" />
      <ErrorBox error={error} />
      <div className="flex gap-2">
        <Button
          variant="destructive"
          disabled={busy || reason.trim().length < 10}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              await api(`/jobs/${detail.job.id}/dispute`, { body: { reason } })
              toast.success("Dispute opened")
              await refresh()
            } catch (e) {
              setError(errorText(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? "Opening…" : "Open dispute"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </ActionCard>
  )
}

// ------------------------------------------------------------------ complaints & reviews

export function ComplaintForm({ detail }: { detail: JobDetail }) {
  const refresh = useRefresh(detail.job.id)
  const [category, setCategory] = useState<Complaint["category"]>("quality")
  const [description, setDescription] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        try {
          await api(`/jobs/${detail.job.id}/complaints`, { body: { category, description } })
          setDescription("")
          toast.success("Complaint filed. An admin will review it.")
          await refresh()
        } catch (err) {
          setError(errorText(err))
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="space-y-2">
        <Label>Category</Label>
        <Select value={category} onValueChange={(v) => setCategory(v as Complaint["category"])}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(COMPLAINT_CATEGORIES).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="complaint">Details</Label>
        <Textarea id="complaint" required minLength={20} maxLength={4000} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the problem. Only you and Yorse admins can see this." />
      </div>
      <ErrorBox error={error} />
      <Button type="submit" variant="outline" disabled={busy}>
        {busy ? "Filing…" : "File complaint"}
      </Button>
    </form>
  )
}

export function ReviewForm({ detail, counterpart }: { detail: JobDetail; counterpart: string }) {
  const refresh = useRefresh(detail.job.id)
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        try {
          await api(`/jobs/${detail.job.id}/reviews`, { body: { rating, comment } })
          toast.success("Review posted")
          await refresh()
        } catch (err) {
          setError(errorText(err))
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="space-y-2">
        <Label>Rate {counterpart}</Label>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => setRating(n)} className="rounded p-0.5 hover:bg-accent" aria-label={`${n} stars`}>
              <Star className={n <= rating ? "size-5 fill-brand-orange text-brand-orange" : "size-5 text-muted-foreground"} />
            </button>
          ))}
          <span className="ml-2 text-sm text-muted-foreground">{rating}/5</span>
        </div>
      </div>
      <Textarea required minLength={10} maxLength={2000} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="How was working together?" />
      <ErrorBox error={error} />
      <Button type="submit" disabled={busy}>
        {busy ? "Posting…" : "Post review"}
      </Button>
    </form>
  )
}

export function ActionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="border-brand-teal/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="size-4 text-brand-teal" /> {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}
