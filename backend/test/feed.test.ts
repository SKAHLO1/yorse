import { describe, expect, it } from "vitest"
import { futureDate, setup } from "./helpers"

const criteria = ["Ships a working REST endpoint", "Includes integration tests"]

async function world() {
  const s = setup()
  const client = await s.user("client")
  const dev = await s.user("dev")
  const dev2 = await s.user("dev2")
  const admin = await s.user("admin", { admin: true, wallet: false })
  return { ...s, client, dev, dev2, admin }
}

const publicJob = (extra: object = {}) => ({
  title: "Build a booking API",
  deliverableDescription: "A REST API for bookings with tests and deployment instructions.",
  acceptanceCriteria: criteria,
  dueDate: futureDate(),
  amountUsdc: "500",
  visibility: "public",
  ...extra,
})

const applyBody = { message: "I have built three booking APIs and can start on Monday.", portfolioUrl: "https://github.com/dev" }

describe("public listings & live feed", () => {
  it("public jobs appear in everyone's feed with the poster's public profile", async () => {
    const w = await world()
    const created = await w.client.post("/api/jobs", publicJob())
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    expect(created.body.job).toMatchObject({ status: "open", visibility: "public", freelancerUid: null, applicationCount: 0 })

    const feed = (await w.dev.get("/api/feed")).body.feed
    expect(feed).toHaveLength(1)
    expect(feed[0]).toMatchObject({ title: "Build a booking API", amountUsdc: "500.00", acceptanceCriteriaCount: 2, isMine: false, myApplicationStatus: null })
    expect(feed[0].client).toMatchObject({ uid: "client", displayName: "client" })
    // Public cards never leak contact or wallet details.
    expect(JSON.stringify(feed[0].client)).not.toMatch(/@example.com|0x/)
    expect((await w.client.get("/api/feed")).body.feed[0].isMine).toBe(true)
  })

  it("invite jobs never appear in the feed", async () => {
    const w = await world()
    const r = await w.client.post("/api/jobs", { ...publicJob(), visibility: "invite", freelancerEmail: w.dev.email })
    expect(r.body.job.status).toBe("pending_acceptance")
    expect((await w.dev2.get("/api/feed")).body.feed).toHaveLength(0)
  })

  it("a non-participant can read an open listing but not a private job", async () => {
    const w = await world()
    const open = (await w.client.post("/api/jobs", publicJob())).body.job
    const view = await w.dev2.get(`/api/jobs/${open.id}`)
    expect(view.status).toBe(200)
    expect(view.body.job.acceptanceCriteria).toEqual(criteria)
    expect(view.body.viewerRole).toBeNull()
    expect(view.body.events).toHaveLength(0) // history stays private

    const invite = (await w.client.post("/api/jobs", { ...publicJob(), visibility: "invite", freelancerEmail: w.dev.email })).body.job
    expect((await w.dev2.get(`/api/jobs/${invite.id}`)).status).toBe(404)
  })
})

describe("applications", () => {
  it("developer applies, client selects, job continues into the normal flow", async () => {
    const w = await world()
    const job = (await w.client.post("/api/jobs", publicJob())).body.job

    const a1 = await w.dev.post(`/api/jobs/${job.id}/applications`, applyBody)
    expect(a1.status, JSON.stringify(a1.body)).toBe(201)
    const a2 = await w.dev2.post(`/api/jobs/${job.id}/applications`, { message: "I can deliver this within the week, references available." })
    expect(a2.status).toBe(201)

    // Duplicate application, and applying to your own job, are both refused.
    expect((await w.dev.post(`/api/jobs/${job.id}/applications`, applyBody)).status).toBe(409)
    expect((await w.client.post(`/api/jobs/${job.id}/applications`, applyBody)).status).toBe(400)

    // Applicants are private to the client; a rival developer cannot enumerate them.
    expect((await w.dev2.get(`/api/jobs/${job.id}/applications`)).status).toBe(403)
    const apps = (await w.client.get(`/api/jobs/${job.id}/applications`)).body.applications
    expect(apps).toHaveLength(2)
    expect(apps[0].applicant).toMatchObject({ uid: "dev" })
    expect((await w.dev.get("/api/feed")).body.feed[0]).toMatchObject({ myApplicationStatus: "pending", applicationCount: 2 })

    // Only the client selects.
    expect((await w.dev2.post(`/api/jobs/${job.id}/applications/${a1.body.application.id}/select`)).status).toBe(403)
    const sel = await w.client.post(`/api/jobs/${job.id}/applications/${a1.body.application.id}/select`)
    expect(sel.status, JSON.stringify(sel.body)).toBe(200)
    expect(sel.body.job).toMatchObject({ status: "pending_acceptance", freelancerUid: "dev", freelancerEmail: w.dev.email })

    // Losing applications are closed, and the job leaves the feed.
    const after = (await w.client.get(`/api/jobs/${job.id}/applications`)).body.applications
    expect(after.map((a: any) => a.status).sort()).toEqual(["rejected", "selected"])
    expect((await w.dev2.get("/api/feed")).body.feed).toHaveLength(0)
    expect((await w.dev2.post(`/api/jobs/${job.id}/applications`, applyBody)).status).toBe(409)

    // The selected developer now has the normal freelancer powers.
    expect((await w.dev.post(`/api/jobs/${job.id}/respond`, { accept: true })).body.job.status).toBe("awaiting_funding")
  })

  it("requires a linked wallet to apply", async () => {
    const s = setup()
    const client = await s.user("client")
    const noWallet = await s.user("nw", { wallet: false })
    const job = (await client.post("/api/jobs", publicJob())).body.job
    const r = await noWallet.post(`/api/jobs/${job.id}/applications`, applyBody)
    expect(r.status).toBe(400)
    expect(r.body.error.message).toMatch(/Link your wallet/)
  })

  it("withdrawing frees the developer to re-apply", async () => {
    const w = await world()
    const job = (await w.client.post("/api/jobs", publicJob())).body.job
    const a = await w.dev.post(`/api/jobs/${job.id}/applications`, applyBody)
    expect((await w.dev2.post(`/api/jobs/${job.id}/applications/${a.body.application.id}/withdraw`)).status).toBe(403)
    expect((await w.dev.post(`/api/jobs/${job.id}/applications/${a.body.application.id}/withdraw`)).body.application.status).toBe("withdrawn")
    expect((await w.dev.post(`/api/jobs/${job.id}/applications`, applyBody)).status).toBe(201)
  })

  it("cannot apply once a job is no longer open", async () => {
    const w = await world()
    const job = (await w.client.post("/api/jobs", { ...publicJob(), visibility: "invite", freelancerEmail: w.dev.email })).body.job
    expect((await w.dev2.post(`/api/jobs/${job.id}/applications`, applyBody)).status).toBe(409)
  })
})

describe("ratings & public profiles", () => {
  /** Runs a public job end to end so both sides can review each other. */
  async function completedJob(w: Awaited<ReturnType<typeof world>>, amount = "100") {
    const job = (await w.client.post("/api/jobs", publicJob({ amountUsdc: amount }))).body.job
    const a = await w.dev.post(`/api/jobs/${job.id}/applications`, applyBody)
    await w.client.post(`/api/jobs/${job.id}/applications/${a.body.application.id}/select`)
    await w.dev.post(`/api/jobs/${job.id}/respond`, { accept: true })
    const txHash = w.chain.fund(job.onchainJobId, w.client.account.address, w.dev.account.address, BigInt(job.amountUnits))
    await w.client.post(`/api/jobs/${job.id}/fund-confirm`, { txHash })
    w.ai.queue.push({
      verdict: "release",
      confidence: 0.95,
      matched_criteria: criteria,
      unmatched_criteria: [],
      reasoning: "The repository exposes the documented endpoint and the test suite covers the booking flow.",
    })
    const s = await w.dev.post(`/api/jobs/${job.id}/submissions`, { deliverableUrl: "https://example.com/api", description: "Booking API deployed with integration tests." })
    expect(s.body.verification.decision).toBe("release")
    return job
  }

  it("published reviews build a public rating for each side", async () => {
    const w = await world()
    const job = await completedJob(w)
    await w.client.post(`/api/jobs/${job.id}/reviews`, { rating: 5, comment: "Excellent work, delivered ahead of schedule." })
    await w.dev.post(`/api/jobs/${job.id}/reviews`, { rating: 4, comment: "Clear requirements and prompt funding." })

    const devProfile = (await w.dev2.get(`/api/users/${w.dev.uid}`)).body
    expect(devProfile.user.ratingAsFreelancer).toEqual({ average: 5, count: 1 })
    expect(devProfile.user.ratingAsClient).toEqual({ average: null, count: 0 })
    expect(devProfile.stats.completedAsFreelancer).toBe(1)
    expect(devProfile.reviews[0]).toMatchObject({ rating: 5, jobTitle: "Build a booking API", reviewerRole: "client" })
    expect(devProfile.reviews[0].reviewer.uid).toBe("client")

    const clientProfile = (await w.dev.get(`/api/users/${w.client.uid}`)).body
    expect(clientProfile.user.ratingAsClient).toEqual({ average: 4, count: 1 })

    // The rating rides along on feed cards.
    const feedClient = (await w.dev2.get("/api/feed")).body.feed
    const fresh = (await w.client.post("/api/jobs", publicJob())).body.job
    expect(fresh.id).toBeTruthy()
    expect((await w.dev2.get("/api/feed")).body.feed[0].client.ratingAsClient).toEqual({ average: 4, count: 1 })
    expect(feedClient).toBeDefined()
  })

  it("averages several reviews and excludes hidden ones", async () => {
    const w = await world()
    const j1 = await completedJob(w, "100")
    const j2 = await completedJob(w, "200")
    await w.client.post(`/api/jobs/${j1.id}/reviews`, { rating: 5, comment: "Great job on the first project." })
    await w.client.post(`/api/jobs/${j2.id}/reviews`, { rating: 2, comment: "Second one was late and needed rework." })
    expect((await w.dev2.get(`/api/users/${w.dev.uid}`)).body.user.ratingAsFreelancer).toEqual({ average: 3.5, count: 2 })

    // Hiding a review removes it from the average and the profile.
    await w.admin.patch(`/api/admin/reviews/${j2.id}_client`, { status: "hidden", moderationNote: "Unfair" })
    let profile = (await w.dev2.get(`/api/users/${w.dev.uid}`)).body
    expect(profile.user.ratingAsFreelancer).toEqual({ average: 5, count: 1 })
    expect(profile.reviews).toHaveLength(1)

    // Republishing restores it.
    await w.admin.patch(`/api/admin/reviews/${j2.id}_client`, { status: "published", moderationNote: null })
    profile = (await w.dev2.get(`/api/users/${w.dev.uid}`)).body
    expect(profile.user.ratingAsFreelancer).toEqual({ average: 3.5, count: 2 })
  })

  it("a profile exposes no email, wallet or private data", async () => {
    const w = await world()
    const job = await completedJob(w)
    await w.client.post(`/api/jobs/${job.id}/reviews`, { rating: 5, comment: "Excellent work, would hire again." })
    const body = JSON.stringify((await w.dev2.get(`/api/users/${w.dev.uid}`)).body)
    expect(body).not.toMatch(/@example\.com/)
    expect(body).not.toMatch(/0x[0-9a-fA-F]{40}/)
    expect(body).not.toMatch(/walletChallenge|nonce/)
  })

  it("unrated users report no average rather than zero", async () => {
    const w = await world()
    const p = (await w.dev.get(`/api/users/${w.dev2.uid}`)).body
    expect(p.user.ratingAsFreelancer).toEqual({ average: null, count: 0 })
    expect(p.reviews).toEqual([])
  })
})
