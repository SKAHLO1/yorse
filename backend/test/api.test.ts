import request from "supertest"
import { describe, expect, it } from "vitest"
import { futureDate, setup } from "./helpers"

const criteria = ["Responsive landing page with hero section", "Contact form posts to /api/contact", "Lighthouse performance score above 90"]
const releaseVerdict = {
  verdict: "release" as const,
  confidence: 0.92,
  matched_criteria: [...criteria],
  unmatched_criteria: [],
  reasoning: "The fetched page contains a hero section, a form posting to /api/contact, and the README reports a Lighthouse score of 97.",
}
const lowConfidence = { ...releaseVerdict, confidence: 0.6, reasoning: "The page has a hero but the Lighthouse claim is unverified; evidence is thin." }

async function fundedJob(ctx: Awaited<ReturnType<typeof world>>) {
  const { client, freelancer, chain } = ctx
  const created = await client.post("/api/jobs", {
    title: "Marketing landing page",
    deliverableDescription: "Build a responsive marketing landing page for the product launch.",
    acceptanceCriteria: criteria,
    dueDate: futureDate(),
    amountUsdc: "250",
    freelancerEmail: freelancer.email,
  })
  expect(created.status, JSON.stringify(created.body)).toBe(201)
  const job = created.body.job
  expect(job.status).toBe("pending_acceptance")
  expect(job.amountUnits).toBe("250000000")

  // Client cannot fund before the freelancer agrees to the terms.
  expect((await client.post(`/api/jobs/${job.id}/fund-confirm`, { txHash: "0x" + "1".repeat(64) })).status).toBe(409)
  expect((await freelancer.post(`/api/jobs/${job.id}/respond`, { accept: true })).body.job.status).toBe("awaiting_funding")

  const txHash = chain.fund(job.onchainJobId, client.account.address, freelancer.account.address, 250_000_000n)
  const funded = await client.post(`/api/jobs/${job.id}/fund-confirm`, { txHash })
  expect(funded.status, JSON.stringify(funded.body)).toBe(200)
  expect(funded.body.job.status).toBe("funded")
  return job
}

async function world() {
  const s = setup()
  const client = await s.user("client")
  const freelancer = await s.user("freelancer")
  const admin = await s.user("admin", { admin: true, wallet: false })
  const stranger = await s.user("stranger")
  return { ...s, client, freelancer, admin, stranger }
}

const submission = {
  deliverableUrl: "https://example.com/landing",
  description: "Landing page deployed with hero, contact form and performance optimizations.",
  notes: "Lighthouse report in README",
}

describe("auth & scoping", () => {
  it("rejects missing and invalid tokens", async () => {
    const { app } = setup()
    expect((await request(app).get("/api/jobs")).status).toBe(401)
    expect((await request(app).get("/api/jobs").set("authorization", "Bearer nope")).status).toBe(401)
  })

  it("hides jobs from non-participants and admin routes from non-admins", async () => {
    const w = await world()
    const job = await fundedJob(w)
    expect((await w.stranger.get(`/api/jobs/${job.id}`)).status).toBe(404)
    expect((await w.stranger.get("/api/jobs")).body.jobs).toHaveLength(0)
    expect((await w.client.get("/api/admin/jobs")).status).toBe(403)
    expect((await w.admin.get(`/api/admin/jobs/${job.id}`)).status).toBe(200)
  })

  it("rejects a wallet signature from a different key", async () => {
    const s = setup()
    const u = await s.user("u", { wallet: false })
    const other = await s.user("o", { wallet: false })
    const ch = await u.post("/api/me/wallet/challenge")
    const sig = await other.account.signMessage({ message: ch.body.message })
    const r = await u.post("/api/me/wallet", { address: u.account.address, signature: sig })
    expect(r.status).toBe(400)
    expect(r.body.error.message).toMatch(/Signature/)
  })

  it("requires linked wallets and an existing freelancer to create a job", async () => {
    const s = setup()
    const noWallet = await s.user("nw", { wallet: false })
    const base = { title: "T job", deliverableDescription: "x".repeat(30), acceptanceCriteria: ["criterion one"], dueDate: futureDate(), amountUsdc: "1" }
    expect((await noWallet.post("/api/jobs", { ...base, freelancerEmail: "a@b.co" })).body.error.message).toMatch(/Link your wallet/)
    const c = await s.user("c")
    expect((await c.post("/api/jobs", { ...base, freelancerEmail: "ghost@example.com" })).body.error.message).toMatch(/No Yorse account/)
    expect((await c.post("/api/jobs", { ...base, amountUsdc: "1.1234567", freelancerEmail: "nw@example.com" })).status).toBe(400)
  })
})

describe("funding", () => {
  it("refuses to confirm when the on-chain escrow does not match the agreed terms", async () => {
    const w = await world()
    const created = await w.client.post("/api/jobs", {
      title: "Mismatch job",
      deliverableDescription: "A job whose on-chain amount will not match the terms.",
      acceptanceCriteria: ["Something verifiable"],
      dueDate: futureDate(),
      amountUsdc: "100",
      freelancerEmail: w.freelancer.email,
    })
    const job = created.body.job
    await w.freelancer.post(`/api/jobs/${job.id}/respond`, { accept: true })
    const txHash = w.chain.fund(job.onchainJobId, w.client.account.address, w.freelancer.account.address, 1_000_000n)
    const r = await w.client.post(`/api/jobs/${job.id}/fund-confirm`, { txHash })
    expect(r.status).toBe(409)
    expect(r.body.error.details.problems.join()).toMatch(/amount/)
  })
})

describe("auto-release path", () => {
  it("submission → AI release (≥0.85, all criteria) → escrow.release → released", async () => {
    const w = await world()
    const job = await fundedJob(w)
    w.ai.queue.push(releaseVerdict)

    // Only the freelancer can submit.
    expect((await w.client.post(`/api/jobs/${job.id}/submissions`, submission)).status).toBe(403)

    const r = await w.freelancer.post(`/api/jobs/${job.id}/submissions`, submission)
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body.verification).toMatchObject({ ok: true, decision: "release" })
    expect(w.chain.jobs.get(job.onchainJobId)!.state).toBe("Released")

    const detail = (await w.client.get(`/api/jobs/${job.id}`)).body
    expect(detail.job.status).toBe("released")
    expect(detail.verifications[0].result.reasoning).toContain("Lighthouse")
    expect(detail.verifications[0].decision).toBe("release")
    expect(detail.events.map((e: any) => e.type)).toEqual(
      expect.arrayContaining(["job_created", "terms_accepted", "funded", "submission_received", "submitted_onchain", "ai_verdict", "released"]),
    )

    // The AI saw the agreed terms and the structured submission.
    const input = w.ai.calls[0] as any
    expect(input.job.acceptance_criteria).toEqual(criteria)
    expect(input.submission.deliverable_url).toBe(submission.deliverableUrl)
  })
})

describe("dispute path", () => {
  it("low confidence → escrow.dispute → admin resolves with refund", async () => {
    const w = await world()
    const job = await fundedJob(w)
    w.ai.queue.push(lowConfidence)
    const r = await w.freelancer.post(`/api/jobs/${job.id}/submissions`, submission)
    expect(r.body.verification).toMatchObject({ ok: true, decision: "dispute" })
    expect(w.chain.jobs.get(job.onchainJobId)!.state).toBe("Disputed")

    const detail = (await w.freelancer.get(`/api/jobs/${job.id}`)).body
    expect(detail.job.status).toBe("disputed")
    expect(detail.job.dispute.reason).toMatch(/below the 0.85/)
    expect(detail.verifications[0].result.reasoning).toBeTruthy()

    // Participants cannot resolve; admin can.
    expect((await w.client.post(`/api/admin/jobs/${job.id}/resolve`, { outcome: "refund", notes: "Client wins the dispute." })).status).toBe(403)
    const disputes = (await w.admin.get("/api/admin/jobs?status=disputed")).body.jobs
    expect(disputes.map((j: any) => j.id)).toContain(job.id)
    const res = await w.admin.post(`/api/admin/jobs/${job.id}/resolve`, { outcome: "refund", notes: "Performance criterion not evidenced." })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.job.status).toBe("resolved_refund")
    expect(res.body.job.resolution.adminEmail).toBe("admin@example.com")
    expect(w.chain.jobs.get(job.onchainJobId)!.state).toBe("ResolvedRefund")
  })

  it("model says release but omits a criterion → dispute (never trust a bare release)", async () => {
    const w = await world()
    const job = await fundedJob(w)
    w.ai.queue.push({ ...releaseVerdict, matched_criteria: criteria.slice(0, 2) })
    const r = await w.freelancer.post(`/api/jobs/${job.id}/submissions`, submission)
    expect(r.body.verification.decision).toBe("dispute")
  })

  it("client non-delivery dispute from Funded → admin resolves with release", async () => {
    const w = await world()
    const job = await fundedJob(w)
    expect((await w.freelancer.post(`/api/jobs/${job.id}/dispute`, { reason: "I want to dispute this" })).status).toBe(403)
    const d = await w.client.post(`/api/jobs/${job.id}/dispute`, { reason: "Freelancer has not delivered anything." })
    expect(d.status).toBe(200)
    expect(d.body.job.dispute.source).toBe("client")
    const res = await w.admin.post(`/api/admin/jobs/${job.id}/resolve`, { outcome: "release", notes: "Work was delivered off-platform." })
    expect(res.body.job.status).toBe("resolved_release")
    expect(w.chain.jobs.get(job.onchainJobId)!.state).toBe("ResolvedRelease")
  })
})

describe("failure surfacing", () => {
  it("AI outage: no verdict is fabricated, error is surfaced, retry works", async () => {
    const w = await world()
    const job = await fundedJob(w)
    w.ai.queue.push(new Error("groq 429 and gemini 503"))
    const r = await w.freelancer.post(`/api/jobs/${job.id}/submissions`, submission)
    expect(r.status).toBe(201)
    expect(r.body.verification).toMatchObject({ ok: false, stage: "ai" })
    expect(r.body.verification.error).toMatch(/429/)

    let detail = (await w.client.get(`/api/jobs/${job.id}`)).body
    expect(detail.job.status).toBe("submitted") // funds stay locked; nothing released or disputed
    expect(detail.job.verification.state).toBe("error")
    expect(detail.verifications[0]).toMatchObject({ status: "error", result: null, decision: null })
    expect(w.chain.jobs.get(job.onchainJobId)!.state).toBe("Submitted")

    w.ai.queue.push(releaseVerdict)
    const retry = await w.freelancer.post(`/api/jobs/${job.id}/verify`)
    expect(retry.status).toBe(200)
    detail = (await w.client.get(`/api/jobs/${job.id}`)).body
    expect(detail.job.status).toBe("released")
  })

  it("chain failure after a verdict: retry re-sends the tx without re-asking the AI", async () => {
    const w = await world()
    const job = await fundedJob(w)
    w.ai.queue.push(releaseVerdict)
    w.chain.failNext.action = "release"
    const r = await w.freelancer.post(`/api/jobs/${job.id}/submissions`, submission)
    expect(r.body.verification).toMatchObject({ ok: false, stage: "chain" })
    expect(r.body.verification.error).toMatch(/RPC timeout/)
    let detail = (await w.admin.get(`/api/admin/jobs/${job.id}`)).body
    expect(detail.job.pendingDecision).toBe("release")
    expect(detail.job.lastChainAction.state).toBe("failed")
    expect((await w.admin.get("/api/admin/overview")).body.attention).toContain(job.id)

    const callsBefore = w.ai.calls.length
    const retry = await w.admin.post(`/api/admin/jobs/${job.id}/verify`)
    expect(retry.status).toBe(200)
    expect(w.ai.calls.length).toBe(callsBefore)
    detail = (await w.admin.get(`/api/admin/jobs/${job.id}`)).body
    expect(detail.job.status).toBe("released")
  })

  it("markSubmitted failure keeps the job funded so the freelancer can resubmit", async () => {
    const w = await world()
    const job = await fundedJob(w)
    w.chain.failNext.action = "markSubmitted"
    const r = await w.freelancer.post(`/api/jobs/${job.id}/submissions`, submission)
    expect(r.status).toBe(502)
    expect(r.body.error.code).toBe("chain_error")
    expect((await w.client.get(`/api/jobs/${job.id}`)).body.job.status).toBe("funded")
    w.ai.queue.push(releaseVerdict)
    expect((await w.freelancer.post(`/api/jobs/${job.id}/submissions`, submission)).status).toBe(201)
  })
})

describe("complaints & reviews path", () => {
  it("gates by status, scopes visibility, and lets admins moderate", async () => {
    const w = await world()
    const job = await fundedJob(w)

    // Not allowed before completion.
    expect((await w.client.post(`/api/jobs/${job.id}/reviews`, { rating: 5, comment: "Great work overall!" })).status).toBe(409)
    expect((await w.client.post(`/api/jobs/${job.id}/complaints`, { category: "quality", description: "Too early to complain about this." })).status).toBe(409)

    w.ai.queue.push(releaseVerdict)
    await w.freelancer.post(`/api/jobs/${job.id}/submissions`, submission)

    const rv = await w.client.post(`/api/jobs/${job.id}/reviews`, { rating: 2, comment: "Delivered but communication was poor, contains rude words." })
    expect(rv.status).toBe(201)
    expect((await w.client.post(`/api/jobs/${job.id}/reviews`, { rating: 3, comment: "Second review attempt" })).status).toBe(409)
    expect((await w.freelancer.post(`/api/jobs/${job.id}/reviews`, { rating: 5, comment: "Clear requirements, paid on time." })).status).toBe(201)
    expect((await w.stranger.post(`/api/jobs/${job.id}/reviews`, { rating: 1, comment: "I was never involved here" })).status).toBe(404)

    const cp = await w.freelancer.post(`/api/jobs/${job.id}/complaints`, { category: "conduct", description: "Client review contains abusive language." })
    expect(cp.status).toBe(201)
    expect(cp.body.complaint.againstEmail).toBe(w.client.email)

    // Complaint visible to its filer and admins only.
    expect((await w.client.get(`/api/jobs/${job.id}`)).body.complaints).toHaveLength(0)
    expect((await w.freelancer.get(`/api/jobs/${job.id}`)).body.complaints).toHaveLength(1)

    // Admin moderation.
    const complaints = (await w.admin.get("/api/admin/complaints?status=open")).body.complaints
    expect(complaints).toHaveLength(1)
    const mod = await w.admin.patch(`/api/admin/complaints/${complaints[0].id}`, { status: "resolved", adminNotes: "Review hidden." })
    expect(mod.body.complaint).toMatchObject({ status: "resolved", handledByUid: "admin" })
    const hide = await w.admin.patch(`/api/admin/reviews/${rv.body.review.id}`, { status: "hidden", moderationNote: "Abusive language" })
    expect(hide.body.review.status).toBe("hidden")
    expect((await w.client.patch(`/api/admin/reviews/${rv.body.review.id}`, { status: "published" })).status).toBe(403)

    // Hidden review: gone for the counterpart, still visible to its author and admins.
    expect((await w.freelancer.get(`/api/jobs/${job.id}`)).body.reviews.map((r: any) => r.reviewerUid)).toEqual(["freelancer"])
    expect((await w.client.get(`/api/jobs/${job.id}`)).body.reviews).toHaveLength(2)
    expect((await w.admin.get(`/api/admin/jobs/${job.id}`)).body.reviews).toHaveLength(2)
    expect((await w.admin.get(`/api/admin/jobs/${job.id}`)).body.complaints).toHaveLength(1)
  })
})
