import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt"
import { parseVerdict, verdictJsonSchemaGemini, type VerdictResult, type VerificationInput } from "./schema"

export type ProviderName = "groq" | "gemini"

/** An image the model should look at (e.g. a screenshot of the deliverable). */
export interface ImagePart {
  mimeType: "image/png" | "image/jpeg"
  base64: string
}

export interface GenerateRequest {
  system: string
  user: string
  /** Gemini responseSchema; Groq uses plain JSON mode. */
  geminiSchema: unknown
  images?: ImagePart[]
}

export interface AiProvider {
  name: ProviderName
  model: string
  /** Whether this model accepts images. Text-only models never receive screenshots. */
  vision: boolean
  /** Raw JSON text from the model. Callers parse and validate it. Images are dropped for text-only models. */
  generate(req: GenerateRequest): Promise<string>
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
  // Free tiers hit short token-per-minute limits (a jury sends three requests at once); a couple of
  // brief waits beat failing the whole verification.
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
    const wait = res.status === 429 && attempt < 2 ? retryDelayMs(res, text) : null
    if (wait === null) {
      throw new ProviderError(provider, `HTTP ${res.status}: ${text.slice(0, 300)}`, res.status, res.status === 429)
    }
    console.warn(`[ai] ${provider} rate limited, retry ${attempt + 1}/2 in ${wait}ms`)
    await new Promise((r) => setTimeout(r, wait))
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new ProviderError(provider, `non-JSON response body: ${text.slice(0, 200)}`, res.status)
  }
}

/** Wraps a raw `generate` with the verdict prompt + schema; any parse failure is a provider failure. */
function withEvaluate(name: ProviderName, model: string, vision: boolean, rawGenerate: AiProvider["generate"]): AiProvider {
  const generate: AiProvider["generate"] = (req) => rawGenerate(vision ? req : { ...req, images: undefined })
  return {
    name,
    model,
    vision,
    generate,
    async evaluate(input) {
      const text = await generate({ system: SYSTEM_PROMPT, user: buildUserPrompt(input, vision), geminiSchema: verdictJsonSchemaGemini, images: input.images })
      try {
        return parseVerdict(text)
      } catch (err) {
        throw new ProviderError(name, (err as Error).message)
      }
    },
  }
}

/** Groq (OpenAI-compatible). Default model: GPT-OSS 120B. */
export function groqProvider(opts: { apiKey: string; model: string; fetchFn?: FetchFn }): AiProvider {
  const fetchFn = opts.fetchFn ?? fetch
  // Groq's vision-capable models are the Llama 4 family; everything else is text-only.
  return withEvaluate("groq", opts.model, /llama-4|vision/i.test(opts.model), async (req) => {
    const user = req.images?.length
      ? [{ type: "text", text: req.user }, ...req.images.map((im) => ({ type: "image_url", image_url: { url: `data:${im.mimeType};base64,${im.base64}` } }))]
      : req.user
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
          { role: "system", content: req.system },
          { role: "user", content: user },
        ],
      },
    )
    const content: unknown = data?.choices?.[0]?.message?.content
    if (typeof content !== "string" || !content.trim()) {
      throw new ProviderError("groq", `empty completion (finish_reason=${data?.choices?.[0]?.finish_reason ?? "?"})`)
    }
    return content
  })
}

/** Google Gemini (AI Studio). Uses schema-constrained JSON output. */
export function geminiProvider(opts: { apiKey: string; model: string; fetchFn?: FetchFn }): AiProvider {
  const fetchFn = opts.fetchFn ?? fetch
  return withEvaluate("gemini", opts.model, true, async (req) => {
    const parts = [{ text: req.user }, ...(req.images ?? []).map((im) => ({ inline_data: { mime_type: im.mimeType, data: im.base64 } }))]
    const data = await postJson(
      "gemini",
      fetchFn,
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`,
      { "x-goog-api-key": opts.apiKey },
      {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          responseSchema: req.geminiSchema,
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
    return text
  })
}

/** Builds a provider from a "provider:model" spec, e.g. "groq:llama-3.3-70b-versatile". */
export function providerFromSpec(spec: string, keys: { groq?: string; gemini?: string }, fetchFn?: FetchFn): AiProvider {
  const i = spec.indexOf(":")
  const name = spec.slice(0, i).trim()
  const model = spec.slice(i + 1).trim()
  if (i < 1 || !model) throw new Error(`Invalid model spec "${spec}" (expected provider:model)`)
  if (name === "groq") {
    if (!keys.groq) throw new Error(`"${spec}" needs GROQ_API_KEY`)
    return groqProvider({ apiKey: keys.groq, model, fetchFn })
  }
  if (name === "gemini") {
    if (!keys.gemini) throw new Error(`"${spec}" needs GEMINI_API_KEY`)
    return geminiProvider({ apiKey: keys.gemini, model, fetchFn })
  }
  throw new Error(`Unknown AI provider "${name}" in "${spec}" (use groq or gemini)`)
}
