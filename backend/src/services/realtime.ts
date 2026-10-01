import { EventEmitter } from "node:events"
import type { Request, Response } from "express"
import type { AuthUser } from "../auth"
import type { Store } from "../store/types"
import type { Job } from "../types"

/**
 * Real-time job updates. Every write that touches a job (status, applications, submissions,
 * verdicts, rulings, arguments, reviews, complaints) emits a "job changed" signal, and each
 * signed-in browser holds one Server-Sent Events stream that forwards the signals it may see.
 *
 * Signals carry only the job id. The browser then refetches through the normal authenticated
 * API, so the stream never becomes a second, less-checked way to read data.
 *
 * In-process: run a single backend instance (or put a shared pub/sub behind `ChangeBus`).
 */

export interface ChangeBus {
  emit(jobId: string): void
  subscribe(fn: (jobId: string) => void): () => void
}

/** Coalesces bursts: a submission writes the job several times within milliseconds. */
export function createChangeBus(debounceMs = 300): ChangeBus {
  const ee = new EventEmitter()
  ee.setMaxListeners(0)
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  return {
    emit(jobId) {
      if (pending.has(jobId)) return
      pending.set(
        jobId,
        setTimeout(() => {
          pending.delete(jobId)
          ee.emit("change", jobId)
        }, debounceMs).unref(),
      )
    },
    subscribe(fn) {
      ee.on("change", fn)
      return () => ee.off("change", fn)
    },
  }
}

/** Wraps a Store so every job-related write emits a change signal after it succeeds. */
export function withChangeEvents(store: Store, bus: ChangeBus): Store {
  const after =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>, jobIdOf: (...a: A) => string | null | Promise<string | null>) =>
    async (...a: A) => {
      const r = await fn(...a)
      const id = await jobIdOf(...a)
      if (id) bus.emit(id)
      return r
    }
  return {
    ...store,
    jobs: {
      ...store.jobs,
      create: after(store.jobs.create, (j) => j.id),
      update: after(store.jobs.update, (id) => id),
      transition: after(store.jobs.transition, (id) => id),
    },
    applications: {
      ...store.applications,
      create: after(store.applications.create, (a) => a.jobId),
      update: after(store.applications.update, (jobId) => jobId),
    },
    submissions: {
      ...store.submissions,
      create: after(store.submissions.create, (s) => s.jobId),
      update: after(store.submissions.update, (jobId) => jobId),
    },
    verifications: { ...store.verifications, create: after(store.verifications.create, (v) => v.jobId) },
    rulings: { ...store.rulings, create: after(store.rulings.create, (r) => r.jobId) },
    events: { ...store.events, add: after(store.events.add, (e) => e.jobId) },
    complaints: {
      ...store.complaints,
      create: after(store.complaints.create, (c) => c.jobId),
      update: after(store.complaints.update, async (id) => (await store.complaints.get(id))?.jobId ?? null),
    },
    reviews: {
      ...store.reviews,
      create: after(store.reviews.create, (r) => r.jobId),
      update: after(store.reviews.update, async (id) => (await store.reviews.get(id))?.jobId ?? null),
    },
  }
}

/** Who may be told that a job changed: the same people who can read it. */
function canSee(user: AuthUser, job: Job) {
  return user.admin || job.participants.includes(user.uid) || job.visibility === "public"
}

const HEARTBEAT_MS = 25_000

/** GET /api/stream: one long-lived SSE response per signed-in tab. */
export function streamHandler(store: Store, bus: ChangeBus) {
  return (req: Request, res: Response) => {
    const user = req.user!
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Disable proxy buffering (nginx, Render) so events arrive immediately.
      "x-accel-buffering": "no",
    })
    res.write(`retry: 3000\n\n`)
    res.write(`event: ready\ndata: {}\n\n`)

    const unsubscribe = bus.subscribe(async (jobId) => {
      try {
        const job = await store.jobs.get(jobId)
        if (!job || !canSee(user, job)) return
        res.write(`event: job\ndata: ${JSON.stringify({ jobId, status: job.status })}\n\n`)
      } catch {
        // A failed lookup only skips one signal; the client also polls slowly as a fallback.
      }
    })
    const heartbeat = setInterval(() => res.write(`: ping\n\n`), HEARTBEAT_MS).unref()
    req.on("close", () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  }
}
