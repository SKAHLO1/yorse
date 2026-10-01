import { createConfig, http, type CreateConnectorFn } from "wagmi"
import { injected, walletConnect } from "wagmi/connectors"
import { arbitrumSepolia } from "wagmi/chains"

export const CHAIN = arbitrumSepolia // Arbitrum Sepolia only. Never mainnet.
export const CIRCLE_USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as const
export const EXPLORER = "https://sepolia.arbiscan.io"

/** From cloud.reown.com (formerly WalletConnect Cloud). WalletConnect is offered only when this is set. */
export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || null

const connectors: CreateConnectorFn[] = [injected()]
// Browser only: the WalletConnect provider opens IndexedDB as soon as it is created, which breaks server prerendering.
if (WALLETCONNECT_PROJECT_ID && typeof window !== "undefined") {
  connectors.push(
    walletConnect({
      projectId: WALLETCONNECT_PROJECT_ID,
      showQrModal: true,
      metadata: {
        name: "Yorse",
        description: "AI-verified USDC escrow on Arbitrum",
        url: typeof window !== "undefined" ? window.location.origin : "https://yorse.app",
        icons: [typeof window !== "undefined" ? `${window.location.origin}/icon.svg` : "https://yorse.app/icon.svg"],
      },
      qrModalOptions: { themeMode: "light", themeVariables: { "--wcm-accent-color": "#16a34a", "--wcm-z-index": "1000" } },
    }),
  )
}

export const wagmiConfig = createConfig({
  chains: [arbitrumSepolia],
  connectors,
  transports: {
    [arbitrumSepolia.id]: http(process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL || undefined),
  },
  ssr: true,
})

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig
  }
}

/**
 * Fee fields for Arbitrum transactions. Wallets estimate maxFeePerGas with almost no headroom, and
 * Arbitrum's base fee moves every block, so a confirm a few seconds later can be rejected with
 * "max fee per gas less than block base fee". On Arbitrum you only pay the actual base fee (the
 * max is just a ceiling, and the priority fee is ignored), so a generous ceiling costs nothing extra.
 */
export async function arbitrumFees(client: { getBlock: () => Promise<{ baseFeePerGas: bigint | null }>; getGasPrice: () => Promise<bigint> }) {
  const base = (await client.getBlock()).baseFeePerGas ?? (await client.getGasPrice())
  return { maxFeePerGas: base * BigInt(3), maxPriorityFeePerGas: BigInt(0) }
}

export const shortAddr = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—")
export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`
export const isTxHash = (h?: string | null): h is `0x${string}` => !!h && /^0x[0-9a-fA-F]{64}$/.test(h)
