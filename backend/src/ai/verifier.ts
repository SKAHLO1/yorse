import type { AiProvider, ProviderName } from "./providers"
import type { VerdictResult, VerificationInput } from "./schema"

export interface AttemptLog {
  provider: ProviderName
  model: string
  ok: boolean
  error: string | null
  ms: number
}

export interface VerifierResult {
  result: VerdictResult
  provider: ProviderName
  model: string
  attempts: AttemptLog[]
}

/** Every provider failed. Carries each attempt so the error can be surfaced, never swallowed. */
export class AiUnavailableError extends Error {
  constructor(public attempts: AttemptLog[]) {
    super(
      attempts.length === 0
        ? "No AI provider is configured (set GROQ_API_KEY and/or GEMINI_API_KEY)"
        : `All AI providers failed: ${attempts.map((a) => `${a.provider}(${a.model}): ${a.error}`).join(" | ")}`,
    )
  }
}

export interface AiVerifier {
  readonly providers: { name: ProviderName; model: string }[]
  verify(input: VerificationInput): Promise<VerifierResult>
}

/**
 * Tries providers in order (Groq, then Gemini). Falls back only on provider failure
 * (HTTP error, rate limit, timeout, malformed/invalid JSON). A valid verdict is final:
 * we never ask a second model because we disliked the first answer.
 */
export function createVerifier(providers: AiProvider[]): AiVerifier {
  return {
    providers: providers.map((p) => ({ name: p.name, model: p.model })),
    async verify(input) {
      const attempts: AttemptLog[] = []
      for (const p of providers) {
        const started = Date.now()
        try {
          const result = await p.evaluate(input)
          attempts.push({ provider: p.name, model: p.model, ok: true, error: null, ms: Date.now() - started })
          return { result, provider: p.name, model: p.model, attempts }
        } catch (err) {
          const msg = (err as Error).message
          attempts.push({ provider: p.name, model: p.model, ok: false, error: msg, ms: Date.now() - started })
          console.warn(`[ai] ${p.name} failed, ${providers.indexOf(p) < providers.length - 1 ? "falling back" : "no fallback left"}: ${msg}`)
        }
      }
      throw new AiUnavailableError(attempts)
    },
  }
}
