import { randomUUID } from "node:crypto"
import { conflict, notFound } from "../lib/errors"
import type { Job } from "../types"
import { byAtAsc, byCreatedAsc, byCreatedDesc, type Store } from "./types"

/** In-memory Store for tests and the local e2e harness. Values are cloned to mimic a real database. */
export function createMemoryStore(): Store {
  const clone = <T>(v: T): T => structuredClone(v)
  const users = new Map<string, any>()
  const jobs = new Map<string, Job>()
  const subs = new Map<string, any>()
  const vers = new Map<string, any>()
  const events = new Map<string, any>()
  const applications = new Map<string, any>()
  const complaints = new Map<string, any>()
  const reviews = new Map<string, any>()
  const all = <T>(m: Map<string, T>) => [...m.values()].map(clone)

  return {
    newId: () => randomUUID().replace(/-/g, "").slice(0, 20),

    users: {
      get: async (uid) => (users.has(uid) ? clone(users.get(uid)) : null),
      set: async (p) => void users.set(p.uid, clone(p)),
      update: async (uid, patch) => {
        if (!users.has(uid)) throw notFound("User")
        users.set(uid, { ...users.get(uid), ...clone(patch) })
      },
      findByWallet: async (address) =>
        all(users).find((u) => u.walletAddress?.toLowerCase() === address.toLowerCase()) ?? null,
    },

    jobs: {
      get: async (id) => (jobs.has(id) ? clone(jobs.get(id)!) : null),
      create: async (job) => {
        if (jobs.has(job.id)) throw conflict("Job already exists")
        jobs.set(job.id, clone(job))
      },
      update: async (id, patch) => {
        if (!jobs.has(id)) throw notFound("Job")
        jobs.set(id, { ...jobs.get(id)!, ...clone(patch) })
      },
      transition: async (id, fn) => {
        const cur = jobs.get(id)
        if (!cur) throw notFound("Job")
        const next = { ...cur, ...clone(fn(clone(cur))) }
        jobs.set(id, next)
        return clone(next)
      },
      listForUser: async (uid) => all(jobs).filter((j) => j.participants.includes(uid)).sort(byCreatedDesc),
      list: async (f) => all(jobs).filter((j) => !f?.status || j.status === f.status).sort(byCreatedDesc),
      listOpenPublic: async (limit) =>
        all(jobs).filter((j) => j.visibility === "public" && j.status === "open").sort(byCreatedDesc).slice(0, limit),
    },

    applications: {
      create: async (a) => void applications.set(`${a.jobId}/${a.id}`, clone(a)),
      get: async (jobId, id) => clone(applications.get(`${jobId}/${id}`) ?? null),
      update: async (jobId, id, patch) => {
        const k = `${jobId}/${id}`
        if (!applications.has(k)) throw notFound("Application")
        applications.set(k, { ...applications.get(k), ...clone(patch) })
      },
      listForJob: async (jobId) => all(applications).filter((a) => a.jobId === jobId).sort(byCreatedAsc),
      listForApplicant: async (uid) => all(applications).filter((a) => a.applicantUid === uid).sort(byCreatedDesc),
    },

    submissions: {
      create: async (s) => void subs.set(`${s.jobId}/${s.id}`, clone(s)),
      get: async (jobId, id) => clone(subs.get(`${jobId}/${id}`) ?? null),
      update: async (jobId, id, patch) => {
        const k = `${jobId}/${id}`
        if (!subs.has(k)) throw notFound("Submission")
        subs.set(k, { ...subs.get(k), ...clone(patch) })
      },
      listForJob: async (jobId) => all(subs).filter((s) => s.jobId === jobId).sort(byCreatedDesc),
    },

    verifications: {
      create: async (v) => void vers.set(`${v.jobId}/${v.id}`, clone(v)),
      get: async (jobId, id) => clone(vers.get(`${jobId}/${id}`) ?? null),
      listForJob: async (jobId) => all(vers).filter((v) => v.jobId === jobId).sort(byCreatedDesc),
    },

    events: {
      add: async (e) => void events.set(`${e.jobId}/${e.id}`, clone(e)),
      listForJob: async (jobId) => all(events).filter((e) => e.jobId === jobId).sort(byAtAsc),
    },

    complaints: {
      create: async (c) => void complaints.set(c.id, clone(c)),
      get: async (id) => clone(complaints.get(id) ?? null),
      update: async (id, patch) => {
        if (!complaints.has(id)) throw notFound("Complaint")
        complaints.set(id, { ...complaints.get(id), ...clone(patch) })
      },
      listForJob: async (jobId) => all(complaints).filter((c) => c.jobId === jobId).sort(byCreatedAsc),
      list: async (f) => all(complaints).filter((c) => !f?.status || c.status === f.status).sort(byCreatedDesc),
    },

    reviews: {
      create: async (r) => {
        if (reviews.has(r.id)) throw conflict("You have already reviewed this job")
        reviews.set(r.id, clone(r))
      },
      get: async (id) => clone(reviews.get(id) ?? null),
      update: async (id, patch) => {
        if (!reviews.has(id)) throw notFound("Review")
        reviews.set(id, { ...reviews.get(id), ...clone(patch) })
      },
      listForJob: async (jobId) => all(reviews).filter((r) => r.jobId === jobId).sort(byCreatedAsc),
      listForReviewee: async (uid) => all(reviews).filter((r) => r.revieweeUid === uid).sort(byCreatedDesc),
      list: async (f) => all(reviews).filter((r) => !f?.status || r.status === f.status).sort(byCreatedDesc),
    },
  }
}
