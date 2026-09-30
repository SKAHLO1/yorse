import type { Store } from "../store/types"
import type { JobService } from "./jobs"

/**
 * Background loop that moves time-based arbitration steps along so nobody has to click:
 *  - finalizes proposals whose challenge window has passed (finalize() is permissionless; the keeper
 *    just saves the parties the trouble),
 *  - convenes the AI jury once the argument window closes,
 *  - notices on-chain actions taken outside the app (direct challenge/finalize, escalateStale).
 * Every step is idempotent and goes through the same service code as the API, so a restart or a
 * second instance is harmless. Failures are logged and recorded on the job, never thrown.
 */
export function createKeeper(opts: { store: Store; jobs: JobService; intervalMs: number; now?: () => Date; log?: (msg: string) => void }) {
  const { store, jobs } = opts
  const log = opts.log ?? ((m: string) => console.log(`[keeper] ${m}`))
  const now = () => (opts.now?.() ?? new Date()).getTime()
  const system = { uid: null, role: "system" as const }
  let running = false
  let timer: ReturnType<typeof setInterval> | null = null

  const attempt = async (jobId: string, what: string, fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (err) {
      log(`${what} failed for job ${jobId}: ${(err as Error).message}`)
    }
  }

  async function tick() {
    if (running) return
    running = true
    try {
      for (const job of await store.jobs.list({ status: "proposed" })) {
        await attempt(job.id, "finalize", async () => {
          const synced = await jobs.syncFromChain(job)
          if (synced.status === "proposed" && synced.proposal && now() >= Date.parse(synced.proposal.deadline)) {
            await jobs.finalizeProposal(job.id, system)
            log(`finalized ${job.id} (${synced.proposal.outcome})`)
          }
        })
      }
      for (const job of await store.jobs.list({ status: "challenged" })) {
        await attempt(job.id, "jury", async () => {
          const synced = await jobs.syncFromChain(job)
          if (synced.status !== "challenged" || !synced.challenge) return
          const argued = synced.challenge.arguments.client && synced.challenge.arguments.freelancer
          const due = now() >= Date.parse(synced.challenge.argumentDeadline)
          if (synced.jury.state === "idle" && !synced.pendingRuling && (argued || due)) {
            const r = await jobs.runJury(job.id, system)
            log(`jury for ${job.id}: ${r.ok ? r.outcome : `${r.stage} error: ${r.error}`}`)
          }
        })
      }
      for (const job of await store.jobs.list({ status: "submitted" })) {
        await attempt(job.id, "sync", () => jobs.syncFromChain(job))
      }
    } finally {
      running = false
    }
  }

  return {
    tick,
    start() {
      if (!timer) timer = setInterval(() => void tick(), opts.intervalMs)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}
