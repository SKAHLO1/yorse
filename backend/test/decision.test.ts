import { describe, expect, it } from "vitest"
import { decide, RELEASE_CONFIDENCE_THRESHOLD } from "../src/ai/decision"
import { parseVerdict } from "../src/ai/schema"

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

  it("releases on verdict=release, confidence >= 0.85, all criteria matched", () => {
    expect(decide(pass, criteria).action).toBe("release")
    expect(decide({ ...pass, confidence: 0.85 }, criteria).action).toBe("release")
  })

  it("disputes below threshold even when the model says release", () => {
    const d = decide({ ...pass, confidence: 0.849 }, criteria)
    expect(d.action).toBe("dispute")
    expect(d.reason).toMatch(/below the 0.85/)
  })

  it("disputes on a dispute verdict regardless of confidence", () => {
    expect(decide({ ...pass, verdict: "dispute", confidence: 0.99 }, criteria).action).toBe("dispute")
  })

  it("disputes when release verdict lists unmatched criteria (inconsistent)", () => {
    expect(decide({ ...pass, unmatched_criteria: ["Contact form sends email"] }, criteria).action).toBe("dispute")
  })

  it("disputes when the model silently omits an agreed criterion", () => {
    const d = decide({ ...pass, matched_criteria: criteria.slice(0, 2) }, criteria)
    expect(d.action).toBe("dispute")
    expect(d.reason).toContain("Contact form sends email")
  })

  it("tolerates case/whitespace/trailing punctuation differences only", () => {
    const d = decide({ ...pass, matched_criteria: ["landing page has a  hero section.", "SITE IS RESPONSIVE ON MOBILE", "Contact form sends email;"] }, criteria)
    expect(d.action).toBe("release")
  })

  it("does not accept a truncated criterion as a match", () => {
    const d = decide({ ...pass, matched_criteria: ["Landing page", "Site is responsive on mobile", "Contact form sends email"] }, criteria)
    expect(d.action).toBe("dispute")
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
