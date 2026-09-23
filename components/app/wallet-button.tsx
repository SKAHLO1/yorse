"use client"

import { isAddressEqual } from "viem"
import { useConnect, useConnection, useConnectors, useDisconnect, useSignMessage, useSwitchChain } from "wagmi"
import { useState } from "react"
import { toast } from "sonner"
import { CheckCircle2, Link2, Wallet } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { api, errorText } from "@/lib/api"
import type { Me } from "@/lib/types"
import { addrUrl, CHAIN, shortAddr } from "@/lib/web3"

/** Connect wallet, switch to Arbitrum Sepolia, and link the wallet to the Yorse account by signature. */
export function WalletButton() {
  const { address, chainId, isConnected } = useConnection()
  const connectors = useConnectors()
  const connect = useConnect()
  const disconnect = useDisconnect()
  const switchChain = useSwitchChain()
  const { me, refreshMe } = useAuth()
  const linking = useLinkWallet(refreshMe)

  if (!isConnected || !address) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={connect.isPending}
        onClick={() => {
          const c = connectors[0]
          if (!c) return toast.error("No browser wallet found. Install MetaMask or another injected wallet.")
          connect.mutate({ connector: c, chainId: CHAIN.id }, { onError: (e) => toast.error(errorText(e)) })
        }}
      >
        <Wallet className="size-4" />
        {connect.isPending ? "Connecting…" : "Connect wallet"}
      </Button>
    )
  }

  if (chainId !== CHAIN.id) {
    return (
      <Button size="sm" variant="destructive" onClick={() => switchChain.mutate({ chainId: CHAIN.id }, { onError: (e) => toast.error(errorText(e)) })}>
        Switch to Arbitrum Sepolia
      </Button>
    )
  }

  const linked = me?.walletAddress && isAddressEqual(me.walletAddress, address)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className={linked ? "border-brand-teal/40" : "border-brand-orange/50"}>
          {linked ? <CheckCircle2 className="size-4 text-brand-teal" /> : <Link2 className="size-4 text-brand-orange" />}
          {shortAddr(address)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Connected on Arbitrum Sepolia
          <div className="mt-1 font-mono text-foreground">{address}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {linked ? (
          <DropdownMenuItem disabled>
            <CheckCircle2 className="size-4 text-brand-teal" /> Linked to your account
          </DropdownMenuItem>
        ) : (
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
  )
}

export function useLinkWallet(refreshMe: () => Promise<void>) {
  const sign = useSignMessage()
  const [busy, setBusy] = useState(false)
  async function link(address: `0x${string}`) {
    setBusy(true)
    try {
      const { message } = await api<{ message: string }>("/me/wallet/challenge", { method: "POST", body: {} })
      const signature = await sign.mutateAsync({ message, account: address })
      await api<{ user: Me }>("/me/wallet", { body: { address, signature } })
      await refreshMe()
      toast.success("Wallet linked to your Yorse account")
    } catch (err) {
      toast.error(`Wallet link failed: ${errorText(err)}`)
    } finally {
      setBusy(false)
    }
  }
  return { link, busy }
}
