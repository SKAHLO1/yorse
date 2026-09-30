import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { renderPage, type Screenshot } from "./browser"
import type { VerificationInput } from "./schema"

const MAX_BYTES = 300_000
const MAX_CHARS = 14_000
const TIMEOUT_MS = 12_000

/** A host refused us for quota reasons; the message says how to fix it rather than implying the link is bad. */
export class RateLimitError extends Error {}

/** Text evidence for every model, plus screenshots for vision models when the page could be rendered. */
export type Evidence = VerificationInput["evidence"] & { screenshots?: Screenshot[] }
export type EvidenceFetcher = (url: string | null) => Promise<Evidence>

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number)
    return (
      a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    )
  }
  const v6 = ip.toLowerCase()
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7))
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80")
}

/** Rejects non-http(s) URLs and hosts resolving to private/loopback ranges (SSRF guard). */
async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw)
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("only http(s) links can be fetched")
  if (url.username || url.password) throw new Error("URLs with credentials are not fetched")
  const addrs = await lookup(url.hostname, { all: true })
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) throw new Error("link resolves to a private network address")
  return url
}

async function fetchText(raw: string, accept = "text/html,text/plain,application/json,*/*;q=0.5"): Promise<{ text: string; type: string; finalUrl: string }> {
  let current = raw
  for (let hop = 0; hop < 4; hop++) {
    const url = await assertPublicUrl(current)
    const res = await fetch(url, {
      redirect: "manual",
      headers: {
        accept,
        "user-agent": "YorseVerifier/1.0 (+escrow deliverable check)",
        // Optional: lifts GitHub's 60 req/h anonymous API limit.
        ...(url.hostname === "api.github.com" && process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, url).toString()
      continue
    }
    if (!res.ok) {
      // GitHub answers 403/429 with remaining=0 when the per-IP anonymous quota is spent.
      // Say so plainly: "not found" would send the AI (and the reader) down the wrong path.
      const exhausted = res.headers.get("x-ratelimit-remaining") === "0"
      if (url.hostname === "api.github.com" && (res.status === 403 || res.status === 429) && exhausted) {
        const reset = Number(res.headers.get("x-ratelimit-reset"))
        const mins = Number.isFinite(reset) ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60_000)) : null
        throw new RateLimitError(
          `GitHub API rate limit reached for this server's IP${mins ? ` (resets in ~${mins} min)` : ""}. Set GITHUB_TOKEN to raise it from 60 to 5000 requests/hour.`,
        )
      }
      throw new Error(`HTTP ${res.status}`)
    }
    const type = res.headers.get("content-type") ?? "unknown"
    if (!/text|json|xml|javascript|markdown/i.test(type)) throw new Error(`content type ${type} cannot be inspected as text`)
    const reader = res.body?.getReader()
    if (!reader) return { text: "", type, finalUrl: url.toString() }
    const chunks: Uint8Array[] = []
    let size = 0
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.byteLength
    }
    await reader.cancel().catch(() => undefined)
    return { text: Buffer.concat(chunks).toString("utf8"), type, finalUrl: url.toString() }
  }
  throw new Error("too many redirects")
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|\/p|\/div|\/h\d|\/li|\/tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
}

/** For public GitHub repos, the README and file tree are far better evidence than the HTML page. */
async function githubEvidence(url: URL): Promise<string | null> {
  const m = url.pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+).*)?\/?$/)
  if (url.hostname !== "github.com" || !m) return null
  const [, owner, repo, ref = "HEAD"] = m
  const parts: string[] = [`GitHub repository ${owner}/${repo} (ref ${ref})`]
  let found = 0
  try {
    const tree = await fetchText(`https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`, "application/vnd.github+json")
    const paths = (JSON.parse(tree.text).tree ?? []).map((t: { path: string }) => t.path).slice(0, 250)
    parts.push(`FILE TREE (${paths.length} shown):\n${paths.join("\n")}`)
    found++
  } catch (e) {
    parts.push(`FILE TREE: unavailable (${(e as Error).message})`)
  }
  try {
    const readme = await fetchText(`https://api.github.com/repos/${owner}/${repo}/readme`, "application/vnd.github.raw+json")
    parts.push(`README:\n${readme.text}`)
    found++
  } catch (e) {
    parts.push(`README: unavailable (${(e as Error).message})`)
  }
  if (found === 0) throw new Error(`GitHub repository ${owner}/${repo} is private, missing, or unreachable`)
  return parts.join("\n\n")
}

const browserEnabled = () => process.env.BROWSER_EVIDENCE !== "off"

export const fetchEvidence: EvidenceFetcher = async (raw) => {
  if (!raw) return { status: "not_provided", source_url: null, note: "No link was submitted; only the freelancer's description is available.", content_excerpt: null }
  let url: URL
  try {
    url = await assertPublicUrl(raw)
  } catch (err) {
    return { status: "failed", source_url: raw, note: `Could not fetch the submitted link: ${(err as Error).message}`, content_excerpt: null }
  }
  try {
    const gh = await githubEvidence(url)
    if (gh) return { status: "fetched", source_url: raw, note: "Fetched GitHub repository tree and README.", content_excerpt: gh.slice(0, MAX_CHARS) }
  } catch (err) {
    return { status: "failed", source_url: raw, note: `Could not fetch the submitted link: ${(err as Error).message}`, content_excerpt: null }
  }

  // Plain fetch first (cheap, works for text/JSON), then a real browser for anything that renders.
  let fetched: { body: string; type: string; finalUrl: string } | null = null
  let fetchError: string | null = null
  try {
    const { text, type, finalUrl } = await fetchText(raw)
    fetched = { body: /html/i.test(type) ? htmlToText(text) : text, type, finalUrl }
  } catch (err) {
    fetchError = (err as Error).message
  }

  let renderError: string | null = null
  if (browserEnabled() && (!fetched || /html/i.test(fetched.type))) {
    try {
      const page = await renderPage(raw, assertPublicUrl, MAX_CHARS)
      // The rendered DOM text includes everything client-side JavaScript produced.
      const text = page.text.length >= (fetched?.body.length ?? 0) / 2 ? page.text : fetched!.body.slice(0, MAX_CHARS)
      return {
        status: "fetched",
        source_url: page.finalUrl,
        note: `Opened in headless Chromium${page.title ? ` ("${page.title.slice(0, 80)}")` : ""}; text is the rendered page after JavaScript ran. Screenshots attached: ${page.screenshots.map((s) => `${s.label} ${s.width}x${s.height}`).join(", ")}.`,
        content_excerpt: text,
        screenshots: page.screenshots,
      }
    } catch (err) {
      renderError = (err as Error).message
    }
  }

  if (fetched) {
    const truncated = fetched.body.length > MAX_CHARS
    return {
      status: "fetched",
      source_url: fetched.finalUrl,
      note: `Fetched ${fetched.type}${truncated ? `; truncated to ${MAX_CHARS} characters` : ""}.${renderError ? ` The page could not be rendered in a browser (${renderError}), so no screenshots exist and JavaScript-rendered content may be missing.` : ""}`,
      content_excerpt: fetched.body.slice(0, MAX_CHARS),
    }
  }
  return {
    status: "failed",
    source_url: raw,
    note: `Could not fetch the submitted link: ${fetchError}${renderError ? `; browser render also failed: ${renderError}` : ""}`,
    content_excerpt: null,
  }
}
