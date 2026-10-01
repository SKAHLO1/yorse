import { describe, expect, it } from "vitest"
import { futureDate, setup } from "./helpers"

const criteria = ["Responsive landing page with hero section", "Contact form posts to /api/contact"]
const releaseVerdict = {
  verdict: "release" as const,
  confidence: 0.93,
  matched_criteria: [...criteria],
  unmatched_criteria: [],
  reasoning: "The fetched page shows a hero section and a contact form that posts to /api/contact.",
}

/** A job where the AI proposed release and the client has challenged it with a bond. */
async function appealed() {
  const s = setup({ criteria })
  const client = await s.user("client")
  const freelancer = await s.user("freelancer")
  const admin = await s.user("admin", { admin: true, wallet: false })
  const job = (
    await client.post("/api/jobs", {
      title: "Landing page",
      deliverableDescription: "A responsive landing page with a working contact form.",
      acceptanceCriteria: criteria,
      dueDate: futureDate(),
      amountUsdc: "100",
      freelancerEmail: freelancer.email,
    })
  ).body.job
  await freelancer.post(`/api/jobs/${job.id}/respond`, { accept: true })
  const tx = s.chain.fund(job.onchainJobId, client.account.address, freelancer.account.address, 100_000_000n)
  await client.post(`/api/jobs/${job.id}/fund-confirm`, { txHash: tx })
  s.ai.queue.push(releaseVerdict)
  await freelancer.post(`/api/jobs/${job.id}/submissions`, { deliverableUrl: "https://example.com", description: "Landing page deployed with hero and contact form." })
  s.chain.challenge(job.onchainJobId, client.account.address)
  const c = await client.post(`/api/jobs/${job.id}/challenge`, { argument: "The contact form does not actually submit anywhere." })
  expect(c.body.job.status).toBe("challenged")
  return { ...s, client, freelancer, admin, job }
}

describe("admin takeover of an appeal", () => {
  it("an admin can overrule before the jury convenes: the job becomes a dispute and the jury never rules", async () => {
    const w = await appealed()
    // Participants can't do this.
    expect((await w.client.post(`/api/admin/jobs/${w.job.id}/dispute`, { reason: "I want the admin to decide." })).status).toBe(403)

    const d = await w.admin.post(`/api/admin/jobs/${w.job.id}/dispute`, { reason: "Both sides dispute a technical detail; reviewing manually." })
    expect(d.status, JSON.stringify(d.body)).toBe(200)
    expect(d.body.job.status).toBe("disputed")
    expect(d.body.job.dispute).toMatchObject({ source: "admin" })
    expect(w.chain.jobs.get(w.job.onchainJobId)!.state).toBe("Disputed")

    // The argument round is over and the keeper never convenes the jury.
    expect((await w.freelancer.post(`/api/jobs/${w.job.id}/arguments`, { argument: "The form posts to /api/contact, see the network tab." })).status).toBe(409)
    w.clock.advance(86_400 * 2)
    await w.keeper.tick()
    expect(w.jury.calls).toHaveLength(0)

    const detail = (await w.client.get(`/api/jobs/${w.job.id}`)).body
    expect(detail.events.find((e: any) => e.type === "disputed").message).toMatch(/admin took over the appeal/)

    // The admin decides; the client's bond settles by the same rule (here: proposal overturned → returned).
    const r = await w.admin.post(`/api/admin/jobs/${w.job.id}/resolve`, { outcome: "refund", notes: "The contact form has no submit handler; refunding." })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.job.status).toBe("resolved_refund")
    expect(w.chain.jobs.get(w.job.onchainJobId)!.state).toBe("ResolvedRefund")
    const after = (await w.client.get(`/api/jobs/${w.job.id}`)).body
    expect(after.events.find((e: any) => e.type === "resolved").message).toMatch(/bond was returned/)
  })

  it("is refused while the jury is deliberating, so the jury and the admin never both settle", async () => {
    const w = await appealed()
    await w.store.jobs.update(w.job.id, { jury: { state: "running", error: null, startedAt: w.clock.now().toISOString(), rulingId: null } })
    const d = await w.admin.post(`/api/admin/jobs/${w.job.id}/dispute`, { reason: "Trying to take over mid-deliberation." })
    expect(d.status).toBe(409)
    expect(d.body.error.message).toMatch(/deliberating/)
    expect(w.chain.jobs.get(w.job.onchainJobId)!.state).toBe("Challenged")
  })

  it("if the last argument lands while an admin is taking over, the argument is kept and the jury stays out", async () => {
    const w = await appealed()
    // An admin takeover is in flight (claimed, dispute() not yet confirmed).
    await w.store.jobs.update(w.job.id, { lastChainAction: { type: "dispute", state: "pending", txHash: null, error: null, at: w.clock.now().toISOString() } })
    const a = await w.freelancer.post(`/api/jobs/${w.job.id}/arguments`, { argument: "The form posts to /api/contact, see the network tab." })
    expect(a.status, JSON.stringify(a.body)).toBe(200)
    expect(a.body.job.challenge.arguments.freelancer).toMatch(/network tab/)
    expect(w.jury.calls).toHaveLength(0)
  })
})
