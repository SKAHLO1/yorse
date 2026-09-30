import { fetchEvidence } from "./ai/evidence"
import { createJury } from "./ai/jury"
import { geminiProvider, groqProvider, providerFromSpec, type AiProvider } from "./ai/providers"
import { createVerifier } from "./ai/verifier"
import { createApp } from "./app"
import { createFirebaseAuthService } from "./auth"
import { createEscrowChain } from "./chain/escrow"
import { loadConfig } from "./config"
import { initFirebase } from "./firebase"
import { createKeeper } from "./services/keeper"
import { createFirestoreStore } from "./store/firestore"

async function main() {
  const cfg = loadConfig()
  const fb = initFirebase(cfg.firebase)

  const providers: AiProvider[] = []
  if (cfg.groq) providers.push(groqProvider(cfg.groq)) // primary
  if (cfg.gemini) providers.push(geminiProvider(cfg.gemini)) // fallback

  const keys = { groq: cfg.groq?.apiKey, gemini: cfg.gemini?.apiKey }
  const jury = createJury(cfg.juryModels.map((spec) => providerFromSpec(spec, keys)))

  const chain = await createEscrowChain({ rpcUrl: cfg.rpcUrl, relayerPrivateKey: cfg.relayerPrivateKey, escrowAddress: cfg.escrowAddress })

  const store = createFirestoreStore(fb.db)
  const app = createApp({
    store,
    auth: createFirebaseAuthService(fb.auth),
    chain,
    ai: createVerifier(providers),
    jury,
    fetchEvidence,
    argumentWindowSeconds: cfg.argumentWindowSeconds,
    corsOrigins: cfg.corsOrigins,
  })
  createKeeper({ store, jobs: app.jobs, intervalMs: cfg.keeperIntervalMs }).start()

  app.listen(cfg.port, () => {
    console.log(`Yorse backend on :${cfg.port}`)
    console.log(`  escrow  ${chain.escrowAddress} (Arbitrum Sepolia)`)
    console.log(`  relayer ${chain.relayerAddress}`)
    console.log(`  AI      ${providers.map((p) => `${p.name}:${p.model}`).join(" -> ")}`)
    console.log(`  jury    ${jury.jurors.map((j) => `${j.name}:${j.model}`).join(", ")}`)
    const p = chain.params
    console.log(
      `  arbitration: ${p.challengeWindowSeconds}s challenge window, ${p.bondBps / 100}% bond, ${cfg.argumentWindowSeconds}s arguments, ${p.relayerTimeoutSeconds}s relayer timeout`,
    )
  })
}

main().catch((err) => {
  console.error(`Failed to start: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
