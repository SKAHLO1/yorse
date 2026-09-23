import { randomBytes } from "node:crypto"
import { getAddress, isAddressEqual, verifyMessage, type Hex } from "viem"
import { decide, RELEASE_CONFIDENCE_THRESHOLD } from "../ai/decision"
import type { EvidenceFetcher } from "../ai/evidence"
import type { VerificationInput } from "../ai/schema"
import { AiUnavailableError, type AiVerifier } from "../ai/verifier"
import type { AuthService, AuthUser } from "../auth"
import { ChainError, toOnchainJobId, type EscrowChain, type RelayerAction } from "../chain/escrow"
import { badRequest, conflict, forbidden, HttpError, notFound, upstream } from "../lib/errors"
import { parseUsdc } from "../lib/usdc"
import type { Store } from "../store/types"
import {
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  type Application,
  type FeedItem,
  type PublicUser,
  type RatingSummary,
  type ChainAction,
  type Job,
  type JobEvent,
  type JobStatus,
  type JobVisibility,
  type Role,
  type Submission,
  type UserProfile,
  type Verification,
} from "../types"

export interface Deps {
  store: Store
  auth: AuthService
  chain: EscrowChain
  ai: AiVerifier
  fetchEvidence: EvidenceFetcher
  now?: () => Date
}

const VERIFICATION_STALE_MS = 5 * 60_000
const WALLET_CHALLENGE_TTL_MS = 10 * 60_000

export type VerificationOutcome =
  | { ok: true; decision: "release" | "dispute"; verificationId: string; txHash: string }
  | { ok: false; stage: "ai" | "chain"; error: string; verificationId: string | null }

export function createJobService(deps: Deps) {
  const { store, chain, ai } = deps
  const iso = () => (deps.now?.() ?? new Date()).toISOString()

  // ------------------------------------------------------------------ helpers

  async function logEvent(
    jobId: string,
    type: string,
    message: string,
    actor: { uid: string | null; role: JobEvent["actorRole"] },
    data: Record<string, unknown> | null = null,
  ) {
    await store.events.add({ id: store.newId(), jobId, type, message, actorUid: actor.uid, actorRole: actor.role, data, at: iso() })
  }

  const chainAction = (type: ChainAction["type"], state: ChainAction["state"], txHash: string | null, error: string | null): ChainAction => ({
    type,
    state,
    txHash,
    error,
    at: iso(),
  })

  function roleOf(job: Job, uid: string): Role | null {
    if (job.clientUid === uid) return "client"
    if (job.freelancerUid === uid) return "freelancer"
    return null
  }

  async function loadJobFor(user: AuthUser, id: string, opts: { allowAdmin?: boolean } = {}) {
    const job = await store.jobs.get(id)
    if (!job) throw notFound("Job")
    const role = roleOf(job, user.uid)
    if (!role && !(opts.allowAdmin && user.admin)) throw notFound("Job") // don't leak existence
    return { job, role }
  }

  function requireStatus(job: Job, ...allowed: JobStatus[]) {
    if (!allowed.includes(job.status)) {
      throw conflict(`This action is not allowed while the job is "${job.status}"`, { status: job.status, allowed })
    }
  }

  /** Runs a relayer call, recording success/failure on the job. Throws a 502 on failure (never swallowed). */
  async function relayerCall(job: Job, action: RelayerAction, actor: { uid: string | null; role: JobEvent["actorRole"] }) {
    await store.jobs.update(job.id, { lastChainAction: chainAction(action, "pending", null, null), updatedAt: iso() })
    try {
      const { txHash } = await chain.send(action, job.onchainJobId)
      await store.jobs.update(job.id, { lastChainAction: chainAction(action, "confirmed", txHash, null), updatedAt: iso() })
      return txHash
    } catch (err) {
      const msg = err instanceof ChainError ? err.message : `escrow.${action}() failed: ${(err as Error).message}`
      const txHash = err instanceof ChainError ? err.txHash : null
      await store.jobs.update(job.id, { lastChainAction: chainAction(action, "failed", txHash, msg), updatedAt: iso() })
      await logEvent(job.id, "chain_error", msg, actor, { action, txHash })
      throw upstream("chain_error", msg, { action, txHash })
    }
  }

  // ------------------------------------------------------------------ users & wallets

  async function ensureProfile(user: AuthUser): Promise<UserProfile> {
    const existing = await store.users.get(user.uid)
    if (existing) {
      // Keep identity fields in step with the auth provider (e.g. a changed Google avatar).
      const patch: Partial<UserProfile> = {}
      if (existing.email !== user.email) patch.email = user.email
      if (user.picture && existing.photoUrl !== user.picture) patch.photoUrl = user.picture
      if (user.name && existing.displayName !== user.name) patch.displayName = user.name
      if (Object.keys(patch).length) {
        patch.updatedAt = iso()
        await store.users.update(user.uid, patch)
      }
      return { ...existing, ...patch }
    }
    const profile: UserProfile = {
      uid: user.uid,
      email: user.email,
      displayName: user.name,
      photoUrl: user.picture,
      ratingAsFreelancer: { average: null, count: 0 },
      ratingAsClient: { average: null, count: 0 },
      walletAddress: null,
      walletAddressLower: null,
      walletLinkedAt: null,
      walletChallenge: null,
      createdAt: iso(),
      updatedAt: iso(),
    }
    await store.users.set(profile)
    return profile
  }

  async function walletChallenge(user: AuthUser) {
    await ensureProfile(user)
    const nonce = randomBytes(16).toString("hex")
    const issued = iso()
    const message = [
      "Link this wallet to your Yorse account.",
      "",
      `Account: ${user.email}`,
      "Network: Arbitrum Sepolia (421614)",
      `Nonce: ${nonce}`,
      `Issued: ${issued}`,
      "",
      "Signing is free and does not send a transaction.",
    ].join("\n")
    const expiresAt = new Date(Date.parse(issued) + WALLET_CHALLENGE_TTL_MS).toISOString()
    await store.users.update(user.uid, { walletChallenge: { nonce, message, expiresAt }, updatedAt: iso() })
    return { message, expiresAt }
  }

  async function linkWallet(user: AuthUser, address: string, signature: Hex) {
    const profile = await ensureProfile(user)
    const ch = profile.walletChallenge
    if (!ch) throw badRequest("Request a wallet challenge first")
    if (Date.parse(ch.expiresAt) < Date.parse(iso())) throw badRequest("Wallet challenge expired; request a new one")
    let checksummed: `0x${string}`
    try {
      checksummed = getAddress(address)
    } catch {
      throw badRequest("Invalid wallet address")
    }
    const valid = await verifyMessage({ address: checksummed, message: ch.message, signature }).catch(() => false)
    if (!valid) throw badRequest("Signature does not match this wallet")

    const owner = await store.users.findByWallet(checksummed)
    if (owner && owner.uid !== user.uid) throw conflict("This wallet is already linked to another Yorse account")
    if (profile.walletAddress && !isAddressEqual(profile.walletAddress, checksummed)) {
      const active = (await store.jobs.listForUser(user.uid)).filter((j) => ACTIVE_STATUSES.includes(j.status))
      if (active.length) throw conflict("You cannot change wallets while you have active jobs", { activeJobs: active.map((j) => j.id) })
    }
    await store.users.update(user.uid, {
      walletAddress: checksummed,
      walletAddressLower: checksummed.toLowerCase(),
      walletLinkedAt: iso(),
      walletChallenge: null,
      updatedAt: iso(),
    })
    return (await store.users.get(user.uid))!
  }

  // ------------------------------------------------------------------ job lifecycle

  async function createJob(
    user: AuthUser,
    input: {
      title: string
      deliverableDescription: string
      acceptanceCriteria: string[]
      dueDate: string
      amountUsdc: string
      visibility: JobVisibility
      freelancerEmail?: string | null
    },
  ) {
    const client = await ensureProfile(user)
    if (!client.walletAddress) throw badRequest("Link your wallet before creating a job")
    const isPublic = input.visibility === "public"
    if (!isPublic && !input.freelancerEmail) throw badRequest("Enter the developer's email, or list the job publicly")
    if (input.freelancerEmail && input.freelancerEmail.toLowerCase() === user.email.toLowerCase()) throw badRequest("You cannot hire yourself")

    const due = new Date(input.dueDate)
    if (Number.isNaN(due.getTime())) throw badRequest("Invalid due date")
    if (due.getTime() < Date.parse(iso())) throw badRequest("Due date must be in the future")

    let amount: { units: string; display: string }
    try {
      amount = parseUsdc(input.amountUsdc)
    } catch (e) {
      throw badRequest((e as Error).message)
    }

    // Invite jobs name the developer up front; public jobs stay open until an applicant is picked.
    let freelancerRef: { uid: string; email: string; wallet: `0x${string}` } | null = null
    if (!isPublic) {
      const fAuth = await deps.auth.getUserByEmail(input.freelancerEmail!.trim())
      if (!fAuth) throw badRequest("No Yorse account exists for that developer email. Ask them to sign up first.")
      const freelancer = await store.users.get(fAuth.uid)
      if (!freelancer?.walletAddress) throw badRequest("That developer has not linked a wallet yet")
      if (isAddressEqual(freelancer.walletAddress, client.walletAddress)) throw badRequest("Client and developer wallets must differ")
      freelancerRef = { uid: fAuth.uid, email: fAuth.email, wallet: freelancer.walletAddress }
    }

    const id = store.newId()
    const now = iso()
    const job: Job = {
      id,
      onchainJobId: toOnchainJobId(id),
      title: input.title.trim(),
      deliverableDescription: input.deliverableDescription.trim(),
      acceptanceCriteria: input.acceptanceCriteria.map((c) => c.trim()).filter(Boolean),
      dueDate: due.toISOString(),
      amountUsdc: amount.display,
      amountUnits: amount.units,
      clientUid: user.uid,
      clientEmail: user.email,
      clientWallet: client.walletAddress,
      visibility: input.visibility,
      freelancerUid: freelancerRef?.uid ?? null,
      freelancerEmail: freelancerRef?.email ?? null,
      freelancerWallet: freelancerRef?.wallet ?? null,
      participants: freelancerRef ? [user.uid, freelancerRef.uid] : [user.uid],
      applicationCount: 0,
      status: isPublic ? "open" : "pending_acceptance",
      fundTxHash: null,
      currentSubmissionId: null,
      verification: { state: "idle", error: null, startedAt: null, verificationId: null },
      pendingDecision: null,
      lastChainAction: null,
      dispute: null,
      resolution: null,
      createdAt: now,
      updatedAt: now,
    }
    await store.jobs.create(job)
    await logEvent(
      id,
      "job_created",
      isPublic
        ? `Client listed the job publicly for ${job.amountUsdc} USDC`
        : `Client created the job for ${job.amountUsdc} USDC`,
      { uid: user.uid, role: "client" },
    )
    return job
  }

  async function respondToTerms(user: AuthUser, id: string, accept: boolean) {
    const { job, role } = await loadJobFor(user, id)
    if (role !== "freelancer") throw forbidden("Only the freelancer can accept or decline the terms")
    const updated = await store.jobs.transition(id, (j) => {
      requireStatus(j, "pending_acceptance")
      return { status: accept ? "awaiting_funding" : "declined", updatedAt: iso() }
    })
    await logEvent(job.id, accept ? "terms_accepted" : "terms_declined", accept ? "Freelancer accepted the terms" : "Freelancer declined the terms", {
      uid: user.uid,
      role: "freelancer",
    })
    return updated
  }

  async function cancelJob(user: AuthUser, id: string) {
    const { role } = await loadJobFor(user, id)
    if (role !== "client") throw forbidden("Only the client can cancel")
    // Before funding, nothing is on-chain, so cancellation is purely off-chain.
    const onchain = await chain.getJob(toOnchainJobId(id))
    if (onchain.state !== "None") throw conflict("This job has already been funded on-chain and cannot be cancelled")
    const updated = await store.jobs.transition(id, (j) => {
      requireStatus(j, "pending_acceptance", "awaiting_funding")
      return { status: "cancelled", updatedAt: iso() }
    })
    await logEvent(id, "job_cancelled", "Client cancelled the job before funding", { uid: user.uid, role: "client" })
    return updated
  }

  /**
   * Client funded from their wallet; verify on-chain that the escrow matches the agreed terms exactly.
   * The on-chain job record is the source of truth; txHash is optional (used for the receipt check and history).
   */
  async function confirmFunding(user: AuthUser, id: string, txHash?: Hex) {
    const { job, role } = await loadJobFor(user, id)
    if (role !== "client") throw forbidden("Only the client can confirm funding")
    requireStatus(job, "awaiting_funding")

    if (txHash) {
      try {
        await chain.confirmFundingTx(txHash)
      } catch (err) {
        throw upstream("chain_error", (err as Error).message, { txHash })
      }
    }
    if (!job.freelancerWallet) throw conflict("Choose a developer before funding this job")
    const onchain = await chain.getJob(job.onchainJobId)
    const problems: string[] = []
    if (onchain.state !== "Funded") problems.push(`on-chain state is ${onchain.state}, expected Funded`)
    if (onchain.state !== "None") {
      if (!isAddressEqual(onchain.client, job.clientWallet)) problems.push(`funded by ${onchain.client}, expected client wallet ${job.clientWallet}`)
      if (!isAddressEqual(onchain.freelancer, job.freelancerWallet)) problems.push(`freelancer is ${onchain.freelancer}, expected ${job.freelancerWallet}`)
      if (onchain.amount.toString() !== job.amountUnits) problems.push(`amount is ${onchain.amount} units, expected ${job.amountUnits}`)
    }
    if (problems.length) {
      await logEvent(id, "funding_mismatch", `Funding could not be confirmed: ${problems.join("; ")}`, { uid: user.uid, role: "client" }, { txHash })
      throw conflict("On-chain escrow does not match the agreed job terms", { problems })
    }

    const updated = await store.jobs.transition(id, (j) => {
      requireStatus(j, "awaiting_funding")
      return { status: "funded", fundTxHash: txHash ?? null, updatedAt: iso() }
    })
    await logEvent(id, "funded", `Escrow funded with ${job.amountUsdc} USDC`, { uid: user.uid, role: "client" }, { txHash })
    return updated
  }

  // ------------------------------------------------------------------ submission + AI verification

  async function submitDeliverable(
    user: AuthUser,
    id: string,
    input: { deliverableUrl: string | null; fileReference: string | null; description: string; notes: string | null },
  ) {
    const { role } = await loadJobFor(user, id)
    if (role !== "freelancer") throw forbidden("Only the freelancer can submit a deliverable")

    // Claim the job so two concurrent submissions can't both call markSubmitted.
    const job = await store.jobs.transition(id, (j) => {
      requireStatus(j, "funded")
      if (j.lastChainAction?.type === "markSubmitted" && j.lastChainAction.state === "pending") {
        throw conflict("A submission is already being recorded on-chain")
      }
      return { lastChainAction: chainAction("markSubmitted", "pending", null, null), updatedAt: iso() }
    })

    const submission: Submission = {
      id: store.newId(),
      jobId: id,
      freelancerUid: user.uid,
      deliverableUrl: input.deliverableUrl,
      fileReference: input.fileReference,
      description: input.description.trim(),
      notes: input.notes?.trim() || null,
      onchainTxHash: null,
      createdAt: iso(),
    }
    await store.submissions.create(submission)
    await logEvent(id, "submission_received", "Freelancer submitted a deliverable", { uid: user.uid, role: "freelancer" }, { submissionId: submission.id })

    // Record on-chain. If a previous attempt already moved it to Submitted, don't send again.
    const onchain = await chain.getJob(job.onchainJobId)
    let txHash: string
    if (onchain.state === "Funded") {
      txHash = await relayerCall(job, "markSubmitted", { uid: user.uid, role: "freelancer" })
    } else if (onchain.state === "Submitted") {
      txHash = job.lastChainAction?.txHash ?? "already-submitted"
    } else {
      const msg = `Escrow is in state ${onchain.state}; cannot record a submission`
      await store.jobs.update(id, { lastChainAction: chainAction("markSubmitted", "failed", null, msg), updatedAt: iso() })
      throw conflict(msg)
    }

    await store.submissions.update(id, submission.id, { onchainTxHash: txHash })
    await store.jobs.update(id, {
      status: "submitted",
      currentSubmissionId: submission.id,
      verification: { state: "idle", error: null, startedAt: null, verificationId: null },
      updatedAt: iso(),
    })
    await logEvent(id, "submitted_onchain", "Submission recorded on-chain", { uid: null, role: "system" }, { txHash })

    const verification = await runVerification(id, { uid: user.uid, role: "freelancer" })
    return { submission: { ...submission, onchainTxHash: txHash }, verification }
  }

  /**
   * Runs the AI check for the current submission and applies the decision rule on-chain.
   * - If a verdict already exists but its chain action failed, only the chain action is retried
   *   (the AI is never re-asked for a verdict that already exists).
   * - AI or chain failures are recorded on the job and returned, never swallowed.
   */
  async function runVerification(id: string, actor: { uid: string | null; role: JobEvent["actorRole"] }): Promise<VerificationOutcome> {
    const pre = await store.jobs.get(id)
    if (!pre) throw notFound("Job")
    requireStatus(pre, "submitted")
    if (pre.pendingDecision && pre.verification.verificationId) {
      return executeDecision(pre, pre.pendingDecision, pre.verification.verificationId, actor)
    }

    const job = await store.jobs.transition(id, (j) => {
      requireStatus(j, "submitted")
      if (j.pendingDecision) throw conflict("A verdict already exists for this submission")
      const running = j.verification.state === "running" && j.verification.startedAt && Date.parse(iso()) - Date.parse(j.verification.startedAt) < VERIFICATION_STALE_MS
      if (running) throw conflict("Verification is already running")
      return { verification: { state: "running", error: null, startedAt: iso(), verificationId: null }, updatedAt: iso() }
    })
    const submission = job.currentSubmissionId ? await store.submissions.get(id, job.currentSubmissionId) : null
    if (!submission) throw new HttpError(500, "internal", "Current submission is missing")

    const evidence = await deps.fetchEvidence(submission.deliverableUrl)
    const input: VerificationInput = {
      job: {
        title: job.title,
        deliverable_description: job.deliverableDescription,
        acceptance_criteria: job.acceptanceCriteria,
        due_date: job.dueDate,
      },
      submission: {
        submitted_at: submission.createdAt,
        deliverable_url: submission.deliverableUrl,
        file_reference: submission.fileReference,
        description: submission.description,
        notes: submission.notes,
      },
      evidence,
    }
    const evidenceMeta = { url: evidence.source_url, fetched: evidence.status === "fetched", note: evidence.note }
    const base = { jobId: id, submissionId: submission.id, threshold: RELEASE_CONFIDENCE_THRESHOLD, evidence: evidenceMeta, createdAt: iso() }

    let outcome: Awaited<ReturnType<AiVerifier["verify"]>>
    try {
      outcome = await ai.verify(input)
    } catch (err) {
      const attempts = err instanceof AiUnavailableError ? err.attempts : []
      const msg = (err as Error).message
      const v: Verification = { id: store.newId(), ...base, status: "error", provider: null, model: null, result: null, decision: null, decisionReason: null, attempts, error: msg }
      await store.verifications.create(v)
      await store.jobs.update(id, { verification: { state: "error", error: msg, startedAt: null, verificationId: v.id }, updatedAt: iso() })
      await logEvent(id, "ai_error", `AI verification failed: ${msg}`, { uid: null, role: "system" }, { verificationId: v.id })
      return { ok: false, stage: "ai", error: msg, verificationId: v.id }
    }

    const decision = decide(outcome.result, job.acceptanceCriteria)
    const v: Verification = {
      id: store.newId(),
      ...base,
      status: "completed",
      provider: outcome.provider,
      model: outcome.model,
      result: outcome.result,
      decision: decision.action,
      decisionReason: decision.reason,
      attempts: outcome.attempts,
      error: null,
    }
    await store.verifications.create(v)
    await store.jobs.update(id, {
      verification: { state: "done", error: null, startedAt: null, verificationId: v.id },
      pendingDecision: decision.action,
      updatedAt: iso(),
    })
    await logEvent(
      id,
      "ai_verdict",
      `AI (${outcome.provider}) returned "${outcome.result.verdict}" at confidence ${outcome.result.confidence.toFixed(2)} → ${decision.action}`,
      { uid: null, role: "system" },
      { verificationId: v.id, decisionReason: decision.reason },
    )
    return executeDecision({ ...job, pendingDecision: decision.action }, decision.action, v.id, actor)
  }

  async function executeDecision(
    job: Job,
    action: "release" | "dispute",
    verificationId: string,
    actor: { uid: string | null; role: JobEvent["actorRole"] },
  ): Promise<VerificationOutcome> {
    const onchain = await chain.getJob(job.onchainJobId)
    const done = action === "release" ? "Released" : "Disputed"
    let txHash: string
    if (onchain.state === done) {
      txHash = job.lastChainAction?.txHash ?? "already-applied" // a previous attempt landed but wasn't recorded
    } else if (onchain.state === "Submitted") {
      try {
        txHash = await relayerCall(job, action, { uid: null, role: "system" })
      } catch (err) {
        return { ok: false, stage: "chain", error: (err as Error).message, verificationId }
      }
    } else {
      const msg = `Escrow is in state ${onchain.state}; cannot ${action}`
      await store.jobs.update(job.id, { lastChainAction: chainAction(action, "failed", null, msg), updatedAt: iso() })
      return { ok: false, stage: "chain", error: msg, verificationId }
    }

    const v = await store.verifications.get(job.id, verificationId)
    await store.jobs.update(job.id, {
      status: action === "release" ? "released" : "disputed",
      pendingDecision: null,
      dispute:
        action === "dispute"
          ? { reason: v?.decisionReason ?? "AI verification did not meet the release rule", source: "ai", byUid: null, at: iso() }
          : null,
      updatedAt: iso(),
    })
    await logEvent(
      job.id,
      action === "release" ? "released" : "disputed",
      action === "release" ? `Escrow released ${job.amountUsdc} USDC to the freelancer` : "Job moved to dispute for admin review",
      actor.role === "admin" ? actor : { uid: null, role: "system" },
      { txHash, verificationId },
    )
    return { ok: true, decision: action, verificationId, txHash }
  }

  /** Non-delivery escape hatch: client (or admin) disputes a funded job with no accepted submission. */
  async function raiseDispute(user: AuthUser, id: string, reason: string, asAdmin = false) {
    const { job, role } = await loadJobFor(user, id, { allowAdmin: asAdmin })
    if (!asAdmin && role !== "client") throw forbidden("Only the client can raise a non-delivery dispute")
    if (asAdmin) {
      // Admin may also dispute a submitted job whose AI check keeps failing.
      if (job.status === "submitted" && !(job.verification.state === "error" || job.pendingDecision === "dispute")) {
        throw conflict("This submission is still being verified; retry verification instead")
      }
      requireStatus(job, "funded", "submitted")
    } else {
      requireStatus(job, "funded")
    }
    const onchain = await chain.getJob(job.onchainJobId)
    const actor = { uid: user.uid, role: asAdmin ? ("admin" as const) : ("client" as const) }
    let txHash: string
    if (onchain.state === "Disputed") txHash = job.lastChainAction?.txHash ?? "already-disputed"
    else txHash = await relayerCall(job, "dispute", actor)

    const updated = await store.jobs.transition(id, () => ({
      status: "disputed",
      pendingDecision: null,
      dispute: { reason, source: asAdmin ? "admin" : "client", byUid: user.uid, at: iso() },
      updatedAt: iso(),
    }))
    await logEvent(id, "disputed", `${asAdmin ? "Admin" : "Client"} opened a dispute: ${reason}`, actor, { txHash })
    return updated
  }

  async function resolveDispute(admin: AuthUser, id: string, outcome: "release" | "refund", notes: string) {
    if (!admin.admin) throw forbidden()
    const job = await store.jobs.get(id)
    if (!job) throw notFound("Job")
    requireStatus(job, "disputed")
    const onchain = await chain.getJob(job.onchainJobId)
    const target = outcome === "release" ? "ResolvedRelease" : "ResolvedRefund"
    const actor = { uid: admin.uid, role: "admin" as const }
    let txHash: string
    if (onchain.state === target) txHash = job.lastChainAction?.txHash ?? "already-resolved"
    else if (onchain.state === "Disputed") txHash = await relayerCall(job, outcome, actor)
    else throw conflict(`Escrow is in state ${onchain.state}; cannot resolve`)

    const updated = await store.jobs.transition(id, () => ({
      status: outcome === "release" ? "resolved_release" : "resolved_refund",
      resolution: { outcome, notes, adminUid: admin.uid, adminEmail: admin.email, txHash, at: iso() },
      updatedAt: iso(),
    }))
    await logEvent(
      id,
      "resolved",
      outcome === "release" ? `Admin released ${job.amountUsdc} USDC to the freelancer` : `Admin refunded ${job.amountUsdc} USDC to the client`,
      actor,
      { txHash, notes },
    )
    return updated
  }

  async function retryVerification(user: AuthUser, id: string) {
    const { role } = await loadJobFor(user, id, { allowAdmin: true })
    return runVerification(id, role ? { uid: user.uid, role } : { uid: user.uid, role: "admin" })
  }

  // ------------------------------------------------------------------ reads

  async function jobDetail(user: AuthUser, id: string, opts: { admin?: boolean } = {}) {
    // An open public listing is readable by any signed-in user so they can decide whether to apply.
    // They get the terms and the poster's public profile - no submissions, complaints or reviews.
    const listing = await store.jobs.get(id)
    if (listing && listing.visibility === "public" && listing.status === "open" && listing.clientUid !== user.uid && !(opts.admin && user.admin)) {
      const myApplication = (await store.applications.listForJob(id)).find((a) => a.applicantUid === user.uid) ?? null
      return {
        job: listing,
        viewerRole: null,
        onchain: { client: "", freelancer: "", amount: "0", state: "None" as const },
        escrowAddress: chain.escrowAddress,
        submissions: [],
        verifications: [],
        events: [],
        complaints: [],
        reviews: [],
        client: await publicUser(listing.clientUid),
        myApplication,
      }
    }
    const { job, role } = await loadJobFor(user, id, { allowAdmin: opts.admin })
    const [submissions, verifications, events, complaints, reviews, onchain] = await Promise.all([
      store.submissions.listForJob(id),
      store.verifications.listForJob(id),
      store.events.listForJob(id),
      store.complaints.listForJob(id),
      store.reviews.listForJob(id),
      chain.getJob(job.onchainJobId).catch((e) => ({ error: (e as Error).message })),
    ])
    const isAdminView = opts.admin && user.admin
    return {
      job,
      viewerRole: isAdminView ? "admin" : role,
      client: await publicUser(job.clientUid),
      freelancer: job.freelancerUid ? await publicUser(job.freelancerUid) : null,
      myApplication: null,
      onchain: "error" in onchain ? onchain : { ...onchain, amount: onchain.amount.toString() },
      escrowAddress: chain.escrowAddress,
      submissions,
      verifications,
      events,
      // Complaints go to admins; a participant only sees the ones they filed.
      complaints: isAdminView ? complaints : complaints.filter((c) => c.filedByUid === user.uid),
      // Hidden reviews are visible only to their author and admins.
      reviews: isAdminView ? reviews : reviews.filter((r) => r.status === "published" || r.reviewerUid === user.uid),
    }
  }


  // ------------------------------------------------------------------ public listings, applications, profiles

  /** Public view of a user: never exposes email, wallet or the challenge nonce. */
  function toPublicUser(p: UserProfile): PublicUser {
    return {
      uid: p.uid,
      displayName: p.displayName?.trim() || p.email.split("@")[0],
      photoUrl: p.photoUrl ?? null,
      ratingAsFreelancer: p.ratingAsFreelancer ?? { average: null, count: 0 },
      ratingAsClient: p.ratingAsClient ?? { average: null, count: 0 },
      memberSince: p.createdAt,
    }
  }

  const MISSING_USER: PublicUser = {
    uid: "",
    displayName: "Unknown user",
    photoUrl: null,
    ratingAsFreelancer: { average: null, count: 0 },
    ratingAsClient: { average: null, count: 0 },
    memberSince: "",
  }

  async function publicUser(uid: string): Promise<PublicUser> {
    const p = await store.users.get(uid)
    return p ? toPublicUser(p) : { ...MISSING_USER, uid }
  }

  /** Homepage live feed: newest public jobs still accepting applications. */
  async function feed(user: AuthUser, limit = 20): Promise<FeedItem[]> {
    const jobs = await store.jobs.listOpenPublic(Math.min(limit, 50))
    const posters = new Map<string, PublicUser>()
    for (const uid of new Set(jobs.map((j) => j.clientUid))) posters.set(uid, await publicUser(uid))
    const mine = await store.applications.listForApplicant(user.uid)
    return jobs.map((j) => ({
      id: j.id,
      title: j.title,
      deliverableDescription: j.deliverableDescription,
      acceptanceCriteriaCount: j.acceptanceCriteria.length,
      amountUsdc: j.amountUsdc,
      dueDate: j.dueDate,
      createdAt: j.createdAt,
      applicationCount: j.applicationCount ?? 0,
      client: posters.get(j.clientUid) ?? MISSING_USER,
      myApplicationStatus: mine.find((a) => a.jobId === j.id)?.status ?? null,
      isMine: j.clientUid === user.uid,
    }))
  }

  /** A developer applies to a public job. */
  async function applyToJob(user: AuthUser, jobId: string, input: { message: string; portfolioUrl: string | null }) {
    const profile = await ensureProfile(user)
    if (!profile.walletAddress) throw badRequest("Link your wallet before applying - clients can only hire linked wallets")
    const job = await store.jobs.get(jobId)
    if (!job) throw notFound("Job")
    if (job.visibility !== "public" || job.status !== "open") throw conflict("This job is not accepting applications")
    if (job.clientUid === user.uid) throw badRequest("You cannot apply to your own job")
    if (isAddressEqual(profile.walletAddress, job.clientWallet)) throw badRequest("Client and developer wallets must differ")

    const existing = (await store.applications.listForJob(jobId)).find((a) => a.applicantUid === user.uid)
    if (existing && existing.status !== "withdrawn") throw conflict("You have already applied to this job")

    const app: Application = {
      id: existing?.id ?? store.newId(),
      jobId,
      jobTitle: job.title,
      applicantUid: user.uid,
      applicantEmail: user.email,
      message: input.message.trim(),
      portfolioUrl: input.portfolioUrl,
      status: "pending",
      createdAt: existing?.createdAt ?? iso(),
      updatedAt: iso(),
    }
    if (existing) {
      await store.applications.update(jobId, app.id, app)
    } else {
      await store.applications.create(app)
      await store.jobs.transition(jobId, (j) => ({ applicationCount: (j.applicationCount ?? 0) + 1, updatedAt: iso() }))
    }
    await logEvent(jobId, "application_received", `${app.applicantEmail} applied`, { uid: user.uid, role: "freelancer" }, { applicationId: app.id })
    return app
  }

  async function withdrawApplication(user: AuthUser, jobId: string, applicationId: string) {
    const app = await store.applications.get(jobId, applicationId)
    if (!app) throw notFound("Application")
    if (app.applicantUid !== user.uid) throw forbidden("You can only withdraw your own application")
    if (app.status !== "pending") throw conflict(`This application is already ${app.status}`)
    await store.applications.update(jobId, applicationId, { status: "withdrawn", updatedAt: iso() })
    // Keep the feed's "N applied" honest.
    await store.jobs.transition(jobId, (j) => ({ applicationCount: Math.max(0, (j.applicationCount ?? 1) - 1), updatedAt: iso() }))
    return { ...app, status: "withdrawn" as const }
  }

  /** Client picks an applicant; the job then follows the normal accept -> fund -> verify flow. */
  async function selectApplicant(user: AuthUser, jobId: string, applicationId: string) {
    const job = await store.jobs.get(jobId)
    if (!job) throw notFound("Job")
    if (job.clientUid !== user.uid) throw forbidden("Only the client can choose an applicant")
    requireStatus(job, "open")

    const app = await store.applications.get(jobId, applicationId)
    if (!app || app.jobId !== jobId) throw notFound("Application")
    if (app.status !== "pending") throw conflict(`That application is ${app.status}`)

    const dev = await store.users.get(app.applicantUid)
    if (!dev?.walletAddress) throw conflict("That developer no longer has a linked wallet")
    if (isAddressEqual(dev.walletAddress, job.clientWallet)) throw badRequest("Client and developer wallets must differ")
    const devWallet = dev.walletAddress

    const updated = await store.jobs.transition(jobId, (j) => {
      requireStatus(j, "open")
      return {
        freelancerUid: app.applicantUid,
        freelancerEmail: app.applicantEmail,
        freelancerWallet: devWallet,
        participants: [j.clientUid, app.applicantUid],
        status: "pending_acceptance" as const,
        updatedAt: iso(),
      }
    })
    // Close the rest so nobody is left waiting on a decided job.
    for (const other of await store.applications.listForJob(jobId)) {
      const status = other.id === applicationId ? "selected" : other.status === "pending" ? "rejected" : other.status
      if (status !== other.status) await store.applications.update(jobId, other.id, { status, updatedAt: iso() })
    }
    await logEvent(jobId, "applicant_selected", `Client selected ${app.applicantEmail}`, { uid: user.uid, role: "client" }, { applicationId })
    return updated
  }

  async function listApplications(user: AuthUser, jobId: string) {
    const job = await store.jobs.get(jobId)
    if (!job) throw notFound("Job")
    const isClient = job.clientUid === user.uid
    if (!isClient && !user.admin) throw forbidden("Only the client can see applications")
    const apps = await store.applications.listForJob(jobId)
    return Promise.all(apps.map(async (a) => ({ ...a, applicant: await publicUser(a.applicantUid) })))
  }

  const myApplications = (user: AuthUser) => store.applications.listForApplicant(user.uid)

  /** Public profile: ratings plus the published reviews behind them. */
  async function profile(uid: string) {
    const p = await store.users.get(uid)
    if (!p) throw notFound("User")
    const all = await store.reviews.listForReviewee(uid)
    const published = all.filter((r) => r.status === "published")
    const reviews = await Promise.all(
      published.slice(0, 50).map(async (r) => ({
        id: r.id,
        jobId: r.jobId,
        jobTitle: r.jobTitle,
        rating: r.rating,
        comment: r.comment,
        reviewerRole: r.reviewerRole,
        reviewer: await publicUser(r.reviewerUid),
        createdAt: r.createdAt,
      })),
    )
    const jobs = await store.jobs.listForUser(uid)
    return {
      user: toPublicUser(p),
      stats: {
        completedAsFreelancer: jobs.filter((j) => j.freelancerUid === uid && TERMINAL_STATUSES.includes(j.status)).length,
        completedAsClient: jobs.filter((j) => j.clientUid === uid && TERMINAL_STATUSES.includes(j.status)).length,
        hasLinkedWallet: !!p.walletAddress,
      },
      reviews,
    }
  }

  /** Recompute a user's public rating from their published reviews. Called after a review is posted or moderated. */
  async function recomputeRating(uid: string) {
    const published = (await store.reviews.listForReviewee(uid)).filter((r) => r.status === "published")
    const summarise = (rs: typeof published): RatingSummary =>
      rs.length
        ? { average: Math.round((rs.reduce((t, r) => t + r.rating, 0) / rs.length) * 100) / 100, count: rs.length }
        : { average: null, count: 0 }
    // A review written by the client is about the developer's work, and vice versa.
    await store.users.update(uid, {
      ratingAsFreelancer: summarise(published.filter((r) => r.reviewerRole === "client")),
      ratingAsClient: summarise(published.filter((r) => r.reviewerRole === "freelancer")),
      updatedAt: iso(),
    })
  }

  return {
    ensureProfile,
    toPublicUser,
    publicUser,
    feed,
    applyToJob,
    withdrawApplication,
    selectApplicant,
    listApplications,
    myApplications,
    profile,
    recomputeRating,
    walletChallenge,
    linkWallet,
    createJob,
    respondToTerms,
    cancelJob,
    confirmFunding,
    submitDeliverable,
    runVerification,
    retryVerification,
    raiseDispute,
    resolveDispute,
    jobDetail,
    listJobs: (user: AuthUser) => store.jobs.listForUser(user.uid),
    roleOf,
    loadJobFor,
    logEvent,
  }
}

export type JobService = ReturnType<typeof createJobService>
