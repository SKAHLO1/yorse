"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { Plus, Radio, UserRoundPlus, X } from "lucide-react"
import { AppShell } from "@/components/app/app-shell"
import { useAuth } from "@/components/auth-provider"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { api, errorText } from "@/lib/api"
import type { Job } from "@/lib/types"

export default function NewJobPage() {
  return (
    <AppShell>
      <NewJobForm />
    </AppShell>
  )
}

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
        visibility === "public"
          ? "Job listed. It is now in the live feed and open to applications."
          : "Job created. The developer must accept the terms before you fund.",
      )
      router.push(`/jobs/${job.id}`)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-brand text-2xl font-bold">New job</h1>
        <p className="text-sm text-muted-foreground">
          Write terms the AI can check against evidence. Each acceptance criterion should be concrete and verifiable from the deliverable link.
        </p>
      </div>
      {me && !me.walletAddress && (
        <Alert className="border-brand-orange/40">
          <AlertDescription>Link a wallet first (top bar → Connect wallet → Link). You fund escrow from that wallet.</AlertDescription>
        </Alert>
      )}
      <form onSubmit={submit}>
        <Card>
          <CardHeader>
            <CardTitle>Terms</CardTitle>
            <CardDescription>Once the freelancer accepts, these terms are what the AI verifies.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field label="Title" htmlFor="title">
              <Input id="title" required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Landing page for product launch" />
            </Field>
            <Field label="Deliverable description" htmlFor="desc" hint="What exactly will be delivered, and in what form (repo, URL, document)?">
              <Textarea id="desc" required minLength={20} maxLength={4000} rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <div className="space-y-2">
              <Label>Acceptance criteria</Label>
              <p className="text-xs text-muted-foreground">One checkable requirement per line. All must be met for automatic release.</p>
              {criteria.map((c, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={c}
                    minLength={5}
                    maxLength={500}
                    required={i === 0}
                    placeholder={i === 0 ? "e.g. README documents how to run the project" : "Another criterion"}
                    onChange={(e) => setCriteria((cs) => cs.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  {criteria.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => setCriteria((cs) => cs.filter((_, j) => j !== i))} aria-label="Remove criterion">
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
              {criteria.length < 12 && (
                <Button type="button" variant="outline" size="sm" onClick={() => setCriteria((cs) => [...cs, ""])}>
                  <Plus className="size-4" /> Add criterion
                </Button>
              )}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Due date" htmlFor="due">
                <Input id="due" type="date" required min={minDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
              <Field label="Amount (USDC)" htmlFor="amount" hint="Circle testnet USDC on Arbitrum Sepolia">
                <Input id="amount" required inputMode="decimal" pattern="^\d+(\.\d{1,6})?$" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="250.00" />
              </Field>
            </div>
            <div className="space-y-2">
              <Label>Who can take this job?</Label>
              <RadioGroup value={visibility} onValueChange={(v) => setVisibility(v as "public" | "invite")} className="grid gap-2 sm:grid-cols-2">
                <Label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[[data-state=checked]]:border-brand-teal">
                  <RadioGroupItem value="public" className="mt-0.5" />
                  <span>
                    <span className="flex items-center gap-1.5 font-medium">
                      <Radio className="size-4 text-brand-teal" /> Anyone
                    </span>
                    <span className="text-xs text-muted-foreground">Listed in the live feed. Developers apply and you pick one.</span>
                  </span>
                </Label>
                <Label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[[data-state=checked]]:border-brand-teal">
                  <RadioGroupItem value="invite" className="mt-0.5" />
                  <span>
                    <span className="flex items-center gap-1.5 font-medium">
                      <UserRoundPlus className="size-4 text-brand-teal" /> A specific developer
                    </span>
                    <span className="text-xs text-muted-foreground">Private. Never appears in the feed.</span>
                  </span>
                </Label>
              </RadioGroup>
            </div>
            {visibility === "invite" && (
              <Field label="Developer email" htmlFor="femail" hint="They need a Yorse account with a linked wallet.">
                <Input id="femail" type="email" required value={freelancerEmail} onChange={(e) => setFreelancerEmail(e.target.value)} />
              </Field>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Creating…" : "Create job"}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
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
