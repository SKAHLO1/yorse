"use client"

import { useConnection } from "wagmi"
import { cn } from "@/lib/utils"
import { CHAIN } from "@/lib/web3"

/** "Arbitrum Sepolia ●": green when the connected wallet is on the right network, amber when it isn't. */
export function NetworkPill({ className }: { className?: string }) {
  const { chainId, isConnected } = useConnection()
  const wrong = isConnected && chainId !== CHAIN.id
  return (
    <span
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground shadow-soft",
        className,
      )}
      title={wrong ? "Your wallet is on a different network" : "Yorse runs on Arbitrum Sepolia"}
    >
      <ArbitrumGlyph className="size-4" />
      Arbitrum Sepolia
      <span className={cn("size-2 rounded-full", wrong ? "bg-amber-500" : "bg-emerald-500")} />
    </span>
  )
}

export function ArbitrumGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="16" cy="16" r="16" fill="#213147" />
      <path d="M17.6 9.2 23 18.6l-1.9 1.1-5.3-9.3 1.8-1.2Zm-3.2 0 1.8 1.2-6.9 12-1.9-1.1 7-12.1Zm5.6 11.3 1.9-1.1 1.4 2.4-1.9 1.1-1.4-2.4Z" fill="#12AAFF" />
      <path d="M16 6.5 24.3 11.3v9.4L16 25.5l-8.3-4.8v-9.4L16 6.5Z" fill="none" stroke="#9DCCED" strokeWidth="1.2" />
    </svg>
  )
}
