"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import { Toaster } from "sonner"
import { useEffect } from "react"
import { WagmiProvider } from "wagmi"
import { reconnect } from "wagmi/actions"
import { PASSKEY_CONNECTOR_ID, restorePasskeyWallet } from "@/lib/passkey"
import { wagmiConfig } from "@/lib/web3"
import { AuthProvider } from "./auth-provider"
import { RealtimeProvider } from "./realtime-provider"

/** After a reload, rebuild a saved passkey wallet (public data only, no prompt) and let wagmi reconnect it. */
function usePasskeyRestore() {
  useEffect(() => {
    void restorePasskeyWallet().then((p) => {
      if (p) void reconnect(wagmiConfig, { connectors: wagmiConfig.connectors.filter((c) => c.id === PASSKEY_CONNECTOR_ID) })
    })
  }, [])
}

export function Providers({ children }: { children: React.ReactNode }) {
  usePasskeyRestore()
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 } } }),
  )
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RealtimeProvider>{children}</RealtimeProvider>
          <Toaster theme="light" richColors closeButton position="bottom-right" />
        </AuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
