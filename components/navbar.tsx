"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { ArrowRight, Menu, X } from "lucide-react"
import { NetworkPill } from "./app/network-pill"
import { useAuth } from "./auth-provider"
import { YorseLogo } from "./yorse-logo"
import { cn } from "@/lib/utils"

const LINKS: [string, string][] = [
  ["Home", "/"],
  ["How It Works", "/#how"],
  ["AI Verdicts", "/#verdict"],
  ["Safeguards", "/#guarantees"],
  ["For Agents", "/agents"],
]

export function Navbar() {
  const { user, loading } = useAuth()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const signedIn = !loading && !!user
  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="shrink-0">
          <YorseLogo />
        </Link>
        <div className="hidden items-center gap-7 md:flex">
          {LINKS.map(([label, href]) => {
            const active = href === pathname
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "relative py-5 text-sm font-medium transition-colors",
                  active ? "text-foreground after:absolute after:inset-x-0 after:bottom-3 after:h-0.5 after:rounded after:bg-brand-green" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </Link>
            )
          })}
        </div>
        <div className="ml-auto hidden items-center gap-3 sm:flex">
          <NetworkPill className="hidden lg:inline-flex" />
          {signedIn ? (
            <Link href="/dashboard" className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-soft">
              Dashboard <ArrowRight className="size-4" />
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground">
                Log in
              </Link>
              <Link href="/login?mode=signup" className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-soft">
                Get started
              </Link>
            </>
          )}
        </div>
        <button type="button" className="ml-auto rounded-md p-2 sm:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open && (
        <div className="border-t border-border bg-background px-4 py-3 sm:hidden">
          {LINKS.map(([label, href]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)} className="block py-2 text-sm font-medium">
              {label}
            </Link>
          ))}
          <Link href={signedIn ? "/dashboard" : "/login?mode=signup"} className="mt-2 flex h-10 items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground">
            {signedIn ? "Dashboard" : "Get started"}
          </Link>
        </div>
      )}
    </nav>
  )
}
