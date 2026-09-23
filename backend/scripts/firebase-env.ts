import { readFileSync } from "node:fs"

/** Reads only the Firebase Admin credentials (scripts that don't need chain/AI config). */
export function loadFirebaseOnly() {
  const e = process.env
  if (e.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const sa = JSON.parse(readFileSync(e.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8"))
    return { projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }
  }
  if (e.FIREBASE_PROJECT_ID && e.FIREBASE_CLIENT_EMAIL && e.FIREBASE_PRIVATE_KEY) {
    return { projectId: e.FIREBASE_PROJECT_ID, clientEmail: e.FIREBASE_CLIENT_EMAIL, privateKey: e.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") }
  }
  throw new Error("Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY in backend/.env")
}
