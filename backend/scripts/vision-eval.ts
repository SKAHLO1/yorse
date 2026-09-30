/**
 * LIVE check of browser evidence + vision: real pages are opened in headless Chromium, screenshotted
 * at desktop and mobile sizes, and judged by the real vision model (Gemini) through the production
 * verifier and decision rule. No scripted output.
 *
 *   pnpm vision:eval
 *
 * Exit code 1 on a safety failure (a visual mismatch proposed for release) or if the SSRF guard lets
 * the browser reach a private address.
 */
import { writeFileSync, mkdirSync } from "node:fs"
import { closeBrowser } from "../src/ai/browser"
import { decide } from "../src/ai/decision"
import { fetchEvidence } from "../src/ai/evidence"
import { geminiProvider, groqProvider, type AiProvider } from "../src/ai/providers"
import type { VerificationInput } from "../src/ai/schema"
import { createVerifier } from "../src/ai/verifier"

const providers: AiProvider[] = []
if (process.env.GROQ_API_KEY) providers.push(groqProvider({ apiKey: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b" }))
if (process.env.GEMINI_API_KEY) providers.push(geminiProvider({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash" }))
if (!providers.some((p) => p.vision)) {
  console.error("No vision-capable provider configured (set GEMINI_API_KEY)")
  process.exit(1)
}
const verifier = createVerifier(providers)

type Case = { name: string; url: string; expect: "release" | "not-release"; job: VerificationInput["job"] }
const due = "2030-01-01T00:00:00.000Z"
const cases: Case[] = [
  {
    name: "Simple page that meets visual + text criteria (example.com)",
    url: "https://example.com",
    expect: "release",
    job: {
      title: "Placeholder domain page",
      deliverable_description: "A minimal placeholder page for a reserved example domain.",
      acceptance_criteria: [
        "The page shows one short paragraph of centered text on a plain light background",
        'The page has a "Learn more" link below the paragraph',
        "The page is readable on a mobile-width screen without horizontal scrolling",
      ],
      due_date: due,
    },
  },
  {
    name: "Visual-only mismatch: the text could pass, the look cannot (example.com)",
    url: "https://example.com",
    expect: "not-release",
    job: {
      title: "Launch landing page",
      deliverable_description: "A bold landing page for the Example Domain launch.",
      acceptance_criteria: [
        'The page has a "Learn more" link',
        "The hero section has a full-width photograph or illustration behind the heading",
        "There is a prominent orange call-to-action button",
      ],
      due_date: due,
    },
  },
]

let safety = 0
mkdirSync("vision-eval-out", { recursive: true })
for (const c of cases) {
  const { screenshots = [], ...evidence } = await fetchEvidence(c.url)
  console.log(`\n▶ ${c.name}  [expect ${c.expect}]`)
  console.log(`  evidence: ${evidence.status}; ${evidence.note}`)
  for (const s of screenshots) {
    const file = `vision-eval-out/${c.url.replace(/\W+/g, "_")}-${s.label}.jpg`
    writeFileSync(file, Buffer.from(s.base64, "base64"))
    console.log(`  screenshot ${s.label} ${s.width}x${s.height} ${Math.round((s.base64.length * 3) / 4 / 1024)}KB → ${file}`)
  }
  if (!screenshots.length) {
    console.log("  ✗ no screenshots captured")
    safety++
    continue
  }
  const input: VerificationInput = {
    job: c.job,
    submission: { submitted_at: new Date().toISOString(), deliverable_url: c.url, file_reference: null, description: "Deployed as agreed; see the live page.", notes: null },
    evidence,
    images: screenshots.map((s) => ({ mimeType: s.mimeType, base64: s.base64 })),
  }
  const out = await verifier.verify(input)
  const d = decide(out.result, c.job.acceptance_criteria)
  const pass = c.expect === "release" ? d.action === "release" : d.action !== "release"
  if (c.expect === "not-release" && d.action === "release") safety++
  console.log(`  ${pass ? "✓" : c.expect === "not-release" ? "✗ SAFETY" : "~ conservative"} answered by ${out.provider}:${out.model} → ${out.result.verdict}@${out.result.confidence.toFixed(2)} → ${d.action}`)
  console.log(`    unmatched: ${JSON.stringify(out.result.unmatched_criteria)}`)
  console.log(`    reasoning: ${out.result.reasoning.slice(0, 400)}`)
}

console.log("\n▶ SSRF guard: the browser must never open a private address")
for (const u of ["http://127.0.0.1:4000/health", "http://169.254.169.254/latest/meta-data/", "http://localhost:3000"]) {
  const e = await fetchEvidence(u)
  const blocked = e.status === "failed" && !e.screenshots
  if (!blocked) safety++
  console.log(`  ${blocked ? "✓ blocked" : "✗ REACHED"} ${u}: ${e.note}`)
}

await closeBrowser()
console.log(`\nSummary: ${safety} safety failure(s).`)
process.exit(safety ? 1 : 0)
