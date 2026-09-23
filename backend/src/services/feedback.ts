import type { AuthUser } from "../auth"
import { badRequest, conflict, forbidden, notFound } from "../lib/errors"
import type { Store } from "../store/types"
import {
  COMPLAINABLE_STATUSES,
  TERMINAL_STATUSES,
  type Complaint,
  type ComplaintCategory,
  type ComplaintStatus,
  type Review,
  type ReviewStatus,
} from "../types"
import type { JobService } from "./jobs"

export function createFeedbackService(store: Store, jobs: JobService, now: () => Date = () => new Date()) {
  const iso = () => now().toISOString()

  async function fileComplaint(user: AuthUser, jobId: string, input: { category: ComplaintCategory; description: string }) {
    const { job, role } = await jobs.loadJobFor(user, jobId)
    if (!role) throw forbidden()
    if (!COMPLAINABLE_STATUSES.includes(job.status)) {
      throw conflict("Complaints can be filed once a job is completed or in dispute", { status: job.status })
    }
    const openByMe = (await store.complaints.listForJob(jobId)).filter(
      (c) => c.filedByUid === user.uid && (c.status === "open" || c.status === "under_review"),
    )
    if (openByMe.length >= 3) throw conflict("You already have 3 open complaints on this job")

    // Complainable statuses all imply a chosen developer, but narrow the types explicitly.
    if (!job.freelancerUid || !job.freelancerEmail) throw conflict("This job has no developer yet")
    const against =
      role === "client" ? { uid: job.freelancerUid, email: job.freelancerEmail } : { uid: job.clientUid, email: job.clientEmail }
    const c: Complaint = {
      id: store.newId(),
      jobId,
      jobTitle: job.title,
      filedByUid: user.uid,
      filedByEmail: user.email,
      filedByRole: role,
      againstUid: against.uid,
      againstEmail: against.email,
      category: input.category,
      description: input.description.trim(),
      status: "open",
      adminNotes: null,
      handledByUid: null,
      createdAt: iso(),
      updatedAt: iso(),
    }
    await store.complaints.create(c)
    await jobs.logEvent(jobId, "complaint_filed", `${role === "client" ? "Client" : "Freelancer"} filed a ${input.category} complaint`, { uid: user.uid, role }, { complaintId: c.id })
    return c
  }

  async function leaveReview(user: AuthUser, jobId: string, input: { rating: number; comment: string }) {
    const { job, role } = await jobs.loadJobFor(user, jobId)
    if (!role) throw forbidden()
    if (!TERMINAL_STATUSES.includes(job.status)) throw conflict("Reviews can only be left on completed jobs", { status: job.status })
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw badRequest("Rating must be 1–5")

    if (!job.freelancerUid || !job.freelancerEmail) throw conflict("This job has no developer yet")
    const reviewee =
      role === "client" ? { uid: job.freelancerUid, email: job.freelancerEmail } : { uid: job.clientUid, email: job.clientEmail }
    const r: Review = {
      id: `${jobId}_${user.uid}`, // one review per participant per job
      jobId,
      jobTitle: job.title,
      reviewerUid: user.uid,
      reviewerEmail: user.email,
      reviewerRole: role,
      revieweeUid: reviewee.uid,
      revieweeEmail: reviewee.email,
      rating: input.rating,
      comment: input.comment.trim(),
      status: "published",
      moderationNote: null,
      moderatedByUid: null,
      createdAt: iso(),
      updatedAt: iso(),
    }
    await store.reviews.create(r)
    await jobs.recomputeRating(r.revieweeUid) // refresh the public rating shown on profiles and feed cards
    await jobs.logEvent(jobId, "review_posted", `${role === "client" ? "Client" : "Freelancer"} left a ${input.rating}★ review`, { uid: user.uid, role }, { reviewId: r.id })
    return r
  }

  async function moderateComplaint(admin: AuthUser, id: string, patch: { status: ComplaintStatus; adminNotes: string | null }) {
    if (!admin.admin) throw forbidden()
    const c = await store.complaints.get(id)
    if (!c) throw notFound("Complaint")
    await store.complaints.update(id, { status: patch.status, adminNotes: patch.adminNotes, handledByUid: admin.uid, updatedAt: iso() })
    await jobs.logEvent(c.jobId, "complaint_moderated", `Admin marked complaint as ${patch.status}`, { uid: admin.uid, role: "admin" }, { complaintId: id })
    return (await store.complaints.get(id))!
  }

  async function moderateReview(admin: AuthUser, id: string, patch: { status: ReviewStatus; moderationNote: string | null }) {
    if (!admin.admin) throw forbidden()
    const r = await store.reviews.get(id)
    if (!r) throw notFound("Review")
    await store.reviews.update(id, { status: patch.status, moderationNote: patch.moderationNote, moderatedByUid: admin.uid, updatedAt: iso() })
    await jobs.recomputeRating(r.revieweeUid) // hiding or republishing changes the average
    await jobs.logEvent(r.jobId, "review_moderated", `Admin set review to ${patch.status}`, { uid: admin.uid, role: "admin" }, { reviewId: id })
    return (await store.reviews.get(id))!
  }

  return { fileComplaint, leaveReview, moderateComplaint, moderateReview }
}

export type FeedbackService = ReturnType<typeof createFeedbackService>
