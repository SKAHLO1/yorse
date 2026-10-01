"use client"

import { useState } from "react"
import { useConnect, useConnectors } from "wagmi"
import { Fingerprint, Loader2, Sparkles } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { errorText } from "@/lib/api"
import { createPasskeyWallet, hasSavedPasskeyWallet, loginPasskeyWallet, PASSKEY_CONNECTOR_ID, restorePasskeyWallet, ZERODEV_PROJECT_ID } from "@/lib/passkey"
import { CHAIN } from "@/lib/web3"

/**
 * "Passkey wallet" in the Connect Wallet modal: a smart account secured by Face ID / Touch ID /
 * Windows Hello, with gas paid by the ZeroDev paymaster. No extension, no seed phrase, no ETH.
 */
export function PasskeyOption({ onConnected }: { onConnected: () => void }) {
  const { me } = useAuth()
  const connectors = useConnectors()
  const connect = useConnect()
  const [mode, setMode] = useState<"idle" | "create">("idle")
  const [name, setName] = useState(me?.displayName || me?.email || "")
  const [busy, setBusy] = useState<"create" | "login" | "continue" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const saved = typeof window !== "undefined" && hasSavedPasskeyWallet()
  if (!ZERODEV_PROJECT_ID) return null

  async function run(kind: "create" | "login" | "continue") {
    setBusy(kind)
    setError(null)
    try {
      if (kind === "create") await createPasskeyWallet(`Yorse · ${name.trim() || "wallet"}`)
      else if (kind === "login") await loginPasskeyWallet()
      else if (!(await restorePasskeyWallet())) throw new Error("No saved passkey wallet on this device; use an existing passkey instead.")
      const connector = connectors.find((c) => c.id === PASSKEY_CONNECTOR_ID)
      if (!connector) throw new Error("Passkey wallet is not available in this browser")
      await connect.mutateAsync({ connector, chainId: CHAIN.id })
      onConnected()
    } catch (err) {
      const msg = errorText(err)
      setError(/NotAllowedError|cancel|abort|timed out/i.test(msg) ? "The passkey prompt was dismissed. Try again when you're ready." : msg)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-xl border border-brand-green/40 bg-accent/50 p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-emerald-300">
          <Fingerprint className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Passkey wallet</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
              <Sparkles className="size-3" /> No extension · no gas
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A smart wallet on Arbitrum secured by your fingerprint, face or device PIN. Yorse pays the network fees.
          </p>
        </div>
      </div>

      {mode === "create" ? (
        <div className="mt-3 space-y-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name for this passkey" className="h-10 bg-card" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => run("create")} disabled={!!busy}>
              {busy === "create" && <Loader2 className="size-4 animate-spin" />} Create with passkey
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("idle")} disabled={!!busy}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {saved && (
            <Button size="sm" onClick={() => run("continue")} disabled={!!busy}>
              {busy === "continue" && <Loader2 className="size-4 animate-spin" />} Continue with my passkey wallet
            </Button>
          )}
          <Button size="sm" variant={saved ? "outline" : "default"} onClick={() => setMode("create")} disabled={!!busy}>
            Create a new one
          </Button>
          <Button size="sm" variant="outline" onClick={() => run("login")} disabled={!!busy}>
            {busy === "login" && <Loader2 className="size-4 animate-spin" />} Use an existing passkey
          </Button>
        </div>
      )}
      {busy && <p className="mt-2 text-xs text-muted-foreground">Follow your browser&apos;s passkey prompt.</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}
