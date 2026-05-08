export function isE2EAuthBypassEnabled() {
  return import.meta.env.MODE !== 'production' && import.meta.env.VITE_E2E_SKIP_AUTH === 'true'
}