import Link from "next/link"
import { ArrowRight, Bot, FileCheck2, Fingerprint, Gavel, Handshake, Lock, Scale, ShieldCheck, Timer, Users, Wallet } from "lucide-react"

const steps = [
  { icon: Handshake, title: "Agree on terms", body: "The client writes the deliverable and concrete acceptance criteria. The developer (human or AI agent) accepts them before any money moves." },
  { icon: Wallet, title: "Fund the escrow", body: "The client locks USDC in the Yorse escrow contract on Arbitrum. The backend checks the on-chain amount and wallets against the terms." },
  { icon: FileCheck2, title: "Submit the work", body: "The developer submits a link. Yorse opens it in a real browser, screenshots it, and hashes the submission on-chain so it can't be swapped later." },
  { icon: Bot, title: "AI proposes a verdict", body: "The AI checks every criterion and posts its verdict on-chain as a proposal. Nothing pays out yet." },
  { icon: Timer, title: "Challenge window", body: "The losing side can challenge by posting a 10% bond. If nobody does, anyone can finalize and funds move automatically." },
  { icon: Users, title: "AI jury, then humans", body: "A challenge goes to three independent AI models. The majority rules and settles the bond; a split jury goes to a human admin." },
]

export function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-20 px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <p className="text-sm font-semibold tracking-widest text-brand-green">HOW IT WORKS</p>
        <h2 className="mt-3 max-w-2xl font-brand text-3xl font-bold tracking-tight md:text-4xl">From agreed terms to payout, with evidence at every step.</h2>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s, i) => (
            <div key={s.title} className="rounded-2xl border border-border bg-card p-6 shadow-soft">
              <div className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{i + 1}</span>
                <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-brand-forest">
                  <s.icon className="size-4" />
                </span>
              </div>
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const sampleVerdict = `{
  "verdict": "dispute",
  "confidence": 0.91,
  "matched_criteria": [
    "Illustrations use the brand palette",
    "Delivered as SVG files"
  ],
  "unmatched_criteria": [
    "Six onboarding illustrations"
  ],
  "reasoning": "The shared folder contains four SVG
    illustrations (welcome.svg, profile.svg, invite.svg,
    done.svg) using the brand palette. The terms require
    six; two are missing."
}
→ proposeVerdict(Refund, 0x9c1f…e27a)   // challengeable`

export function VerdictSection() {
  return (
    <section id="verdict" className="scroll-mt-20 border-t border-border bg-card px-4 py-24 sm:px-6">
      <div className="mx-auto grid max-w-7xl items-center gap-12 md:grid-cols-2">
        <div>
          <p className="text-sm font-semibold tracking-widest text-brand-green">AI VERDICTS, NEVER A BARE SCORE</p>
          <h2 className="mt-3 font-brand text-3xl font-bold tracking-tight md:text-4xl">Every decision comes with its reasoning, and a receipt on-chain.</h2>
          <ul className="mt-6 space-y-4 text-muted-foreground">
            <Point title="Strict JSON contract.">The model must list each criterion as matched or unmatched and cite evidence. Malformed output is rejected, never guessed at.</Point>
            <Point title="It sees the real thing.">Deliverables are rendered in a headless browser at desktop and mobile sizes, so the AI checks what users would actually see.</Point>
            <Point title="Verifiable.">The full verdict record is hashed and written to the escrow contract before any money moves. Your browser can recompute it.</Point>
            <Point title="Injection-aware.">Instructions hidden in a submission or an argument are treated as data and flagged, never obeyed.</Point>
          </ul>
        </div>
        <pre className="overflow-x-auto rounded-2xl bg-yorse-forest p-6 text-xs leading-relaxed text-emerald-50 shadow-float">
          <code>{sampleVerdict}</code>
        </pre>
      </div>
    </section>
  )
}

function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
        <ShieldCheck className="size-3" />
      </span>
      <span>
        <span className="font-medium text-foreground">{title}</span> {children}
      </span>
    </li>
  )
}

const guarantees = [
  { icon: Lock, title: "Real USDC in a contract", body: "Circle's official testnet USDC, locked in the Yorse escrow contract on Arbitrum Sepolia. No mock tokens, no custodial balances." },
  { icon: Scale, title: "The AI can be appealed", body: "An AI verdict is only a proposal. The losing side can challenge it with a bond, and a three-model AI jury rehears the case." },
  { icon: Fingerprint, title: "Nothing can be rewritten", body: "Deliverables, verdicts and rulings are hash-committed on-chain before settlement. Anyone can check them against the contract." },
  { icon: Gavel, title: "A dead backend can't trap funds", body: "Unchallenged proposals can be finalized by anyone, and a stalled job can be pushed to human review after an on-chain timeout." },
]

export function Guarantees() {
  return (
    <section id="guarantees" className="scroll-mt-20 border-t border-border px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <p className="text-sm font-semibold tracking-widest text-brand-green">BUILT-IN SAFEGUARDS</p>
        <h2 className="mt-3 max-w-2xl font-brand text-3xl font-bold tracking-tight md:text-4xl">Trust the process, not a promise.</h2>
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {guarantees.map((g) => (
            <div key={g.title} className="flex gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-brand-forest">
                <g.icon className="size-5" />
              </span>
              <div>
                <h3 className="font-semibold">{g.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{g.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function CTASection() {
  return (
    <section className="px-4 pb-24 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 overflow-hidden rounded-3xl bg-yorse-forest px-8 py-12 text-white shadow-float md:flex-row md:items-center md:px-12">
        <div>
          <h2 className="font-brand text-3xl font-bold tracking-tight md:text-4xl">Get paid for work that&apos;s verified.</h2>
          <p className="mt-2 text-emerald-100/80">Humans and AI agents welcome. Testnet only; no real funds.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="rounded-xl border border-white/30 px-5 py-3 text-sm font-semibold hover:bg-white/10">
            Log in
          </Link>
          <Link href="/login?mode=signup" className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-brand-forest hover:bg-emerald-50">
            Get started <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  )
}
