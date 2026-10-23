import path from 'path'

export function reactI18nextAliases(dirname: string): Record<string, string> {
  return {
    'react-i18next': path.resolve(dirname, './src/lib/i18n/react-i18next.ts'),
  }
}
