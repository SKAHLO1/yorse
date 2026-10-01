import { describe, expect, it } from "vitest"
import { futureDate, setup } from "./helpers"

const OLD_ESCROW = "0x00000000000000000000000000000000000e5c19"

describe("jobs stay on the escrow that funded them", () => {
  it("records the escrow at funding, reads proof from it after a redeploy, and refuses to sign for it", async () => {
    const s = setup({ criteria: ["Something checkable"] })
    const client = await s.user("client")
    const freelancer = await s.user("freelancer")
    const reads: (string | undefined)[] = []
    const getJob = s.chain.getJob
    s.chain.getJob = async (id, escrow) => (reads.push(escrow), getJob(id, escrow))

    const job = (
      await client.post("/api/jobs", {
        title: "Redeploy-safe job",
        deliverableDescription: "A job that must stay verifiable after the escrow is redeployed.",
        acceptanceCriteria: ["Something checkable"],
        dueDate: futureDate(),
        amountUsdc: "10",
        freelancerEmail: freelancer.email,
      })
    ).body.job
    expect(job.escrowAddress).toBeNull()
    await freelancer.post(`/api/jobs/${job.id}/respond`, { accept: true })
    const tx = s.chain.fund(job.onchainJobId, client.account.address, freelancer.account.address, 10_000_000n)
    const funded = (await client.post(`/api/jobs/${job.id}/fund-confirm`, { txHash: tx })).body.job
    expect(funded.escrowAddress).toBe(s.chain.escrowAddress)

    // Simulate a redeploy: this job's funds now live on an earlier deployment.
    await s.store.jobs.update(job.id, { escrowAddress: OLD_ESCROW })
    reads.length = 0
    const detail = (await client.get(`/api/jobs/${job.id}`)).body
    expect(detail.escrowAddress).toBe(OLD_ESCROW) // the UI links to and verifies against the right contract
    expect(reads).toContain(OLD_ESCROW)

    // The relayer only signs for the current deployment, with a clear message instead of a revert.
    const sub = await freelancer.post(`/api/jobs/${job.id}/submissions`, { deliverableUrl: "https://example.com", description: "Delivered the agreed work in full." })
    expect(sub.status).toBe(409)
    expect(sub.body.error.message).toMatch(/earlier escrow deployment/)
    // Refused before anything was recorded, so nothing is left half-done.
    const after = (await client.get(`/api/jobs/${job.id}`)).body
    expect(after.job.lastChainAction).toBeNull()
    expect(after.submissions).toHaveLength(0)
  })
})
