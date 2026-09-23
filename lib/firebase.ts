"use client"

import { getApps, initializeApp, type FirebaseApp } from "firebase/app"
import { getAuth, type Auth } from "firebase/auth"

// Public web config (safe to ship to the browser). No admin credentials ever live in the frontend.
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

export const firebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId)

let app: FirebaseApp | null = null

export function firebaseAuth(): Auth {
  if (!firebaseConfigured) {
    throw new Error("Firebase is not configured. Set the NEXT_PUBLIC_FIREBASE_* variables in .env.local.")
  }
  app ??= getApps()[0] ?? initializeApp(config)
  return getAuth(app)
}
