"use client"

import { useConnect, useConnectors } from "wagmi"
import { toast } from "sonner"
import { ArrowRight, Loader2, Wallet } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { YorseMark } from "@/components/yorse-logo"
import { errorText } from "@/lib/api"
import { cn } from "@/lib/utils"
import { PASSKEY_CONNECTOR_ID } from "@/lib/passkey"
import { CHAIN, EXPLORER } from "@/lib/web3"
import { PasskeyOption } from "./passkey-option"

/** Popular wallets we suggest installing when the browser doesn't have them. Matched against EIP-6963 names. */
const SUGGESTED = [
  { name: "MetaMask", match: /metamask/i, url: "https://metamask.io/download/", color: "#F6851B" },
  { name: "Coinbase Wallet", match: /coinbase/i, url: "https://www.coinbase.com/wallet/downloads", color: "#0052FF" },
  { name: "Rabby", match: /rabby/i, url: "https://rabby.io/", color: "#7084FF" },
  { name: "Rainbow", match: /rainbow/i, url: "https://rainbow.me/download", color: "#001E59" },
  { name: "Trust Wallet", match: /trust/i, url: "https://trustwallet.com/download", color: "#0500FF" },
]

export function ConnectWalletDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const connectors = useConnectors()
  const connect = useConnect()
  // wagmi lists every EIP-6963 wallet it discovers plus a generic "Injected" fallback.
  const discovered = connectors.filter((c) => c.type === "injected" && c.id !== "injected" && c.id !== PASSKEY_CONNECTOR_ID)
  const generic = connectors.find((c) => c.id === "injected")
  const wc = connectors.find((c) => c.type === "walletConnect")
  const installable = SUGGESTED.filter((s) => !discovered.some((c) => s.match.test(c.name)))

  function go(connector: (typeof connectors)[number]) {
    // WalletConnect shows its own QR modal; ours must get out of the way first.
    if (connector.type === "walletConnect") onOpenChange(false)
    connect.mutate(
      { connector, chainId: CHAIN.id },
      {
        onSuccess: () => onOpenChange(false),
        onError: (e) => toast.error(errorText(e)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <div className="grid md:grid-cols-[1fr_260px]">
          <div className="p-6">
            <DialogHeader className="text-left">
              <DialogTitle className="text-lg">Connect your wallet</DialogTitle>
              <DialogDescription>Use your crypto wallet to fund escrow and get paid. Make sure it's on Arbitrum Sepolia.</DialogDescription>
            </DialogHeader>

            <div className="mt-5">
              <PasskeyOption onConnected={() => onOpenChange(false)} />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {discovered.map((c, i) => (
                <WalletTile
                  key={c.uid}
                  name={c.name}
                  icon={c.icon}
                  tag={i === 0 ? "Detected" : undefined}
                  busy={connect.isPending && connect.variables?.connector === c}
                  disabled={connect.isPending}
                  onClick={() => go(c)}
                />
              ))}
              {wc && (
                <WalletTile
                  name="WalletConnect"
                  logo={<WalletConnectLogo />}
                  tag="Mobile & QR"
                  busy={connect.isPending && connect.variables?.connector === wc}
                  disabled={connect.isPending}
                  onClick={() => go(wc)}
                />
              )}
              {!discovered.length && generic && (
                <WalletTile name="Browser wallet" busy={connect.isPending} disabled={connect.isPending} onClick={() => go(generic)} />
              )}
              {installable.map((s) => (
                <a
                  key={s.name}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-background/40 px-3 py-4 text-center transition-colors hover:border-brand-green/40 hover:bg-accent/40"
                >
                  <span className="flex size-10 items-center justify-center rounded-xl text-sm font-bold text-white opacity-80" style={{ backgroundColor: s.color }}>
                    {s.name[0]}
                  </span>
                  <span className="text-sm font-medium">{s.name}</span>
                  <span className="text-[11px] text-muted-foreground group-hover:text-brand-green">Install →</span>
                </a>
              ))}
            </div>
            {!discovered.length && !generic && !wc && (
              <p className="mt-4 text-sm text-muted-foreground">No browser wallet was found. Install one of the wallets above, then reload this page.</p>
            )}
            <p className="mt-5 text-xs text-muted-foreground">
              Connecting is local to your browser. To post, fund or get paid you'll also <span className="font-medium text-foreground">link</span> the wallet by signing
              a free message. No transaction is sent.
            </p>
          </div>

          <div className="relative hidden overflow-hidden bg-yorse-forest p-6 text-white md:flex md:flex-col">
            <YorseMark className="size-12" />
            <h3 className="mt-5 font-brand text-2xl font-bold leading-tight">
              Built on
              <br />
              Arbitrum Sepolia
            </h3>
            <p className="mt-3 text-sm text-emerald-100/80">Fast, low-cost transactions. Escrow holds Circle's testnet USDC. No real funds.</p>
            <a
              href={EXPLORER}
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-flex w-fit items-center gap-2 rounded-lg border border-white/30 px-3 py-2 text-sm hover:bg-white/10"
            >
              View on Explorer <ArrowRight className="size-4" />
            </a>
            <IsoBlocks className="absolute -bottom-6 -right-8 w-48 opacity-90" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function WalletTile({
  name,
  icon,
  logo,
  tag,
  busy,
  disabled,
  onClick,
}: {
  name: string
  icon?: string
  logo?: React.ReactNode
  tag?: string
  busy?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-border bg-card px-3 py-4 text-center shadow-soft transition-all hover:-translate-y-0.5 hover:border-brand-green/50",
        disabled && "opacity-60",
      )}
    >
      {logo ? (
        logo
      ) : icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={icon} alt="" className="size-10 rounded-xl" />
      ) : (
        <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-brand-forest">
          <Wallet className="size-5" />
        </span>
      )}
      <span className="text-sm font-medium">{name}</span>
      {busy ? (
        <Loader2 className="size-3.5 animate-spin text-brand-green" />
      ) : tag ? (
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">{tag}</span>
      ) : (
        <span className="text-[11px] text-muted-foreground">Connect</span>
      )}
    </button>
  )
}

function WalletConnectLogo() {
  return (
    <span className="flex size-10 items-center justify-center rounded-xl bg-[#3B99FC]">
      <svg viewBox="0 0 40 25" className="w-6" aria-hidden>
        <path
          fill="#fff"
          d="M8.2 4.9c6.5-6.3 17.1-6.3 23.6 0l.8.8c.3.3.3.8 0 1.1l-2.7 2.6c-.2.2-.4.2-.6 0l-1.1-1.1c-4.5-4.4-11.9-4.4-16.4 0l-1.2 1.2c-.2.2-.4.2-.6 0L7.3 6.9c-.3-.3-.3-.8 0-1.1l.9-.9Zm29.1 5.4 2.4 2.3c.3.3.3.8 0 1.1L28.9 24.2c-.3.3-.8.3-1.1 0l-7.6-7.5c-.1-.1-.2-.1-.3 0l-7.6 7.5c-.3.3-.8.3-1.1 0L.3 13.7c-.3-.3-.3-.8 0-1.1l2.4-2.3c.3-.3.8-.3 1.1 0l7.6 7.5c.1.1.2.1.3 0l7.6-7.5c.3-.3.8-.3 1.1 0l7.6 7.5c.1.1.2.1.3 0l7.6-7.5c.3-.3.8-.3 1.1 0Z"
        />
      </svg>
    </span>
  )
}

/** Stack of isometric green blocks, the decorative motif from the brand art. */
export function IsoBlocks({ className }: { className?: string }) {
  const block = (x: number, y: number, h: number, key: string) => (
    <g key={key} transform={`translate(${x} ${y})`}>
      <path d={`M0 0 L30 -17 L60 0 L30 17 Z`} fill="#4ade80" />
      <path d={`M0 0 L30 17 L30 ${17 + h} L0 ${h} Z`} fill="#16a34a" />
      <path d={`M60 0 L30 17 L30 ${17 + h} L60 ${h} Z`} fill="#0f6b3a" />
    </g>
  )
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden>
      {block(70, 60, 70, "a")}
      {block(110, 100, 45, "b")}
      {block(30, 110, 40, "c")}
      {block(90, 20, 30, "d")}
    </svg>
  )
}
