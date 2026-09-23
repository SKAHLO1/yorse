import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddressEqual,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { arbitrumSepolia } from "viem/chains"
import { errorMessage } from "../lib/errors"
import { escrowAbi } from "./escrowAbi"

export const ARBITRUM_SEPOLIA_CHAIN_ID = 421614
/** Circle's official testnet USDC on Arbitrum Sepolia. Hard-coded on purpose: never configurable. */
export const CIRCLE_USDC: Address = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"
export const USDC_DECIMALS = 6

export const ONCHAIN_STATES = [
  "None",
  "Funded",
  "Submitted",
  "Released",
  "Disputed",
  "ResolvedRelease",
  "ResolvedRefund",
] as const
export type OnchainState = (typeof ONCHAIN_STATES)[number]

export type RelayerAction = "markSubmitted" | "release" | "dispute" | "refund"

export interface OnchainJob {
  client: Address
  freelancer: Address
  amount: bigint
  state: OnchainState
}

/** The only component that can sign escrow transactions. Lives server-side; the key never leaves this module. */
export interface EscrowChain {
  readonly escrowAddress: Address
  readonly relayerAddress: Address
  getJob(onchainJobId: Hex): Promise<OnchainJob>
  /** Sends a relayer-only call, waits for the receipt, and throws with a readable reason on revert. */
  send(action: RelayerAction, onchainJobId: Hex): Promise<{ txHash: Hex }>
  /** Confirms a client-submitted funding tx succeeded and targeted the escrow contract. */
  confirmFundingTx(txHash: Hex): Promise<void>
  health(): Promise<Record<string, unknown>>
}

export class ChainError extends Error {
  constructor(
    public action: string,
    message: string,
    public txHash: Hex | null = null,
  ) {
    super(message)
  }
}

/** Firestore job id -> bytes32 used as the on-chain job key. */
export const toOnchainJobId = (jobId: string): Hex => keccak256(stringToHex(`yorse:${jobId}`))

export async function createEscrowChain(opts: {
  rpcUrl: string
  relayerPrivateKey: Hex
  escrowAddress: Address
}): Promise<EscrowChain> {
  const account = privateKeyToAccount(opts.relayerPrivateKey)
  const transport = http(opts.rpcUrl, { timeout: 30_000, retryCount: 2 })
  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport })
  const walletClient = createWalletClient({ chain: arbitrumSepolia, transport, account })
  const escrowAddress = getAddress(opts.escrowAddress)

  // --- Startup safety checks: refuse to run against anything but the intended deployment. ---
  const chainId = await publicClient.getChainId()
  if (chainId !== ARBITRUM_SEPOLIA_CHAIN_ID) {
    throw new Error(`RPC is chain ${chainId}; Yorse only runs on Arbitrum Sepolia (${ARBITRUM_SEPOLIA_CHAIN_ID})`)
  }
  const code = await publicClient.getCode({ address: escrowAddress })
  if (!code || code === "0x") throw new Error(`No contract deployed at ESCROW_ADDRESS ${escrowAddress}`)
  const [usdc, relayer] = await Promise.all([
    publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "usdc" }),
    publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "relayer" }),
  ])
  if (!isAddressEqual(usdc, CIRCLE_USDC)) throw new Error(`Escrow USDC is ${usdc}, expected Circle USDC ${CIRCLE_USDC}`)
  if (!isAddressEqual(relayer, account.address)) {
    throw new Error(`RELAYER_PRIVATE_KEY is ${account.address} but escrow relayer is ${relayer}`)
  }

  // Serialize relayer txs so nonces never collide.
  let queue: Promise<unknown> = Promise.resolve()
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => undefined)
    return run
  }

  const getJob = async (onchainJobId: Hex): Promise<OnchainJob> => {
    const j = await publicClient.readContract({
      address: escrowAddress,
      abi: escrowAbi,
      functionName: "getJob",
      args: [onchainJobId],
    })
    return { client: j.client, freelancer: j.freelancer, amount: j.amount, state: ONCHAIN_STATES[j.state] }
  }

  return {
    escrowAddress,
    relayerAddress: account.address,
    getJob,

    send: (action, onchainJobId) =>
      serialized(async () => {
        let txHash: Hex | null = null
        try {
          // Simulate first to get a decoded revert reason instead of a failed tx.
          const { request } = await publicClient.simulateContract({
            account,
            address: escrowAddress,
            abi: escrowAbi,
            functionName: action,
            args: [onchainJobId],
          })
          txHash = await walletClient.writeContract(request)
          const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 })
          if (receipt.status !== "success") throw new Error("transaction reverted")
          return { txHash }
        } catch (err) {
          throw new ChainError(action, `escrow.${action}() failed: ${errorMessage(err)}`, txHash)
        }
      }),

    confirmFundingTx: async (txHash) => {
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 })
        if (receipt.status !== "success") throw new Error("funding transaction reverted")
        if (!receipt.to || !isAddressEqual(receipt.to, escrowAddress)) {
          throw new Error("transaction was not sent to the Yorse escrow contract")
        }
      } catch (err) {
        throw new ChainError("fund", `Could not confirm funding tx: ${errorMessage(err)}`, txHash)
      }
    },

    health: async () => {
      const [block, eth] = await Promise.all([
        publicClient.getBlockNumber(),
        publicClient.getBalance({ address: account.address }),
      ])
      return {
        chainId,
        block: block.toString(),
        escrow: escrowAddress,
        usdc: CIRCLE_USDC,
        relayer: account.address,
        relayerEthWei: eth.toString(),
      }
    },
  }
}
