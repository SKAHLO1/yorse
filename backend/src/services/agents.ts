import { createHash, randomBytes } from "node:crypto"
import { getAddress, type Hex } from "viem"
import type { AuthUser } from "../auth"
import { ChainError, type EscrowChain } from "../chain/escrow"
import { badRequest, conflict, notFound, upstream } from "../lib/errors"
import type { Store } from "../store/types"
import type { UserProfile } from "../types"

/**
 * AI agents as first-class freelancers. An agent has no Firebase account: it proves control of a
 * wallet by signing a challenge and receives an API key. That key is a bearer token for the same
 * API humans use, so an agent browses the feed, applies, accepts terms, delivers, argues before the
 * jury, and is paid by the same escrow to the wallet it signed with.
 *
 * Only a SHA-256 hash of each key is stored; the key itself is shown once.
 */

const CHALLENGE_TTL_MS = 10 * 60_000
const KEY_PREFIX = "yk_"
const LAST_USED_WRITE_MS = 60_000

/** Deterministic, but not the address itself: public profiles never expose wallets. */
export const agentUid = (address: string) => `agent-${createHash("sha256").update(`yorse-agent:${address.toLowerCase()}`).digest("hex").slice(0, 20)}`
const agentEmail = (address: string) => `${agentUid(address)}@agents.yorse.app`
const hashKey = (key: string) => createHash("sha256").update(key).digest("hex")
export const isAgentKey = (token: string) => token.startsWith(KEY_PREFIX)

export function createAgentService(deps: { store: Store; chain: Pick<EscrowChain, "verifySignature">; now?: () => Date }) {
  const { store } = deps
  const iso = () => (deps.now?.() ?? new Date()).toISOString()

  function checksum(address: string) {
    try {
      return getAddress(address)
    } catch {
      throw badRequest("Invalid wallet address")
    }
  }

  /** Step 1: the agent asks what to sign. */
  async function challenge(address: string) {
    const wallet = checksum(address)
    const owner = await store.users.findByWallet(wallet)
    if (owner && owner.kind !== "agent") throw conflict("This wallet belongs to a human Yorse account; agents need their own wallet")
    const uid = agentUid(wallet)
    const nonce = randomBytes(16).toString("hex")
    const issued = iso()
    const message = [
      "Register this wallet as an AI agent on Yorse.",
      "",
      `Agent wallet: ${wallet}`,
      "Network: Arbitrum Sepolia (421614)",
      `Nonce: ${nonce}`,
      `Issued: ${issued}`,
      "",
      "Escrow payouts for work this agent delivers go to this wallet.",
      "Signing is free and does not send a transaction.",
    ].join("\n")
    const expiresAt = new Date(Date.parse(issued) + CHALLENGE_TTL_MS).toISOString()
    const existing = await store.users.get(uid)
    if (existing) {
      await store.users.update(uid, { walletChallenge: { nonce, message, expiresAt }, updatedAt: iso() })
    } else {
      const profile: UserProfile = {
        uid,
        email: agentEmail(wallet),
        displayName: null,
        photoUrl: null,
        kind: "agent",
        agent: null,
        ratingAsFreelancer: { average: null, count: 0 },
        ratingAsClient: { average: null, count: 0 },
        // Not linked until the signature proves control of the wallet.
        walletAddress: null,
        walletAddressLower: null,
        walletLinkedAt: null,
        walletChallenge: { nonce, message, expiresAt },
        createdAt: issued,
        updatedAt: issued,
      }
      await store.users.set(profile)
    }
    return { message, expiresAt }
  }

  /** Step 2: the agent signs the challenge and receives an API key (shown once). */
  async function register(input: { address: string; signature: Hex; name: string; description: string; homepage: string | null }) {
    const wallet = checksum(input.address)
    const uid = agentUid(wallet)
    const profile = await store.users.get(uid)
    const ch = profile?.walletChallenge
    if (!profile || !ch) throw badRequest("Request a challenge first")
    if (Date.parse(ch.expiresAt) < Date.parse(iso())) throw badRequest("Challenge expired; request a new one")
    const valid = await deps.chain.verifySignature(wallet, ch.message, input.signature).catch((err) => {
      throw err instanceof ChainError ? upstream("chain_error", err.message) : err
    })
    if (!valid) throw badRequest("Signature does not match this wallet")

    const now = iso()
    await store.users.update(uid, {
      displayName: input.name.trim(),
      agent: { description: input.description.trim(), homepage: input.homepage },
      walletAddress: wallet,
      walletAddressLower: wallet.toLowerCase(),
      walletLinkedAt: profile.walletLinkedAt ?? now,
      walletChallenge: null,
      updatedAt: now,
    })
    const key = `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`
    await store.apiKeys.create({ id: hashKey(key), uid, prefix: key.slice(0, 10), createdAt: now, lastUsedAt: null, revokedAt: null })
    return { apiKey: key, uid, wallet }
  }

  /** Bearer-token authentication for agents. Returns null for unknown or revoked keys. */
  async function authenticate(key: string): Promise<AuthUser | null> {
    const record = await store.apiKeys.get(hashKey(key))
    if (!record || record.revokedAt) return null
    const profile = await store.users.get(record.uid)
    if (!profile || profile.kind !== "agent" || !profile.walletAddress) return null
    if (!record.lastUsedAt || Date.parse(iso()) - Date.parse(record.lastUsedAt) > LAST_USED_WRITE_MS) {
      await store.apiKeys.update(record.id, { lastUsedAt: iso() })
    }
    return { uid: profile.uid, email: profile.email, name: profile.displayName, picture: null, admin: false, agent: true }
  }

  async function listKeys(user: AuthUser) {
    const keys = await store.apiKeys.listForUid(user.uid)
    return keys.map(({ id: _hash, ...k }) => k)
  }

  async function revokeKey(user: AuthUser, prefix: string) {
    const key = (await store.apiKeys.listForUid(user.uid)).find((k) => k.prefix === prefix && !k.revokedAt)
    if (!key) throw notFound("API key")
    await store.apiKeys.update(key.id, { revokedAt: iso() })
    return { revoked: prefix }
  }

  return { challenge, register, authenticate, listKeys, revokeKey }
}

export type AgentService = ReturnType<typeof createAgentService>
