import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { initI18n } from '@/lib/i18n'
import { getErrorBody, getErrorCode, getErrorMessage, getErrorMessageFromResponse } from './error-utils'

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

  it('does not leak raw backend message from Response and maps known code', async () => {
    const responseWithKnownCode = new Response(
      JSON.stringify({
        code: 'SELLER_IDENTITY_INCOMPLETE',
        message: 'Raw backend seller message',
      }),
      { status: 422 },
    )
    const msg = await getErrorMessageFromResponse(responseWithKnownCode, 'fallback')
    expect(msg).toBe('Die Angaben zum Betrieb sind für den Versand unvollständig. Bitte ergänzen Sie sie.')
    expect(msg).not.toContain('Raw backend')
  })

  it('does not leak raw backend message from Response when code is unknown', async () => {
    const responseWithUnknownCode = new Response(
      JSON.stringify({
        code: 'UNKNOWN_OR_INTERNAL',
        message: 'Raw unlocalized server text',
      }),
      { status: 400 },
    )
    const msg = await getErrorMessageFromResponse(responseWithUnknownCode, 'Standardfehler')
    expect(msg).toBe('Standardfehler')
    expect(msg).not.toContain('Raw unlocalized')
  })
})


describe('error fallback literal guard', () => {
  it('ensures no call site in core-web/src passes a string literal as fallback', () => {
    const srcRoot = path.resolve(__dirname, '..')

    function isSourceFile(filePath: string): boolean {
      if (filePath.endsWith('.d.ts')) return false
      if (filePath.endsWith('.test.ts') || filePath.endsWith('.test.tsx')) return false
      if (filePath.endsWith('.spec.ts') || filePath.endsWith('.spec.tsx')) return false
      if (filePath.includes('test-copy.ts')) return false
      if (filePath.includes(`${path.sep}test${path.sep}`) || filePath.includes('/test/')) return false
      return filePath.endsWith('.ts') || filePath.endsWith('.tsx')
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

    const checkedFunctions = new Set([
      'getErrorMessage',
      'throwImportResponseError',
      'throwHttpError',
    ])

    // Legacy call sites outside AUT-836 scope to be addressed in follow-up audit
    const UNMIGRATED_THROW_HTTP_ERROR_FILES = new Set([
      'api/api-keys.ts',
      'api/document-branding.ts',
      'api/tyre-storage.ts',
      'components/workshop/MechanicFindingAdvisorPanel.tsx',
    ])

    for (const filePath of files) {
      const src = fs.readFileSync(filePath, 'utf8')
      if (
        !src.includes('getErrorMessage') &&
        !src.includes('throwImportResponseError') &&
        !src.includes('throwHttpError')
      ) {
        continue
      }

      const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true)
      const relPath = path.relative(srcRoot, filePath).replace(/\\/g, '/')

      function visit(node: ts.Node) {
        if (ts.isCallExpression(node)) {
          const expr = node.expression
          let name = ''
          if (ts.isIdentifier(expr)) name = expr.text
          else if (ts.isPropertyAccessExpression(expr)) name = expr.name.text
          if (name === 'throwHttpError' && UNMIGRATED_THROW_HTTP_ERROR_FILES.has(relPath)) {
            return
          }
          if (checkedFunctions.has(name)) {
            const fallbackArg = node.arguments[1]
            if (fallbackArg) {
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
