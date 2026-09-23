"use client"

import { firebaseAuth } from "./firebase"

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "")

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

/** Authenticated call to the Yorse backend. Every request carries the user's Firebase ID token. */
export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const user = firebaseAuth().currentUser
  if (!user) throw new ApiError(401, "unauthorized", "Sign in required")
  const token = await user.getIdToken()

  let res: Response
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new ApiError(0, "network", `Cannot reach the Yorse backend at ${API_URL}. Is it running?`)
  }
  const json = await res.json().catch(() => null)
  // Verification endpoints return 502 with a structured body when the AI or chain step fails.
  if (!res.ok && !(res.status === 502 && json?.verification)) {
    const e = json?.error
    throw new ApiError(res.status, e?.code ?? "http_error", e?.message ?? `Request failed (${res.status})`, e?.details)
  }
  return json as T
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const problems = (err.details as { problems?: string[] } | undefined)?.problems
    return problems?.length ? `${err.message}: ${problems.join("; ")}` : err.message
  }
  if (err && typeof err === "object" && "shortMessage" in err) return String((err as { shortMessage: string }).shortMessage)
  return err instanceof Error ? err.message : String(err)
}
