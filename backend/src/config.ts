import { readFileSync } from "node:fs"
import { z } from "zod"

const hex = (len?: number) => z.string().regex(len ? new RegExp(`^0x[0-9a-fA-F]{${len}}$`) : /^0x[0-9a-fA-F]+$/)

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  ARBITRUM_SEPOLIA_RPC_URL: z.string().url().default("https://sepolia-rollup.arbitrum.io/rpc"),
  RELAYER_PRIVATE_KEY: hex(64),
  ESCROW_ADDRESS: hex(40),

  // Firebase Admin: either a path to the service-account JSON, or the three fields inline.
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),

  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
})

export type Config = ReturnType<typeof loadConfig>

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    throw new Error(`Invalid backend environment (see backend/.env.example):\n${lines.join("\n")}`)
  }
  const e = parsed.data
  if (!e.GROQ_API_KEY && !e.GEMINI_API_KEY) {
    throw new Error("Set GROQ_API_KEY (primary) and/or GEMINI_API_KEY (fallback); the AI layer cannot run without one")
  }

  let firebase: { projectId: string; clientEmail: string; privateKey: string }
  if (e.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const sa = JSON.parse(readFileSync(e.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8"))
    firebase = { projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }
  } else if (e.FIREBASE_PROJECT_ID && e.FIREBASE_CLIENT_EMAIL && e.FIREBASE_PRIVATE_KEY) {
    firebase = { projectId: e.FIREBASE_PROJECT_ID, clientEmail: e.FIREBASE_CLIENT_EMAIL, privateKey: e.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") }
  } else {
    throw new Error("Set FIREBASE_SERVICE_ACCOUNT_PATH, or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY")
  }

  return {
    port: e.PORT,
    corsOrigins: e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    rpcUrl: e.ARBITRUM_SEPOLIA_RPC_URL,
    relayerPrivateKey: e.RELAYER_PRIVATE_KEY as `0x${string}`,
    escrowAddress: e.ESCROW_ADDRESS as `0x${string}`,
    firebase,
    groq: e.GROQ_API_KEY ? { apiKey: e.GROQ_API_KEY, model: e.GROQ_MODEL } : null,
    gemini: e.GEMINI_API_KEY ? { apiKey: e.GEMINI_API_KEY, model: e.GEMINI_MODEL } : null,
  }
}
