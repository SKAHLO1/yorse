import request from "supertest"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { describe, expect, it } from "vitest"
import { futureDate, setup } from "./helpers"

const criteria = ["Homepage copy mentions sourdough in the headline", "Lists opening hours for every day"]

async function registerAgent(app: ReturnType<typeof setup>["app"], name = "CopyBot 3000") {
  const account = privateKeyToAccount(generatePrivateKey())
  const ch = await request(app).post("/api/agents/challenge").send({ address: account.address })
  expect(ch.status, JSON.stringify(ch.body)).toBe(200)
  const signature = await account.signMessage({ message: ch.body.message })
  const r = await request(app)
    .post("/api/agents/register")
    .send({ address: account.address, signature, name, description: "Writes website copy with an LLM and publishes it as a public page." })
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  const key: string = r.body.apiKey
  const h = { authorization: `Bearer ${key}` }
  return {
    account,
    key,
    uid: r.body.uid as string,
    get: (p: string) => request(app).get(p).set(h),
    post: (p: string, b: object = {}) => request(app).post(p).set(h).send(b),
  }
}

describe("AI agents as freelancers", () => {
  it("an agent registers by signature, applies, is hired, delivers, and is paid to its own wallet", async () => {
    const s = setup({ criteria })
    const client = await s.user("client")
    const agent = await registerAgent(s.app)
    expect(agent.key).toMatch(/^yk_/)

    // The key works on the ordinary API; the agent's wallet is the one it signed with.
    const me = (await agent.get("/api/me")).body.user
    expect(me).toMatchObject({ agent: true, kind: "agent", displayName: "CopyBot 3000", walletAddress: agent.account.address })

    const job = (
      await client.post("/api/jobs", {
        title: "Bakery homepage copy",
        deliverableDescription: "Homepage copy for a neighbourhood sourdough bakery.",
        acceptanceCriteria: criteria,
        dueDate: futureDate(),
        amountUsdc: "40",
        visibility: "public",
      })
    ).body.job
    expect((await agent.get("/api/feed")).body.feed.map((f: any) => f.id)).toContain(job.id)
    const app = await agent.post(`/api/jobs/${job.id}/applications`, { message: "I am an AI agent; I will deliver the copy within the hour." })
    expect(app.status, JSON.stringify(app.body)).toBe(201)

    // The client sees an agent, clearly labelled, with no email or wallet exposed.
    const apps = (await client.get(`/api/jobs/${job.id}/applications`)).body.applications
    expect(apps[0].applicant).toMatchObject({ isAgent: true, displayName: "CopyBot 3000" })
    expect(apps[0].applicant.agent.description).toMatch(/LLM/)
    expect(JSON.stringify(apps[0].applicant)).not.toMatch(/0x|@/)

    await client.post(`/api/jobs/${job.id}/applications/${app.body.application.id}/select`)
    expect((await agent.post(`/api/jobs/${job.id}/respond`, { accept: true })).body.job.status).toBe("awaiting_funding")
    const hired = (await client.get(`/api/jobs/${job.id}`)).body.job
    expect(hired.freelancerWallet).toBe(agent.account.address)

    const tx = s.chain.fund(job.onchainJobId, client.account.address, agent.account.address, BigInt(job.amountUnits))
    expect((await client.post(`/api/jobs/${job.id}/fund-confirm`, { txHash: tx })).status).toBe(200)

    s.ai.queue.push({
      verdict: "release",
      confidence: 0.94,
      matched_criteria: criteria,
      unmatched_criteria: [],
      reasoning: "The page headline reads 'Real sourdough, baked at dawn' and the footer lists hours for all seven days.",
    })
    const sub = await agent.post(`/api/jobs/${job.id}/submissions`, { deliverableUrl: "https://example.com/copy", description: "Published the homepage copy; headline and full weekly hours included." })
    expect(sub.status, JSON.stringify(sub.body)).toBe(201)
    expect(sub.body.verification.decision).toBe("release")
    s.clock.advance(180)
    await s.keeper.tick()
    expect(s.chain.jobs.get(job.onchainJobId)!.state).toBe("Released")
    expect(s.chain.jobs.get(job.onchainJobId)!.freelancer).toBe(agent.account.address)
  })

  it("rejects forged signatures, unknown keys, revoked keys, and human-only actions", async () => {
    const s = setup()
    const human = await s.user("human")
    const account = privateKeyToAccount(generatePrivateKey())
    const other = privateKeyToAccount(generatePrivateKey())
    const ch = await request(s.app).post("/api/agents/challenge").send({ address: account.address })
    const forged = await other.signMessage({ message: ch.body.message })
    const bad = await request(s.app).post("/api/agents/register").send({ address: account.address, signature: forged, name: "Forger", description: "Tries to claim a wallet it does not own." })
    expect(bad.status).toBe(400)

    // A wallet linked to a human cannot become an agent.
    expect((await request(s.app).post("/api/agents/challenge").send({ address: human.account.address })).status).toBe(409)

    expect((await request(s.app).get("/api/me").set("authorization", "Bearer yk_not-a-real-key")).status).toBe(401)

    const agent = await registerAgent(s.app)
    const jobBody = { title: "Agent job", deliverableDescription: "An agent trying to post a job of its own.", acceptanceCriteria: ["Something checkable"], dueDate: futureDate(), amountUsdc: "5", visibility: "public" }
    expect((await agent.post("/api/jobs", jobBody)).status).toBe(403) // agents can't post jobs yet
    expect((await agent.post("/api/me/wallet/challenge")).status).toBe(200) // harmless
    expect((await agent.post("/api/me/wallet", { address: agent.account.address, signature: "0x00" })).status).toBe(403)
    expect((await agent.get("/api/admin/overview")).status).toBe(403)

    const keys = (await agent.get("/api/agents/keys")).body.keys
    expect(keys).toHaveLength(1)
    expect(JSON.stringify(keys)).not.toContain(agent.key) // only a prefix is ever returned
    expect((await agent.post(`/api/agents/keys/${keys[0].prefix}/revoke`)).status).toBe(200)
    expect((await agent.get("/api/me")).status).toBe(401)
  })
})
