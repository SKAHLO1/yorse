import { describe, expect, it } from "vitest"
import { decide, RELEASE_CONFIDENCE_THRESHOLD } from "../src/ai/decision"
import { parseJurorVote, tally } from "../src/ai/jury"
import { parseVerdict } from "../src/ai/schema"
import type { JurorResult } from "../src/types"

const criteria = ["Landing page has a hero section", "Site is responsive on mobile", "Contact form sends email"]
const pass = {
  verdict: "release" as const,
  confidence: 0.93,
  matched_criteria: [...criteria],
  unmatched_criteria: [],
  reasoning: "The fetched page shows a hero section, a responsive viewport meta tag, and a working form.",
}

describe("decision rule", () => {
  it("threshold is fixed at 0.85", () => expect(RELEASE_CONFIDENCE_THRESHOLD).toBe(0.85))

  it("proposes release on verdict=release, confidence >= 0.85, all criteria matched", () => {
    expect(decide(pass, criteria).action).toBe("release")
    expect(decide({ ...pass, confidence: 0.85 }, criteria).action).toBe("release")
  })

  it("escalates to the jury below threshold, whatever the model says", () => {
    const d = decide({ ...pass, confidence: 0.849 }, criteria)
    expect(d.action).toBe("escalate")
    expect(d.reason).toMatch(/below the 0.85/)
    expect(decide({ ...pass, verdict: "dispute", unmatched_criteria: criteria.slice(0, 1), confidence: 0.6 }, criteria).action).toBe("escalate")
  })

  it("proposes refund on a confident dispute that names an unmet criterion", () => {
    expect(decide({ ...pass, verdict: "dispute", matched_criteria: criteria.slice(1), unmatched_criteria: criteria.slice(0, 1), confidence: 0.99 }, criteria).action).toBe("refund")
  })

  it("escalates a dispute verdict that names no unmet criterion (inconsistent)", () => {
    expect(decide({ ...pass, verdict: "dispute", confidence: 0.99 }, criteria).action).toBe("escalate")
  })

  it("escalates when release verdict lists unmatched criteria (inconsistent)", () => {
    expect(decide({ ...pass, unmatched_criteria: ["Contact form sends email"] }, criteria).action).toBe("escalate")
  })

  it("escalates when the model silently omits an agreed criterion", () => {
    const d = decide({ ...pass, matched_criteria: criteria.slice(0, 2) }, criteria)
    expect(d.action).toBe("escalate")
    expect(d.reason).toContain("Contact form sends email")
  })

  it("tolerates case/whitespace/trailing punctuation differences only", () => {
    const d = decide({ ...pass, matched_criteria: ["landing page has a  hero section.", "SITE IS RESPONSIVE ON MOBILE", "Contact form sends email;"] }, criteria)
    expect(d.action).toBe("release")
  })

  it("does not accept a truncated criterion as a match", () => {
    const d = decide({ ...pass, matched_criteria: ["Landing page", "Site is responsive on mobile", "Contact form sends email"] }, criteria)
    expect(d.action).toBe("escalate")
  })
})

describe("jury tally", () => {
  const juror = (vote: JurorResult["vote"], extra: Partial<JurorResult> = {}): JurorResult => ({
    provider: "groq",
    model: "m",
    ok: vote !== null,
    error: vote === null ? "HTTP 503" : null,
    ms: 1,
    vote,
    confidence: 0.9,
    matched_criteria: [],
    unmatched_criteria: [],
    reasoning: "reasoning with enough detail",
    ...extra,
  })
  it("needs a strict majority of the whole panel", () => {
    expect(tally([juror("release"), juror("release"), juror("refund")]).outcome).toBe("release")
    expect(tally([juror("refund"), juror("refund"), juror("abstain")]).outcome).toBe("refund")
    expect(tally([juror("release"), juror("refund"), juror("abstain")]).outcome).toBe("split")
  })
  it("failed jurors count against a majority, so outages go to a human", () => {
    expect(tally([juror("release"), juror(null), juror(null)]).outcome).toBe("split")
    expect(tally([juror("release"), juror("release"), juror(null)]).outcome).toBe("release")
  })
  it("a release vote that lists unmet criteria is an abstention", () => {
    const t = tally([juror("release", { unmatched_criteria: ["x"] }), juror("release"), juror("refund")])
    expect(t.counts).toEqual({ release: 1, refund: 1, abstain: 1, failed: 0 })
    expect(t.outcome).toBe("split")
  })
  it("parses juror JSON strictly", () => {
    expect(parseJurorVote(JSON.stringify({ vote: "refund", confidence: 0.8, matched_criteria: [], unmatched_criteria: ["a"], reasoning: "The form does not submit anywhere." })).vote).toBe("refund")
    expect(() => parseJurorVote(JSON.stringify({ vote: "release" }))).toThrow(/schema/)
    expect(() => parseJurorVote("sure, release it")).toThrow(/non-JSON/)
  })
})

describe("parseVerdict (strict JSON contract)", () => {
  it("accepts a valid verdict and a fenced block", () => {
    expect(parseVerdict(JSON.stringify(pass)).verdict).toBe("release")
    expect(parseVerdict("```json\n" + JSON.stringify(pass) + "\n```").confidence).toBe(0.93)
  })
  it("rejects non-JSON", () => expect(() => parseVerdict("Looks good to me!")).toThrow(/non-JSON/))
  it("rejects extra keys, out-of-range confidence, bad verdict, empty reasoning", () => {
    expect(() => parseVerdict(JSON.stringify({ ...pass, extra: 1 }))).toThrow(/schema/)
    expect(() => parseVerdict(JSON.stringify({ ...pass, confidence: 1.2 }))).toThrow(/schema/)
    expect(() => parseVerdict(JSON.stringify({ ...pass, verdict: "approve" }))).toThrow(/schema/)
    expect(() => parseVerdict(JSON.stringify({ ...pass, reasoning: "ok" }))).toThrow(/schema/)
  })
})
