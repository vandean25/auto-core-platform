import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const hasFirebaseConfig = Object.values(firebaseConfig).every((value) => Boolean(value))

/** Web push (AUT-766): the sender id belongs to the app options, the VAPID key is passed to `getToken`. Empty key = push off. */
export const pushVapidKey = import.meta.env.VITE_FIREBASE_VAPID_PUBLIC_KEY?.trim() ?? ''
const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() ?? ''

export const firebaseApp = hasFirebaseConfig ? initializeApp({ ...firebaseConfig, ...(messagingSenderId ? { messagingSenderId } : {}) }) : null
export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null
export const firebaseConfigMissing = !hasFirebaseConfig
