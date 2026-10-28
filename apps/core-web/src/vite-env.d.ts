/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Web push (AUT-766). Both are public; an empty VAPID key means push is off. */
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string
  readonly VITE_FIREBASE_VAPID_PUBLIC_KEY?: string
}

declare module '*.svg?raw' {
  const content: string
  export default content
}
