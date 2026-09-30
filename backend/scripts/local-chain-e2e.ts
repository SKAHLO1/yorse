/**
 * Local end-to-end run against the REAL Escrow contract and REAL Circle USDC on a forked
 * Arbitrum Sepolia (anvil). Needs no keys. Verifies the backend <-> chain wiring:
 * fund (client wallet) -> submit -> markSubmitted -> AI proposal -> challenge window (time warp)
 * -> finalize / bonded challenge -> AI jury ruling -> admin resolve.
 *
 * This is a regression harness, not the live check: AI verdicts and jury votes are scripted.
 * The live checks are Smoke.s.sol (contract on Arbitrum Sepolia), scripts/jury-eval.ts (real
 * models) and scripts/e2e.ts / the UI (everything together).
 *
 *   anvil --fork-url https://sepolia-rollup.arbitrum.io/rpc --port 8546
 *   pnpm tsx scripts/local-chain-e2e.ts
 */
import { readFileSync } from "node:fs"
import { createPublicClient, createTestClient, createWalletClient, erc20Abi, http, parseUnits, type Address, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { arbitrumSepolia } from "viem/chains"
import { createApp } from "../src/app"
import { CIRCLE_USDC, createEscrowChain } from "../src/chain/escrow"
import { escrowAbi } from "../src/chain/escrowAbi"
import { createKeeper } from "../src/services/keeper"
import { createMemoryStore } from "../src/store/memory"
import { fakeAuth, noEvidence, scriptedAi, scriptedJury } from "../test/helpers"
import request from "supertest"

const RPC = process.env.LOCAL_RPC ?? "http://127.0.0.1:8546"
// Well-known anvil dev keys: local fork only.
const RELAYER = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
const CLIENT = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d")
const FREELANCER = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a")

const transport = http(RPC)
const pub = createPublicClient({ chain: arbitrumSepolia, transport })
const test = createTestClient({ chain: arbitrumSepolia, transport, mode: "anvil" })
const wallet = (acct: typeof RELAYER) => createWalletClient({ chain: arbitrumSepolia, transport, account: acct })

let step = 0
const ok = (msg: string) => console.log(`  ✓ ${++step}. ${msg}`)
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`)
}

async function mintUsdc(to: Hex, amount: bigint) {
  const mm = await pub.readContract({ address: CIRCLE_USDC, abi: [{ type: "function", name: "masterMinter", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }], functionName: "masterMinter" })
  await test.impersonateAccount({ address: mm })
  await test.setBalance({ address: mm, value: parseUnits("10", 18) })
  const minterAbi = [
    { type: "function", name: "configureMinter", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
    { type: "function", name: "mint", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  ] as const
  const mmWallet = createWalletClient({ chain: arbitrumSepolia, transport, account: mm })
  await pub.waitForTransactionReceipt({ hash: await mmWallet.writeContract({ address: CIRCLE_USDC, abi: minterAbi, functionName: "configureMinter", args: [RELAYER.address, amount] }) })
  await pub.waitForTransactionReceipt({ hash: await wallet(RELAYER).writeContract({ address: CIRCLE_USDC, abi: minterAbi, functionName: "mint", args: [to, amount] }) })
}

const WINDOW = 180n
const usdcOf = (a: Address) => pub.readContract({ address: CIRCLE_USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] })

async function main() {
  console.log(`Local chain e2e against ${RPC}`)
  assert((await pub.getChainId()) === 421614, "anvil must fork Arbitrum Sepolia (chain 421614)")
  for (const a of [RELAYER, CLIENT, FREELANCER]) await test.setBalance({ address: a.address, value: parseUnits("10", 18) })

  // Deploy the real Escrow bytecode compiled by forge.
  const artifact = JSON.parse(readFileSync(new URL("../../contracts/out/Escrow.sol/Escrow.json", import.meta.url), "utf8"))
  const deployHash = await wallet(RELAYER).deployContract({ abi: escrowAbi, bytecode: artifact.bytecode.object, args: [CIRCLE_USDC, RELAYER.address, RELAYER.address, WINDOW, 3600n, 1000] })
  const escrowAddress = (await pub.waitForTransactionReceipt({ hash: deployHash })).contractAddress!
  ok(`Escrow deployed at ${escrowAddress}`)

  await mintUsdc(CLIENT.address, parseUnits("1000", 6))
  await mintUsdc(FREELANCER.address, parseUnits("10", 6)) // enough for a challenge bond
  const startFreelancer = await usdcOf(FREELANCER.address)
  const startClient = await usdcOf(CLIENT.address)
  ok(`client holds ${startClient / 1_000_000n} USDC (minted in fork)`)

  const chain = await createEscrowChain({ rpcUrl: RPC, relayerPrivateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", escrowAddress })
  ok("backend chain client passed startup checks (chain id, Circle USDC, relayer)")

  const auth = fakeAuth()
  const ai = scriptedAi()
  const criteria = ["README documents setup steps", "Includes unit tests"]
  const jury = scriptedJury(() => criteria)
  const store = createMemoryStore()
  // Backend time follows the fork's block time, so warping the chain also moves the backend's clock.
  let chainNow = Number((await pub.getBlock()).timestamp) * 1000
  const now = () => new Date(chainNow)
  const warp = async (seconds: bigint) => {
    await test.increaseTime({ seconds: Number(seconds) })
    await test.mine({ blocks: 1 })
    chainNow = Number((await pub.getBlock()).timestamp) * 1000
  }
  const app = createApp({ store, chain, ai, jury, auth, fetchEvidence: noEvidence, argumentWindowSeconds: 60, now, corsOrigins: [] })
  const keeper = createKeeper({ store, jobs: app.jobs, intervalMs: 1e9, now, log: (m) => console.log(`    keeper: ${m}`) })
  const agent = (uid: string, acct: typeof RELAYER | null, admin = false) => {
    const h = { authorization: `Bearer ${auth.add({ uid, email: `${uid}@local.test`, name: uid, picture: null, admin })}` }
    return {
      acct,
      get: (p: string) => request(app).get(p).set(h),
      post: (p: string, b: object = {}) => request(app).post(p).set(h).send(b),
    }
  }
  const client = agent("client", CLIENT)
  const freelancer = agent("freelancer", FREELANCER)
  const admin = agent("admin", null, true)
  for (const u of [client, freelancer]) {
    const ch = await u.post("/api/me/wallet/challenge")
    const r = await u.post("/api/me/wallet", { address: u.acct!.address, signature: await u.acct!.signMessage({ message: ch.body.message }) })
    assert(r.status === 200, `wallet link: ${JSON.stringify(r.body)}`)
  }
  ok("client and freelancer linked wallets by signature")

  const createAndFund = async (amount: string) => {
    const c = await client.post("/api/jobs", {
      title: `Local e2e ${amount}`,
      deliverableDescription: "A small TypeScript library with documentation and tests.",
      acceptanceCriteria: criteria,
      dueDate: new Date(chainNow + 86400_000 * 3).toISOString(),
      amountUsdc: amount,
      freelancerEmail: "freelancer@local.test",
    })
    assert(c.status === 201, JSON.stringify(c.body))
    const job = c.body.job
    await freelancer.post(`/api/jobs/${job.id}/respond`, { accept: true })
    // The client funds from their own wallet (what the frontend does via wagmi).
    const units = BigInt(job.amountUnits)
    const cw = wallet(CLIENT)
    await pub.waitForTransactionReceipt({ hash: await cw.writeContract({ address: CIRCLE_USDC, abi: erc20Abi, functionName: "approve", args: [escrowAddress, units] }) })
    const fundHash = await cw.writeContract({ address: escrowAddress, abi: escrowAbi, functionName: "fund", args: [job.onchainJobId, FREELANCER.address, units] })
    const f = await client.post(`/api/jobs/${job.id}/fund-confirm`, { txHash: fundHash })
    assert(f.status === 200 && f.body.job.status === "funded", `fund-confirm: ${JSON.stringify(f.body)}`)
    return job
  }
  const onchainState = async (id: Hex) => (await chain.getJob(id)).state
  const submit = (id: string) =>
    freelancer.post(`/api/jobs/${id}/submissions`, { deliverableUrl: "https://example.com/repo", description: "Library with README setup section and a vitest suite." })

  // --- Path 1: proposal -> window passes -> keeper finalizes
  console.log("\nPath 1: AI proposal → unchallenged → finalize")
  const j1 = await createAndFund("12.5")
  ok(`job funded on-chain: ${await onchainState(j1.onchainJobId)}`)
  ai.queue.push({ verdict: "release", confidence: 0.95, matched_criteria: criteria, unmatched_criteria: [], reasoning: "README has a Setup section and tests/ contains a vitest suite with 12 tests." })
  const s1 = await submit(j1.id)
  assert(s1.body.verification?.ok && s1.body.verification.decision === "release", JSON.stringify(s1.body))
  const oc1 = await chain.getJob(j1.onchainJobId)
  assert(oc1.state === "Proposed" && oc1.proposed === "Release", `expected Proposed(Release), got ${oc1.state}`)
  const d1 = (await client.get(`/api/jobs/${j1.id}`)).body
  assert(oc1.deliverableHash === d1.submissions[0].commitment.hash, "deliverable hash on-chain matches the stored submission")
  assert(oc1.verdictHash === d1.verifications[0].commitment.hash, "verdict hash on-chain matches the stored verdict")
  ok("AI verdict posted as proposal; deliverable + verdict hashes committed on-chain")
  await keeper.tick()
  assert((await onchainState(j1.onchainJobId)) === "Proposed", "keeper must not finalize inside the window")
  await warp(WINDOW)
  await keeper.tick()
  assert((await onchainState(j1.onchainJobId)) === "Released", "expected Released")
  ok("window passed → keeper called finalize() → on-chain Released")

  // --- Path 2: refund proposal -> freelancer challenges with a real bond -> jury refunds -> bond to client
  console.log("\nPath 2: refund proposal → bonded challenge → AI jury")
  const j2 = await createAndFund("7")
  ai.queue.push({ verdict: "dispute", confidence: 0.9, matched_criteria: ["README documents setup steps"], unmatched_criteria: ["Includes unit tests"], reasoning: "The repository tree has no test files or test runner configuration." })
  const s2 = await submit(j2.id)
  assert(s2.body.verification?.decision === "refund", JSON.stringify(s2.body))
  const bond = (await freelancer.get(`/api/jobs/${j2.id}`)).body.arbitration.bond
  assert(bond.display === "0.70", `bond is 10%: ${JSON.stringify(bond)}`)
  const fw = wallet(FREELANCER)
  await pub.waitForTransactionReceipt({ hash: await fw.writeContract({ address: CIRCLE_USDC, abi: erc20Abi, functionName: "approve", args: [escrowAddress, BigInt(bond.units)] }) })
  const challengeTx = await fw.writeContract({ address: escrowAddress, abi: escrowAbi, functionName: "challenge", args: [j2.onchainJobId] })
  const c2 = await freelancer.post(`/api/jobs/${j2.id}/challenge`, { txHash: challengeTx, argument: "The tests live in a separate folder the reviewer may have missed." })
  assert(c2.status === 200 && c2.body.job.status === "challenged", JSON.stringify(c2.body))
  ok(`freelancer challenged on-chain with a ${bond.display} USDC bond`)
  jury.queue.push(["refund", "refund", "release"])
  const a2 = await client.post(`/api/jobs/${j2.id}/arguments`, { argument: "There is no test runner configured anywhere in the repo." })
  assert(a2.status === 200 && a2.body.job.status === "refunded", JSON.stringify(a2.body))
  const oc2 = await chain.getJob(j2.onchainJobId)
  const ruling2 = (await client.get(`/api/jobs/${j2.id}`)).body.rulings[0]
  assert(oc2.state === "Refunded" && oc2.rulingHash === ruling2.commitment.hash, "jury ruling committed and applied")
  ok("jury 2–1 for refund → resolveChallenge() → on-chain Refunded; ruling hash committed")

  // --- Path 2b: unsure AI -> escalate -> jury split -> admin
  console.log("\nPath 2b: unsure AI → jury split → admin")
  const j2b = await createAndFund("1")
  ai.queue.push({ verdict: "release", confidence: 0.6, matched_criteria: criteria, unmatched_criteria: [], reasoning: "The README mentions tests but the test folder could not be inspected." })
  const s2b = await submit(j2b.id)
  assert(s2b.body.verification?.decision === "escalate" && (await onchainState(j2b.onchainJobId)) === "Challenged", JSON.stringify(s2b.body))
  jury.queue.push(["release", "refund", "abstain"])
  await warp(61n)
  await keeper.tick()
  assert((await onchainState(j2b.onchainJobId)) === "Disputed", "split jury goes to Disputed")
  const r2 = await admin.post(`/api/admin/jobs/${j2b.id}/resolve`, { outcome: "refund", notes: "No tests were delivered; refunding client." })
  assert(r2.status === 200, JSON.stringify(r2.body))
  assert((await onchainState(j2b.onchainJobId)) === "ResolvedRefund", "expected ResolvedRefund")
  ok("escalate() → jury split → dispute() → admin resolve(refund) → on-chain ResolvedRefund")

  // --- Path 3: non-delivery dispute from Funded -> admin release
  console.log("\nPath 3: non-delivery dispute from Funded → admin release")
  const j3 = await createAndFund("3")
  const d3 = await client.post(`/api/jobs/${j3.id}/dispute`, { reason: "No delivery by the due date." })
  assert(d3.status === 200, JSON.stringify(d3.body))
  assert((await onchainState(j3.onchainJobId)) === "Disputed", "expected Disputed")
  const r3 = await admin.post(`/api/admin/jobs/${j3.id}/resolve`, { outcome: "release", notes: "Freelancer showed off-platform delivery." })
  assert(r3.status === 200 && (await onchainState(j3.onchainJobId)) === "ResolvedRelease", JSON.stringify(r3.body))
  ok("client dispute from Funded → admin resolve(release) → on-chain ResolvedRelease")

  // --- Path 5: public listing -> application -> selection -> release -> rating
  console.log("\nPath 5: public listing, application, selection")
  const p5 = await client.post("/api/jobs", {
    title: "Public listing e2e",
    deliverableDescription: "A small TypeScript library with documentation and tests, open to applications.",
    acceptanceCriteria: criteria,
    dueDate: new Date(chainNow + 86400_000 * 3).toISOString(),
    amountUsdc: "2",
    visibility: "public",
  })
  assert(p5.status === 201 && p5.body.job.status === "open", JSON.stringify(p5.body))
  const openJob = p5.body.job

  const feedForDev = (await freelancer.get("/api/feed")).body.feed
  assert(feedForDev.some((f: any) => f.id === openJob.id), "listing must appear in the developer's feed")
  ok(`listing is live in the feed (posted by ${feedForDev[0].client.displayName})`)

  const application = await freelancer.post(`/api/jobs/${openJob.id}/applications`, {
    message: "I maintain two similar libraries and can deliver the docs and tests this week.",
    portfolioUrl: "https://github.com/example",
  })
  assert(application.status === 201, JSON.stringify(application.body))
  const seen = (await client.get(`/api/jobs/${openJob.id}/applications`)).body.applications
  assert(seen.length === 1 && seen[0].applicant.uid === "freelancer", "client sees the application")
  ok("developer applied; only the client can see it")

  const picked = await client.post(`/api/jobs/${openJob.id}/applications/${application.body.application.id}/select`)
  assert(picked.status === 200 && picked.body.job.status === "pending_acceptance", JSON.stringify(picked.body))
  assert((await freelancer.get("/api/feed")).body.feed.every((f: any) => f.id !== openJob.id), "selected job must leave the feed")
  ok("client selected the developer; listing left the feed")

  await freelancer.post(`/api/jobs/${openJob.id}/respond`, { accept: true })
  const units5 = BigInt(openJob.amountUnits)
  const cw5 = wallet(CLIENT)
  await pub.waitForTransactionReceipt({ hash: await cw5.writeContract({ address: CIRCLE_USDC, abi: erc20Abi, functionName: "approve", args: [escrowAddress, units5] }) })
  const fund5 = await cw5.writeContract({ address: escrowAddress, abi: escrowAbi, functionName: "fund", args: [openJob.onchainJobId, FREELANCER.address, units5] })
  const f5 = await client.post(`/api/jobs/${openJob.id}/fund-confirm`, { txHash: fund5 })
  assert(f5.status === 200, JSON.stringify(f5.body))
  ai.queue.push({ verdict: "release", confidence: 0.96, matched_criteria: criteria, unmatched_criteria: [], reasoning: "README documents setup and the repository contains a passing unit test suite." })
  const s5 = await submit(openJob.id)
  assert(s5.body.verification?.decision === "release", JSON.stringify(s5.body))
  await warp(WINDOW)
  const fin5 = await freelancer.post(`/api/jobs/${openJob.id}/finalize`)
  assert(fin5.status === 200, JSON.stringify(fin5.body))
  assert((await onchainState(openJob.onchainJobId)) === "Released", "expected Released")
  ok("public job funded, verified and released on-chain")

  // --- Path 6: ratings from reviews
  console.log("\nPath 6: ratings")
  assert((await client.post(`/api/jobs/${openJob.id}/reviews`, { rating: 5, comment: "Delivered exactly to the criteria, great communication." })).status === 201, "client review")
  assert((await freelancer.post(`/api/jobs/${openJob.id}/reviews`, { rating: 4, comment: "Clear scope and funded the escrow promptly." })).status === 201, "developer review")
  const devProfile = (await client.get("/api/users/freelancer")).body
  const clientProfile = (await freelancer.get("/api/users/client")).body
  assert(devProfile.user.ratingAsFreelancer.average === 5, `developer rating: ${JSON.stringify(devProfile.user.ratingAsFreelancer)}`)
  assert(clientProfile.user.ratingAsClient.average === 4, `client rating: ${JSON.stringify(clientProfile.user.ratingAsClient)}`)
  assert(!JSON.stringify(devProfile).includes("@local.test"), "public profile must not leak emails")
  ok(`ratings: developer ${devProfile.user.ratingAsFreelancer.average}/5, client ${clientProfile.user.ratingAsClient.average}/5, no emails exposed`)

  // --- Path 4: complaints + reviews
  console.log("\nPath 4: complaints & reviews")
  assert((await client.post(`/api/jobs/${j1.id}/reviews`, { rating: 5, comment: "Excellent work, fast delivery." })).status === 201, "review")
  assert((await freelancer.post(`/api/jobs/${j2.id}/complaints`, { category: "ai_verdict", description: "My tests were in a separate branch the AI did not see." })).status === 201, "complaint")
  const complaints = (await admin.get("/api/admin/complaints")).body.complaints
  assert(complaints.length === 1, "admin sees complaint")
  ok("review + complaint filed and visible to admin")

  // --- Balances
  const endFreelancer = await usdcOf(FREELANCER.address)
  const endClient = await usdcOf(CLIENT.address)
  const escrowBal = await usdcOf(escrowAddress)
  // Paid out: 12.5 + 3 (admin release) + 2 (public listing) = 17.5. Refunded: 7 and 1.
  // The freelancer's losing 0.70 bond went to the client.
  assert(endFreelancer - startFreelancer === parseUnits("16.8", 6), `freelancer +16.80 USDC, got ${endFreelancer - startFreelancer}`)
  assert(startClient - endClient === parseUnits("16.8", 6), `client -16.80 USDC net, got ${startClient - endClient}`)
  assert(escrowBal === 0n, "escrow drained")
  ok("balances: freelancer +16.80 USDC (17.50 paid − 0.70 lost bond), client −16.80 net, escrow 0")

  console.log("\nAll local chain e2e paths passed.")
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
