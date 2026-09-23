"use client"

import { onIdTokenChanged, signOut as fbSignOut, type User } from "firebase/auth"
import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { api, errorText } from "@/lib/api"
import { firebaseAuth, firebaseConfigured } from "@/lib/firebase"
import type { Me } from "@/lib/types"

interface AuthState {
  user: User | null
  me: Me | null
  loading: boolean
  /** Set when signed in but the backend profile could not be loaded. */
  meError: string | null
  refreshMe: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [meError, setMeError] = useState<string | null>(null)

  const refreshMe = useCallback(async () => {
    try {
      const { user } = await api<{ user: Me }>("/me")
      setMe(user)
      setMeError(null)
    } catch (err) {
      setMe(null)
      setMeError(errorText(err))
    }
  }, [])

  useEffect(() => {
    if (!firebaseConfigured) {
      setLoading(false)
      return
    }
    return onIdTokenChanged(firebaseAuth(), async (u) => {
      setUser(u)
      if (u) await refreshMe()
      else {
        setMe(null)
        setMeError(null)
      }
      setLoading(false)
    })
  }, [refreshMe])

  const signOut = useCallback(async () => {
    await fbSignOut(firebaseAuth())
  }, [])

  return <AuthContext.Provider value={{ user, me, loading, meError, refreshMe, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>")
  return ctx
}
