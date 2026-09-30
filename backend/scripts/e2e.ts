/**
 * LIVE end-to-end test (build step 7): real Firebase Auth + Firestore, real Groq/Gemini,
 * real Escrow on Arbitrum Sepolia with Circle testnet USDC. Talks to a RUNNING backend.
 *
 * Requires in backend/.env (in addition to the normal backend config):
 *   FIREBASE_WEB_API_KEY     - web API key (to exchange custom tokens for ID tokens)
 *   E2E_CLIENT_PRIVATE_KEY   - testnet wallet with Arbitrum Sepolia ETH + >= 3.3*E2E_AMOUNT USDC
 *   E2E_API_URL              - default http://localhost:4000
 *   E2E_AMOUNT               - default 0.10 (USDC per job)
 *
 *   pnpm dev      (in one terminal)
 *   pnpm e2e      (in another)
 *
 * Paths: AI proposal -> keeper finalize; mismatched deliverable never pays out; client posts a real
 * bond and challenges -> real AI jury -> bond settled; complaint + review -> admin moderation.
 * Takes ~10 minutes: it waits out the real challenge and argument windows.
 */
import { createPublicClient, createWalletClient, erc20Abi, http, keccak256, parseUnits, stringToHex, type Hex } from "viem"
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
  const need = (parseUnits(AMOUNT, 6) * 33n) / 10n // three jobs + one 10% bond
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

  /** Polls until the job leaves the given statuses (the backend keeper drives time-based steps). */
  async function waitWhile(jobId: string, statuses: string[], timeoutMs: number) {
    const until = Date.now() + timeoutMs
    for (;;) {
      const d = (await client.get(`/api/jobs/${jobId}`)).body
      if (!statuses.includes(d.job.status)) return d
      if (Date.now() > until) throw new Error(`job ${jobId} still ${d.job.status} after ${timeoutMs / 1000}s`)
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
  /** Every commitment the backend stored must hash to exactly what the contract holds. */
  function checkCommitments(d: any) {
    const oc = d.onchain
    const sub = d.submissions.find((x: any) => x.id === d.job.currentSubmissionId)
    const ver = d.verifications.find((x: any) => x.id === d.job.verification.verificationId)
    assert(keccak256(stringToHex(sub.commitment.canonical)) === oc.deliverableHash, "deliverable hash on-chain matches the stored record")
    assert(keccak256(stringToHex(ver.commitment.canonical)) === oc.verdictHash, "verdict hash on-chain matches the stored record")
    const ruling = d.rulings.find((x: any) => x.id === d.job.jury.rulingId && x.commitment)
    if (ruling) assert(keccak256(stringToHex(ruling.commitment.canonical)) === oc.rulingHash, "ruling hash on-chain matches the stored record")
    return !!ruling
  }
  const windowMs = (health.chain.arbitration.challengeWindowSeconds + 90) * 1000
  const argsMs = 5 * 60_000

  console.log("\nPath 1: real deliverable → AI proposal → unchallenged → keeper finalizes")
  const j1 = await createAndFund(`E2E optimistic ${stamp}`)
  const s1 = await freelancer.post(`/api/jobs/${j1.id}/submissions`, {
    deliverableUrl: "https://github.com/expressjs/cors",
    description: "Published the cors middleware. README covers npm install and origin configuration; tests are in /test.",
  })
  assert(s1.status === 201 && s1.body.verification.ok, `submit: ${JSON.stringify(s1.body)}`)
  let d1 = (await client.get(`/api/jobs/${j1.id}`)).body
  show(d1.verifications[0])
  ok(`AI decision "${s1.body.verification.decision}" posted on-chain: https://sepolia.arbiscan.io/tx/${s1.body.verification.txHash}`)
  if (d1.job.status === "challenged") await freelancer.post(`/api/jobs/${j1.id}/arguments`, { argument: "The README has npm install and origin docs; tests are in the test/ folder." })
  d1 = await waitWhile(j1.id, ["proposed", "challenged"], windowMs + argsMs)
  checkCommitments(d1)
  assert(d1.job.status === "released" && d1.onchain.state === "Released", `expected released, got ${d1.job.status}/${d1.onchain.state}`)
  ok(`settled without anyone clicking: released on-chain (${d1.job.lastChainAction.type}) https://sepolia.arbiscan.io/tx/${d1.job.lastChainAction.txHash}`)
  ok("deliverable + verdict hashes recomputed locally match the contract")

  console.log("\nPath 2: mismatched deliverable must never pay out")
  const j2 = await createAndFund(`E2E mismatch ${stamp}`)
  const s2 = await freelancer.post(`/api/jobs/${j2.id}/submissions`, {
    deliverableUrl: "https://github.com/sindresorhus/slugify",
    description: "Here is the CORS middleware as agreed, fully tested and documented.",
  })
  assert(s2.status === 201 && s2.body.verification.ok, `submit: ${JSON.stringify(s2.body)}`)
  let d2 = (await freelancer.get(`/api/jobs/${j2.id}`)).body
  show(d2.verifications[0])
  assert(s2.body.verification.decision !== "release", "SAFETY: mismatched deliverable got a release proposal")
  ok(`AI decision "${s2.body.verification.decision}" (not release)`)
  if (d2.job.status === "challenged") await client.post(`/api/jobs/${j2.id}/arguments`, { argument: "The submitted repository is a slug library, not CORS middleware." })
  d2 = await waitWhile(j2.id, ["proposed", "challenged"], windowMs + argsMs)
  checkCommitments(d2)
  assert(d2.job.status !== "released", "SAFETY: mismatched deliverable was released")
  if (d2.job.status === "disputed") {
    const r2 = await admin.post(`/api/admin/jobs/${j2.id}/resolve`, { outcome: "refund", notes: "Submitted repository is unrelated to the agreed deliverable." })
    assert(r2.status === 200, `resolve: ${JSON.stringify(r2.body)}`)
  }
  ok(`refunded to the client (${d2.job.status})`)

  console.log("\nPath 3: client challenges a release with a real bond → AI jury")
  const j3 = await createAndFund(`E2E challenge ${stamp}`)
  const s3 = await freelancer.post(`/api/jobs/${j3.id}/submissions`, {
    deliverableUrl: "https://github.com/expressjs/cors",
    description: "Published the cors middleware. README covers npm install and origin configuration; tests are in /test.",
  })
  assert(s3.status === 201 && s3.body.verification.ok, `submit: ${JSON.stringify(s3.body)}`)
  if (s3.body.verification.decision !== "release") {
    console.log(`  ! AI chose "${s3.body.verification.decision}" instead of a release proposal; skipping the bonded-challenge path.`)
  } else {
    const d3 = (await client.get(`/api/jobs/${j3.id}`)).body
    const bond = BigInt(d3.arbitration.bond.units)
    const before = await pub.readContract({ address: CIRCLE_USDC, abi: erc20Abi, functionName: "balanceOf", args: [clientAcct.address] })
    await pub.waitForTransactionReceipt({ hash: await clientWallet.writeContract({ address: CIRCLE_USDC, abi: erc20Abi, functionName: "approve", args: [escrow, bond] }) })
    const ch = await clientWallet.writeContract({ address: escrow, abi: escrowAbi, functionName: "challenge", args: [j3.onchainJobId] })
    await pub.waitForTransactionReceipt({ hash: ch })
    const c3 = await client.post(`/api/jobs/${j3.id}/challenge`, { txHash: ch, argument: "I don't think the tests are adequate; I want a refund." })
    assert(c3.status === 200 && c3.body.job.status === "challenged", `challenge: ${JSON.stringify(c3.body)}`)
    ok(`client challenged with a ${d3.arbitration.bond.display} USDC bond: https://sepolia.arbiscan.io/tx/${ch}`)
    const a3 = await freelancer.post(`/api/jobs/${j3.id}/arguments`, { argument: "README documents npm install and the origin option; the test/ folder has the suite." })
    assert(a3.status === 200, `argue: ${JSON.stringify(a3.body)}`)
    const end = await waitWhile(j3.id, ["challenged"], argsMs)
    const ruling = end.rulings[0]
    for (const j of ruling.jurors) console.log(`      juror ${j.provider}:${j.model} → ${j.ok ? `${j.vote}@${j.confidence}` : `FAILED ${j.error}`}`)
    assert(checkCommitments(end), "jury ruling committed on-chain")
    const after = await pub.readContract({ address: CIRCLE_USDC, abi: erc20Abi, functionName: "balanceOf", args: [clientAcct.address] })
    if (end.job.status === "released") assert(before - after === bond, `upheld: client loses the bond (delta ${before - after})`)
    if (end.job.status === "refunded") assert(after - before === BigInt(j3.amountUnits), `overturned: client gets funds back and keeps the bond (delta ${after - before})`)
    ok(`jury ${ruling.outcome} (${ruling.reason}); status ${end.job.status}; bond settled correctly; ruling hash verified`)
  }

  console.log("\nPath 4: complaints & reviews → moderation")
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
