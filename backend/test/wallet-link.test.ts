import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { describe, expect, it } from "vitest"
import { ChainError } from "../src/chain/escrow"
import { setup } from "./helpers"

describe("wallet linking", () => {
  it("an RPC failure while checking a smart-wallet signature is reported as such, never as a wrong signature", async () => {
    const s = setup()
    const u = await s.user("u", { wallet: false })
    s.chain.verifySignature = async () => {
      throw new ChainError("verifySignature", "Could not check the wallet signature on-chain: HTTP 429 Too Many Requests")
    }
    const ch = await u.post("/api/me/wallet/challenge")
    const signature = await u.account.signMessage({ message: ch.body.message })
    const r = await u.post("/api/me/wallet", { address: u.account.address, signature })
    expect(r.status).toBe(502)
    expect(r.body.error.code).toBe("chain_error")
    expect(r.body.error.message).toMatch(/429/)
    expect(r.body.error.message).not.toMatch(/does not match/)
  })

  it("a genuinely wrong signature is still rejected as one", async () => {
    const s = setup()
    const u = await s.user("u", { wallet: false })
    const ch = await u.post("/api/me/wallet/challenge")
    const other = privateKeyToAccount(generatePrivateKey())
    const r = await u.post("/api/me/wallet", { address: u.account.address, signature: await other.signMessage({ message: ch.body.message }) })
    expect(r.status).toBe(400)
    expect(r.body.error.message).toMatch(/does not match/)
  })
})
