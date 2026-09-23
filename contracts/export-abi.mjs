// Copies the compiled Escrow ABI into the backend and frontend. Run after `forge build`.
import { readFileSync, writeFileSync } from "node:fs"
const abi = JSON.parse(readFileSync(new URL("./out/Escrow.sol/Escrow.json", import.meta.url))).abi
const ts =
  "// Generated from contracts/out/Escrow.sol/Escrow.json — run `node contracts/export-abi.mjs` after changing Escrow.sol\n" +
  `export const escrowAbi = ${JSON.stringify(abi, null, 2)} as const\n`
for (const target of ["../backend/src/chain/escrowAbi.ts", "../lib/escrow-abi.ts"]) writeFileSync(new URL(target, import.meta.url), ts)
console.log("ABI exported")
