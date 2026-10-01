"use client"

import { createKernelAccount, createKernelAccountClient, createZeroDevPaymasterClient } from "@zerodev/sdk"
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants"
import { deserializePasskeyValidator, PasskeyValidatorContractVersion, toPasskeyValidator, toWebAuthnKey, WebAuthnMode } from "@zerodev/passkey-validator"
import { createPublicClient, http, numberToHex, type Address, type Hex } from "viem"
import { injected } from "wagmi/connectors"
import { arbitrumSepolia as CHAIN } from "wagmi/chains"

/**
 * Passkey smart wallets (ERC-4337) via ZeroDev.
 *
 * The user's passkey (Face ID, Touch ID, Windows Hello, a security key) controls a Kernel smart
 * account on Arbitrum Sepolia. Transactions become user operations whose gas the project's ZeroDev
 * paymaster sponsors, so the account never needs ETH. The account is exposed to wagmi as an
 * ordinary EIP-1193 wallet, so linking, funding, challenging and payouts work unchanged.
 *
 * Only public key data is kept in localStorage (to restore the wallet without a prompt after a
 * reload); every signature still requires the passkey.
 */

export const ZERODEV_PROJECT_ID = process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID?.trim() || null
export const PASSKEY_CONNECTOR_ID = "yorsePasskey"
const STORAGE_KEY = "yorse:passkey-wallet"
const entryPoint = getEntryPoint("0.7")
const kernelVersion = KERNEL_V3_1

const zerodevRpc = () => `https://rpc.zerodev.app/api/v3/${ZERODEV_PROJECT_ID}/chain/${CHAIN.id}`
const passkeyServer = () => `https://passkeys.zerodev.app/api/v3/${ZERODEV_PROJECT_ID}`

let provider: PasskeyProvider | null = null

async function buildProvider(validator: Awaited<ReturnType<typeof toPasskeyValidator>>) {
  const publicClient = createPublicClient({ chain: CHAIN, transport: http(process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL || undefined) })
  const account = await createKernelAccount(publicClient, { plugins: { sudo: validator }, entryPoint, kernelVersion })
  const paymaster = createZeroDevPaymasterClient({ chain: CHAIN, transport: http(zerodevRpc()) })
  const client = createKernelAccountClient({
    account,
    chain: CHAIN,
    bundlerTransport: http(zerodevRpc()),
    client: publicClient,
    paymaster: { getPaymasterData: (userOperation) => paymaster.sponsorUserOperation({ userOperation }) },
  })
  try {
    localStorage.setItem(STORAGE_KEY, validator.getSerializedData())
  } catch {
    // private mode: the wallet works for this session, the user re-authenticates after a reload
  }
  provider = new PasskeyProvider(client, publicClient)
  return provider
}

/** Creates a new passkey (the browser shows its biometric/security-key prompt) and its smart account. */
export async function createPasskeyWallet(name: string) {
  const webAuthnKey = await toWebAuthnKey({ passkeyName: name, passkeyServerUrl: passkeyServer(), mode: WebAuthnMode.Register, passkeyServerHeaders: {} })
  return buildProvider(await toPasskeyValidator(publicClientForValidator(), { webAuthnKey, entryPoint, kernelVersion, validatorContractVersion: PasskeyValidatorContractVersion.V0_0_3_PATCHED }))
}

/** Signs in with an existing passkey on this device or a synced one. */
export async function loginPasskeyWallet() {
  const webAuthnKey = await toWebAuthnKey({ passkeyName: "Yorse", passkeyServerUrl: passkeyServer(), mode: WebAuthnMode.Login, passkeyServerHeaders: {} })
  return buildProvider(await toPasskeyValidator(publicClientForValidator(), { webAuthnKey, entryPoint, kernelVersion, validatorContractVersion: PasskeyValidatorContractVersion.V0_0_3_PATCHED }))
}

/** Rebuilds the wallet from saved public key data after a reload. No prompt; signing still needs the passkey. */
export async function restorePasskeyWallet() {
  if (!ZERODEV_PROJECT_ID || provider) return provider
  let saved: string | null = null
  try {
    saved = localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!saved) return null
  try {
    return await buildProvider(await deserializePasskeyValidator(publicClientForValidator(), { serializedData: saved, entryPoint, kernelVersion }))
  } catch {
    return null
  }
}

export function forgetPasskeyWallet() {
  provider = null
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export const hasSavedPasskeyWallet = () => {
  try {
    return !!localStorage.getItem(STORAGE_KEY)
  } catch {
    return false
  }
}

const publicClientForValidator = () => createPublicClient({ chain: CHAIN, transport: http(process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL || undefined) })

type KernelClient = ReturnType<typeof createKernelAccountClient>

/** The few EventEmitter methods wagmi uses on an EIP-1193 provider. */
class Emitter {
  private listeners = new Map<string, Set<(...a: unknown[]) => void>>()
  on(event: string, fn: (...a: unknown[]) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(fn)
    return this
  }
  removeListener(event: string, fn: (...a: unknown[]) => void) {
    this.listeners.get(event)?.delete(fn)
    return this
  }
  off(event: string, fn: (...a: unknown[]) => void) {
    return this.removeListener(event, fn)
  }
  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((fn) => fn(...args))
    return true
  }
}

/**
 * Minimal EIP-1193 provider over the Kernel client. Written here rather than using the SDK's own
 * provider because wagmi passes personal_sign messages hex-encoded (they must be signed as raw
 * bytes, not as the hex string) and adds EOA fee fields that don't apply to user operations.
 */
class PasskeyProvider extends Emitter {
  constructor(
    private client: KernelClient,
    private publicClient: ReturnType<typeof createPublicClient>,
  ) {
    super()
  }
  get address(): Address {
    return this.client.account!.address
  }
  async request({ method, params = [] }: { method: string; params?: unknown[] | object }): Promise<unknown> {
    const p = params as unknown[]
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [this.address]
      case "eth_chainId":
        return numberToHex(CHAIN.id)
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain":
        return null
      case "wallet_requestPermissions":
      case "wallet_getPermissions":
        return [{ parentCapability: "eth_accounts" }]
      case "wallet_revokePermissions":
        return null
      case "personal_sign": {
        const [data, address] = p as [Hex, Address]
        this.assertSelf(address)
        return this.client.signMessage({ account: this.client.account!, message: { raw: data } })
      }
      case "eth_signTypedData_v4": {
        const [address, json] = p as [Address, string]
        this.assertSelf(address)
        const td = JSON.parse(json)
        return this.client.signTypedData({ account: this.client.account!, domain: td.domain, types: td.types, primaryType: td.primaryType, message: td.message })
      }
      case "eth_sendTransaction": {
        const [tx] = p as [{ to: Address; data?: Hex; value?: Hex }]
        try {
          // Waits for the user operation to land and returns the bundle's transaction hash.
          return await this.client.sendTransaction({ account: this.client.account!, chain: CHAIN, to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined })
        } catch (err) {
          const msg = String((err as { details?: string; message?: string }).details ?? (err as Error).message)
          if (/sponsoring polic/i.test(msg)) {
            throw new Error("Gas sponsorship is not set up: the ZeroDev project has no gas policy covering this transaction.")
          }
          throw err
        }
      }
      default:
        return this.publicClient.request({ method, params } as never)
    }
  }
  private assertSelf(address: Address) {
    if (address.toLowerCase() !== this.address.toLowerCase()) throw new Error("Can only sign for the connected passkey wallet")
  }
}

/** wagmi connector for the passkey wallet. Present only when a ZeroDev project is configured. */
export const passkeyConnector = injected({
  target: () => ({ id: PASSKEY_CONNECTOR_ID, name: "Passkey wallet", provider: (provider ?? undefined) as never }),
  shimDisconnect: true,
})
