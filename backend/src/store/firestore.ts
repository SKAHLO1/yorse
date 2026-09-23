import type { Firestore } from "firebase-admin/firestore"
import { conflict, notFound } from "../lib/errors"
import type { Job } from "../types"
import { byAtAsc, byCreatedAsc, byCreatedDesc, type Store } from "./types"

/**
 * Firestore-backed Store (Admin SDK, server-side only).
 *
 * Layout:
 *   users/{uid}
 *   jobs/{jobId}
 *   jobs/{jobId}/submissions/{id}
 *   jobs/{jobId}/verifications/{id}
 *   jobs/{jobId}/events/{id}
 *   complaints/{id}
 *   reviews/{jobId}_{reviewerUid}
 *
 * Queries use a single equality filter and sort in memory, so no composite indexes are required.
 * Clients never touch Firestore directly (see firestore.rules: deny all).
 */
export function createFirestoreStore(db: Firestore): Store {
  const users = db.collection("users")
  const jobs = db.collection("jobs")
  const complaints = db.collection("complaints")
  const reviews = db.collection("reviews")
  const sub = (jobId: string, name: string) => jobs.doc(jobId).collection(name)
  const data = <T>(snap: FirebaseFirestore.DocumentSnapshot): T | null => (snap.exists ? (snap.data() as T) : null)
  const list = <T>(q: FirebaseFirestore.QuerySnapshot) => q.docs.map((d) => d.data() as T)
  const ensure = async (ref: FirebaseFirestore.DocumentReference, what: string) => {
    if (!(await ref.get()).exists) throw notFound(what)
  }

  return {
    newId: () => jobs.doc().id,

    users: {
      get: async (uid) => data(await users.doc(uid).get()),
      set: async (p) => void (await users.doc(p.uid).set(p)),
      update: async (uid, patch) => {
        await ensure(users.doc(uid), "User")
        await users.doc(uid).update(patch)
      },
      findByWallet: async (address) => {
        // Addresses are stored checksummed; compare case-insensitively via a lowercase mirror field.
        const q = await users.where("walletAddressLower", "==", address.toLowerCase()).limit(1).get()
        return q.empty ? null : (q.docs[0].data() as any)
      },
    },

    jobs: {
      get: async (id) => data<Job>(await jobs.doc(id).get()),
      create: async (job) => {
        try {
          await jobs.doc(job.id).create(job)
        } catch (e: any) {
          if (e?.code === 6) throw conflict("Job already exists")
          throw e
        }
      },
      update: async (id, patch) => {
        await ensure(jobs.doc(id), "Job")
        await jobs.doc(id).update(patch)
      },
      transition: (id, fn) =>
        db.runTransaction(async (tx) => {
          const ref = jobs.doc(id)
          const snap = await tx.get(ref)
          if (!snap.exists) throw notFound("Job")
          const cur = snap.data() as Job
          const patch = fn(cur)
          tx.update(ref, patch)
          return { ...cur, ...patch }
        }),
      listForUser: async (uid) =>
        list<Job>(await jobs.where("participants", "array-contains", uid).get()).sort(byCreatedDesc),
      list: async (f) =>
        list<Job>(await (f?.status ? jobs.where("status", "==", f.status) : jobs).limit(500).get()).sort(byCreatedDesc),
      // Equality on one field + orderBy on another needs no composite index in Firestore
      // only when the equality field is the same; we sort in memory instead to keep it index-free.
      listOpenPublic: async (limit) =>
        list<Job>(await jobs.where("status", "==", "open").limit(500).get())
          .filter((j) => j.visibility === "public")
          .sort(byCreatedDesc)
          .slice(0, limit),
    },

    applications: {
      create: async (a) => void (await sub(a.jobId, "applications").doc(a.id).set(a)),
      get: async (jobId, id) => data(await sub(jobId, "applications").doc(id).get()),
      update: async (jobId, id, patch) => void (await sub(jobId, "applications").doc(id).update(patch)),
      listForJob: async (jobId) => list<any>(await sub(jobId, "applications").get()).sort(byCreatedAsc),
      // Collection-group query: every application by this user across all jobs.
      listForApplicant: async (uid) =>
        list<any>(await db.collectionGroup("applications").where("applicantUid", "==", uid).limit(200).get()).sort(byCreatedDesc),
    },

    submissions: {
      create: async (s) => void (await sub(s.jobId, "submissions").doc(s.id).set(s)),
      get: async (jobId, id) => data(await sub(jobId, "submissions").doc(id).get()),
      update: async (jobId, id, patch) => void (await sub(jobId, "submissions").doc(id).update(patch)),
      listForJob: async (jobId) => list<any>(await sub(jobId, "submissions").get()).sort(byCreatedDesc),
    },

    verifications: {
      create: async (v) => void (await sub(v.jobId, "verifications").doc(v.id).set(v)),
      get: async (jobId, id) => data(await sub(jobId, "verifications").doc(id).get()),
      listForJob: async (jobId) => list<any>(await sub(jobId, "verifications").get()).sort(byCreatedDesc),
    },

    events: {
      add: async (e) => void (await sub(e.jobId, "events").doc(e.id).set(e)),
      listForJob: async (jobId) => list<any>(await sub(jobId, "events").get()).sort(byAtAsc),
    },

    complaints: {
      create: async (c) => void (await complaints.doc(c.id).set(c)),
      get: async (id) => data(await complaints.doc(id).get()),
      update: async (id, patch) => {
        await ensure(complaints.doc(id), "Complaint")
        await complaints.doc(id).update(patch)
      },
      listForJob: async (jobId) => list<any>(await complaints.where("jobId", "==", jobId).get()).sort(byCreatedAsc),
      list: async (f) =>
        list<any>(await (f?.status ? complaints.where("status", "==", f.status) : complaints).limit(500).get()).sort(
          byCreatedDesc,
        ),
    },

    reviews: {
      create: async (r) => {
        try {
          await reviews.doc(r.id).create(r)
        } catch (e: any) {
          if (e?.code === 6) throw conflict("You have already reviewed this job")
          throw e
        }
      },
      get: async (id) => data(await reviews.doc(id).get()),
      update: async (id, patch) => {
        await ensure(reviews.doc(id), "Review")
        await reviews.doc(id).update(patch)
      },
      listForJob: async (jobId) => list<any>(await reviews.where("jobId", "==", jobId).get()).sort(byCreatedAsc),
      listForReviewee: async (uid) => list<any>(await reviews.where("revieweeUid", "==", uid).limit(500).get()).sort(byCreatedDesc),
      list: async (f) =>
        list<any>(await (f?.status ? reviews.where("status", "==", f.status) : reviews).limit(500).get()).sort(
          byCreatedDesc,
        ),
    },
  }
}
