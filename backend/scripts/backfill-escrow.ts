/**
 * One-off: records on each funded job the escrow contract that actually holds it, taken from the
 * funding transaction's receipt. Needed for jobs funded before jobs stored `escrowAddress`, so
 * they stay readable (and their on-chain proof stays verifiable) after the escrow is redeployed.
 *
 *   pnpm tsx --env-file=.env scripts/backfill-escrow.ts            # dry run
 *   pnpm tsx --env-file=.env scripts/backfill-escrow.ts --write
 */
import { createPublicClient, getAddress, http, type Hex } from "viem"
import { arbitrumSepolia } from "viem/chains"
import { initFirebase } from "../src/firebase"
import { loadFirebaseOnly } from "./firebase-env"

const write = process.argv.includes("--write")
const { db } = initFirebase(loadFirebaseOnly())
const pub = createPublicClient({ chain: arbitrumSepolia, transport: http(process.env.ARBITRUM_SEPOLIA_RPC_URL) })

let updated = 0
for (const doc of (await db.collection("jobs").get()).docs) {
  const job = doc.data() as { id: string; title: string; status: string; fundTxHash?: string | null; escrowAddress?: string | null }
  if (job.escrowAddress) continue
  if (!job.fundTxHash || !/^0x[0-9a-fA-F]{64}$/.test(job.fundTxHash)) {
    console.log(`skip  ${job.id} (${job.status}): no funding tx`)
    continue
  }
  const receipt = await pub.getTransactionReceipt({ hash: job.fundTxHash as Hex }).catch(() => null)
  if (!receipt?.to) {
    console.log(`skip  ${job.id}: funding tx not found on Arbitrum Sepolia`)
    continue
  }
  const escrow = getAddress(receipt.to)
  console.log(`${write ? "set " : "would set"} ${job.id} "${job.title}" (${job.status}) → ${escrow}`)
  if (write) await doc.ref.update({ escrowAddress: escrow })
  updated++
}
console.log(`\n${updated} job(s) ${write ? "updated" : "to update (dry run; pass --write)"}`)
process.exit(0)
