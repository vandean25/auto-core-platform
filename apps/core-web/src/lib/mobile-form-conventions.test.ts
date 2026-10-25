// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const webRoot = join(import.meta.dirname, '../..')
const webSrcRoot = join(webRoot, 'src')

function listTsxFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stats = statSync(fullPath)
    if (stats.isDirectory()) {
      if (entry === 'generated') continue
      listTsxFiles(fullPath, acc)
      continue
    }
    if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) {
      acc.push(fullPath)
    }
  }
  return acc
}

const PHONE_FIELD_MARKERS = [
  /name=["']phone["']/,
  /register\(["']phone["']\)/,
  /id=["']phone["']/,
  /id=["']seller-phone["']/,
  /placeholder=\{t\(['"]orderIntake\.phone['"]\)\}/,
  /ariaLabel=\{t\(['"]detail\.aria\.phone['"]\)\}/,
]

function isPhoneFieldFile(content: string): boolean {
  return PHONE_FIELD_MARKERS.some((marker) => marker.test(content))
}

function hasTelAttributes(content: string): boolean {
  const hasExplicitTel =
    /type=["']tel["']/.test(content) && /autoComplete=["']tel["']/.test(content)
  const hasPhoneInlineEdit = /<InlineEdit[\s\S]{0,500}\bphone\b/.test(content)
  return hasExplicitTel || hasPhoneInlineEdit
}

describe('mobile form conventions (grep guard)', () => {
  it('phone fields use type=tel and autoComplete=tel', () => {
    const violations: string[] = []

    for (const filePath of listTsxFiles(webSrcRoot)) {
      const content = readFileSync(filePath, 'utf8')
      if (!isPhoneFieldFile(content)) continue
      if (!hasTelAttributes(content)) {
        violations.push(relative(webRoot, filePath))
      }
    }

    expect(violations).toEqual([])
  })

  it('raw number inputs declare inputMode', () => {
    const violations: string[] = []
    const rawNumberInput = /<input\b[^>]*\btype=["']number["'][^>]*>/g

    for (const filePath of listTsxFiles(webSrcRoot)) {
      const content = readFileSync(filePath, 'utf8')
      const matches = content.match(rawNumberInput) ?? []
      for (const tag of matches) {
        if (!/\binputMode=/.test(tag)) {
          violations.push(`${relative(webRoot, filePath)}: ${tag}`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('Input assigns inputMode for type=number', () => {
    const inputSource = readFileSync(join(webSrcRoot, 'components/ui/input.tsx'), 'utf8')
    expect(inputSource).toContain('resolveNumberInputMode')
    expect(inputSource).toContain('inputMode={resolvedInputMode}')
  })

  it('production textareas use mobile field text sizing', () => {
    const violations: string[] = []
    const textareaBlock = /<textarea[\s\S]*?(?:\/>|<\/textarea>)/g
    for (const filePath of listTsxFiles(webSrcRoot)) {
      const content = readFileSync(filePath, 'utf8')
      const matches = content.match(textareaBlock) ?? []
      for (const block of matches) {
        const hasMobileSizing =
          block.includes('mobileFieldTextClass') ||
          block.includes('TEXTAREA_CLASS_NAME') ||
          block.includes('TEXTAREA_CLASS') ||
          (block.includes('text-base') && block.includes('md:text-sm'))
        if (hasMobileSizing) continue
        violations.push(`${relative(webRoot, filePath)}`)
      }
    }

    expect(violations).toEqual([])
  })

  it('CommandInput uses mobile field text sizing', () => {
    const commandSource = readFileSync(join(webSrcRoot, 'components/ui/command.tsx'), 'utf8')
    expect(commandSource).toContain('text-base')
    expect(commandSource).toContain('md:text-sm')
  })
})
