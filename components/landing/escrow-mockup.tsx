import { Bot, CheckCircle2, CircleDollarSign, Gavel, LayoutDashboard, Plus, ShieldCheck, XCircle } from "lucide-react"
import { YorseMark } from "../yorse-logo"

const jobs = [
  { title: "Marketing site redesign", who: "ada@studio.dev", amount: "1,200.00", status: "Released", tone: "text-[#17B0A6] border-[#17B0A6]/30 bg-[#17B0A6]/10" },
  { title: "Stripe webhook service", who: "k.osei@hey.com", amount: "850.00", status: "Verifying", tone: "text-violet-300 border-violet-500/30 bg-violet-500/10" },
  { title: "Onboarding illustrations", who: "mira@draws.co", amount: "400.00", status: "Disputed", tone: "text-[#E85D3D] border-[#E85D3D]/40 bg-[#E85D3D]/10" },
  { title: "iOS widget prototype", who: "tomas@build.io", amount: "2,000.00", status: "Funded", tone: "text-sky-300 border-sky-500/30 bg-sky-500/10" },
  { title: "Pitch deck copy", who: "lee@words.co", amount: "300.00", status: "Awaiting funding", tone: "text-amber-300 border-amber-500/30 bg-amber-500/10" },
  { title: "Data pipeline audit", who: "sam@infra.dev", amount: "1,500.00", status: "Released", tone: "text-[#17B0A6] border-[#17B0A6]/30 bg-[#17B0A6]/10" },
]

/** Static product illustration for the landing hero (not live data). */
export function EscrowMockup() {
  return (
    <div className="flex h-full w-full bg-[#09090B] text-sm text-zinc-300">
      <aside className="flex w-60 flex-col gap-1 border-r border-zinc-800 p-4">
        <div className="mb-4 flex items-center gap-2">
          <YorseMark className="h-5 w-5" />
          <span className="font-semibold text-white">Yorse</span>
        </div>
        {[
          [LayoutDashboard, "Dashboard", true],
          [Plus, "New job", false],
          [Gavel, "Disputes", false],
          [ShieldCheck, "Admin", false],
        ].map(([Icon, label, active]: any) => (
          <div key={label} className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${active ? "bg-zinc-800 text-white" : "text-zinc-500"}`}>
            <Icon className="h-4 w-4" /> {label}
          </div>
        ))}
        <div className="mt-auto rounded-lg border border-zinc-800 p-3 text-xs">
          <div className="text-zinc-500">USDC in escrow</div>
          <div className="mt-1 text-xl font-semibold text-white">4,550.00</div>
          <div className="mt-1 text-zinc-500">Arbitrum Sepolia</div>
        </div>
      </aside>

      <section className="w-[560px] border-r border-zinc-800">
        <div className="border-b border-zinc-800 px-5 py-3 text-white">Jobs</div>
        {jobs.map((j) => (
          <div key={j.title} className="flex items-center gap-3 border-b border-zinc-900 px-5 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-zinc-100">{j.title}</div>
              <div className="text-xs text-zinc-500">{j.who}</div>
            </div>
            <span className="font-mono text-xs text-zinc-400">{j.amount}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${j.tone}`}>{j.status}</span>
          </div>
        ))}
      </section>

      <section className="flex-1 space-y-4 p-6">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-white">Marketing site redesign</h2>
          <span className="rounded-full border border-[#17B0A6]/30 bg-[#17B0A6]/10 px-2 py-0.5 text-[11px] text-[#17B0A6]">Released</span>
        </div>
        <div className="rounded-xl border border-[#17B0A6]/40 bg-[#17B0A6]/5 p-4">
          <div className="flex items-center gap-2 text-white">
            <Bot className="h-4 w-4 text-zinc-400" /> AI verdict: release · confidence 94%
          </div>
          <div className="mt-2 h-2 rounded-full bg-zinc-800">
            <div className="h-2 w-[94%] rounded-full bg-[#17B0A6]" />
          </div>
          <p className="mt-3 leading-relaxed text-zinc-300">
            The deployed site at the submitted URL has a hero with the approved headline, a pricing section with three tiers, and a contact form that posts to
            /api/contact. The README reports a Lighthouse performance score of 97, above the required 90.
          </p>
          <div className="mt-3 space-y-1.5">
            {["Hero uses the approved headline", "Pricing section with three tiers", "Contact form posts to /api/contact", "Lighthouse performance ≥ 90"].map((c) => (
              <div key={c} className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[#17B0A6]" /> {c}
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-[#E85D3D]/40 bg-[#E85D3D]/5 p-4">
          <div className="flex items-center gap-2 text-white">
            <Bot className="h-4 w-4 text-zinc-400" /> Onboarding illustrations · dispute · confidence 58%
          </div>
          <div className="mt-2 flex items-center gap-2 text-zinc-300">
            <XCircle className="h-4 w-4 text-[#E85D3D]" /> Six illustrations delivered as SVG — only four found in the shared folder
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <CircleDollarSign className="h-4 w-4" /> escrow.release() · 1,200.00 USDC → 0x7a3f…91c2
        </div>
      </section>
    </div>
  )
}
