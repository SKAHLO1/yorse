import cors from "cors"
import express, { type NextFunction, type Request, type Response } from "express"
import rateLimit, { ipKeyGenerator } from "express-rate-limit"
import helmet from "helmet"
import { z, ZodError } from "zod"
import type { AuthUser } from "./auth"
import { errorMessage, forbidden, HttpError, unauthorized } from "./lib/errors"
import { createFeedbackService } from "./services/feedback"
import { createJobService, type Deps } from "./services/jobs"

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

// ------------------------------------------------------------------ validation schemas

const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid transaction hash")
const httpUrl = z
  .string()
  .trim()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "Link must start with http:// or https://")

const schemas = {
  linkWallet: z.object({ address: z.string(), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }),
  createJob: z.object({
    title: z.string().trim().min(3).max(120),
    deliverableDescription: z.string().trim().min(20).max(4000),
    acceptanceCriteria: z.array(z.string().trim().min(5).max(500)).min(1).max(12),
    dueDate: z.string().min(8),
    amountUsdc: z.string().trim().min(1).max(20),
    // "public" lists the job in the feed and accepts applications; "invite" names the developer up front.
    visibility: z.enum(["public", "invite"]).default("invite"),
    freelancerEmail: z.string().trim().email().nullish(),
  }),
  apply: z
    .object({
      message: z.string().trim().min(20).max(2000),
      portfolioUrl: httpUrl.max(2000).nullish(),
    })
    .transform((v) => ({ message: v.message, portfolioUrl: v.portfolioUrl || null })),
  respond: z.object({ accept: z.boolean() }),
  fundConfirm: z.object({ txHash: txHash.optional() }),
  submit: z
    .object({
      deliverableUrl: httpUrl.max(2000).nullish(),
      fileReference: z.string().trim().max(500).nullish(),
      description: z.string().trim().min(20).max(5000),
      notes: z.string().trim().max(2000).nullish(),
    })
    .transform((v) => ({ deliverableUrl: v.deliverableUrl || null, fileReference: v.fileReference || null, description: v.description, notes: v.notes || null })),
  dispute: z.object({ reason: z.string().trim().min(10).max(2000) }),
  complaint: z.object({
    category: z.enum(["quality", "communication", "payment", "ai_verdict", "conduct", "other"]),
    description: z.string().trim().min(20).max(4000),
  }),
  review: z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().min(10).max(2000) }),
  resolve: z.object({ outcome: z.enum(["release", "refund"]), notes: z.string().trim().min(10).max(4000) }),
  moderateComplaint: z.object({
    status: z.enum(["open", "under_review", "resolved", "dismissed"]),
    adminNotes: z.string().trim().max(4000).nullish().transform((v) => v || null),
  }),
  moderateReview: z.object({
    status: z.enum(["published", "hidden"]),
    moderationNote: z.string().trim().max(2000).nullish().transform((v) => v || null),
  }),
  jobStatus: z
    .enum(["open", "pending_acceptance", "declined", "cancelled", "awaiting_funding", "funded", "submitted", "released", "disputed", "resolved_release", "resolved_refund"])
    .optional(),
}

const body = <T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> => schema.parse(req.body ?? {})
const param = (req: Request, name: string) => String(req.params[name])

// ------------------------------------------------------------------ app

export function createApp(deps: Deps & { corsOrigins: string[] }) {
  const jobs = createJobService(deps)
  const feedback = createFeedbackService(deps.store, jobs, deps.now)
  const app = express()

  app.disable("x-powered-by")
  app.set("trust proxy", 1)
  app.use(helmet())
  app.use(cors({ origin: deps.corsOrigins, allowedHeaders: ["authorization", "content-type"], methods: ["GET", "POST", "PATCH"] }))
  app.use(express.json({ limit: "200kb" }))

  // ---- public
  app.get("/health", async (_req, res) => {
    const chain = await deps.chain.health().catch((e) => ({ error: errorMessage(e) }))
    res.json({ ok: !("error" in chain), chain, ai: deps.ai.providers })
  })

  // ---- auth
  const requireAuth = async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization
    if (!header?.startsWith("Bearer ")) return next(unauthorized())
    try {
      req.user = await deps.auth.verifyIdToken(header.slice(7))
      next()
    } catch {
      next(unauthorized("Invalid or expired session; sign in again"))
    }
  }
  const requireAdmin = (req: Request, _res: Response, next: NextFunction) => (req.user?.admin ? next() : next(forbidden("Admin access required")))

  const api = express.Router()
  api.use(requireAuth)

  // Mutations that hit the chain or the AI are rate limited per user.
  const heavyLimiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    keyGenerator: (req) => req.user?.uid ?? ipKeyGenerator(req.ip ?? "0.0.0.0"),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: { code: "rate_limited", message: "Too many requests; slow down" } },
  })

  // ---- me / wallet
  api.get("/me", async (req, res) => {
    const profile = await jobs.ensureProfile(req.user!)
    const { walletChallenge: _omit, ...safe } = profile
    res.json({ user: { ...safe, admin: req.user!.admin } })
  })
  api.post("/me/wallet/challenge", async (req, res) => res.json(await jobs.walletChallenge(req.user!)))
  api.post("/me/wallet", async (req, res) => {
    const { address, signature } = body(schemas.linkWallet, req)
    const { walletChallenge: _omit, ...safe } = await jobs.linkWallet(req.user!, address, signature as `0x${string}`)
    res.json({ user: { ...safe, admin: req.user!.admin } })
  })

  // ---- live feed & public profiles
  api.get("/feed", async (req, res) => {
    const limit = Number(req.query.limit) || 20
    res.json({ feed: await jobs.feed(req.user!, limit) })
  })
  api.get("/users/:uid", async (req, res) => res.json(await jobs.profile(param(req, "uid"))))
  api.get("/me/applications", async (req, res) => res.json({ applications: await jobs.myApplications(req.user!) }))

  // ---- jobs
  api.get("/jobs", async (req, res) => res.json({ jobs: await jobs.listJobs(req.user!) }))
  api.post("/jobs", async (req, res) => res.status(201).json({ job: await jobs.createJob(req.user!, body(schemas.createJob, req)) }))
  api.get("/jobs/:id", async (req, res) => res.json(await jobs.jobDetail(req.user!, param(req, "id"))))
  api.get("/jobs/:id/applications", async (req, res) => res.json({ applications: await jobs.listApplications(req.user!, param(req, "id")) }))
  api.post("/jobs/:id/applications", async (req, res) =>
    res.status(201).json({ application: await jobs.applyToJob(req.user!, param(req, "id"), body(schemas.apply, req)) }),
  )
  api.post("/jobs/:id/applications/:appId/withdraw", async (req, res) =>
    res.json({ application: await jobs.withdrawApplication(req.user!, param(req, "id"), param(req, "appId")) }),
  )
  api.post("/jobs/:id/applications/:appId/select", async (req, res) =>
    res.json({ job: await jobs.selectApplicant(req.user!, param(req, "id"), param(req, "appId")) }),
  )
  api.post("/jobs/:id/respond", async (req, res) => res.json({ job: await jobs.respondToTerms(req.user!, param(req, "id"), body(schemas.respond, req).accept) }))
  api.post("/jobs/:id/cancel", async (req, res) => res.json({ job: await jobs.cancelJob(req.user!, param(req, "id")) }))
  api.post("/jobs/:id/fund-confirm", heavyLimiter, async (req, res) =>
    res.json({ job: await jobs.confirmFunding(req.user!, param(req, "id"), body(schemas.fundConfirm, req).txHash as `0x${string}` | undefined) }),
  )
  api.post("/jobs/:id/submissions", heavyLimiter, async (req, res) => {
    const result = await jobs.submitDeliverable(req.user!, param(req, "id"), body(schemas.submit, req))
    res.status(201).json(result)
  })
  api.post("/jobs/:id/verify", heavyLimiter, async (req, res) => {
    const outcome = await jobs.retryVerification(req.user!, param(req, "id"))
    res.status(outcome.ok ? 200 : 502).json({ verification: outcome })
  })
  api.post("/jobs/:id/dispute", heavyLimiter, async (req, res) =>
    res.json({ job: await jobs.raiseDispute(req.user!, param(req, "id"), body(schemas.dispute, req).reason) }),
  )
  api.post("/jobs/:id/complaints", async (req, res) =>
    res.status(201).json({ complaint: await feedback.fileComplaint(req.user!, param(req, "id"), body(schemas.complaint, req)) }),
  )
  api.post("/jobs/:id/reviews", async (req, res) =>
    res.status(201).json({ review: await feedback.leaveReview(req.user!, param(req, "id"), body(schemas.review, req)) }),
  )

  // ---- admin
  const admin = express.Router()
  admin.use(requireAdmin)
  admin.get("/overview", async (_req, res) => {
    const [all, complaints, reviews] = await Promise.all([deps.store.jobs.list(), deps.store.complaints.list(), deps.store.reviews.list()])
    const byStatus: Record<string, number> = {}
    for (const j of all) byStatus[j.status] = (byStatus[j.status] ?? 0) + 1
    res.json({
      jobs: { total: all.length, byStatus },
      complaints: { total: complaints.length, open: complaints.filter((c) => c.status === "open" || c.status === "under_review").length },
      reviews: { total: reviews.length, hidden: reviews.filter((r) => r.status === "hidden").length },
      attention: all.filter((j) => j.status === "submitted" && (j.verification.state === "error" || j.lastChainAction?.state === "failed")).map((j) => j.id),
    })
  })
  admin.get("/jobs", async (req, res) => res.json({ jobs: await deps.store.jobs.list({ status: schemas.jobStatus.parse(req.query.status || undefined) }) }))
  admin.get("/jobs/:id", async (req, res) => res.json(await jobs.jobDetail(req.user!, param(req, "id"), { admin: true })))
  admin.post("/jobs/:id/resolve", heavyLimiter, async (req, res) => {
    const { outcome, notes } = body(schemas.resolve, req)
    res.json({ job: await jobs.resolveDispute(req.user!, param(req, "id"), outcome, notes) })
  })
  admin.post("/jobs/:id/dispute", heavyLimiter, async (req, res) =>
    res.json({ job: await jobs.raiseDispute(req.user!, param(req, "id"), body(schemas.dispute, req).reason, true) }),
  )
  admin.post("/jobs/:id/verify", heavyLimiter, async (req, res) => {
    const outcome = await jobs.retryVerification(req.user!, param(req, "id"))
    res.status(outcome.ok ? 200 : 502).json({ verification: outcome })
  })
  admin.get("/complaints", async (req, res) => {
    const status = z.enum(["open", "under_review", "resolved", "dismissed"]).optional().parse(req.query.status || undefined)
    res.json({ complaints: await deps.store.complaints.list({ status }) })
  })
  admin.patch("/complaints/:id", async (req, res) =>
    res.json({ complaint: await feedback.moderateComplaint(req.user!, param(req, "id"), body(schemas.moderateComplaint, req)) }),
  )
  admin.get("/reviews", async (req, res) => {
    const status = z.enum(["published", "hidden"]).optional().parse(req.query.status || undefined)
    res.json({ reviews: await deps.store.reviews.list({ status }) })
  })
  admin.patch("/reviews/:id", async (req, res) =>
    res.json({ review: await feedback.moderateReview(req.user!, param(req, "id"), body(schemas.moderateReview, req)) }),
  )
  api.use("/admin", admin)

  app.use("/api", api)

  app.use((_req, res) => res.status(404).json({ error: { code: "not_found", message: "Route not found" } }))

  // Every error is surfaced with a code and message; upstream (AI/chain) details are included.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: { code: "validation_error", message: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), details: err.issues },
      })
    }
    if (err instanceof HttpError) {
      if (err.status >= 500) console.error(`[${req.method} ${req.path}] ${err.code}: ${err.message}`)
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details ?? null } })
    }
    if ((err as { type?: string })?.type === "entity.parse.failed") {
      return res.status(400).json({ error: { code: "bad_json", message: "Request body is not valid JSON" } })
    }
    console.error(`[${req.method} ${req.path}] unhandled`, err)
    res.status(500).json({ error: { code: "internal", message: errorMessage(err) } })
  })

  return app
}
