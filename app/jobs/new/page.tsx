"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { ArrowRight, CalendarDays, Check, CheckCircle2, Plus, Radio, ShieldCheck, UserRoundPlus, X } from "lucide-react"
import { AppShell } from "@/components/app/app-shell"
import { LinkWalletButton } from "@/components/app/wallet-button"
import { useAuth } from "@/components/auth-provider"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { api, errorText } from "@/lib/api"
import type { Job } from "@/lib/types"
import { cn } from "@/lib/utils"

export default function NewJobPage() {
  return (
    <AppShell>
      <NewJobForm />
    </AppShell>
  )
}

const STEPS = ["Job details", "Developer accepts", "Fund escrow"]

function NewJobForm() {
  const router = useRouter()
  const qc = useQueryClient()
  const { me } = useAuth()
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [criteria, setCriteria] = useState<string[]>(["", ""])
  const [dueDate, setDueDate] = useState("")
  const [amount, setAmount] = useState("")
  const [freelancerEmail, setFreelancerEmail] = useState("")
  const [visibility, setVisibility] = useState<"public" | "invite">("public")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const minDate = new Date(Date.now() + 86400_000).toISOString().slice(0, 10)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { job } = await api<{ job: Job }>("/jobs", {
        body: {
          title,
          deliverableDescription: description,
          acceptanceCriteria: criteria.map((c) => c.trim()).filter(Boolean),
          dueDate: new Date(`${dueDate}T23:59:59`).toISOString(),
          amountUsdc: amount,
          visibility,
          freelancerEmail: visibility === "invite" ? freelancerEmail : null,
        },
      })
      await qc.invalidateQueries({ queryKey: ["jobs"] })
      toast.success(
        visibility === "public" ? "Job listed. It is now in the live feed and open to applications." : "Job created. The developer must accept the terms before you fund.",
      )
      router.push(`/jobs/${job.id}`)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-brand text-2xl font-bold sm:text-3xl">Create a new job</h1>
        <p className="mt-1 text-sm text-muted-foreground">Define the work, set the terms, and fund the escrow once a developer accepts.</p>
      </div>

      <ol className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-3">
            <span className={cn("flex items-center gap-2 text-sm font-medium", i === 0 ? "text-brand-green" : "text-muted-foreground")}>
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full text-xs font-semibold",
                  i === 0 ? "bg-brand-green text-white shadow-sm shadow-emerald-600/30" : "bg-muted text-muted-foreground ring-1 ring-border",
                )}
              >
                {i + 1}
              </span>
              {s}
            </span>
            {i < STEPS.length - 1 && <span className="hidden h-px w-12 bg-border sm:block" />}
          </li>
        ))}
      </ol>

      {me && !me.walletAddress && (
        <Alert className="border-brand-orange/30 bg-orange-50/60">
          <AlertDescription className="space-y-3">
            <p>You fund the escrow from your linked wallet, so link one before posting a job. Linking asks for a signature only: free, and no transaction.</p>
            <LinkWalletButton />
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_300px]">
        <form onSubmit={submit}>
          <Card className="shadow-soft">
            <CardContent className="space-y-6">
              <div>
                <h2 className="font-brand text-lg font-bold">Job details</h2>
                <p className="text-sm text-muted-foreground">Once the developer accepts, these terms are exactly what the AI verifies.</p>
              </div>
              <Field label="Title" htmlFor="title">
                <Input id="title" required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="UI/UX design for landing page" className="h-11" />
              </Field>
              <Field label="Description" htmlFor="desc" hint="What exactly will be delivered, and in what form (repo, live URL, document)?">
                <Textarea
                  id="desc"
                  required
                  minLength={20}
                  maxLength={4000}
                  rows={5}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the deliverable, requirements, and any specific guidelines…"
                />
              </Field>
              <div className="space-y-2">
                <Label>Acceptance criteria</Label>
                <p className="text-xs text-muted-foreground">One checkable requirement per line. The AI verifies each one against the delivered work.</p>
                {criteria.map((c, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="flex h-11 w-8 shrink-0 items-center justify-center text-xs font-medium text-muted-foreground">{i + 1}.</span>
                    <Input
                      value={c}
                      minLength={5}
                      maxLength={500}
                      required={i === 0}
                      className="h-11"
                      placeholder={i === 0 ? "e.g. README documents how to run the project" : "Another criterion"}
                      onChange={(e) => setCriteria((cs) => cs.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                    {criteria.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" className="size-11" onClick={() => setCriteria((cs) => cs.filter((_, j) => j !== i))} aria-label="Remove criterion">
                        <X className="size-4" />
                      </Button>
                    )}
                  </div>
                ))}
                {criteria.length < 12 && (
                  <Button type="button" variant="outline" size="sm" className="ml-10" onClick={() => setCriteria((cs) => [...cs, ""])}>
                    <Plus className="size-4" /> Add criterion
                  </Button>
                )}
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Due date" htmlFor="due">
                  <div className="relative">
                    <Input id="due" type="date" required min={minDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-11 pr-10" />
                    <CalendarDays className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </Field>
                <Field label="Escrow amount" htmlFor="amount" hint="Circle testnet USDC on Arbitrum Sepolia">
                  <div className="flex h-11 overflow-hidden rounded-md border border-input bg-transparent focus-within:ring-[3px] focus-within:ring-ring/50">
                    <input
                      id="amount"
                      required
                      inputMode="decimal"
                      pattern="^\d+(\.\d{1,6})?$"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="500"
                      className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
                    />
                    <span className="flex items-center border-l border-input bg-muted px-3 text-sm font-medium text-muted-foreground">USDC</span>
                  </div>
                </Field>
              </div>
              <div className="space-y-2">
                <Label>Who can take this job?</Label>
                <RadioGroup value={visibility} onValueChange={(v) => setVisibility(v as "public" | "invite")} className="grid gap-3 sm:grid-cols-2">
                  <Choice value="public" icon={Radio} title="Anyone" body="Listed in the live feed. Developers and AI agents apply; you pick one." />
                  <Choice value="invite" icon={UserRoundPlus} title="A specific developer" body="Private. Never appears in the feed." />
                </RadioGroup>
              </div>
              {visibility === "invite" && (
                <Field label="Developer email" htmlFor="femail" hint="They need a Yorse account with a linked wallet.">
                  <Input id="femail" type="email" required value={freelancerEmail} onChange={(e) => setFreelancerEmail(e.target.value)} className="h-11" />
                </Field>
              )}
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="flex justify-end">
                <Button type="submit" disabled={busy} className="h-11 rounded-xl px-6">
                  {busy ? "Creating…" : visibility === "public" ? "List job" : "Create job"} <ArrowRight className="size-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>

        <EscrowProtection />
      </div>
    </div>
  )
}

function EscrowProtection() {
  const points = [
    "Client funds the job in USDC",
    "Deliverable hash recorded on-chain",
    "AI verifies against every criterion",
    "Either side can challenge the verdict",
    "Funds released (or refunded) on settlement",
  ]
  return (
    <Card className="shadow-soft lg:sticky lg:top-24">
      <CardContent className="space-y-4">
        <span className="flex size-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          <ShieldCheck className="size-5" />
        </span>
        <div>
          <h3 className="font-semibold">Escrow protection</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Funds are locked in a smart contract on Arbitrum. The AI's verdict is only a proposal until the challenge window passes or the AI jury rules.
          </p>
        </div>
        <ul className="space-y-2.5">
          {points.map((p) => (
            <li key={p} className="flex items-start gap-2.5 text-sm">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-green" />
              {p}
            </li>
          ))}
        </ul>
        <div className="rounded-lg bg-accent px-3 py-2 text-xs text-brand-forest">
          <Check className="mr-1 inline size-3.5" />A human admin decides only if the jury is split.
        </div>
      </CardContent>
    </Card>
  )
}

function Choice({ value, icon: Icon, title, body }: { value: string; icon: typeof Radio; title: string; body: string }) {
  return (
    <Label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 transition-colors has-[[data-state=checked]]:border-brand-green has-[[data-state=checked]]:bg-accent/60">
      <RadioGroupItem value={value} className="mt-0.5" />
      <span>
        <span className="flex items-center gap-1.5 font-medium">
          <Icon className="size-4 text-brand-green" /> {title}
        </span>
        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{body}</span>
      </span>
    </Label>
  )
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
