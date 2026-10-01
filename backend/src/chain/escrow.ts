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
import type { Outcome } from "../types"
import { escrowAbi } from "./escrowAbi"

export const ARBITRUM_SEPOLIA_CHAIN_ID = 421614
/** Circle's official testnet USDC on Arbitrum Sepolia. Hard-coded on purpose: never configurable. */
export const CIRCLE_USDC: Address = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"
export const USDC_DECIMALS = 6

/** Mirrors `Escrow.State`; order matters. */
export const ONCHAIN_STATES = [
  "None",
  "Funded",
  "Submitted",
  "Released",
  "Disputed",
  "ResolvedRelease",
  "ResolvedRefund",
  "Proposed",
  "Challenged",
  "Refunded",
] as const
export type OnchainState = (typeof ONCHAIN_STATES)[number]

/** Mirrors `Escrow.Outcome`. */
export const ONCHAIN_OUTCOMES = ["None", "Release", "Refund"] as const
export type OnchainOutcome = (typeof ONCHAIN_OUTCOMES)[number]
export const outcomeToChain = (o: Outcome): number => (o === "release" ? 1 : 2)

/**
 * Every call the relayer can make, with its arguments. `finalize` is permissionless on-chain;
 * the relayer sends it so nobody has to, but either party could.
 */
export type RelayerCall =
  | { fn: "markSubmitted"; deliverableHash: Hex }
  | { fn: "proposeVerdict"; outcome: Outcome; verdictHash: Hex }
  | { fn: "escalate"; verdictHash: Hex }
  | { fn: "finalize" }
  | { fn: "resolveChallenge"; outcome: Outcome; rulingHash: Hex }
  | { fn: "dispute" }
  | { fn: "resolve"; outcome: Outcome; rulingHash: Hex }
export type RelayerAction = RelayerCall["fn"]

export interface OnchainJob {
  client: Address
  freelancer: Address
  amount: bigint
  state: OnchainState
  proposed: OnchainOutcome
  /** Unix seconds. */
  stateSince: number
  /** Unix seconds; 0 until a verdict is proposed. */
  challengeDeadline: number
  challenger: Address
  bond: bigint
  deliverableHash: Hex
  verdictHash: Hex
  rulingHash: Hex
}

/** Immutable arbitration parameters of this deployment. */
export interface ArbitrationParams {
  challengeWindowSeconds: number
  relayerTimeoutSeconds: number
  bondBps: number
}

/** The only component that can sign escrow transactions. Lives server-side; the key never leaves this module. */
export interface EscrowChain {
  readonly escrowAddress: Address
  readonly relayerAddress: Address
  readonly params: ArbitrationParams
  /** Reads a job from `escrow` (default: the current deployment). Jobs stay on the escrow that funded them. */
  getJob(onchainJobId: Hex, escrow?: Address): Promise<OnchainJob>
  /** Sends a relayer call, waits for the receipt, and throws with a readable reason on revert. */
  send(onchainJobId: Hex, call: RelayerCall): Promise<{ txHash: Hex }>
  /** Confirms a client/party-submitted tx succeeded and targeted the escrow contract. */
  confirmTx(txHash: Hex): Promise<void>
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

export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000"
export const ZERO_HASH: Hex = `0x${"0".repeat(64)}`

export function emptyOnchainJob(): OnchainJob {
  return {
    client: ZERO_ADDRESS,
    freelancer: ZERO_ADDRESS,
    amount: 0n,
    state: "None",
    proposed: "None",
    stateSince: 0,
    challengeDeadline: 0,
    challenger: ZERO_ADDRESS,
    bond: 0n,
    deliverableHash: ZERO_HASH,
    verdictHash: ZERO_HASH,
    rulingHash: ZERO_HASH,
  }
}

function callArgs(jobId: Hex, call: RelayerCall): readonly unknown[] {
  switch (call.fn) {
    case "markSubmitted":
      return [jobId, call.deliverableHash]
    case "proposeVerdict":
      return [jobId, outcomeToChain(call.outcome), call.verdictHash]
    case "escalate":
      return [jobId, call.verdictHash]
    case "resolveChallenge":
    case "resolve":
      return [jobId, outcomeToChain(call.outcome), call.rulingHash]
    case "finalize":
    case "dispute":
      return [jobId]
  }
}

/** getJob of the original (pre-arbitration) escrow, kept so its jobs stay readable. */
const escrowV1GetJobAbi = [
  {
    type: "function",
    name: "getJob",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "client", type: "address" },
          { name: "freelancer", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "state", type: "uint8" },
        ],
      },
    ],
  },
] as const

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
  const read = <T>(functionName: string) =>
    publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName } as never) as Promise<T>

  // --- Startup safety checks: refuse to run against anything but the intended deployment. ---
  const chainId = await publicClient.getChainId()
  if (chainId !== ARBITRUM_SEPOLIA_CHAIN_ID) {
    throw new Error(`RPC is chain ${chainId}; Yorse only runs on Arbitrum Sepolia (${ARBITRUM_SEPOLIA_CHAIN_ID})`)
  }
  const code = await publicClient.getCode({ address: escrowAddress })
  if (!code || code === "0x") throw new Error(`No contract deployed at ESCROW_ADDRESS ${escrowAddress}`)
  let usdc: Address, relayer: Address, window: bigint, timeout: bigint, bondBps: number
  try {
    ;[usdc, relayer, window, timeout, bondBps] = await Promise.all([
      read<Address>("usdc"),
      read<Address>("relayer"),
      read<bigint>("challengeWindow"),
      read<bigint>("relayerTimeout"),
      read<number>("bondBps"),
    ])
  } catch (err) {
    throw new Error(`ESCROW_ADDRESS ${escrowAddress} is not an arbitration-enabled Yorse escrow (redeploy Escrow.sol): ${errorMessage(err)}`)
  }
  if (!isAddressEqual(usdc, CIRCLE_USDC)) throw new Error(`Escrow USDC is ${usdc}, expected Circle USDC ${CIRCLE_USDC}`)
  if (!isAddressEqual(relayer, account.address)) {
    throw new Error(`RELAYER_PRIVATE_KEY is ${account.address} but escrow relayer is ${relayer}`)
  }
  const params: ArbitrationParams = {
    challengeWindowSeconds: Number(window),
    relayerTimeoutSeconds: Number(timeout),
    bondBps: Number(bondBps),
  }

  // Serialize relayer txs so nonces never collide.
  let queue: Promise<unknown> = Promise.resolve()
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => undefined)
    return run
  }

  const getJob = async (onchainJobId: Hex, escrow: Address = escrowAddress): Promise<OnchainJob> => {
    let j
    try {
      j = await publicClient.readContract({ address: escrow, abi: escrowAbi, functionName: "getJob", args: [onchainJobId] })
    } catch (err) {
      // The first (v1) deployment returned a 4-field record; its states share the same first 7 values.
      if (isAddressEqual(escrow, escrowAddress)) throw err
      const v1 = await publicClient.readContract({ address: escrow, abi: escrowV1GetJobAbi, functionName: "getJob", args: [onchainJobId] })
      return { ...emptyOnchainJob(), client: v1.client, freelancer: v1.freelancer, amount: v1.amount, state: ONCHAIN_STATES[v1.state] }
    }
    return {
      client: j.client,
      freelancer: j.freelancer,
      amount: j.amount,
      state: ONCHAIN_STATES[j.state],
      proposed: ONCHAIN_OUTCOMES[j.proposed],
      stateSince: Number(j.stateSince),
      challengeDeadline: Number(j.challengeDeadline),
      challenger: j.challenger,
      bond: j.bond,
      deliverableHash: j.deliverableHash,
      verdictHash: j.verdictHash,
      rulingHash: j.rulingHash,
    }
  }

  return {
    escrowAddress,
    relayerAddress: account.address,
    params,
    getJob,

    send: (onchainJobId, call) =>
      serialized(async () => {
        let txHash: Hex | null = null
        try {
          // Simulate first to get a decoded revert reason instead of a failed tx.
          const { request } = await publicClient.simulateContract({
            account,
            address: escrowAddress,
            abi: escrowAbi,
            functionName: call.fn,
            args: callArgs(onchainJobId, call),
          } as never)
          txHash = await walletClient.writeContract(request as never)
          const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 })
          if (receipt.status !== "success") throw new Error("transaction reverted")
          return { txHash }
        } catch (err) {
          throw new ChainError(call.fn, `escrow.${call.fn}() failed: ${errorMessage(err)}`, txHash)
        }
      }),

    confirmTx: async (txHash) => {
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 })
        if (receipt.status !== "success") throw new Error("transaction reverted")
        if (!receipt.to || !isAddressEqual(receipt.to, escrowAddress)) {
          throw new Error("transaction was not sent to the Yorse escrow contract")
        }
      } catch (err) {
        throw new ChainError("confirm", `Could not confirm transaction: ${errorMessage(err)}`, txHash)
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
        arbitration: params,
      }
    },
  }
}
