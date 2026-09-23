import type { Auth } from "firebase-admin/auth"

export interface AuthUser {
  uid: string
  email: string
  name: string | null
  /** Google profile picture from the token, when the provider supplies one. */
  picture: string | null
  admin: boolean
}

export interface AuthService {
  verifyIdToken(token: string): Promise<AuthUser>
  getUserByEmail(email: string): Promise<{ uid: string; email: string } | null>
}

export function createFirebaseAuthService(auth: Auth): AuthService {
  return {
    async verifyIdToken(token) {
      // checkRevoked=true so disabled/revoked users are rejected immediately.
      const decoded = await auth.verifyIdToken(token, true)
      if (!decoded.email) throw new Error("Account has no email address")
      return {
        uid: decoded.uid,
        email: decoded.email,
        name: (decoded.name as string | undefined) ?? null,
        picture: (decoded.picture as string | undefined) ?? null,
        admin: decoded.admin === true,
      }
    },
    async getUserByEmail(email) {
      try {
        const u = await auth.getUserByEmail(email)
        return u.email ? { uid: u.uid, email: u.email } : null
      } catch (e: any) {
        if (e?.code === "auth/user-not-found") return null
        throw e
      }
    },
  }
}
