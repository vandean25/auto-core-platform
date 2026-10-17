#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { translateEnErrorToDe } from './error-message-de-translate.mjs'
import { CANONICAL_EN_MESSAGES } from './error-canonical-en.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const dePath = path.join(REPO_ROOT, 'locales/de/errors.json')
const enPath = path.join(REPO_ROOT, 'locales/en/errors.json')

const de = JSON.parse(fs.readFileSync(dePath, 'utf8'))
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'))

function germanizeCodeLabel(code) {
  const parts = code.split('_').map((part) => {
    const lower = part.toLowerCase()
    const map = {
      air: 'Luft',
      conditioning: 'konditionierung',
      alloy: 'Leichtmetall',
      wheels: 'räder',
      automatic: 'Automatik',
      climate: 'Klima',
      cruise: 'Tempomat',
      control: 'Regelung',
      first: 'Erst',
      registration: 'zulassung',
      required: 'erforderlich',
      shortening: 'Verkürzung',
      vehicle: 'Fahrzeug',
      too: 'zu',
      new: 'jung',
      consumer: 'Verbraucher',
      rule: 'Regel',
      not: 'nicht',
      available: 'verfügbar',
      gewaehrleistung: 'Gewährleistung',
    }
    return map[lower] ?? part.charAt(0) + part.slice(1).toLowerCase()
  })
  const label = parts.join(' ')
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}.`
}

let updated = 0
for (const code of Object.keys(en.codes ?? {}).sort()) {
  const enText = en.codes[code]
  const current = de.codes?.[code]
  if (typeof current === 'string' && current.trim() !== enText.trim()) {
    continue
  }
  const canonicalEn = CANONICAL_EN_MESSAGES[code]
  const sourceEn = canonicalEn ?? enText
  let next = translateEnErrorToDe(sourceEn, code)
  if (next.trim() === enText.trim()) {
    next = germanizeCodeLabel(code)
  }
  if (next.trim() === enText.trim()) {
    next = `Technischer Hinweis (${code}).`
  }
  de.codes[code] = next
  updated += 1
}

fs.writeFileSync(dePath, `${JSON.stringify(de, null, 2)}\n`)
console.log(`Updated ${updated} DE error code strings in locales/de/errors.json`)
