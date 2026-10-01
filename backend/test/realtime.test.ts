import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { futureDate, setup } from "./helpers"

/** Opens the SSE stream like the browser does (fetch + Authorization header) and collects job events. */
async function openStream(base: string, uid: string) {
  const ctrl = new AbortController()
  const res = await fetch(`${base}/api/stream`, { headers: { authorization: `Bearer token-${uid}` }, signal: ctrl.signal })
  expect(res.status).toBe(200)
  expect(res.headers.get("content-type")).toMatch(/text\/event-stream/)
  const events: { jobId: string; status: string }[] = []
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        buf += decoder.decode(value, { stream: true })
        let i: number
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i)
          buf = buf.slice(i + 2)
          if (block.includes("event: job")) events.push(JSON.parse(block.split("data: ")[1]))
        }
      }
    } catch {
      // aborted
    }
  })()
  return { events, close: () => (ctrl.abort(), pump) }
}

const waitFor = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting for event")
    await new Promise((r) => setTimeout(r, 25))
  }
}

const closers: (() => unknown)[] = []
afterEach(async () => {
  // Streams first, then servers: server.close() waits for open connections.
  for (const c of closers.splice(0).reverse()) await c()
})

describe("real-time job updates (SSE)", () => {
  it("pushes a change to the other party, never to a stranger for a private job", async () => {
    const s = setup()
    const client = await s.user("client")
    const freelancer = await s.user("freelancer")
    const stranger = await s.user("stranger")
    const server = s.app.listen(0)
    closers.push(() => new Promise((r) => (server.closeAllConnections(), server.close(r))))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    const job = (
      await client.post("/api/jobs", {
        title: "Private job",
        deliverableDescription: "A private invite-only job for realtime testing.",
        acceptanceCriteria: ["Something checkable"],
        dueDate: futureDate(),
        amountUsdc: "10",
        freelancerEmail: freelancer.email,
      })
    ).body.job

    const clientStream = await openStream(base, "client")
    const strangerStream = await openStream(base, "stranger")
    closers.push(clientStream.close, strangerStream.close)

    // The freelancer accepts; the client's page should learn about it without refreshing.
    expect((await freelancer.post(`/api/jobs/${job.id}/respond`, { accept: true })).status).toBe(200)
    await waitFor(() => clientStream.events.some((e) => e.jobId === job.id))
    expect(clientStream.events.find((e) => e.jobId === job.id)!.status).toBe("awaiting_funding")
    // Several writes within a burst arrive as one signal.
    await new Promise((r) => setTimeout(r, 400))
    expect(clientStream.events.filter((e) => e.jobId === job.id)).toHaveLength(1)
    expect(strangerStream.events).toHaveLength(0)
    void stranger
  })

  it("public listings reach every signed-in user (the live feed updates itself)", async () => {
    const s = setup()
    const client = await s.user("client")
    await s.user("browser")
    const server = s.app.listen(0)
    closers.push(() => new Promise((r) => (server.closeAllConnections(), server.close(r))))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const browser = await openStream(base, "browser")
    closers.push(browser.close)

    const job = (
      await client.post("/api/jobs", {
        title: "Public job",
        deliverableDescription: "A public job everyone should see appear live.",
        acceptanceCriteria: ["Something checkable"],
        dueDate: futureDate(),
        amountUsdc: "10",
        visibility: "public",
      })
    ).body.job
    await waitFor(() => browser.events.some((e) => e.jobId === job.id))
  })

  it("rejects an unauthenticated stream", async () => {
    const s = setup()
    const server = s.app.listen(0)
    closers.push(() => new Promise((r) => (server.closeAllConnections(), server.close(r))))
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/stream`)
    expect(res.status).toBe(401)
  })
})
