export const SHELL_GLOSSARY_KEYS = [
  'atp',
  'salesOrder',
  'workshopOrder',
  'invoice',
  'pickerl',
  'kva',
  'storageBayBin',
] as const

export type ShellGlossaryKey = (typeof SHELL_GLOSSARY_KEYS)[number]
