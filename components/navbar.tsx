"use client"

import Link from "next/link"
import { useAuth } from "./auth-provider"
import { YorseLogo } from "./yorse-logo"

export function Navbar() {
  const { user, loading } = useAuth()
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-zinc-800 bg-[#09090B]/80 backdrop-blur-md">
      <div className="w-full flex justify-center px-6 py-4">
        <div className="w-full max-w-4xl flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <YorseLogo />
          </Link>
          <div className="hidden md:flex items-center gap-8">
            <a href="#how" className="text-sm text-zinc-400 hover:text-white transition-colors">
              How it works
            </a>
            <a href="#verdict" className="text-sm text-zinc-400 hover:text-white transition-colors">
              AI verdicts
            </a>
            <a href="#guarantees" className="text-sm text-zinc-400 hover:text-white transition-colors">
              Safeguards
            </a>
          </div>
          <div className="flex items-center gap-4">
            {!loading && user ? (
              <Link
                href="/dashboard"
                className="text-sm text-white bg-zinc-800 hover:bg-zinc-700 px-3.5 py-1.5 rounded-md border border-zinc-700 transition-colors"
              >
                Dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className="text-sm text-zinc-400 hover:text-white transition-colors">
                  Log in
                </Link>
                <Link
                  href="/login?mode=signup"
                  className="text-sm text-white bg-zinc-800 hover:bg-zinc-700 px-3.5 py-1.5 rounded-md border border-zinc-700 transition-colors"
                >
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
