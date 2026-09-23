/**
 * Grants (or revokes) the Firebase custom claim `admin: true`.
 *   pnpm set-admin you@example.com
 *   pnpm set-admin you@example.com --revoke
 * The user must sign out and back in (or wait up to 1h) for the new token to carry the claim.
 */
import { initFirebase } from "../src/firebase"
import { loadFirebaseOnly } from "./firebase-env"

const [email, flag] = process.argv.slice(2)
if (!email) {
  console.error("Usage: pnpm set-admin <email> [--revoke]")
  process.exit(1)
}
const { auth } = initFirebase(loadFirebaseOnly())
const user = await auth.getUserByEmail(email)
const revoke = flag === "--revoke"
await auth.setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), admin: !revoke })
// Force existing sessions to refresh so the claim change applies immediately.
await auth.revokeRefreshTokens(user.uid)
console.log(`${revoke ? "Revoked" : "Granted"} admin for ${email} (uid ${user.uid}). They must sign in again.`)
