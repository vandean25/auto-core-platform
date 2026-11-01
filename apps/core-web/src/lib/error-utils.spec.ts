import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { initI18n } from '@/lib/i18n'
import { getErrorBody, getErrorCode, getErrorMessage } from './error-utils'

describe('getErrorMessage', () => {
  beforeAll(async () => {
    await initI18n({ language: 'de' })
  })

  it('uses HTTP status fallback codes when the body has no wire code', () => {
    const message = getErrorMessage(
      {
        response: {
          status: 400,
          data: {
            message: 'inspected_on must be a valid date',
            eventId: 'evt_12345',
          },
        },
      },
      'fallback',
    )

    expect(message).toBe(
      'Die Anfrage konnte nicht verarbeitet werden. (Error ID: evt_12345)',
    )
    expect(message).not.toContain('inspected_on')
  })

  it('uses HTTP_500 copy for 5xx responses without a domain code', () => {
    const message = getErrorMessage(
      {
        status: 500,
        data: {
          message: 'Internal server error',
          requestId: 'req-1',
          eventId: 'evt-1',
        },
      },
      'fallback',
    )

    expect(message).toBe(
      'Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es erneut. (ref: req-1)',
    )
  })

  it('maps the active-order conflict code to translated copy', () => {
    const message = getErrorMessage(
      {
        status: 409,
        data: {
          message: 'Vehicle already has active order WO-2026-0007',
          code: 'VEHICLE_HAS_ACTIVE_ORDER',
          orderId: 'wo-live',
          orderNumber: 'WO-2026-0007',
        },
      },
      'fallback',
    )

    expect(message).toBe(
      'Für dieses Fahrzeug besteht bereits ein offener Werkstattauftrag (WO-2026-0007).',
    )
  })

  it('translates known wire codes instead of backend message text', () => {
    const message = getErrorMessage(
      {
        status: 422,
        data: {
          message: 'Seller identity is incomplete.',
          code: 'SELLER_IDENTITY_INCOMPLETE',
        },
      },
      'fallback',
    )

    expect(message).toBe(
      'Die Angaben zum Betrieb sind für den Versand unvollständig. Bitte ergänzen Sie sie.',
    )
  })

  it('reads the code and body from an API error', () => {
    const error = {
      status: 409,
      data: { code: 'VEHICLE_HAS_ACTIVE_ORDER', orderId: 'wo-live' },
    }

    expect(getErrorCode(error)).toBe('VEHICLE_HAS_ACTIVE_ORDER')
    expect(getErrorBody(error)).toEqual({ code: 'VEHICLE_HAS_ACTIVE_ORDER', orderId: 'wo-live' })
    expect(getErrorCode(new Error('plain'))).toBeUndefined()
  })

  it('returns fallback message when error is not object-like', () => {
    expect(getErrorMessage(null, 'fallback')).toBe('fallback')
    expect(getErrorMessage(undefined, 'fallback')).toBe('fallback')
    expect(getErrorMessage('string error', 'fallback')).toBe('fallback')
  })

  it('shows German copy for vehicle photo upload size errors', () => {
    const message = getErrorMessage(
      {
        response: {
          status: 413,
          data: {
            code: 'VEHICLE_PHOTO_TOO_LARGE',
            message: 'Vehicle photo exceeds the 10 MiB upload limit.',
          },
        },
      },
      'fallback',
    )

    expect(message).toBe(
      'Das Fahrzeugfoto ist größer als 10 MB.',
    )
  })

  it('uses HTTP_413 fallback when a 413 response has no domain code', () => {
    const message = getErrorMessage(
      {
        response: {
          status: 413,
          data: { message: 'Payload Too Large' },
        },
      },
      'fallback',
    )

    expect(message).toBe('Die Anfrage ist zu groß.')
  })

  it('prefers the caller fallback over generic copy when the wire code has no translation', () => {
    const message = getErrorMessage(
      {
        response: {
          status: 409,
          data: { code: 'NOT_IN_THE_CATALOG', message: 'internal copy' },
        },
      },
      'Import fehlgeschlagen',
    )

    expect(message).toBe('Import fehlgeschlagen')
  })

  it('re-resolves wire codes from errors thrown by throwHttpError', async () => {
    const { throwHttpError } = await import('./error-utils')
    const response = new Response(
      JSON.stringify({
        code: 'FISCAL_PERIOD_LOCKED',
        message: 'Fiscal period is locked for the selected date.',
      }),
      { status: 422 },
    )

    let thrown: unknown
    try {
      await throwHttpError(response, 'fallback')
    } catch (error) {
      thrown = error
    }

    expect(getErrorMessage(thrown, 'fallback')).toBe('Fiskalperiode ist gesperrt.')
  })
})


describe('getErrorMessage fallback guard', () => {
  it('ensures no call site in core-web/src passes a string literal as fallback', () => {
    const srcRoot = path.resolve(__dirname, '..')

    function isSourceFile(file: string): boolean {
      if (file.endsWith('.d.ts')) return false
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) return false
      if (file.endsWith('.spec.ts') || file.endsWith('.spec.tsx')) return false
      if (file.includes('test-copy.ts')) return false
      if (file.includes(`${path.sep}test${path.sep}`) || file.includes('/test/')) return false
      return file.endsWith('.ts') || file.endsWith('.tsx')
    }

    function walk(dir: string): string[] {
      let results: string[] = []
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          results = results.concat(walk(fullPath))
        } else if (isSourceFile(fullPath)) {
          results.push(fullPath)
        }
      }
      return results
    }

    const files = walk(srcRoot)
    const violations: Array<{ file: string; line: number; text: string }> = []

    function checkLiteral(node: ts.Node, sf: ts.SourceFile, relPath: string) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
        violations.push({ file: relPath, line: line + 1, text: node.getText(sf) })
      } else if (ts.isBinaryExpression(node)) {
        checkLiteral(node.left, sf, relPath)
        checkLiteral(node.right, sf, relPath)
      }
    }

    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8')
      if (!src.includes('getErrorMessage')) continue

      const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true)

      function visit(node: ts.Node) {
        if (ts.isCallExpression(node)) {
          const expr = node.expression
          let name = ''
          if (ts.isIdentifier(expr)) name = expr.text
          else if (ts.isPropertyAccessExpression(expr)) name = expr.name.text
          if (name === 'getErrorMessage') {
            const fallbackArg = node.arguments[1]
            if (fallbackArg) {
              const relPath = path.relative(srcRoot, file).replace(/\\/g, '/')
              checkLiteral(fallbackArg, sf, relPath)
            }
          }
        }
        ts.forEachChild(node, visit)
      }

      visit(sf)
    }

    expect(violations).toEqual([])
  })
})
