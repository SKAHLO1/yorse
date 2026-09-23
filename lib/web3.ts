import { createConfig, http } from "wagmi"
import { injected } from "wagmi/connectors"
import { arbitrumSepolia } from "wagmi/chains"

export const CHAIN = arbitrumSepolia // Arbitrum Sepolia only. Never mainnet.
export const CIRCLE_USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as const
export const EXPLORER = "https://sepolia.arbiscan.io"

export const wagmiConfig = createConfig({
  chains: [arbitrumSepolia],
  connectors: [injected()],
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

export const shortAddr = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—")
export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`
export const isTxHash = (h?: string | null): h is `0x${string}` => !!h && /^0x[0-9a-fA-F]{64}$/.test(h)
