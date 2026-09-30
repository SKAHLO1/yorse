"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { AlertTriangle, Bot, LayoutDashboard, LogOut, Menu, Plus, Radio, ShieldCheck, Star, UserRound, Wallet } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { YorseLogo } from "@/components/yorse-logo"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { firebaseConfigured } from "@/lib/firebase"
import { cn } from "@/lib/utils"
import { NetworkPill } from "./network-pill"
import { UserAvatar } from "./user-bits"
import { WalletButton, WalletStatusCard } from "./wallet-button"

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; match?: (p: string) => boolean }

export function AppShell({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, me, loading, meError, signOut } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    if (!loading && firebaseConfigured && !user) router.replace(`/login?next=${encodeURIComponent(pathname)}`)
  }, [loading, user, router, pathname])
  useEffect(() => setMobileOpen(false), [pathname])

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
        <Spinner className="size-6 text-brand-green" />
      </Centered>
    )
  }

  const nav: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/feed", label: "Jobs", icon: Radio, match: (p) => p === "/feed" || (p.startsWith("/jobs/") && p !== "/jobs/new") },
    { href: "/jobs/new", label: "New Job", icon: Plus },
    { href: "/wallet", label: "Wallet", icon: Wallet },
    ...(me ? [{ href: `/u/${me.uid}`, label: "Reviews", icon: Star, match: (p: string) => p === `/u/${me.uid}` }] : []),
    { href: "/agents", label: "Agents", icon: Bot },
    ...(me?.admin ? [{ href: "/admin", label: "Admin", icon: ShieldCheck }] : []),
  ]
  const active = (item: NavItem) => (item.match ? item.match(pathname) : pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href)))

  const sidebar = (
    <div className="flex h-full flex-col bg-yorse-forest px-4 py-6 text-sidebar-foreground">
      <Link href="/dashboard" className="px-2">
        <YorseLogo tone="dark" />
      </Link>
      <nav className="mt-10 flex flex-1 flex-col gap-1">
        {nav.map((item) => {
          const Icon = item.icon
          const on = active(item)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors",
                on ? "bg-emerald-400/15 text-white ring-1 ring-inset ring-emerald-300/20" : "text-emerald-50/70 hover:bg-white/5 hover:text-white",
              )}
            >
              <Icon className={cn("size-[18px]", on && "text-emerald-300")} />
              {item.label}
            </Link>
          )
        })}
      </nav>
      <WalletStatusCard />
    </div>
  )

  return (
    <div className="min-h-screen bg-yorse-wash">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block">{sidebar}</aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/75 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 border-0 p-0">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                {sidebar}
              </SheetContent>
            </Sheet>
            <Link href="/dashboard" className="lg:hidden">
              <YorseLogo />
            </Link>
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <NetworkPill className="hidden sm:inline-flex" />
              <WalletButton />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-9 gap-2 rounded-full px-1" aria-label="Account menu">
                    <UserAvatar
                      user={{ uid: me?.uid ?? user.uid, displayName: me?.displayName || user.email || "Account", photoUrl: me?.photoUrl ?? user.photoURL }}
                      size="sm"
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    Signed in as
                    <div className="truncate text-foreground">{user.email}</div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {me && (
                    <DropdownMenuItem asChild>
                      <Link href={`/u/${me.uid}`}>
                        <UserRound className="size-4" /> My public profile
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem asChild>
                    <Link href="/wallet">
                      <Wallet className="size-4" /> Wallet
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => signOut().then(() => router.replace("/login"))}>
                    <LogOut className="size-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
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
            <Spinner className="size-6 text-brand-green" />
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-yorse-wash p-6">{children}</div>
}
