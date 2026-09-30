import Link from "next/link"
import { YorseLogo } from "./yorse-logo"

export function Footer() {
  const links: Record<string, [string, string][]> = {
    Product: [
      ["How it works", "/#how"],
      ["AI verdicts", "/#verdict"],
      ["Safeguards", "/#guarantees"],
      ["For agents", "/agents"],
    ],
    App: [
      ["Dashboard", "/dashboard"],
      ["New job", "/jobs/new"],
      ["Sign in", "/login"],
    ],
    Testnet: [
      ["Circle USDC faucet", "https://faucet.circle.com"],
      ["Arbiscan (Sepolia)", "https://sepolia.arbiscan.io"],
    ],
  }

  return (
    <footer className="bg-yorse-forest px-4 py-16 text-emerald-50 sm:px-6">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 md:grid-cols-4">
        <div className="col-span-2 space-y-3 md:col-span-1">
          <YorseLogo tone="dark" showTagline />
          <p className="text-xs text-emerald-100/60">Testnet MVP on Arbitrum Sepolia. No real funds.</p>
        </div>
        {Object.entries(links).map(([category, items]) => (
          <div key={category}>
            <h3 className="mb-4 text-sm font-semibold text-white">{category}</h3>
            <ul className="space-y-3">
              {items.map(([label, href]) => (
                <li key={label}>
                  {href.startsWith("http") ? (
                    <a href={href} target="_blank" rel="noreferrer" className="text-sm text-emerald-100/60 transition-colors hover:text-white">
                      {label}
                    </a>
                  ) : (
                    <Link href={href} className="text-sm text-emerald-100/60 transition-colors hover:text-white">
                      {label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </footer>
  )
}
