import { formatUnits, parseUnits } from "viem"
import { USDC_DECIMALS } from "../chain/escrow"

/** "250.5" -> { units: "250500000", display: "250.50" }. Rejects more than 6 decimals. */
export function parseUsdc(input: string): { units: string; display: string } {
  const trimmed = input.trim()
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) throw new Error("Amount must be a positive number with at most 6 decimals")
  const units = parseUnits(trimmed, USDC_DECIMALS)
  if (units <= 0n) throw new Error("Amount must be greater than zero")
  return { units: units.toString(), display: formatUsdc(units) }
}

export function formatUsdc(units: bigint | string): string {
  const s = formatUnits(BigInt(units), USDC_DECIMALS)
  const [whole, frac = ""] = s.split(".")
  return `${whole}.${frac.padEnd(2, "0")}`
}
