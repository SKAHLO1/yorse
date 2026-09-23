import { fetchEvidence } from "./ai/evidence"
import { geminiProvider, groqProvider, type AiProvider } from "./ai/providers"
import { createVerifier } from "./ai/verifier"
import { createApp } from "./app"
import { createFirebaseAuthService } from "./auth"
import { createEscrowChain } from "./chain/escrow"
import { loadConfig } from "./config"
import { initFirebase } from "./firebase"
import { createFirestoreStore } from "./store/firestore"

async function main() {
  const cfg = loadConfig()
  const fb = initFirebase(cfg.firebase)

  const providers: AiProvider[] = []
  if (cfg.groq) providers.push(groqProvider(cfg.groq)) // primary
  if (cfg.gemini) providers.push(geminiProvider(cfg.gemini)) // fallback

  const chain = await createEscrowChain({ rpcUrl: cfg.rpcUrl, relayerPrivateKey: cfg.relayerPrivateKey, escrowAddress: cfg.escrowAddress })

  const app = createApp({
    store: createFirestoreStore(fb.db),
    auth: createFirebaseAuthService(fb.auth),
    chain,
    ai: createVerifier(providers),
    fetchEvidence,
    corsOrigins: cfg.corsOrigins,
  })

  app.listen(cfg.port, () => {
    console.log(`Yorse backend on :${cfg.port}`)
    console.log(`  escrow  ${chain.escrowAddress} (Arbitrum Sepolia)`)
    console.log(`  relayer ${chain.relayerAddress}`)
    console.log(`  AI      ${providers.map((p) => `${p.name}:${p.model}`).join(" -> ")}`)
  })
}

main().catch((err) => {
  console.error(`Failed to start: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
