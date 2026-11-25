import { appendFileSync } from 'node:fs'
import { text } from 'node:stream/consumers'

import { isUiComponentPath } from './ui-screenshots-check.mjs'

const hint = 'Update the matching docs in German and English or ask ACP Doku. If no update is needed, add `Docs: n/a – <reason>` to the PR body.'

function isUserFacing(file) {
  return isUiComponentPath(file) || /^locales\/(de|en)\//.test(file) ||
    file === 'apps/core-api/openapi/openapi.json'
}

function hasDocsOptOut(body) {
  const lines = body.replace(/<!--[\s\S]*?-->/g, ' ').split(/\r?\n/)
  return lines.some((line) => {
    const reason = /^Docs:[ \t]*n\/a[ \t]*[-–][ \t]*(.+)$/i.exec(line.trim())?.[1]?.trim()
    return Boolean(reason) && reason !== '<reason>'
  })
}

try {
  const files = (await text(process.stdin)).split('\0')
  const userFacing = files.filter(isUserFacing)
  const docsChanged = files.some((file) => file.startsWith('docs-site/'))
  if (userFacing.length > 0 && !docsChanged && !hasDocsOptOut(process.env.PR_BODY ?? '')) {
    const paths = userFacing.map((file) => JSON.stringify(file))
    const warningPaths = paths.join(', ').replaceAll('%', '%25')
    console.log(`::warning::User-facing changes without docs: ${warningPaths}. ${hint}`)
    if (process.env.GITHUB_STEP_SUMMARY) {
      const summary = ['## User-facing changes without docs', '', ...paths.map((file) => `    ${file}`), '', hint, '']
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n'))
    }
  }
} catch {
  console.log('::warning::Docs check could not read the changed paths or write the job summary.')
}
