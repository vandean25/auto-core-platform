import type { ComponentProps, ReactElement } from 'react'
import { Trans } from 'react-i18next'

/**
 * Safe wrapper around react-i18next <Trans>.
 *
 * When global `interpolation.escapeValue` is `false`, react-i18next interpolates values
 * into the translation template before parsing AST tags. If user-controlled strings contain
 * allowed tags (e.g. <strong>, <br>, <p>, numbered slots), the AST parser would create real
 * elements or corrupt markup nesting.
 *
 * SafeTrans enforces `shouldUnescape={true}` and `interpolation.escapeValue = true` during
 * value interpolation so user values are parsed as plain text nodes, while special characters
 * (like ampersands, slashes, quotes) still render correctly without HTML entities.
 */
export function SafeTrans({
  shouldUnescape = true,
  tOptions,
  ...props
}: ComponentProps<typeof Trans>): ReactElement {
  const safeTOptions = {
    ...tOptions,
    interpolation: {
      ...tOptions?.interpolation,
      escapeValue: true,
    },
  }

  return <Trans shouldUnescape={shouldUnescape} tOptions={safeTOptions} {...props} />
}
