export type PeekListControl = {
  peekId: string | null
  isPeekOpen: boolean
  openPeek: (id: string) => void
  closePeek: () => void
}
