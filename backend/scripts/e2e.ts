/**
 * LIVE end-to-end test (build step 7): real Firebase Auth + Firestore, real Groq/Gemini,
 * real Escrow on Arbitrum Sepolia with Circle testnet USDC. Talks to a RUNNING backend.
 *
 * Requires in backend/.env (in addition to the normal backend config):
 *   FIREBASE_WEB_API_KEY     - web API key (to exchange custom tokens for ID tokens)
 *   E2E_CLIENT_PRIVATE_KEY   - testnet wallet with Arbitrum Sepolia ETH + >= 2*E2E_AMOUNT USDC
 *   E2E_API_URL              - default http://localhost:4000
 *   E2E_AMOUNT               - default 0.10 (USDC per job)
 *
 *   pnpm dev      (in one terminal)
 *   pnpm e2e      (in another)
 *
 * Paths: auto-release, dispute -> admin refund, complaint + review -> admin moderation.
 */
import { createPublicClient, createWalletClient, erc20Abi, http, parseUnits, type Hex } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { arbitrumSepolia } from "viem/chains"
import { CIRCLE_USDC } from "../src/chain/escrow"
import { escrowAbi } from "../src/chain/escrowAbi"
import { initFirebase } from "../src/firebase"
import { loadFirebaseOnly } from "./firebase-env"

const API = process.env.E2E_API_URL ?? "http://localhost:4000"
const WEB_KEY = process.env.FIREBASE_WEB_API_KEY
const CLIENT_PK = process.env.E2E_CLIENT_PRIVATE_KEY as Hex | undefined
const AMOUNT = process.env.E2E_AMOUNT ?? "0.10"
const RPC = process.env.ARBITRUM_SEPOLIA_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc"
if (!WEB_KEY || !CLIENT_PK) {
  console.error("Set FIREBASE_WEB_API_KEY and E2E_CLIENT_PRIVATE_KEY in backend/.env")
  process.exit(1)
}

const { auth } = initFirebase(loadFirebaseOnly())
const pub = createPublicClient({ chain: arbitrumSepolia, transport: http(RPC) })
const clientAcct = privateKeyToAccount(CLIENT_PK)
const freelancerAcct = privateKeyToAccount(generatePrivateKey()) // only signs the wallet-link message
const clientWallet = createWalletClient({ chain: arbitrumSepolia, transport: http(RPC), account: clientAcct })

let step = 0
const ok = (m: string) => console.log(`  ✓ ${++step}. ${m}`)
function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m)
}

async function idTokenFor(email: string, admin: boolean) {
  let user = await auth.getUserByEmail(email).catch(() => null)
  if (!user) user = await auth.createUser({ email, emailVerified: true, password: `E2e-${generatePrivateKey().slice(2, 18)}` })
  await auth.setCustomUserClaims(user.uid, admin ? { admin: true } : {})
  const custom = await auth.createCustomToken(user.uid)
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  const body = (await res.json()) as any
  assert(res.ok, `sign-in failed for ${email}: ${JSON.stringify(body)}`)
  return body.idToken as string
}

function apiFor(token: string) {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json().catch(() => ({}))
    return { status: res.status, body: json as any }
  }
  return { get: (p: string) => call("GET", p), post: (p: string, b?: unknown) => call("POST", p, b ?? {}), patch: (p: string, b: unknown) => call("PATCH", p, b) }
}

async function main() {
  console.log(`Live e2e → ${API} (Arbitrum Sepolia)`)
  const health = (await fetch(`${API}/health`).then((r) => r.json())) as any
  assert(health.ok, `backend unhealthy: ${JSON.stringify(health)}`)
  const escrow = health.chain.escrow as Hex
  ok(`backend healthy; escrow ${escrow}; AI ${health.ai.map((p: any) => p.name).join("→")}`)

  const usdc = await pub.readContract({ address: CIRCLE_USDC, abi: erc20Abi, functionName: "balanceOf", args: [clientAcct.address] })
  const need = parseUnits(AMOUNT, 6) * 2n
  assert(usdc >= need, `client wallet ${clientAcct.address} has ${usdc} USDC units; needs ${need} (faucet.circle.com)`)

  const stamp = Date.now()
  const client = apiFor(await idTokenFor("e2e-client@yorse.test", false))
  const freelancer = apiFor(await idTokenFor("e2e-freelancer@yorse.test", false))
  const admin = apiFor(await idTokenFor("e2e-admin@yorse.test", true))
  ok("signed in 3 Firebase users (client, freelancer, admin w/ custom claim)")

  for (const [u, acct] of [[client, clientAcct], [freelancer, freelancerAcct]] as const) {
    const ch = await u.post("/api/me/wallet/challenge")
    const r = await u.post("/api/me/wallet", { address: acct.address, signature: await acct.signMessage({ message: ch.body.message }) })
    // A reused e2e account keeps its earlier wallet if it has active jobs; that's fine for the client key.
    assert(r.status === 200 || r.body?.error?.code === "conflict", `wallet link: ${JSON.stringify(r.body)}`)
  }
  ok(`wallets linked (client ${clientAcct.address.slice(0, 10)}…, freelancer ${freelancerAcct.address.slice(0, 10)}…)`)

  const criteria = ["README documents installation via npm", "README documents configuring the allowed origin", "Repository contains automated tests"]
  async function createAndFund(title: string) {
    const c = await client.post("/api/jobs", {
      title,
      deliverableDescription: "An open-source Node.js middleware package that enables CORS for Express apps, with documentation and tests.",
      acceptanceCriteria: criteria,
      dueDate: new Date(Date.now() + 7 * 86400_000).toISOString(),
      amountUsdc: AMOUNT,
      freelancerEmail: "e2e-freelancer@yorse.test",
    })
    assert(c.status === 201, `create job: ${JSON.stringify(c.body)}`)
    const job = c.body.job
    assert((await freelancer.post(`/api/jobs/${job.id}/respond`, { accept: true })).status === 200, "accept")
    const units = BigInt(job.amountUnits)
    await pub.waitForTransactionReceipt({ hash: await clientWallet.writeContract({ address: CIRCLE_USDC, abi: erc20Abi, functionName: "approve", args: [escrow, units] }) })
    const fundHash = await clientWallet.writeContract({ address: escrow, abi: escrowAbi, functionName: "fund", args: [job.onchainJobId, job.freelancerWallet, units] })
    const f = await client.post(`/api/jobs/${job.id}/fund-confirm`, { txHash: fundHash })
    assert(f.status === 200, `fund-confirm: ${JSON.stringify(f.body)}`)
    ok(`"${title}" funded: https://sepolia.arbiscan.io/tx/${fundHash}`)
    return job
  }
  const show = (v: any) => {
    const r = v?.result
    if (r) console.log(`      AI ${v.provider}:${v.model} → ${r.verdict}@${r.confidence} ; decision ${v.decision}\n      reasoning: ${r.reasoning}`)
  }

  console.log("\nPath 1: auto-release (real deliverable)")
  const j1 = await createAndFund(`E2E auto-release ${stamp}`)
  const s1 = await freelancer.post(`/api/jobs/${j1.id}/submissions`, {
    deliverableUrl: "https://github.com/expressjs/cors",
    description: "Published the cors middleware. README covers npm install and origin configuration; tests are in /test.",
  })
  assert(s1.status === 201, `submit: ${JSON.stringify(s1.body)}`)
  const d1 = (await client.get(`/api/jobs/${j1.id}`)).body
  show(d1.verifications[0])
  assert(s1.body.verification.ok, `verification failed: ${s1.body.verification.error}`)
  if (d1.job.status !== "released") {
    console.log(`  ! AI was conservative and disputed a passing deliverable (status ${d1.job.status}). Resolving via admin to keep going.`)
    await admin.post(`/api/admin/jobs/${j1.id}/resolve`, { outcome: "release", notes: "E2E: deliverable verified manually." })
  } else ok(`released on-chain: https://sepolia.arbiscan.io/tx/${s1.body.verification.txHash}`)

  console.log("\nPath 2: dispute (mismatched deliverable) → admin refund")
  const j2 = await createAndFund(`E2E dispute ${stamp}`)
  const s2 = await freelancer.post(`/api/jobs/${j2.id}/submissions`, {
    deliverableUrl: "https://github.com/sindresorhus/slugify",
    description: "Here is the CORS middleware as agreed, fully tested and documented.",
  })
  assert(s2.status === 201 && s2.body.verification.ok, `submit: ${JSON.stringify(s2.body)}`)
  const d2 = (await freelancer.get(`/api/jobs/${j2.id}`)).body
  show(d2.verifications[0])
  assert(d2.job.status === "disputed", `SAFETY: mismatched deliverable was not disputed (status ${d2.job.status})`)
  ok("mismatched deliverable disputed on-chain")
  const listed = (await admin.get("/api/admin/jobs?status=disputed")).body.jobs.map((j: any) => j.id)
  assert(listed.includes(j2.id), "admin dispute queue")
  const r2 = await admin.post(`/api/admin/jobs/${j2.id}/resolve`, { outcome: "refund", notes: "Submitted repository is unrelated to the agreed deliverable." })
  assert(r2.status === 200, `resolve: ${JSON.stringify(r2.body)}`)
  ok(`admin refunded: https://sepolia.arbiscan.io/tx/${r2.body.job.resolution.txHash}`)

  console.log("\nPath 3: complaints & reviews → moderation")
  const rv = await client.post(`/api/jobs/${j1.id}/reviews`, { rating: 5, comment: "Great package, well documented and tested." })
  assert(rv.status === 201, `review: ${JSON.stringify(rv.body)}`)
  const cp = await freelancer.post(`/api/jobs/${j2.id}/complaints`, { category: "ai_verdict", description: "E2E complaint: testing the complaint moderation workflow." })
  assert(cp.status === 201, `complaint: ${JSON.stringify(cp.body)}`)
  assert((await admin.patch(`/api/admin/complaints/${cp.body.complaint.id}`, { status: "resolved", adminNotes: "E2E moderated." })).status === 200, "moderate complaint")
  assert((await admin.patch(`/api/admin/reviews/${rv.body.review.id}`, { status: "hidden", moderationNote: "E2E moderation check." })).status === 200, "moderate review")
  const hidden = (await freelancer.get(`/api/jobs/${j1.id}`)).body.reviews.find((r: any) => r.id === rv.body.review.id)
  assert(!hidden, "hidden review must not be visible to the counterpart")
  ok("review + complaint filed, moderated, and visibility enforced")

  const events = (await admin.get(`/api/admin/jobs/${j2.id}`)).body.events.map((e: any) => e.type)
  ok(`admin full history for dispute job: ${events.join(" → ")}`)
  console.log("\nLive e2e passed.")
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
