"use client"

import { isAddressEqual } from "viem"
import { useConnection, useDisconnect, useSignMessage, useSwitchChain } from "wagmi"
import { useState } from "react"
import { toast } from "sonner"
import { CheckCircle2, Link2, Loader2, Wallet } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { api, errorText } from "@/lib/api"
import type { Me } from "@/lib/types"
import { cn } from "@/lib/utils"
import { addrUrl, CHAIN, shortAddr } from "@/lib/web3"
import { ConnectWalletDialog } from "./connect-wallet-dialog"

/**
 * Connecting a wallet and linking it to the Yorse account are two different things:
 * connecting is local to the browser, linking proves ownership by signature so the
 * backend can escrow to that address. The UI must never let the first look like the second.
 */
export function WalletButton() {
  const { address, chainId, isConnected } = useConnection()
  const { me, refreshMe } = useAuth()
  const linking = useLinkWallet(refreshMe)
  const disconnect = useDisconnect()
  const linked = !!me?.walletAddress && !!address && isAddressEqual(me.walletAddress, address)

  if (!isConnected || !address) return <ConnectButton />
  if (chainId !== CHAIN.id) return <SwitchChainButton />

  return (
    <div className="flex items-center gap-2">
      {!linked && (
        <Button size="sm" onClick={() => linking.link(address)} disabled={linking.busy} className="bg-brand-green text-white hover:bg-brand-green/90">
          {linking.busy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
          {linking.busy ? "Check your wallet…" : me?.walletAddress ? "Link this wallet" : "Link wallet"}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className={cn("h-9 rounded-lg bg-card", linked ? "border-brand-teal/40" : "border-border")}>
            {linked ? <CheckCircle2 className="size-4 text-brand-teal" /> : <Wallet className="size-4 text-muted-foreground" />}
            {shortAddr(address)}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Connected on Arbitrum Sepolia
            <div className="mt-1 font-mono text-foreground">{address}</div>
            <div className={cn("mt-1", linked ? "text-brand-teal" : "text-brand-orange")}>
              {linked ? "Linked to your Yorse account" : "Not linked yet — you can't post, fund or be paid until you link"}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {!linked && (
            <DropdownMenuItem onSelect={() => linking.link(address)} disabled={linking.busy}>
              <Link2 className="size-4" />
              {me?.walletAddress ? `Replace linked wallet (${shortAddr(me.walletAddress)})` : "Link this wallet to my account"}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <a href={addrUrl(address)} target="_blank" rel="noreferrer">
              View on Arbiscan
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => disconnect.mutate()}>Disconnect</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function ConnectButton({ className, label = "Connect Wallet" }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" className={cn("h-9 rounded-lg px-4 shadow-soft", className)} onClick={() => setOpen(true)}>
        <Wallet className="size-4" />
        {label}
      </Button>
      <ConnectWalletDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

/** Compact wallet state for the sidebar footer: address, network and whether it's linked. */
export function WalletStatusCard() {
  const { address, chainId, isConnected } = useConnection()
  const { me } = useAuth()
  const [open, setOpen] = useState(false)
  const linked = !!me?.walletAddress && !!address && isAddressEqual(me.walletAddress, address)
  const state = !isConnected || !address ? "off" : chainId !== CHAIN.id ? "chain" : linked ? "linked" : "unlinked"
  const shown = address ?? me?.walletAddress ?? null
  return (
    <>
      <button
        type="button"
        onClick={() => state === "off" && setOpen(true)}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border border-sidebar-border bg-white/5 p-3 text-left transition-colors",
          state === "off" && "hover:bg-white/10",
        )}
      >
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold",
            state === "linked" ? "bg-emerald-400 text-emerald-950" : "bg-white/10 text-emerald-100",
          )}
        >
          <Wallet className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-mono text-sm text-white">{shown ? shortAddr(shown) : "No wallet"}</span>
          <span
            className={cn(
              "flex items-center gap-1.5 text-xs",
              state === "linked" ? "text-emerald-300" : state === "off" ? "text-emerald-100/60" : "text-amber-300",
            )}
          >
            <span className={cn("size-1.5 rounded-full", state === "linked" ? "bg-emerald-400" : state === "off" ? "bg-white/40" : "bg-amber-400")} />
            {state === "linked" ? "Connected · linked" : state === "chain" ? "Wrong network" : state === "unlinked" ? "Connected · not linked" : "Click to connect"}
          </span>
        </span>
      </button>
      <ConnectWalletDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

function SwitchChainButton({ className }: { className?: string }) {
  const switchChain = useSwitchChain()
  return (
    <Button size="sm" variant="destructive" className={cn("h-9 rounded-lg", className)} onClick={() => switchChain.mutate({ chainId: CHAIN.id }, { onError: (e) => toast.error(errorText(e)) })}>
      Switch to Arbitrum Sepolia
    </Button>
  )
}

/**
 * Drop-in control for anywhere a linked wallet is required. Walks the whole sequence:
 * connect -> right network -> sign to link, and reports why it stopped if it fails.
 */
export function LinkWalletButton({ className }: { className?: string }) {
  const { address, chainId, isConnected } = useConnection()
  const { me, refreshMe } = useAuth()
  const linking = useLinkWallet(refreshMe)
  const linked = !!me?.walletAddress && !!address && isAddressEqual(me.walletAddress, address)

  if (!isConnected || !address) return <ConnectButton className={className} label="Connect wallet" />
  if (chainId !== CHAIN.id) return <SwitchChainButton className={className} />
  if (linked) {
    return (
      <p className="flex items-center gap-2 text-sm text-brand-teal">
        <CheckCircle2 className="size-4" /> Wallet linked ({shortAddr(address)})
      </p>
    )
  }
  return (
    <div className={cn("space-y-2", className)}>
      <Button size="sm" onClick={() => linking.link(address)} disabled={linking.busy} className="bg-brand-green text-white hover:bg-brand-green/90">
        {linking.busy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
        {linking.busy ? "Check your wallet…" : `Link ${shortAddr(address)}`}
      </Button>
      {linking.error && <p className="text-sm text-destructive-foreground">{linking.error}</p>}
      {linking.busy && <p className="text-xs text-muted-foreground">Your wallet will ask you to sign a message. It's free and sends no transaction.</p>}
    </div>
  )
}

export function useLinkWallet(refreshMe: () => Promise<void>) {
  const sign = useSignMessage()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function link(address: `0x${string}`) {
    setBusy(true)
    setError(null)
    try {
      const { message } = await api<{ message: string }>("/me/wallet/challenge", { method: "POST", body: {} })
      const signature = await sign.mutateAsync({ message, account: address })
      await api<{ user: Me }>("/me/wallet", { body: { address, signature } })
      await refreshMe()
      toast.success("Wallet linked to your Yorse account")
    } catch (err) {
      // Rejecting the signature prompt is the common case, so name it plainly.
      const raw = errorText(err)
      const message = /user rejected|denied|4001/i.test(raw)
        ? "You dismissed the signature request in your wallet. Linking needs that signature — it's free and sends no transaction."
        : `Wallet link failed: ${raw}`
      setError(message)
      toast.error(message, { duration: 10_000 })
    } finally {
      setBusy(false)
    }
  }

  return { link, busy, error }
}
