import { cert, getApps, initializeApp, type App } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import { getFirestore } from "firebase-admin/firestore"

export function initFirebase(cfg: { projectId: string; clientEmail: string; privateKey: string }) {
  const app: App = getApps()[0] ?? initializeApp({ credential: cert(cfg), projectId: cfg.projectId })
  const db = getFirestore(app)
  db.settings({ ignoreUndefinedProperties: true })
  return { app, auth: getAuth(app), db }
}
