import type {
  Application,
  Complaint,
  ComplaintStatus,
  Job,
  JobEvent,
  JobStatus,
  Review,
  ReviewStatus,
  Submission,
  UserProfile,
  Verification,
} from "../types"

/**
 * Persistence boundary. Production uses Firestore (./firestore.ts); tests and the local
 * e2e harness use the in-memory implementation (./memory.ts) with identical semantics.
 */
export interface Store {
  newId(): string

  users: {
    get(uid: string): Promise<UserProfile | null>
    set(profile: UserProfile): Promise<void>
    update(uid: string, patch: Partial<UserProfile>): Promise<void>
    findByWallet(address: string): Promise<UserProfile | null>
  }

  jobs: {
    get(id: string): Promise<Job | null>
    create(job: Job): Promise<void>
    update(id: string, patch: Partial<Job>): Promise<void>
    /**
     * Atomic read-modify-write. `fn` returns the patch to apply, or throws to abort.
     * Returns the updated job.
     */
    transition(id: string, fn: (job: Job) => Partial<Job>): Promise<Job>
    listForUser(uid: string): Promise<Job[]>
    list(filter?: { status?: JobStatus }): Promise<Job[]>
    /** Public jobs still accepting applications, newest first (the homepage feed). */
    listOpenPublic(limit: number): Promise<Job[]>
  }

  applications: {
    create(a: Application): Promise<void>
    get(jobId: string, id: string): Promise<Application | null>
    update(jobId: string, id: string, patch: Partial<Application>): Promise<void>
    listForJob(jobId: string): Promise<Application[]>
    listForApplicant(uid: string): Promise<Application[]>
  }

  submissions: {
    create(s: Submission): Promise<void>
    get(jobId: string, id: string): Promise<Submission | null>
    update(jobId: string, id: string, patch: Partial<Submission>): Promise<void>
    listForJob(jobId: string): Promise<Submission[]>
  }

  verifications: {
    create(v: Verification): Promise<void>
    get(jobId: string, id: string): Promise<Verification | null>
    listForJob(jobId: string): Promise<Verification[]>
  }

  events: {
    add(e: JobEvent): Promise<void>
    listForJob(jobId: string): Promise<JobEvent[]>
  }

  complaints: {
    create(c: Complaint): Promise<void>
    get(id: string): Promise<Complaint | null>
    update(id: string, patch: Partial<Complaint>): Promise<void>
    listForJob(jobId: string): Promise<Complaint[]>
    list(filter?: { status?: ComplaintStatus }): Promise<Complaint[]>
  }

  reviews: {
    /** Fails with a conflict if a review with this id already exists. */
    create(r: Review): Promise<void>
    get(id: string): Promise<Review | null>
    update(id: string, patch: Partial<Review>): Promise<void>
    listForJob(jobId: string): Promise<Review[]>
    /** Every review written about this user, used to recompute their public rating. */
    listForReviewee(uid: string): Promise<Review[]>
    list(filter?: { status?: ReviewStatus }): Promise<Review[]>
  }
}

export const byCreatedDesc = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt)
export const byAtAsc = <T extends { at: string }>(a: T, b: T) => a.at.localeCompare(b.at)
export const byCreatedAsc = <T extends { createdAt: string }>(a: T, b: T) => a.createdAt.localeCompare(b.createdAt)
