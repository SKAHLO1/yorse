"use client"

import { motion } from "framer-motion"
import Link from "next/link"
import { ArrowRight, Bot, Check, CheckCircle2, DollarSign, Gavel, PlayCircle, Scale, ShieldCheck, Sparkles, UserRound, Users } from "lucide-react"
import { cn } from "@/lib/utils"

const rise = (delay = 0) => ({ initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, delay } })

export function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="relative overflow-hidden bg-yorse-wash pt-28">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-12 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:px-8">
        <div>
          <motion.div {...rise()} className="inline-flex flex-wrap items-center gap-x-2 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-brand-forest ring-1 ring-emerald-600/10">
            <span>Onchain Escrow</span>
            <span className="text-emerald-500">•</span>
            <span>AI Verified</span>
            <span className="text-emerald-500">•</span>
            <span>Built for Freelancers</span>
          </motion.div>
          <motion.h1 {...rise(0.05)} className="mt-6 font-brand text-5xl font-bold leading-[1.02] tracking-tight text-[#0a1a13] sm:text-6xl xl:text-7xl">
            Work Gets Done.
            <br />
            <span className="text-yorse-gradient">Money Moves.</span>
          </motion.h1>
          <motion.p {...rise(0.1)} className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Yorse is a decentralized freelance payments platform where clients fund milestone escrow in USDC and an AI verifies the deliverable before funds are
            released. Anyone can appeal a verdict to an AI jury, with humans as the final fallback.
          </motion.p>
          <motion.div {...rise(0.15)} className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={signedIn ? "/dashboard" : "/login?mode=signup"}
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-float transition-transform hover:-translate-y-0.5"
            >
              {signedIn ? "Open dashboard" : "Get Started"} <ArrowRight className="size-4" />
            </Link>
            <a href="#how" className="inline-flex h-12 items-center gap-2 rounded-xl border border-border bg-card px-6 text-sm font-semibold shadow-soft hover:border-brand-green/40">
              <PlayCircle className="size-4" /> How It Works
            </a>
          </motion.div>
          <motion.ul {...rise(0.2)} className="mt-10 grid gap-5 sm:grid-cols-3">
            {[
              { icon: ShieldCheck, title: "Smart Escrow", sub: "USDC on Arbitrum Sepolia" },
              { icon: Sparkles, title: "AI Verification", sub: "Checks the real deliverable" },
              { icon: Users, title: "Dispute Fallback", sub: "AI jury, then a human" },
            ].map(({ icon: Icon, title, sub }) => (
              <li key={title} className="flex items-center gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-brand-forest ring-1 ring-emerald-600/10">
                  <Icon className="size-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="block text-xs text-muted-foreground">{sub}</span>
                </span>
              </li>
            ))}
          </motion.ul>
        </div>

        <HeroArt />
      </div>

      <div className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="grid rounded-2xl border border-border bg-card/80 shadow-soft backdrop-blur sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Check, title: "Onchain", sub: "Every verdict hash-committed" },
            { icon: Scale, title: "Appealable", sub: "Challenge any AI verdict" },
            { icon: ShieldCheck, title: "Secure", sub: "Circle USDC · Arbitrum Sepolia" },
            { icon: Gavel, title: "Fair", sub: "3-model AI jury + humans" },
          ].map(({ icon: Icon, title, sub }, i) => (
            <div key={title} className={cn("flex items-center gap-4 px-6 py-6", i > 0 && "border-t border-border sm:border-t-0 lg:border-l", i === 2 && "sm:border-t lg:border-t-0")}>
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-brand-forest">
                <Icon className="size-5" />
              </span>
              <span>
                <span className="block font-brand text-xl font-bold">{title}</span>
                <span className="block text-sm text-muted-foreground">{sub}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** The coin-on-a-platform illustration with floating status cards, drawn in SVG + CSS. */
function HeroArt() {
  return (
    <div className="relative mx-auto h-[440px] w-full max-w-[560px] sm:h-[520px]">
      {/* orbits */}
      <svg viewBox="0 0 560 520" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <radialGradient id="glow" cx="50%" cy="55%" r="50%">
            <stop offset="0" stopColor="#22c55e" stopOpacity="0.28" />
            <stop offset="1" stopColor="#22c55e" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="280" cy="300" rx="260" ry="190" fill="url(#glow)" />
        <ellipse cx="280" cy="290" rx="230" ry="90" fill="none" stroke="#16a34a" strokeOpacity="0.25" strokeDasharray="3 7" />
        <ellipse cx="280" cy="290" rx="170" ry="62" fill="none" stroke="#16a34a" strokeOpacity="0.35" />
        <circle cx="120" cy="252" r="3" fill="#22c55e" />
        <circle cx="448" cy="330" r="3" fill="#22c55e" />
        <circle cx="330" cy="352" r="2.5" fill="#16a34a" />
      </svg>

      {/* platform */}
      <svg viewBox="0 0 300 180" className="absolute left-1/2 top-[47%] w-[66%] -translate-x-1/2" aria-hidden>
        <path d="M150 20 L290 90 L150 160 L10 90 Z" fill="#dcfce7" />
        <path d="M10 90 L150 160 L150 176 L10 106 Z" fill="#86efac" />
        <path d="M290 90 L150 160 L150 176 L290 106 Z" fill="#4ade80" />
        <path d="M150 40 L250 90 L150 140 L50 90 Z" fill="#bbf7d0" />
        <path d="M50 90 L150 140 L150 152 L50 102 Z" fill="#22c55e" />
        <path d="M250 90 L150 140 L150 152 L250 102 Z" fill="#16a34a" />
        <path d="M150 58 L214 90 L150 122 L86 90 Z" fill="#0e3b2b" opacity="0.9" />
      </svg>

      {/* coin */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="absolute left-1/2 top-[25%] -translate-x-1/2"
      >
        <div className="animate-float">
          <div className="relative size-44 sm:size-52">
            <div className="absolute inset-0 translate-x-2 translate-y-2 rounded-full bg-emerald-950" />
            <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_25%,#6ee7b7_0%,#16a34a_45%,#065f46_100%)] shadow-[0_30px_60px_-20px_rgba(6,78,59,0.6)]" />
            <div className="absolute inset-[12%] rounded-full border-[6px] border-emerald-200/60 bg-[radial-gradient(circle_at_35%_30%,#34d399,#047857_80%)]" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-20 items-center justify-center rounded-full border-[5px] border-white/90 sm:size-24">
                <DollarSign className="size-12 text-white sm:size-14" strokeWidth={2.6} />
              </span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* floating cards */}
      <FloatCard className="left-[4%] top-[2%] w-56" delay={0.35}>
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-emerald-600 text-white">
            <Check className="size-5" strokeWidth={3} />
          </span>
          <span>
            <span className="block text-xs text-muted-foreground">Payment secured</span>
            <span className="block font-brand text-lg font-bold">250 USDC</span>
            <span className="block text-[11px] text-muted-foreground">Escrowed on Arbitrum Sepolia</span>
          </span>
        </div>
      </FloatCard>

      <FloatCard className="-left-6 top-[36%] hidden w-44 sm:block" delay={0.45}>
        <Party icon={UserRound} tint="bg-sky-100 text-sky-700" title="Client" sub="Funds milestone" />
      </FloatCard>
      <FloatCard className="-left-6 top-[55%] hidden w-44 sm:block" delay={0.55}>
        <Party icon={UserRound} tint="bg-amber-100 text-amber-700" title="Freelancer" sub="Submits deliverable" />
      </FloatCard>

      <FloatCard className="-right-6 top-[6%] hidden w-52 md:block" delay={0.5}>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bot className="size-4 text-brand-green" /> AI verifying…
        </div>
        <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
          {["Fetching the deliverable", "Matching every criterion", "Hashing the verdict"].map((t) => (
            <li key={t} className="flex items-center gap-2">
              <CheckCircle2 className="size-3.5 text-emerald-500" /> {t}
            </li>
          ))}
        </ul>
        <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
          <ShieldCheck className="size-3" /> 92% confidence
        </span>
      </FloatCard>

      <FloatCard className="-right-6 bottom-[2%] w-56" delay={0.65}>
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-600/20">
            <Scale className="size-4" />
          </span>
          <span>
            <span className="block text-sm font-semibold">Ready to release</span>
            <span className="block text-xs text-muted-foreground">Settles automatically if nobody challenges in time.</span>
          </span>
        </div>
      </FloatCard>
    </div>
  )
}

function FloatCard({ className, delay, children }: { className?: string; delay: number; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay }}
      className={cn("absolute z-10 rounded-2xl border border-border/80 bg-white/95 p-4 shadow-float backdrop-blur", className)}
    >
      {children}
    </motion.div>
  )
}

function Party({ icon: Icon, tint, title, sub }: { icon: typeof UserRound; tint: string; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={cn("flex size-10 items-center justify-center rounded-full", tint)}>
        <Icon className="size-5" />
      </span>
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{sub}</span>
      </span>
    </div>
  )
}
