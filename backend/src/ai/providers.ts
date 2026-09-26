import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt"
import { parseVerdict, verdictJsonSchemaGemini, type VerdictResult, type VerificationInput } from "./schema"

export type ProviderName = "groq" | "gemini"

export interface AiProvider {
  name: ProviderName
  model: string
  evaluate(input: VerificationInput): Promise<VerdictResult>
}

export class ProviderError extends Error {
  constructor(
    public provider: ProviderName,
    message: string,
    public status: number | null = null,
    public rateLimited = false,
  ) {
    super(message)
  }
}

type FetchFn = typeof fetch
const TIMEOUT_MS = 45_000
/** Longer than this and it is better to fall back to the other provider. */
const MAX_RETRY_WAIT_S = 12

/** Seconds to wait from a 429, using the retry-after header or the "try again in 3.3s" hint. Capped. */
function retryDelayMs(res: Response, body: string): number | null {
  const header = Number(res.headers.get("retry-after"))
  const fromBody = body.match(/try again in ([\d.]+)\s*(ms|s)\b/i)
  const seconds = Number.isFinite(header) && header > 0 ? header : fromBody ? Number(fromBody[1]) / (fromBody[2].toLowerCase() === "ms" ? 1000 : 1) : null
  if (seconds === null || !Number.isFinite(seconds)) return null
  return seconds <= MAX_RETRY_WAIT_S ? Math.ceil(seconds * 1000) + 250 : null
}

async function postJson(provider: ProviderName, fetchFn: FetchFn, url: string, headers: Record<string, string>, body: unknown) {
  let res: Response
  let text: string
  // Free tiers hit short token-per-minute limits; one brief wait beats failing the whole verification.
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      throw new ProviderError(provider, `request failed: ${(err as Error).message}`)
    }
    text = await res.text()
    if (res.ok) break
    const wait = res.status === 429 && attempt === 0 ? retryDelayMs(res, text) : null
    if (wait === null) {
      throw new ProviderError(provider, `HTTP ${res.status}: ${text.slice(0, 300)}`, res.status, res.status === 429)
    }
    console.warn(`[ai] ${provider} rate limited, retrying once in ${wait}ms`)
    await new Promise((r) => setTimeout(r, wait))
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new ProviderError(provider, `non-JSON response body: ${text.slice(0, 200)}`, res.status)
  }
}

/** Groq (OpenAI-compatible). Default model: GPT-OSS 120B. */
export function groqProvider(opts: { apiKey: string; model: string; fetchFn?: FetchFn }): AiProvider {
  const fetchFn = opts.fetchFn ?? fetch
  return {
    name: "groq",
    model: opts.model,
    async evaluate(input) {
      const data = await postJson(
        "groq",
        fetchFn,
        "https://api.groq.com/openai/v1/chat/completions",
        { authorization: `Bearer ${opts.apiKey}` },
        {
          model: opts.model,
          temperature: 0,
          max_completion_tokens: 2048,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(input) },
          ],
        },
      )
      const content: unknown = data?.choices?.[0]?.message?.content
      if (typeof content !== "string" || !content.trim()) {
        throw new ProviderError("groq", `empty completion (finish_reason=${data?.choices?.[0]?.finish_reason ?? "?"})`)
      }
      try {
        return parseVerdict(content)
      } catch (err) {
        throw new ProviderError("groq", (err as Error).message)
      }
    },
  }
}

/** Google Gemini (AI Studio). Uses schema-constrained JSON output. */
export function geminiProvider(opts: { apiKey: string; model: string; fetchFn?: FetchFn }): AiProvider {
  const fetchFn = opts.fetchFn ?? fetch
  return {
    name: "gemini",
    model: opts.model,
    async evaluate(input) {
      const data = await postJson(
        "gemini",
        fetchFn,
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`,
        { "x-goog-api-key": opts.apiKey },
        {
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: buildUserPrompt(input) }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
            responseSchema: verdictJsonSchemaGemini,
          },
        },
      )
      const block = data?.promptFeedback?.blockReason
      if (block) throw new ProviderError("gemini", `prompt blocked: ${block}`)
      const cand = data?.candidates?.[0]
      const text: unknown = cand?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("")
      if (typeof text !== "string" || !text.trim()) {
        throw new ProviderError("gemini", `empty completion (finishReason=${cand?.finishReason ?? "?"})`)
      }
      try {
        return parseVerdict(text)
      } catch (err) {
        throw new ProviderError("gemini", (err as Error).message)
      }
    },
  }
}
