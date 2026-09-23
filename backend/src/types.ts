/** Off-chain domain model. Firestore holds all of this; the chain only holds funds + job state. */

export type JobStatus =
  | "open" // public listing, accepting applications, no freelancer chosen yet
  | "pending_acceptance" // client created terms, freelancer has not agreed yet
  | "declined"
  | "cancelled"
  | "awaiting_funding" // terms agreed, client must fund on-chain
  | "funded"
  | "submitted" // on-chain Submitted; AI verification pending, running, errored, or its chain action failed
  | "released"
  | "disputed"
  | "resolved_release"
  | "resolved_refund"

export const TERMINAL_STATUSES: JobStatus[] = ["released", "resolved_release", "resolved_refund"]
export const COMPLAINABLE_STATUSES: JobStatus[] = ["released", "disputed", "resolved_release", "resolved_refund"]
export const ACTIVE_STATUSES: JobStatus[] = ["open", "pending_acceptance", "awaiting_funding", "funded", "submitted", "disputed"]

export type Role = "client" | "freelancer"

/** Public listings accept applications; invite jobs name the freelancer up front and never appear in the feed. */
export type JobVisibility = "public" | "invite"

/** Aggregate of published reviews for one side of the marketplace. Only completed jobs produce reviews. */
export interface RatingSummary {
  average: number | null
  count: number
}

export interface UserProfile {
  uid: string
  email: string
  displayName: string | null
  /** From the Firebase token's picture claim (Google sign-in). Null means the UI shows an initials avatar. */
  photoUrl: string | null
  /** Public reputation, recomputed whenever a review is posted or moderated. */
  ratingAsFreelancer: RatingSummary
  ratingAsClient: RatingSummary
  walletAddress: `0x${string}` | null
  /** Lowercase mirror of walletAddress for exact-match lookups. */
  walletAddressLower: string | null
  walletLinkedAt: string | null
  walletChallenge: { nonce: string; message: string; expiresAt: string } | null
  createdAt: string
  updatedAt: string
}

export type ChainActionType = "markSubmitted" | "release" | "dispute" | "refund"

export interface ChainAction {
  type: ChainActionType
  state: "pending" | "confirmed" | "failed"
  txHash: string | null
  error: string | null
  at: string
}

export interface Job {
  id: string
  onchainJobId: `0x${string}`
  title: string
  deliverableDescription: string
  acceptanceCriteria: string[]
  dueDate: string
  amountUsdc: string // human readable, e.g. "250.00"
  amountUnits: string // 6-decimal integer as string
  visibility: JobVisibility
  clientUid: string
  clientEmail: string
  clientWallet: `0x${string}`
  /** Null while a public job is still open; set when the client picks an applicant. */
  freelancerUid: string | null
  freelancerEmail: string | null
  freelancerWallet: `0x${string}` | null
  participants: string[]
  /** Denormalised for the feed so listing jobs doesn't need a second read per card. */
  applicationCount: number
  status: JobStatus
  fundTxHash: string | null
  currentSubmissionId: string | null
  verification: {
    state: "idle" | "running" | "error" | "done"
    error: string | null
    startedAt: string | null
    verificationId: string | null
  }
  /** Set when a verdict exists but its on-chain action has not been confirmed yet. Never re-run AI in this case. */
  pendingDecision: "release" | "dispute" | null
  lastChainAction: ChainAction | null
  dispute: { reason: string; source: "ai" | "client" | "admin"; byUid: string | null; at: string } | null
  resolution: { outcome: "release" | "refund"; notes: string; adminUid: string; adminEmail: string; txHash: string; at: string } | null
  createdAt: string
  updatedAt: string
}

export interface Submission {
  id: string
  jobId: string
  freelancerUid: string
  deliverableUrl: string | null
  fileReference: string | null
  description: string
  notes: string | null
  /** markSubmitted tx. Null means the on-chain step failed and this submission was not accepted. */
  onchainTxHash: string | null
  createdAt: string
}

export interface AiVerdict {
  verdict: "release" | "dispute"
  confidence: number
  matched_criteria: string[]
  unmatched_criteria: string[]
  reasoning: string
}

export interface Verification {
  id: string
  jobId: string
  submissionId: string
  status: "completed" | "error"
  provider: "groq" | "gemini" | null
  model: string | null
  result: AiVerdict | null
  /** Outcome of the backend decision rule, not the model's raw word. */
  decision: "release" | "dispute" | null
  decisionReason: string | null
  threshold: number
  attempts: { provider: string; model: string; ok: boolean; error: string | null; ms: number }[]
  evidence: { url: string | null; fetched: boolean; note: string | null }
  error: string | null
  createdAt: string
}

export interface JobEvent {
  id: string
  jobId: string
  type: string
  actorUid: string | null
  actorRole: Role | "admin" | "system"
  message: string
  data: Record<string, unknown> | null
  at: string
}

export type ComplaintStatus = "open" | "under_review" | "resolved" | "dismissed"
export type ComplaintCategory = "quality" | "communication" | "payment" | "ai_verdict" | "conduct" | "other"

export interface Complaint {
  id: string
  jobId: string
  jobTitle: string
  filedByUid: string
  filedByEmail: string
  filedByRole: Role
  againstUid: string
  againstEmail: string
  category: ComplaintCategory
  description: string
  status: ComplaintStatus
  adminNotes: string | null
  handledByUid: string | null
  createdAt: string
  updatedAt: string
}

export type ReviewStatus = "published" | "hidden"

export interface Review {
  id: string
  jobId: string
  jobTitle: string
  reviewerUid: string
  reviewerEmail: string
  reviewerRole: Role
  revieweeUid: string
  revieweeEmail: string
  rating: number
  comment: string
  status: ReviewStatus
  moderationNote: string | null
  moderatedByUid: string | null
  createdAt: string
  updatedAt: string
}

export type ApplicationStatus = "pending" | "selected" | "rejected" | "withdrawn"

/** A developer's pitch for a public job. Lives under jobs/{jobId}/applications. */
export interface Application {
  id: string
  jobId: string
  jobTitle: string
  applicantUid: string
  applicantEmail: string
  message: string
  portfolioUrl: string | null
  status: ApplicationStatus
  createdAt: string
  updatedAt: string
}

/** Public card shown in the feed and next to applications; never includes email or wallet. */
export interface PublicUser {
  uid: string
  displayName: string
  photoUrl: string | null
  ratingAsFreelancer: RatingSummary
  ratingAsClient: RatingSummary
  memberSince: string
}

/** One entry in the homepage live feed. */
export interface FeedItem {
  id: string
  title: string
  deliverableDescription: string
  acceptanceCriteriaCount: number
  amountUsdc: string
  dueDate: string
  createdAt: string
  applicationCount: number
  client: PublicUser
  /** Set for the signed-in viewer: their own application to this job, if any. */
  myApplicationStatus: ApplicationStatus | null
  isMine: boolean
}
