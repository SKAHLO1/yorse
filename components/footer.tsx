import Link from "next/link"
import { YorseLogo } from "./yorse-logo"

export function Footer() {
  const links: Record<string, [string, string][]> = {
    Product: [
      ["How it works", "#how"],
      ["AI verdicts", "#verdict"],
      ["Safeguards", "#guarantees"],
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
    <footer className="border-t border-zinc-800 py-16 px-6" style={{ backgroundColor: "#09090B" }}>
      <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
        <div className="col-span-2 md:col-span-1 space-y-3">
          <YorseLogo showTagline />
          <p className="text-xs text-zinc-500">Testnet MVP on Arbitrum Sepolia. No real funds.</p>
        </div>
        {Object.entries(links).map(([category, items]) => (
          <div key={category}>
            <h3 className="text-white font-medium text-sm mb-4">{category}</h3>
            <ul className="space-y-3">
              {items.map(([label, href]) => (
                <li key={label}>
                  {href.startsWith("http") ? (
                    <a href={href} target="_blank" rel="noreferrer" className="text-zinc-500 hover:text-zinc-300 transition-colors text-sm">
                      {label}
                    </a>
                  ) : (
                    <Link href={href} className="text-zinc-500 hover:text-zinc-300 transition-colors text-sm">
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
