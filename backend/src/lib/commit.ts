import { keccak256, stringToHex, type Hex } from "viem"

/**
 * On-chain commitments. Every verdict and ruling that moves money is hashed and the hash is
 * written to the escrow contract *before* funds move. The exact string that was hashed is
 * stored next to the record, so anyone can recompute keccak256(canonical) and compare it with
 * the value in `Escrow.getJob()`.
 */
export interface Commitment {
  hash: Hex
  /** The exact UTF-8 string that was hashed. Stable key order, no whitespace. */
  canonical: string
}

/** JSON with object keys sorted recursively, so the same record always hashes the same. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm)
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as object)
          .sort()
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
      )
    }
    return v
  }
  return JSON.stringify(norm(value))
}

export const hashText = (s: string): Hex => keccak256(stringToHex(s))

export function commit(record: Record<string, unknown>): Commitment {
  const canonical = canonicalJson(record)
  return { hash: hashText(canonical), canonical }
}
