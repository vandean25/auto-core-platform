/**
 * AUT-659: design-token ratchet. Migrated folders may not add Tailwind palette colours
 * (`text-slate-500`, `bg-amber-50`, `border-white`, …) or arbitrary font sizes (`text-[11px]`).
 * Use the semantic tokens from `src/index.css` instead (mapping: `.agents/skills/acp-ui-polish/SKILL.md`).
 * The list is monotonic: add a folder once it is migrated, never remove one.
 */
export const tokenRatchetFiles = [
  'src/pages/workshop/**/*.{ts,tsx}',
  'src/components/workshop/**/*.{ts,tsx}',
  'src/features/workshop/**/*.{ts,tsx}',
  'src/pages/vehicles/**/*.{ts,tsx}',
  'src/components/vehicles/**/*.{ts,tsx}',
  'src/pages/vehicle-stock/**/*.{ts,tsx}',
  'src/components/vehicle-stock/**/*.{ts,tsx}',
  'src/features/vehicle-stock/**/*.{ts,tsx}',
]

const utility =
  '(text|bg|border|border-[xytrbl]|ring|ring-offset|outline|divide|fill|stroke|from|via|to|placeholder|decoration|accent|caret|shadow)'
const scale =
  '(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d'
const paletteClass = `(^|[\\s:'"\`])${utility}-(${scale}|(white|black)\\b)`
const arbitraryFontSize = `(^|[\\s:'"\`])text-\\[\\d+(\\.\\d+)?(px|rem)\\]`

const paletteMessage =
  'Use a design token (text-muted-foreground, border-border, bg-muted, success/warning/info/destructive) instead of a palette colour (AUT-659).'
const fontSizeMessage = 'Use the Tailwind type scale (text-xs, text-sm, …) instead of an arbitrary font size (AUT-659).'

export const tokenRatchetRestrictedSyntax = [
  { selector: `Literal[value=/${paletteClass}/]`, message: paletteMessage },
  { selector: `TemplateElement[value.raw=/${paletteClass}/]`, message: paletteMessage },
  { selector: `Literal[value=/${arbitraryFontSize}/]`, message: fontSizeMessage },
  { selector: `TemplateElement[value.raw=/${arbitraryFontSize}/]`, message: fontSizeMessage },
]
