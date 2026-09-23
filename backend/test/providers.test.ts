import { describe, expect, it, vi } from "vitest"
import { geminiProvider, groqProvider } from "../src/ai/providers"
import type { VerificationInput } from "../src/ai/schema"
import { AiUnavailableError, createVerifier } from "../src/ai/verifier"

const input: VerificationInput = {
  job: { title: "Logo", deliverable_description: "A logo", acceptance_criteria: ["SVG file delivered"], due_date: "2030-01-01" },
  submission: { submitted_at: "2029-12-01", deliverable_url: null, file_reference: null, description: "Here is the logo", notes: null },
  evidence: { status: "not_provided", source_url: null, note: null, content_excerpt: null },
}
const verdict = {
  verdict: "dispute",
  confidence: 0.4,
  matched_criteria: [],
  unmatched_criteria: ["SVG file delivered"],
  reasoning: "No link or file content was provided, so the SVG cannot be verified from evidence.",
}

const groqOk = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), { status: 200 })
const geminiOk = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] }), { status: 200 })

describe("AI providers", () => {
  it("Groq sends strict JSON mode at temperature 0 and parses the verdict", async () => {
    const fetchFn = vi.fn(async () => groqOk(JSON.stringify(verdict)))
    const r = await groqProvider({ apiKey: "k", model: "llama-3.3-70b-versatile", fetchFn: fetchFn as any }).evaluate(input)
    expect(r.verdict).toBe("dispute")
    const body = JSON.parse((fetchFn.mock.calls[0] as any)[1].body)
    expect(body.response_format).toEqual({ type: "json_object" })
    expect(body.temperature).toBe(0)
    expect(body.messages[1].content).toContain("<submission_data>")
  })

  it("Gemini uses responseSchema and parses the verdict", async () => {
    const fetchFn = vi.fn(async () => geminiOk(JSON.stringify(verdict)))
    const r = await geminiProvider({ apiKey: "k", model: "gemini-2.5-flash", fetchFn: fetchFn as any }).evaluate(input)
    expect(r.confidence).toBe(0.4)
    const body = JSON.parse((fetchFn.mock.calls[0] as any)[1].body)
    expect(body.generationConfig.responseMimeType).toBe("application/json")
    expect(body.generationConfig.responseSchema.required).toContain("reasoning")
  })
})

describe("verifier fallback", () => {
  it("falls back to Gemini when Groq is rate limited", async () => {
    const groq = groqProvider({ apiKey: "k", model: "g", fetchFn: (async () => new Response("rate limited", { status: 429 })) as any })
    const gem = geminiProvider({ apiKey: "k", model: "m", fetchFn: (async () => geminiOk(JSON.stringify(verdict))) as any })
    const r = await createVerifier([groq, gem]).verify(input)
    expect(r.provider).toBe("gemini")
    expect(r.attempts.map((a) => [a.provider, a.ok])).toEqual([["groq", false], ["gemini", true]])
    expect(r.attempts[0].error).toMatch(/429/)
  })

  it("falls back when Groq returns output that violates the schema", async () => {
    const groq = groqProvider({ apiKey: "k", model: "g", fetchFn: (async () => groqOk('{"verdict":"yes"}')) as any })
    const gem = geminiProvider({ apiKey: "k", model: "m", fetchFn: (async () => geminiOk(JSON.stringify(verdict))) as any })
    const r = await createVerifier([groq, gem]).verify(input)
    expect(r.provider).toBe("gemini")
    expect(r.attempts[0].error).toMatch(/schema/)
  })

  it("does NOT ask the fallback when the primary returns a valid dispute", async () => {
    const gemFetch = vi.fn()
    const groq = groqProvider({ apiKey: "k", model: "g", fetchFn: (async () => groqOk(JSON.stringify(verdict))) as any })
    const gem = geminiProvider({ apiKey: "k", model: "m", fetchFn: gemFetch as any })
    const r = await createVerifier([groq, gem]).verify(input)
    expect(r.provider).toBe("groq")
    expect(gemFetch).not.toHaveBeenCalled()
  })

  it("throws AiUnavailableError with every attempt when all providers fail", async () => {
    const groq = groqProvider({ apiKey: "k", model: "g", fetchFn: (async () => new Response("boom", { status: 500 })) as any })
    const gem = geminiProvider({ apiKey: "k", model: "m", fetchFn: (async () => { throw new Error("network down") }) as any })
    const err = await createVerifier([groq, gem]).verify(input).catch((e) => e)
    expect(err).toBeInstanceOf(AiUnavailableError)
    expect(err.attempts).toHaveLength(2)
    expect(err.message).toMatch(/groq.*500.*gemini.*network down/s)
  })
})
