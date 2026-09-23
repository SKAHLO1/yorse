import { z } from "zod"

/** The strict verdict contract every provider must satisfy. Anything else is treated as a provider failure. */
export const verdictSchema = z
  .object({
    verdict: z.enum(["release", "dispute"]),
    confidence: z.number().min(0).max(1),
    matched_criteria: z.array(z.string()),
    unmatched_criteria: z.array(z.string()),
    reasoning: z.string().trim().min(20, "reasoning must cite specific evidence"),
  })
  .strict()

export type VerdictResult = z.infer<typeof verdictSchema>

/** JSON Schema used for providers that support schema-constrained output (Gemini responseSchema). */
export const verdictJsonSchemaGemini = {
  type: "OBJECT",
  properties: {
    verdict: { type: "STRING", enum: ["release", "dispute"] },
    confidence: { type: "NUMBER" },
    matched_criteria: { type: "ARRAY", items: { type: "STRING" } },
    unmatched_criteria: { type: "ARRAY", items: { type: "STRING" } },
    reasoning: { type: "STRING" },
  },
  required: ["verdict", "confidence", "matched_criteria", "unmatched_criteria", "reasoning"],
  propertyOrdering: ["verdict", "confidence", "matched_criteria", "unmatched_criteria", "reasoning"],
} as const

/** Structured object the model receives. Built only from agreed terms + the freelancer's submission + fetched evidence. */
export interface VerificationInput {
  job: {
    title: string
    deliverable_description: string
    acceptance_criteria: string[]
    due_date: string
  }
  submission: {
    submitted_at: string
    deliverable_url: string | null
    file_reference: string | null
    description: string
    notes: string | null
  }
  evidence: {
    status: "fetched" | "failed" | "not_provided"
    source_url: string | null
    note: string | null
    content_excerpt: string | null
  }
}

export function parseVerdict(raw: string): VerdictResult {
  let json: unknown
  try {
    // Tolerate a fenced block, but nothing else: the payload must be a single JSON object.
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    json = JSON.parse(cleaned)
  } catch {
    throw new Error(`model returned non-JSON output: ${raw.slice(0, 200)}`)
  }
  const parsed = verdictSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(`model output violated the verdict schema: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`)
  }
  return parsed.data
}
