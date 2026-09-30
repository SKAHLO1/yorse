"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { erc20Abi, formatEther, formatUnits, isAddressEqual } from "viem"
import { useBalance, useConnection, useReadContract } from "wagmi"
import { ArrowDownLeft, ArrowUpRight, Droplets, ExternalLink, Lock, ShieldCheck, Wallet } from "lucide-react"
import { AppShell } from "@/components/app/app-shell"
import { LinkWalletButton } from "@/components/app/wallet-button"
import { useAuth } from "@/components/auth-provider"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/lib/api"
import type { Job } from "@/lib/types"
import { cn } from "@/lib/utils"
import { addrUrl, CHAIN, CIRCLE_USDC, shortAddr } from "@/lib/web3"

const LOCKED = ["funded", "submitted", "proposed", "challenged", "disputed"]

export default function WalletPage() {
  return (
    <AppShell>
      <WalletView />
    </AppShell>
  )
}

function WalletView() {
  const { me } = useAuth()
  const { address, chainId, isConnected } = useConnection()
  const onChain = isConnected && chainId === CHAIN.id && !!address
  const eth = useBalance({ address, chainId: CHAIN.id, query: { enabled: onChain } })
  const usdc = useReadContract({ address: CIRCLE_USDC, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: CHAIN.id, query: { enabled: onChain } })
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api<{ jobs: Job[] }>("/jobs").then((r) => r.jobs), enabled: !!me })

  const mine = jobs.data ?? []
  const sum = (js: Job[]) => js.reduce((s, j) => s + Number(j.amountUsdc), 0)
  const lockedAsClient = sum(mine.filter((j) => j.clientUid === me?.uid && LOCKED.includes(j.status)))
  const pendingAsFreelancer = sum(mine.filter((j) => j.freelancerUid === me?.uid && LOCKED.includes(j.status)))
  const earned = sum(mine.filter((j) => j.freelancerUid === me?.uid && (j.status === "released" || j.status === "resolved_release")))
  const refunded = sum(mine.filter((j) => j.clientUid === me?.uid && (j.status === "refunded" || j.status === "resolved_refund")))
  const linked = !!me?.walletAddress && !!address && isAddressEqual(me.walletAddress, address)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-brand text-2xl font-bold">Wallet</h1>
        <p className="text-sm text-muted-foreground">Your linked wallet, balances on Arbitrum Sepolia, and the USDC moving through your escrows.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="relative overflow-hidden rounded-2xl bg-yorse-forest p-6 text-white shadow-float">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm text-emerald-100/80">
              <Wallet className="size-4" /> Linked wallet
            </span>
            <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", me?.walletAddress ? "bg-emerald-400/20 text-emerald-200" : "bg-amber-400/20 text-amber-200")}>
              {me?.walletAddress ? "Linked" : "Not linked"}
            </span>
          </div>
          <div className="mt-4 break-all font-mono text-lg">{me?.walletAddress ?? "No wallet linked yet"}</div>
          {me?.walletAddress && (
            <a href={addrUrl(me.walletAddress)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-200 hover:underline">
              View on Arbiscan <ExternalLink className="size-3" />
            </a>
          )}
          <div className="mt-8 grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-emerald-100/70">USDC balance</div>
              <div className="mt-1 font-brand text-3xl font-bold">{onChain && usdc.data !== undefined ? Number(formatUnits(usdc.data, 6)).toFixed(2) : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-emerald-100/70">ETH for gas</div>
              <div className="mt-1 font-brand text-3xl font-bold">{onChain && eth.data ? Number(formatEther(eth.data.value)).toFixed(4) : "—"}</div>
            </div>
          </div>
          {!onChain && <p className="mt-4 text-xs text-emerald-100/70">Connect your wallet on Arbitrum Sepolia to see live balances.</p>}
          {onChain && !linked && <p className="mt-4 text-xs text-amber-200">Balances shown are for the connected wallet {shortAddr(address)}, which isn't your linked wallet.</p>}
        </div>

        <Card className="shadow-soft">
          <CardHeader>
            <CardTitle className="text-base">Link a wallet</CardTitle>
            <CardDescription>
              Clients fund escrow from their linked wallet; developers are paid to theirs. Linking asks for a free signature, never a transaction.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LinkWalletButton />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile icon={Lock} label="Locked in your escrows" value={lockedAsClient} hint="As a client, until a verdict settles" />
        <Tile icon={ShieldCheck} label="Pending to you" value={pendingAsFreelancer} hint="Funded jobs you're delivering" />
        <Tile icon={ArrowDownLeft} label="Earned" value={earned} hint="Released to you" tone="green" />
        <Tile icon={ArrowUpRight} label="Refunded to you" value={refunded} hint="Returned from escrow" />
      </div>

      <Card className="shadow-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Droplets className="size-4 text-brand-green" /> Testnet funds
          </CardTitle>
          <CardDescription>Yorse runs on Arbitrum Sepolia with Circle's testnet USDC. None of it has real value.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Faucet href="https://faucet.circle.com" label="Circle USDC faucet" sub="Pick Arbitrum Sepolia" />
          <Faucet href="https://www.alchemy.com/faucets/arbitrum-sepolia" label="Arbitrum Sepolia ETH" sub="For gas" />
          <Faucet href={addrUrl(CIRCLE_USDC)} label="USDC contract" sub={shortAddr(CIRCLE_USDC)} />
          <Link href="/dashboard" className="ml-auto self-center text-sm text-brand-green hover:underline">
            Back to dashboard →
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}

function Tile({ icon: Icon, label, value, hint, tone }: { icon: typeof Lock; label: string; value: number; hint: string; tone?: "green" }) {
  return (
    <Card className="gap-2 py-5 shadow-soft">
      <CardContent className="px-5">
        <span className={cn("flex size-9 items-center justify-center rounded-lg", tone === "green" ? "bg-emerald-50 text-emerald-600" : "bg-accent text-brand-forest")}>
          <Icon className="size-4" />
        </span>
        <div className="mt-3 text-xs text-muted-foreground">{label}</div>
        <div className="font-brand text-2xl font-bold">
          {value.toFixed(2)} <span className="text-sm font-medium text-muted-foreground">USDC</span>
        </div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  )
}

function Faucet({ href, label, sub }: { href: string; label: string; sub: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm transition-colors hover:border-brand-green/40">
      <span>
        <span className="block font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{sub}</span>
      </span>
      <ExternalLink className="size-3.5 text-muted-foreground" />
    </a>
  )
}
