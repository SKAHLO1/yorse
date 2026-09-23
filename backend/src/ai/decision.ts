import type { VerdictResult } from "./schema"

/** Fixed by the product brief. Not configurable, so it cannot be lowered by an env change. */
export const RELEASE_CONFIDENCE_THRESHOLD = 0.85

export interface Decision {
  action: "release" | "dispute"
  reason: string
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.;:,]+$/, "").trim()

/**
 * Backend decision rule. Release only when ALL hold:
 *  - model verdict is "release"
 *  - confidence >= 0.85
 *  - unmatched_criteria is empty
 *  - every agreed acceptance criterion is explicitly listed in matched_criteria
 * Anything else goes to dispute for admin review.
 */
export function decide(result: VerdictResult, acceptanceCriteria: string[]): Decision {
  if (result.verdict !== "release") {
    return { action: "dispute", reason: "AI returned a dispute verdict." }
  }
  if (result.confidence < RELEASE_CONFIDENCE_THRESHOLD) {
    return {
      action: "dispute",
      reason: `AI confidence ${result.confidence.toFixed(2)} is below the ${RELEASE_CONFIDENCE_THRESHOLD} release threshold.`,
    }
  }
  if (result.unmatched_criteria.length > 0) {
    return { action: "dispute", reason: "AI said release but listed unmatched criteria; inconsistent verdict." }
  }
  const matched = result.matched_criteria.map(norm)
  const missing = acceptanceCriteria.filter((c) => {
    const n = norm(c)
    // Verbatim (normalized) match required; the prompt instructs the model to copy criteria exactly.
    return !matched.some((m) => m === n || m.includes(n))
  })
  if (missing.length > 0) {
    return {
      action: "dispute",
      reason: `AI did not explicitly confirm ${missing.length} agreed criterion(s): ${missing.map((m) => `"${m}"`).join(", ")}.`,
    }
  }
  return {
    action: "release",
    reason: `AI verdict release with confidence ${result.confidence.toFixed(2)} ≥ ${RELEASE_CONFIDENCE_THRESHOLD}; all ${acceptanceCriteria.length} criteria matched.`,
  }
}
