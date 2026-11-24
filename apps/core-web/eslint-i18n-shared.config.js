/** Shared eslint-plugin-i18next options for AUT-578 / AUT-579 / AUT-580. */
export const i18nLiteralStringIgnoreAttributes = [
  'className',
  'data-testid',
  'id',
  'href',
  'to',
  'type',
  'name',
  'role',
  'rel',
  'target',
  'autoComplete',
  'variant',
  'size',
  'side',
  'align',
  'viewBox',
  'xmlns',
  'fill',
  'stroke',
  'strokeWidth',
  'strokeLinecap',
  'strokeLinejoin',
  'd',
  'aria-hidden',
]

export const i18nLiteralStringRuleOptions = {
  markupOnly: true,
  ignoreAttribute: i18nLiteralStringIgnoreAttributes,
}

export const i18nLiteralStringRule = ['i18next/no-literal-string', ['error', i18nLiteralStringRuleOptions]]
