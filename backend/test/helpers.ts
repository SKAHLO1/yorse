import request from "supertest"
import { keccak256, stringToHex, type Address, type Hex } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import type { EvidenceFetcher } from "../src/ai/evidence"
import type { VerdictResult } from "../src/ai/schema"
import { AiUnavailableError, type AiVerifier } from "../src/ai/verifier"
import { createApp } from "../src/app"
import type { AuthService, AuthUser } from "../src/auth"
import { ChainError, type EscrowChain, type OnchainJob, type OnchainState } from "../src/chain/escrow"
import { createMemoryStore } from "../src/store/memory"

/** Test-only chain double that enforces exactly the Escrow.sol state machine. */
export function createFakeChain() {
  const jobs = new Map<Hex, OnchainJob>()
  const txs = new Set<Hex>()
  let n = 0
  const tx = () => {
    const h = keccak256(stringToHex(`tx-${n++}`))
    txs.add(h)
    return h
  }
  const failNext: { action?: string } = {}
  const get = (id: Hex) => jobs.get(id) ?? { client: "0x0000000000000000000000000000000000000000" as Address, freelancer: "0x0000000000000000000000000000000000000000" as Address, amount: 0n, state: "None" as OnchainState }
  const need = (id: Hex, action: string, from: OnchainState[]) => {
    const j = get(id)
    if (!from.includes(j.state)) throw new ChainError(action, `escrow.${action}() failed: InvalidState(${j.state})`)
    return j
  }
  const chain: EscrowChain & { fund: (id: Hex, client: Address, freelancer: Address, amount: bigint) => Hex; failNext: typeof failNext; jobs: typeof jobs } = {
    escrowAddress: "0x00000000000000000000000000000000000e5c20",
    relayerAddress: "0x0000000000000000000000000000000000000e1a",
    jobs,
    failNext,
    getJob: async (id) => ({ ...get(id) }),
    fund(id, client, freelancer, amount) {
      if (get(id).state !== "None") throw new Error("JobAlreadyExists")
      jobs.set(id, { client, freelancer, amount, state: "Funded" })
      return tx()
    },
    send: async (action, id) => {
      if (failNext.action === action) {
        failNext.action = undefined
        throw new ChainError(action, `escrow.${action}() failed: RPC timeout`)
      }
      const j = action === "markSubmitted" ? need(id, action, ["Funded"])
        : action === "dispute" ? need(id, action, ["Funded", "Submitted"])
        : action === "refund" ? need(id, action, ["Disputed"])
        : need(id, action, ["Submitted", "Disputed"])
      const next: Record<string, OnchainState> = {
        markSubmitted: "Submitted",
        dispute: "Disputed",
        refund: "ResolvedRefund",
        release: j.state === "Submitted" ? "Released" : "ResolvedRelease",
      }
      j.state = next[action]
      jobs.set(id, j)
      return { txHash: tx() }
    },
    confirmFundingTx: async (h) => {
      if (!txs.has(h)) throw new ChainError("fund", "Could not confirm funding tx: not found")
    },
    health: async () => ({ fake: true }),
  }
  return chain
}

/** Test-only AI double: returns queued verdicts or errors in order. */
export function scriptedAi() {
  const queue: (VerdictResult | Error)[] = []
  const calls: unknown[] = []
  const ai: AiVerifier & { queue: typeof queue; calls: typeof calls } = {
    providers: [{ name: "groq", model: "test" }],
    queue,
    calls,
    async verify(input) {
      calls.push(input)
      const next = queue.shift()
      if (!next) throw new Error("scriptedAi: no verdict queued")
      if (next instanceof Error) throw new AiUnavailableError([{ provider: "groq", model: "test", ok: false, error: next.message, ms: 1 }])
      return { result: next, provider: "groq", model: "test", attempts: [{ provider: "groq", model: "test", ok: true, error: null, ms: 1 }] }
    },
  }
  return ai
}

export function fakeAuth() {
  const users = new Map<string, AuthUser>()
  const auth: AuthService & { add(u: AuthUser): string } = {
    add(u) {
      users.set(`token-${u.uid}`, u)
      return `token-${u.uid}`
    },
    verifyIdToken: async (t) => {
      const u = users.get(t)
      if (!u) throw new Error("bad token")
      return u
    },
    getUserByEmail: async (email) => {
      const u = [...users.values()].find((x) => x.email.toLowerCase() === email.toLowerCase())
      return u ? { uid: u.uid, email: u.email } : null
    },
  }
  return auth
}

export const noEvidence: EvidenceFetcher = async (url) => ({
  status: url ? "fetched" : "not_provided",
  source_url: url,
  note: "test",
  content_excerpt: url ? "<fixture page content>" : null,
})

export function setup() {
  const store = createMemoryStore()
  const chain = createFakeChain()
  const ai = scriptedAi()
  const auth = fakeAuth()
  const app = createApp({ store, chain, ai, auth, fetchEvidence: noEvidence, corsOrigins: ["http://localhost:3000"] })

  /** Creates a signed-in user with a linked wallet (real signature flow). */
  async function user(uid: string, opts: { admin?: boolean; wallet?: boolean } = {}) {
    const email = `${uid}@example.com`
    const token = auth.add({ uid, email, name: uid, picture: null, admin: !!opts.admin })
    const account = privateKeyToAccount(generatePrivateKey())
    const h = { authorization: `Bearer ${token}` }
    const agent = {
      uid,
      email,
      account,
      get: (p: string) => request(app).get(p).set(h),
      post: (p: string, b: object = {}) => request(app).post(p).set(h).send(b),
      patch: (p: string, b: object = {}) => request(app).patch(p).set(h).send(b),
    }
    if (opts.wallet !== false) {
      const ch = await agent.post("/api/me/wallet/challenge")
      const signature = await account.signMessage({ message: ch.body.message })
      const r = await agent.post("/api/me/wallet", { address: account.address, signature })
      if (r.status !== 200) throw new Error(`wallet link failed: ${JSON.stringify(r.body)}`)
    }
    return agent
  }

  return { app, store, chain, ai, auth, user }
}

export const futureDate = () => new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10)
