export {}

declare global {
  interface Window {
    /** Present only when the app runs inside the desktop shell. */
    sovereign?: {
      desktop: true
      platform: string
    }
  }
}
