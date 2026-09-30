import { chromium, type Browser } from "playwright"
import { hashText } from "../lib/commit"

/** A screenshot of the deliverable as a real browser rendered it. Stored with the verdict and shown to vision models. */
export interface Screenshot {
  label: "desktop" | "mobile"
  mimeType: "image/jpeg"
  base64: string
  width: number
  height: number
  /** keccak256 of the base64 payload; committed on-chain inside the verdict record. */
  hash: `0x${string}`
}

export interface RenderedPage {
  finalUrl: string
  title: string
  text: string
  screenshots: Screenshot[]
}

const VIEWPORTS = [
  { label: "desktop" as const, width: 1366, height: 850, isMobile: false, maxHeight: 2400 },
  { label: "mobile" as const, width: 390, height: 844, isMobile: true, maxHeight: 1800 },
]
const NAV_TIMEOUT_MS = 20_000
const SETTLE_MS = 1_500

let browserPromise: Promise<Browser> | null = null
function browser() {
  browserPromise ??= chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] }).catch((err) => {
    browserPromise = null
    throw err
  })
  return browserPromise
}

/**
 * Opens the deliverable in headless Chromium at desktop and mobile sizes. Every request the page
 * makes (redirects, scripts, images, XHR) passes the same SSRF guard as the plain fetcher, so a
 * submitted page can't make this server reach a private network.
 */
export async function renderPage(url: string, assertPublicUrl: (raw: string) => Promise<URL>, maxChars: number): Promise<RenderedPage> {
  const b = await browser()
  const allowed = new Map<string, Promise<boolean>>()
  const hostOk = (raw: string) => {
    const host = new URL(raw).host
    if (!allowed.has(host)) allowed.set(host, assertPublicUrl(raw).then(() => true, () => false))
    return allowed.get(host)!
  }

  const screenshots: Screenshot[] = []
  let text = ""
  let title = ""
  let finalUrl = url
  for (const vp of VIEWPORTS) {
    const context = await b.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
      hasTouch: vp.isMobile,
      deviceScaleFactor: 1,
      userAgent: vp.isMobile
        ? "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36 YorseVerifier/1.0"
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 YorseVerifier/1.0",
      serviceWorkers: "block",
      acceptDownloads: false,
    })
    try {
      await context.route("**/*", async (route) => {
        const u = route.request().url()
        if (u.startsWith("data:") || u.startsWith("blob:")) return route.continue()
        if (!/^https?:/i.test(u) || !(await hostOk(u))) return route.abort("blockedbyclient")
        return route.continue()
      })
      const page = await context.newPage()
      const res = await page.goto(url, { waitUntil: "load", timeout: NAV_TIMEOUT_MS })
      if (res && res.status() >= 400) throw new Error(`HTTP ${res.status()}`)
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined)
      await page.waitForTimeout(SETTLE_MS)
      if (vp.label === "desktop") {
        finalUrl = page.url()
        title = await page.title()
        text = (await page.evaluate<string>("document.body ? document.body.innerText : ''")).replace(/\n{3,}/g, "\n\n").trim().slice(0, maxChars)
      }
      const fullHeight = await page.evaluate<number>("document.documentElement.scrollHeight")
      const height = Math.min(Math.max(fullHeight, vp.height), vp.maxHeight)
      const buf = await page.screenshot({ type: "jpeg", quality: 55, fullPage: true, clip: { x: 0, y: 0, width: vp.width, height } })
      const base64 = buf.toString("base64")
      screenshots.push({ label: vp.label, mimeType: "image/jpeg", base64, width: vp.width, height, hash: hashText(base64) })
    } finally {
      await context.close()
    }
  }
  return { finalUrl, title, text, screenshots }
}

export async function closeBrowser() {
  if (!browserPromise) return
  const b = await browserPromise.catch(() => null)
  browserPromise = null
  await b?.close()
}
