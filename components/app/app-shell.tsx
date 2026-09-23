"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect } from "react"
import { AlertTriangle, LayoutDashboard, LogOut, Plus, Radio, ShieldCheck } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { YorseLogo } from "@/components/yorse-logo"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { firebaseConfigured } from "@/lib/firebase"
import { cn } from "@/lib/utils"
import { WalletButton } from "./wallet-button"

export function AppShell({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, me, loading, meError, signOut } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!loading && firebaseConfigured && !user) router.replace(`/login?next=${encodeURIComponent(pathname)}`)
  }, [loading, user, router, pathname])

  if (!firebaseConfigured) {
    return (
      <Centered>
        <Alert variant="destructive" className="max-w-lg">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Firebase is not configured</AlertTitle>
          <AlertDescription>Set the NEXT_PUBLIC_FIREBASE_* variables in .env.local (see .env.example) and restart the dev server.</AlertDescription>
        </Alert>
      </Centered>
    )
  }
  if (loading || !user) {
    return (
      <Centered>
        <Spinner className="size-6 text-brand-teal" />
      </Centered>
    )
  }

  const nav = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/feed", label: "Browse jobs", icon: Radio },
    { href: "/jobs/new", label: "New job", icon: Plus },
    ...(me?.admin ? [{ href: "/admin", label: "Admin", icon: ShieldCheck }] : []),
  ]

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/dashboard" className="shrink-0">
            <YorseLogo />
          </Link>
          <nav className="flex items-center gap-1 overflow-x-auto">
            {nav.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
                  (pathname === href || (href !== "/dashboard" && pathname.startsWith(href))) && "bg-accent text-foreground",
                )}
              >
                <Icon className="size-4" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <WalletButton />
            <span className="hidden text-xs text-muted-foreground lg:inline">{user.email}</span>
            <Button variant="ghost" size="icon" onClick={() => signOut().then(() => router.replace("/login"))} aria-label="Sign out">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {meError && (
          <Alert variant="destructive" className="mb-6">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Backend unavailable</AlertTitle>
            <AlertDescription>{meError}</AlertDescription>
          </Alert>
        )}
        {adminOnly && me && !me.admin ? (
          <Alert variant="destructive">
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>Admins only</AlertTitle>
            <AlertDescription>Your account does not have the admin role.</AlertDescription>
          </Alert>
        ) : adminOnly && !me ? (
          <Spinner className="size-6 text-brand-teal" />
        ) : (
          children
        )}
      </main>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-background p-6">{children}</div>
}
