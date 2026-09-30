import type { DecisionAction } from "../types"
import type { VerdictResult } from "./schema"

/** Fixed by the product brief. Not configurable, so it cannot be lowered by an env change. */
export const RELEASE_CONFIDENCE_THRESHOLD = 0.85

export interface Decision {
  action: DecisionAction
  reason: string
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.;:,]+$/, "").trim()

/**
 * Backend decision rule for the first AI verdict. Nothing here moves money: the result is posted
 * on-chain as a challengeable proposal (or escalated to the jury).
 *
 * Propose RELEASE only when ALL hold:
 *  - model verdict is "release" with confidence >= 0.85
 *  - unmatched_criteria is empty
 *  - every agreed acceptance criterion is explicitly listed in matched_criteria
 * Propose REFUND only when the model says "dispute" with confidence >= 0.85 and names at least
 * one unmatched criterion.
 * Anything else (low confidence, inconsistent output) ESCALATES straight to the AI jury, with no bond.
 */
export function decide(result: VerdictResult, acceptanceCriteria: string[]): Decision {
  const conf = result.confidence.toFixed(2)
  if (result.confidence < RELEASE_CONFIDENCE_THRESHOLD) {
    return { action: "escalate", reason: `AI confidence ${conf} is below the ${RELEASE_CONFIDENCE_THRESHOLD} threshold; sending to the AI jury.` }
  }
  if (result.verdict === "dispute") {
    if (result.unmatched_criteria.length === 0) {
      return { action: "escalate", reason: "AI said dispute but named no unmatched criterion; inconsistent verdict, sending to the AI jury." }
    }
    return {
      action: "refund",
      reason: `AI verdict dispute with confidence ${conf} ≥ ${RELEASE_CONFIDENCE_THRESHOLD}; ${result.unmatched_criteria.length} criterion(s) unmet. Proposing a refund.`,
    }
  }
  if (result.unmatched_criteria.length > 0) {
    return { action: "escalate", reason: "AI said release but listed unmatched criteria; inconsistent verdict, sending to the AI jury." }
  }
  const matched = result.matched_criteria.map(norm)
  const missing = acceptanceCriteria.filter((c) => {
    const n = norm(c)
    // Verbatim (normalized) match required; the prompt instructs the model to copy criteria exactly.
    return !matched.some((m) => m === n || m.includes(n))
  })
  if (missing.length > 0) {
    return {
      action: "escalate",
      reason: `AI did not explicitly confirm ${missing.length} agreed criterion(s): ${missing.map((m) => `"${m}"`).join(", ")}; sending to the AI jury.`,
    }
  }
  return {
    action: "release",
    reason: `AI verdict release with confidence ${conf} ≥ ${RELEASE_CONFIDENCE_THRESHOLD}; all ${acceptanceCriteria.length} criteria matched. Proposing release.`,
  }
}
