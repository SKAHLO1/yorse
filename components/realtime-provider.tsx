"use client"

import { useQueryClient, type Query } from "@tanstack/react-query"
import { createContext, useContext, useEffect, useState } from "react"
import { API_URL } from "@/lib/api"
import { useAuth } from "./auth-provider"

export type RealtimeStatus = "off" | "connecting" | "live" | "reconnecting"
const RealtimeContext = createContext<RealtimeStatus>("off")
export const useRealtimeStatus = () => useContext(RealtimeContext)

/** Query caches that depend on any job: refreshed whenever a job the viewer can see changes. */
const JOB_WIDE = new Set(["jobs", "feed", "admin", "profile"])
const FALLBACK_POLL_MS = 20_000
const MAX_BACKOFF_MS = 30_000

/**
 * Keeps every open page in sync with the backend in real time.
 *
 * Holds one Server-Sent Events stream per tab (authenticated with the Firebase ID token in a
 * header, never the URL). Each signal names a job; we invalidate just the queries that depend on
 * it and React Query refetches the ones on screen. Reconnects with backoff, catches up after a
 * gap, and polls slowly while disconnected so nothing goes stale.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [status, setStatus] = useState<RealtimeStatus>("off")

  useEffect(() => {
    if (!user) {
      setStatus("off")
      return
    }
    let stopped = false
    let ctrl: AbortController | null = null
    let backoff = 1_000
    let everConnected = false
    let poll: ReturnType<typeof setInterval> | null = null
    const pending = new Set<string>()
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const affects = (q: Query, jobs: Set<string>) => {
      const [head, id] = q.queryKey as [string, string?]
      return (head === "job" && !!id && jobs.has(id)) || JOB_WIDE.has(head)
    }
    // Batch signals that arrive together into one round of refetches.
    const queue = (jobId: string) => {
      pending.add(jobId)
      flushTimer ??= setTimeout(() => {
        const jobs = new Set(pending)
        pending.clear()
        flushTimer = null
        void qc.invalidateQueries({ predicate: (q) => affects(q, jobs) })
      }, 150)
    }
    const startPolling = () => {
      poll ??= setInterval(() => void qc.invalidateQueries({ predicate: (q) => JOB_WIDE.has(q.queryKey[0] as string) || q.queryKey[0] === "job" }), FALLBACK_POLL_MS)
    }
    const stopPolling = () => {
      if (poll) clearInterval(poll)
      poll = null
    }

    async function connect() {
      while (!stopped) {
        setStatus(everConnected ? "reconnecting" : "connecting")
        try {
          const token = await user!.getIdToken()
          ctrl = new AbortController()
          const res = await fetch(`${API_URL}/api/stream`, { headers: { authorization: `Bearer ${token}` }, signal: ctrl.signal, cache: "no-store" })
          if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
          // Anything could have changed while we were disconnected: catch up once.
          if (everConnected) void qc.invalidateQueries()
          everConnected = true
          backoff = 1_000
          stopPolling()
          setStatus("live")

          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buf = ""
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })
            let i: number
            while ((i = buf.indexOf("\n\n")) >= 0) {
              const block = buf.slice(0, i)
              buf = buf.slice(i + 2)
              if (!block.startsWith("event: job")) continue
              const data = block.split("\n").find((l) => l.startsWith("data: "))
              try {
                const { jobId } = JSON.parse(data!.slice(6)) as { jobId: string }
                queue(jobId)
              } catch {
                // malformed line: ignore, the next signal or poll will catch up
              }
            }
          }
        } catch {
          if (stopped) return
        }
        if (stopped) return
        setStatus("reconnecting")
        startPolling()
        await new Promise((r) => setTimeout(r, backoff))
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
      }
    }
    void connect()

    // Coming back to the tab after sleep/offline: refresh immediately rather than waiting.
    const onVisible = () => document.visibilityState === "visible" && void qc.invalidateQueries({ predicate: (q) => q.state.dataUpdatedAt < Date.now() - 10_000 })
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("online", onVisible)

    return () => {
      stopped = true
      ctrl?.abort()
      stopPolling()
      if (flushTimer) clearTimeout(flushTimer)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("online", onVisible)
    }
  }, [user, qc])

  return <RealtimeContext.Provider value={status}>{children}</RealtimeContext.Provider>
}
