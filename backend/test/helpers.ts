import request from "supertest"
import { keccak256, stringToHex, verifyMessage, type Address, type Hex } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import type { EvidenceFetcher } from "../src/ai/evidence"
import type { Jury } from "../src/ai/jury"
import type { VerdictResult } from "../src/ai/schema"
import { AiUnavailableError, type AiVerifier } from "../src/ai/verifier"
import { createApp } from "../src/app"
import type { AuthService, AuthUser } from "../src/auth"
import { ChainError, emptyOnchainJob, type EscrowChain, type OnchainJob, type OnchainState, type RelayerCall } from "../src/chain/escrow"
import { createKeeper } from "../src/services/keeper"
import { createMemoryStore } from "../src/store/memory"
import type { JurorResult, JurorVote } from "../src/types"

/** Shared fake time for the backend and the fake chain, so windows and deadlines can be crossed in tests. */
export function testClock(start = Date.parse("2030-01-01T00:00:00Z")) {
  let t = start
  return {
    now: () => new Date(t),
    seconds: () => Math.floor(t / 1000),
    advance: (seconds: number) => void (t += seconds * 1000),
  }
}

export const ARBITRATION = { challengeWindowSeconds: 180, relayerTimeoutSeconds: 3600, bondBps: 1000 }

/** Test-only chain double that enforces exactly the Escrow.sol state machine, including time and bonds. */
export function createFakeChain(clock = testClock()) {
  const jobs = new Map<Hex, OnchainJob>()
  const txs = new Set<Hex>()
  let n = 0
  const tx = () => {
    const h = keccak256(stringToHex(`tx-${n++}`))
    txs.add(h)
    return h
  }
  const failNext: { action?: string } = {}
  const get = (id: Hex): OnchainJob => jobs.get(id) ?? emptyOnchainJob()
  const revert = (action: string, why: string) => {
    throw new ChainError(action, `escrow.${action}() failed: ${why}`)
  }
  const need = (id: Hex, action: string, from: OnchainState[]) => {
    const j = get(id)
    if (!from.includes(j.state)) revert(action, `InvalidState(${j.state})`)
    return j
  }
  const move = (id: Hex, j: OnchainJob, state: OnchainState) => {
    jobs.set(id, { ...j, state, stateSince: clock.seconds() })
  }
  const payout = (id: Hex, j: OnchainJob, release: boolean, byAdmin: boolean) =>
    move(id, j, byAdmin ? (release ? "ResolvedRelease" : "ResolvedRefund") : release ? "Released" : "Refunded")

  const chain: EscrowChain & {
    fund: (id: Hex, client: Address, freelancer: Address, amount: bigint) => Hex
    /** A party calling challenge() from their own wallet. */
    challenge: (id: Hex, from: Address) => Hex
    /** Anyone calling a permissionless function directly, bypassing the backend. */
    finalizeDirect: (id: Hex) => Hex
    escalateStale: (id: Hex) => Hex
    failNext: typeof failNext
    jobs: typeof jobs
    calls: RelayerCall[]
  } = {
    escrowAddress: "0x00000000000000000000000000000000000e5c20",
    relayerAddress: "0x0000000000000000000000000000000000000e1a",
    params: ARBITRATION,
    jobs,
    failNext,
    calls: [],
    getJob: async (id) => ({ ...get(id) }),
    fund(id, client, freelancer, amount) {
      if (get(id).state !== "None") throw new Error("JobAlreadyExists")
      jobs.set(id, { ...emptyOnchainJob(), client, freelancer, amount, state: "Funded", stateSince: clock.seconds() })
      return tx()
    },
    challenge(id, from) {
      const j = need(id, "challenge", ["Proposed"])
      if (clock.seconds() >= j.challengeDeadline) revert("challenge", "ChallengeWindowClosed")
      const loser = j.proposed === "Release" ? j.client : j.freelancer
      if (from.toLowerCase() !== loser.toLowerCase()) revert("challenge", "NotLosingParty")
      jobs.set(id, { ...j, state: "Challenged", stateSince: clock.seconds(), challenger: from, bond: (j.amount * BigInt(ARBITRATION.bondBps)) / 10_000n })
      return tx()
    },
    finalizeDirect(id) {
      const j = need(id, "finalize", ["Proposed"])
      if (clock.seconds() < j.challengeDeadline) revert("finalize", "ChallengeWindowOpen")
      payout(id, j, j.proposed === "Release", false)
      return tx()
    },
    escalateStale(id) {
      const j = need(id, "escalateStale", ["Submitted", "Challenged"])
      if (clock.seconds() < j.stateSince + ARBITRATION.relayerTimeoutSeconds) revert("escalateStale", "RelayerNotStale")
      move(id, j, "Disputed")
      return tx()
    },
    send: async (id, call) => {
      if (failNext.action === call.fn) {
        failNext.action = undefined
        revert(call.fn, "RPC timeout")
      }
      chain.calls.push(call)
      switch (call.fn) {
        case "markSubmitted": {
          const j = need(id, call.fn, ["Funded"])
          move(id, { ...j, deliverableHash: call.deliverableHash }, "Submitted")
          break
        }
        case "proposeVerdict": {
          const j = need(id, call.fn, ["Submitted"])
          const proposed = call.outcome === "release" ? "Release" : "Refund"
          move(id, { ...j, proposed, verdictHash: call.verdictHash, challengeDeadline: clock.seconds() + ARBITRATION.challengeWindowSeconds }, "Proposed")
          break
        }
        case "escalate": {
          const j = need(id, call.fn, ["Submitted"])
          move(id, { ...j, verdictHash: call.verdictHash }, "Challenged")
          break
        }
        case "finalize":
          chain.finalizeDirect(id)
          break
        case "resolveChallenge": {
          const j = need(id, call.fn, ["Challenged"])
          payout(id, { ...j, rulingHash: call.rulingHash }, call.outcome === "release", false)
          break
        }
        case "dispute":
          move(id, need(id, call.fn, ["Funded", "Submitted", "Challenged"]), "Disputed")
          break
        case "resolve": {
          const j = need(id, call.fn, ["Disputed"])
          payout(id, { ...j, rulingHash: call.rulingHash }, call.outcome === "release", true)
          break
        }
      }
      return { txHash: tx() }
    },
    confirmTx: async (h) => {
      if (!txs.has(h)) throw new ChainError("confirm", "Could not confirm transaction: not found")
    },
    // EOA signatures only in tests; the real chain also checks ERC-1271/6492 smart accounts.
    verifySignature: (address, message, signature) => verifyMessage({ address, message, signature }).catch(() => false),
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

/** Test-only jury double: each deliberation takes the next queued set of votes (null = that juror failed). */
export function scriptedJury(criteria: () => string[]) {
  const queue: (JurorVote | null)[][] = []
  const calls: unknown[] = []
  const panel = [
    { name: "groq", model: "juror-a" },
    { name: "gemini", model: "juror-b" },
    { name: "groq", model: "juror-c" },
  ]
  const jury: Jury & { queue: typeof queue; calls: typeof calls } = {
    jurors: panel,
    queue,
    calls,
    async deliberate(input) {
      calls.push(input)
      const votes = queue.shift()
      if (!votes) throw new Error("scriptedJury: no votes queued")
      return votes.map((vote, i): JurorResult => {
        const c = criteria()
        const base = { provider: panel[i].name, model: panel[i].model, ms: 1 }
        if (!vote) return { ...base, ok: false, error: "HTTP 503", vote: null, confidence: null, matched_criteria: [], unmatched_criteria: [], reasoning: null }
        return {
          ...base,
          ok: true,
          error: null,
          vote,
          confidence: 0.9,
          matched_criteria: vote === "release" ? c : c.slice(1),
          unmatched_criteria: vote === "release" ? [] : c.slice(0, 1),
          reasoning: `Juror ${i + 1} weighed the evidence and both arguments and voted ${vote}.`,
        }
      })
    },
  }
  return jury
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

export function setup(opts: { criteria?: string[] } = {}) {
  const clock = testClock()
  const store = createMemoryStore()
  const chain = createFakeChain(clock)
  const ai = scriptedAi()
  const jury = scriptedJury(() => opts.criteria ?? ["criterion"])
  const auth = fakeAuth()
  const app = createApp({ store, chain, ai, jury, auth, fetchEvidence: noEvidence, argumentWindowSeconds: 120, now: clock.now, corsOrigins: ["http://localhost:3000"] })
  const keeper = createKeeper({ store, jobs: app.jobs, intervalMs: 1_000_000, now: clock.now, log: () => {} })

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

  return { app, store, chain, ai, jury, auth, user, clock, keeper }
}

export const futureDate = () => new Date(Date.parse("2030-01-01T00:00:00Z") + 7 * 86400_000).toISOString().slice(0, 10)
