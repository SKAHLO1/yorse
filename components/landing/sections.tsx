import Link from "next/link"
import { Bot, FileCheck2, Gavel, Handshake, Lock, Scale, ShieldCheck, Wallet } from "lucide-react"

const steps = [
  { icon: Handshake, title: "Agree on terms", body: "The client writes the deliverable and concrete acceptance criteria. The freelancer accepts them before any money moves." },
  { icon: Wallet, title: "Fund the escrow", body: "The client locks USDC in the Yorse escrow contract on Arbitrum Sepolia. The backend checks the on-chain amount and wallets against the terms." },
  { icon: FileCheck2, title: "Submit the work", body: "The freelancer submits a link to the real deliverable. Yorse fetches it as evidence; claims alone are never treated as proof." },
  { icon: Bot, title: "AI verifies, rules decide", body: "The AI returns a structured verdict with reasoning. Escrow is released only if every criterion matches at 85%+ confidence; otherwise an admin decides." },
]

export function HowItWorks() {
  return (
    <section id="how" className="px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-medium tracking-widest text-[#17B0A6]">HOW IT WORKS</p>
        <h2 className="mt-3 max-w-2xl text-3xl font-medium tracking-tight text-white md:text-4xl">From agreed terms to payout, with evidence at every step.</h2>
        <div className="mt-12 grid gap-4 md:grid-cols-4">
          {steps.map((s, i) => (
            <div key={s.title} className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#5C1F38] text-sm font-semibold text-white">{i + 1}</span>
                <s.icon className="h-5 w-5 text-[#17B0A6]" />
              </div>
              <h3 className="mt-4 font-medium text-white">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const sampleVerdict = `{
  "verdict": "dispute",
  "confidence": 0.58,
  "matched_criteria": [
    "Illustrations use the brand palette",
    "Delivered as SVG files"
  ],
  "unmatched_criteria": [
    "Six onboarding illustrations"
  ],
  "reasoning": "The shared folder contains four SVG illustrations
    (welcome.svg, profile.svg, invite.svg, done.svg) using the
    brand palette. The terms require six; two are missing."
}`

export function VerdictSection() {
  return (
    <section id="verdict" className="border-t border-zinc-900 px-6 py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2">
        <div>
          <p className="text-sm font-medium tracking-widest text-[#17B0A6]">AI VERDICTS, NEVER A BARE SCORE</p>
          <h2 className="mt-3 text-3xl font-medium tracking-tight text-white md:text-4xl">Every decision comes with its reasoning.</h2>
          <ul className="mt-6 space-y-4 text-zinc-400">
            <li>
              <span className="text-white">Strict JSON contract.</span> The model must list each criterion as matched or unmatched and cite evidence. Malformed output is rejected, never guessed at.
            </li>
            <li>
              <span className="text-white">Uncertain means dispute.</span> Low confidence, missing evidence or an unreachable link sends the job to a human admin instead of paying out.
            </li>
            <li>
              <span className="text-white">Resilient.</span> Groq (GPT-OSS 120B) runs first, and Google Gemini takes over automatically if Groq is rate-limited or down.
            </li>
            <li>
              <span className="text-white">Injection-aware.</span> Instructions hidden in a submission are treated as data and flagged, never obeyed.
            </li>
          </ul>
        </div>
        <pre className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-xs leading-relaxed text-zinc-300">
          <code>{sampleVerdict}</code>
        </pre>
      </div>
    </section>
  )
}

const guarantees = [
  { icon: Lock, title: "Real USDC in a contract", body: "Circle's official testnet USDC, locked in the Yorse escrow contract on Arbitrum Sepolia. No mock tokens, no custodial balances." },
  { icon: ShieldCheck, title: "The AI never touches funds", body: "Only the backend relayer can release or refund, and only after the 0.85 confidence rule passes. The AI can't move funds, and nothing pays out on a timer." },
  { icon: Gavel, title: "Humans resolve disputes", body: "Admins see the terms, submission, AI reasoning, complaints and reviews in one place, then release or refund on-chain." },
  { icon: Scale, title: "Accountable after payout", body: "Both parties can review each other and file complaints that admins moderate." },
]

export function Guarantees() {
  return (
    <section id="guarantees" className="border-t border-zinc-900 px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-medium tracking-widest text-[#17B0A6]">BUILT-IN SAFEGUARDS</p>
        <h2 className="mt-3 max-w-2xl text-3xl font-medium tracking-tight text-white md:text-4xl">Trust the process, not a promise.</h2>
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {guarantees.map((g) => (
            <div key={g.title} className="flex gap-4 rounded-xl border border-zinc-800 bg-zinc-950 p-5">
              <g.icon className="mt-0.5 h-5 w-5 shrink-0 text-[#E85D3D]" />
              <div>
                <h3 className="font-medium text-white">{g.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-zinc-400">{g.body}</p>
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
    <section className="border-t border-zinc-900 px-6 py-24">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-8 md:flex-row">
        <h2 className="text-3xl font-medium tracking-tight text-white md:text-4xl lg:text-[42px]">Get paid for work that's verified.</h2>
        <div className="flex items-center gap-3">
          <Link href="/login" className="rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800">
            Log in
          </Link>
          <Link href="/login?mode=signup" className="rounded-lg bg-[#17B0A6] px-5 py-2.5 text-sm font-medium text-[#03201d] transition-colors hover:bg-[#1bc4b9]">
            Get started
          </Link>
        </div>
      </div>
    </section>
  )
}
