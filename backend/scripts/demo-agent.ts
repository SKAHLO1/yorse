/**
 * A real autonomous freelancer agent for Yorse. No scripted outputs: an LLM (Groq) decides which
 * public jobs it can do, writes the pitch, writes the deliverable, publishes it as a public GitHub
 * Gist, submits it, and argues its case if the job goes to the AI jury. Payment arrives in the
 * agent's own wallet from the escrow.
 *
 * Env (backend/.env):
 *   GROQ_API_KEY            - the agent's brain
 *   AGENT_PRIVATE_KEY       - the agent's wallet (generated and printed on first run if missing)
 *   AGENT_GITHUB_TOKEN      - token with the "gist" scope; deliverables are published as PUBLIC gists
 *   AGENT_NAME              - default "Yorse Copy Agent"
 *   E2E_API_URL             - default http://localhost:4000
 *
 *   pnpm agent               # runs until stopped
 *   pnpm agent --once        # one pass, then exit
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import type { Hex } from "viem"

const API = process.env.E2E_API_URL ?? "http://localhost:4000"
const GROQ = process.env.GROQ_API_KEY
const GITHUB = process.env.AGENT_GITHUB_TOKEN
const NAME = process.env.AGENT_NAME ?? "Yorse Copy Agent"
const MODEL = process.env.AGENT_MODEL ?? "openai/gpt-oss-120b"
const STATE_DIR = ".agent"
const STATE_FILE = `${STATE_DIR}/state.json`
if (!GROQ) throw new Error("Set GROQ_API_KEY")

type State = { privateKey: Hex; apiKey?: string; handled: Record<string, string> }
function loadState(): State {
  if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8"))
  const pk = (process.env.AGENT_PRIVATE_KEY as Hex | undefined) ?? generatePrivateKey()
  return { privateKey: pk, handled: {} }
}
const state = loadState()
const save = () => {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}
const account = privateKeyToAccount(state.privateKey)
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)

async function http(method: string, path: string, body?: unknown, auth = true) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(auth && state.apiKey ? { authorization: `Bearer ${state.apiKey}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = (await res.json().catch(() => ({}))) as any
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${json?.error?.message ?? JSON.stringify(json)}`)
  return json
}

async function llm(system: string, user: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${GROQ}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    })
    const data = (await res.json()) as any
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 15_000))
      continue
    }
    if (!res.ok) throw new Error(`LLM ${res.status}: ${JSON.stringify(data).slice(0, 200)}`)
    return JSON.parse(data.choices[0].message.content)
  }
}

async function register() {
  if (state.apiKey) {
    try {
      await http("GET", "/api/me")
      return
    } catch {
      log("stored API key rejected; registering again")
    }
  }
  const ch = await http("POST", "/api/agents/challenge", { address: account.address }, false)
  const signature = await account.signMessage({ message: ch.message })
  const r = await http(
    "POST",
    "/api/agents/register",
    {
      address: account.address,
      signature,
      name: NAME,
      description: "An autonomous LLM agent that writes website copy, documentation and other text deliverables, published as public GitHub Gists.",
      homepage: null,
    },
    false,
  )
  state.apiKey = r.apiKey
  save()
  log(`registered as ${NAME}; payouts go to ${account.address}`)
}

const job2text = (j: any) =>
  JSON.stringify({ title: j.title, description: j.deliverableDescription, acceptance_criteria: j.acceptanceCriteria, amount_usdc: j.amountUsdc, due: j.dueDate }, null, 2)

async function considerFeed() {
  const { feed } = await http("GET", "/api/feed")
  for (const item of feed) {
    if (item.isMine || item.myApplicationStatus || state.handled[`apply:${item.id}`]) continue
    const { job } = await http("GET", `/api/jobs/${item.id}`)
    const d = await llm(
      `You are ${NAME}, an AI freelancer. You can ONLY produce text deliverables (copy, docs, specs, markdown) that you publish as a public web page. You cannot write and deploy running software, design images, or do anything needing accounts or physical action. Reply JSON: {"take": boolean, "reason": string, "pitch": string}. The pitch (60-120 words) must honestly say you are an AI agent and how you will meet each criterion.`,
      job2text(job),
    )
    state.handled[`apply:${item.id}`] = d.take ? "applied" : "skipped"
    save()
    if (!d.take) {
      log(`skip "${job.title}": ${d.reason}`)
      continue
    }
    await http("POST", `/api/jobs/${item.id}/applications`, { message: String(d.pitch).slice(0, 2000) })
    log(`applied to "${job.title}"`)
  }
}

async function publishGist(title: string, markdown: string) {
  if (!GITHUB) throw new Error("Set AGENT_GITHUB_TOKEN (gist scope) so the agent can publish its deliverable")
  const res = await fetch("https://api.github.com/gists", {
    method: "POST",
    headers: { authorization: `Bearer ${GITHUB}`, accept: "application/vnd.github+json", "content-type": "application/json" },
    body: JSON.stringify({ description: `${title} (delivered by ${NAME} via Yorse)`, public: true, files: { "deliverable.md": { content: markdown } } }),
  })
  const data = (await res.json()) as any
  if (!res.ok) throw new Error(`GitHub gist ${res.status}: ${data?.message}`)
  return data.html_url as string
}

async function workMyJobs() {
  const { jobs } = await http("GET", "/api/jobs")
  for (const j of jobs) {
    const key = `${j.status}:${j.id}`
    if (state.handled[key]) continue
    if (j.status === "pending_acceptance") {
      await http("POST", `/api/jobs/${j.id}/respond`, { accept: true })
      log(`accepted the terms of "${j.title}"`)
    } else if (j.status === "funded") {
      log(`"${j.title}" is funded; writing the deliverable`)
      const out = await llm(
        `You are ${NAME}. Write the complete deliverable for this job as Markdown. Satisfy EVERY acceptance criterion explicitly and visibly; do not describe what you would do, do it. Reply JSON: {"markdown": string, "summary": string} where summary (40-100 words) maps each criterion to where it is met.`,
        job2text(j),
      )
      const url = await publishGist(j.title, out.markdown)
      log(`published ${url}`)
      const r = await http("POST", `/api/jobs/${j.id}/submissions`, { deliverableUrl: url, description: String(out.summary).slice(0, 5000) })
      log(`submitted; AI decision: ${r.verification.ok ? r.verification.decision : `error (${r.verification.error})`}`)
    } else if (j.status === "challenged" && j.challenge && !j.challenge.arguments.freelancer) {
      const { verifications, submissions } = await http("GET", `/api/jobs/${j.id}`)
      const out = await llm(
        `You are ${NAME}, defending your deliverable before an AI jury. Be factual and specific: point to exactly where each acceptance criterion is met in your published deliverable. If a criterion is genuinely unmet, concede it. Reply JSON: {"argument": string} (80-200 words).`,
        JSON.stringify({ job: JSON.parse(job2text(j)), deliverable: submissions[0], client_argument: j.challenge.arguments.client, first_verdict: verifications[0]?.result }),
      )
      await http("POST", `/api/jobs/${j.id}/arguments`, { argument: String(out.argument).slice(0, 4000) })
      log(`argued before the jury on "${j.title}"`)
    } else if (j.status === "released" || j.status === "resolved_release") {
      log(`💸 paid ${j.amountUsdc} USDC for "${j.title}" → ${account.address}`)
    } else if (j.status === "refunded" || j.status === "resolved_refund") {
      log(`refunded to the client: "${j.title}"`)
    } else continue
    state.handled[key] = new Date().toISOString()
    save()
  }
}

async function main() {
  log(`${NAME} → ${API}; wallet ${account.address}`)
  await register()
  const once = process.argv.includes("--once")
  for (;;) {
    try {
      await considerFeed()
      await workMyJobs()
    } catch (err) {
      log(`error: ${(err as Error).message}`)
    }
    if (once) break
    await new Promise((r) => setTimeout(r, 15_000))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
