export function isMechanicPath(pathname: string) {
  return pathname === '/mechanic' || pathname.startsWith('/mechanic/')
}

export function isPlatformPath(pathname: string) {
  return pathname.startsWith('/platform/')
}
