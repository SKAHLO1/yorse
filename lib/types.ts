// Mirrors backend/src/types.ts (API response shapes).

export type JobStatus =
  | "open"
  | "pending_acceptance"
  | "declined"
  | "cancelled"
  | "awaiting_funding"
  | "funded"
  | "submitted"
  | "released"
  | "disputed"
  | "resolved_release"
  | "resolved_refund"

export type Role = "client" | "freelancer"
export type OnchainState = "None" | "Funded" | "Submitted" | "Released" | "Disputed" | "ResolvedRelease" | "ResolvedRefund"

export type JobVisibility = "public" | "invite"
export type ApplicationStatus = "pending" | "selected" | "rejected" | "withdrawn"

export interface RatingSummary {
  average: number | null
  count: number
}

export interface PublicUser {
  uid: string
  displayName: string
  photoUrl: string | null
  ratingAsFreelancer: RatingSummary
  ratingAsClient: RatingSummary
  memberSince: string
}

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
  /** Present when the client lists applications for their job. */
  applicant?: PublicUser
}

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
  myApplicationStatus: ApplicationStatus | null
  isMine: boolean
}

export interface ProfileReview {
  id: string
  jobId: string
  jobTitle: string
  rating: number
  comment: string
  reviewerRole: Role
  reviewer: PublicUser
  createdAt: string
}

export interface PublicProfile {
  user: PublicUser
  stats: { completedAsFreelancer: number; completedAsClient: number; hasLinkedWallet: boolean }
  reviews: ProfileReview[]
}

export interface Me {
  uid: string
  email: string
  displayName: string | null
  walletAddress: `0x${string}` | null
  walletLinkedAt: string | null
  admin: boolean
}

export interface ChainAction {
  type: "markSubmitted" | "release" | "dispute" | "refund"
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
  amountUsdc: string
  amountUnits: string
  visibility: JobVisibility
  clientUid: string
  clientEmail: string
  clientWallet: `0x${string}`
  freelancerUid: string | null
  freelancerEmail: string | null
  freelancerWallet: `0x${string}` | null
  applicationCount: number
  status: JobStatus
  fundTxHash: string | null
  currentSubmissionId: string | null
  verification: { state: "idle" | "running" | "error" | "done"; error: string | null; startedAt: string | null; verificationId: string | null }
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
  deliverableUrl: string | null
  fileReference: string | null
  description: string
  notes: string | null
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
  submissionId: string
  status: "completed" | "error"
  provider: "groq" | "gemini" | null
  model: string | null
  result: AiVerdict | null
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
  againstEmail: string
  category: ComplaintCategory
  description: string
  status: ComplaintStatus
  adminNotes: string | null
  createdAt: string
  updatedAt: string
}

export interface Review {
  id: string
  jobId: string
  jobTitle: string
  reviewerUid: string
  reviewerEmail: string
  reviewerRole: Role
  revieweeEmail: string
  rating: number
  comment: string
  status: "published" | "hidden"
  moderationNote: string | null
  createdAt: string
}

export interface JobDetail {
  job: Job
  viewerRole: Role | "admin" | null
  onchain: { client: string; freelancer: string; amount: string; state: OnchainState } | { error: string }
  escrowAddress: `0x${string}`
  submissions: Submission[]
  verifications: Verification[]
  events: JobEvent[]
  complaints: Complaint[]
  reviews: Review[]
  client?: PublicUser
  freelancer?: PublicUser | null
  myApplication?: Application | null
}

export const TERMINAL: JobStatus[] = ["released", "resolved_release", "resolved_refund"]
export const COMPLAINABLE: JobStatus[] = ["released", "disputed", "resolved_release", "resolved_refund"]
