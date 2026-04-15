/**
 * Generates a unique ID (UUID v4 format when possible).
 * Includes a robust fallback for environments where crypto.randomUUID is unavailable
 * (e.g., non-secure contexts or certain automated testing environments).
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  // Fallback for non-secure contexts or missing crypto.randomUUID
  // Original source: https://stackoverflow.com/a/2117523
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
