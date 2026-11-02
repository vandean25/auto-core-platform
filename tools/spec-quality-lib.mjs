/**
 * Spec-quality guard (AUT-856): finds low-value tests so new ones cannot be added.
 *
 * Rules:
 * - thin-large-spec: file over the line limit with at most two tests.
 * - weak-existence-assertion: test asserts only existence, or is titled "should be defined".
 * - bare-spy-assertion: test asserts only a bare toHaveBeenCalled().
 * - private-access: spec reaches into the unit under test with `as any` or a bracketed method call.
 */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

export const RULES = {
  'thin-large-spec': 'file is large but holds almost no tests',
  'weak-existence-assertion': 'test only asserts that something exists',
  'bare-spy-assertion': 'test only asserts a bare toHaveBeenCalled() without arguments',
  'private-access': 'test reaches a private member of the unit under test',
}

const SPEC_FILE = /\.(spec|e2e-spec|test)\.tsx?$/
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git'])
const EXISTENCE_MATCHERS = new Set(['toBeDefined', 'toBeTruthy'])
const SPY_MATCHERS = new Set(['toHaveBeenCalled'])
const CLOSERS = { '(': ')', '[': ']', '{': '}' }
const LINE_LIMIT = 150
const MAX_TESTS_FOR_THIN_FILE = 2

const isQuote = (char) => char === '"' || char === "'" || char === '`'

/** Index just after the string or template that opens at `open`. */
function endOfString(text, open) {
  const quote = text[open]
  let cursor = open + 1
  while (cursor < text.length && text[cursor] !== quote) {
    cursor += text[cursor] === '\\' ? 2 : 1
  }
  return Math.min(cursor + 1, text.length)
}

/** Range of comment or string content starting at `index`, plus where scanning continues. */
function blankedSpan(source, index) {
  const pair = source.slice(index, index + 2)
  if (pair === '//') {
    const newline = source.indexOf('\n', index)
    const to = newline === -1 ? source.length : newline
    return { blankFrom: index, blankTo: to, next: to }
  }
  if (pair === '/*') {
    const closed = source.indexOf('*/', index + 2)
    const to = closed === -1 ? source.length : closed + 2
    return { blankFrom: index, blankTo: to, next: to }
  }
  if (isQuote(source[index])) {
    const end = endOfString(source, index)
    return { blankFrom: index + 1, blankTo: end - 1, next: end }
  }
  return null
}

/** Blanks comments and string/template contents and returns the masked copy plus the blanked ranges. */
function maskLiteralsAndComments(source) {
  const masked = source.split('')
  const ranges = []
  let index = 0
  while (index < source.length) {
    const span = blankedSpan(source, index)
    if (!span) {
      index += 1
      continue
    }
    ranges.push([span.blankFrom, span.blankTo])
    for (let cursor = span.blankFrom; cursor < span.blankTo; cursor += 1) {
      if (masked[cursor] !== '\n') masked[cursor] = ' '
    }
    index = span.next
  }
  return { masked: masked.join(''), ranges }
}

/** True when `index` sits inside a blanked comment or string range. */
function isInsideBlanked(ranges, index) {
  return ranges.some(([from, to]) => index >= from && index < to)
}

/** Index just after the bracketed or quoted segment that opens at `open`. */
function skipBalanced(masked, open) {
  if (isQuote(masked[open])) return endOfString(masked, open)
  const opener = masked[open]
  const closer = CLOSERS[opener]
  if (!closer) return open + 1
  let depth = 0
  for (let index = open; index < masked.length; index += 1) {
    if (masked[index] === opener) depth += 1
    if (masked[index] === closer && (depth -= 1) === 0) return index + 1
  }
  return masked.length
}

/** Index of the call paren after a test member chain such as `.each` or `.skip`. */
function declarationOpening(masked, from) {
  const isSpace = (cursor) => masked[cursor] === ' ' || masked[cursor] === '\t'
  let cursor = from
  while (isSpace(cursor)) cursor += 1
  while (masked[cursor] === '.') {
    const chain = masked.slice(cursor + 1).match(/^\w+/)
    if (!chain) break
    cursor += chain[0].length + 1
    while (isSpace(cursor)) cursor += 1
  }
  return masked[cursor] === '(' ? cursor : -1
}

function readTestName(source, masked, opening) {
  if (!isQuote(masked[opening + 1])) return null
  const closing = skipBalanced(masked, opening + 1)
  return source.slice(opening + 2, closing - 1).trim()
}

/**
 * Test name of a declaration such as `it.each([...])('name', fn)`, where the name
 * sits in the second call; null when no call opens with a string argument.
 */
function readChainedTestName(source, masked, opening) {
  let next = skipBalanced(masked, opening)
  while (next < masked.length && /\s/.test(masked[next])) next += 1
  if (masked[next] !== '(') return null
  return readTestName(source, masked, next)
}

/** Test declarations, each carrying the masked source up to the next declaration — that range is the body. */
function findTests(source, masked) {
  const declarations = []
  for (const match of masked.matchAll(/(^|[^\w.$])(it|test)\b/g)) {
    const opening = declarationOpening(masked, match.index + match[1].length + match[2].length)
    if (opening === -1) continue
    const name = readTestName(source, masked, opening) ?? readChainedTestName(source, masked, opening)
    if (name === null) continue
    declarations.push({ name, start: match.index })
  }
  return declarations.map((declaration, index) => ({
    name: declaration.name,
    maskedBody: masked.slice(
      declaration.start,
      index + 1 < declarations.length ? declarations[index + 1].start : source.length,
    ),
  }))
}

function collectMatchers(maskedBody) {
  const matchers = []
  const pattern = /\.\s*(not\s*\.\s*)?(to[A-Z]\w*)\s*\(([^)]*)\)/g
  for (const match of maskedBody.matchAll(pattern)) {
    matchers.push({ matcher: match[2], args: match[3].trim(), negated: Boolean(match[1]) })
  }
  return matchers
}

/** An assertion with a negation or arguments checks an outcome, so it never counts as low-value. */
function isLowValue(matcher, allowed) {
  return !matcher.negated && allowed.has(matcher.matcher) && matcher.args === ''
}

/** The rule and key a single test breaks, or null when it checks a real outcome. */
function testOffender(test) {
  if (/should be defined/i.test(test.name)) return ['weak-existence-assertion', test.name]
  const matchers = collectMatchers(test.maskedBody)
  if (matchers.length === 0 || /\bassert\s*[.(]/.test(test.maskedBody)) return null
  if (matchers.every((matcher) => isLowValue(matcher, EXISTENCE_MATCHERS))) {
    return ['weak-existence-assertion', test.name]
  }
  if (matchers.every((matcher) => isLowValue(matcher, SPY_MATCHERS))) {
    return ['bare-spy-assertion', test.name]
  }
  return null
}

/**
 * Only a cast or bracket followed by a member access reaches into the unit under test.
 * Not flagged: casts inside comments or strings, test-double wiring (a `.mock…` member
 * follows the access) and assertions that merely read a value back (`expect((x as any).field)`).
 */
function privateAccessKeys(source, masked, ranges) {
  const patterns = [
    { pattern: /as\s+any\s*\)\s*\??\.\s*([A-Za-z_]\w*)/g, cast: true },
    { pattern: /as\s+any\s*\)\s*\??\[\s*['"]([^'"]+)['"]\s*\]/g, cast: true },
    { pattern: /[\w.$]+\[\s*['"]([^'"]+)['"]\s*\]\s*\(/g, cast: false },
  ]
  const keys = []
  for (const { pattern, cast } of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (isInsideBlanked(ranges, match.index)) continue
      const end = match.index + match[0].length
      if (/^\s*\??\.\s*mock/.test(masked.slice(end))) continue
      if (cast && isExpectArgument(masked, match.index + match[0].indexOf(')'))) continue
      keys.push(match[1])
    }
  }
  return keys
}

/**
 * True when the cast's paren group opens directly after `expect`, so the access only
 * reads a value back in an assertion instead of reaching into the unit under test.
 */
function isExpectArgument(masked, closeIndex) {
  let cursor = openingParenLeft(masked, closeIndex)
  if (cursor === -1) return false
  while (cursor > 0 && /\s/.test(masked[cursor - 1])) cursor -= 1
  if (masked[cursor - 1] === '(') cursor -= 1
  while (cursor > 0 && /\s/.test(masked[cursor - 1])) cursor -= 1
  return /expect$/.test(masked.slice(0, cursor))
}

/** Index of the matching `(` to the left of the `)` at `closeIndex`, or -1. */
function openingParenLeft(masked, closeIndex) {
  let depth = 0
  for (let cursor = closeIndex; cursor >= 0; cursor -= 1) {
    if (masked[cursor] === ')') depth += 1
    else if (masked[cursor] === '(' && (depth -= 1) === 0) return cursor
  }
  return -1
}

function analyzeSource(source, relativeFile) {
  const { masked, ranges } = maskLiteralsAndComments(source)
  const tests = findTests(source, masked)
  const lines = source.split(/\r?\n/).length
  const isThinFile = lines > LINE_LIMIT && tests.length <= MAX_TESTS_FOR_THIN_FILE
  const rules = [
    ...(isThinFile ? [['thin-large-spec', '*']] : []),
    ...tests.map(testOffender).filter(Boolean),
    ...privateAccessKeys(source, masked, ranges).map((key) => ['private-access', key]),
  ]
  return {
    offenders: rules.map(([rule, key]) => ({ file: relativeFile, rule, key })),
    testCount: tests.length,
    lines,
  }
}

export function baselineId(entry) {
  return `${entry.file}\u0000${entry.rule}\u0000${entry.key}`
}

/** Spec files git knows about (tracked or untracked but not ignored), so ignored output dirs are never scanned. */
function listSpecFilesViaGit(rootDir) {
  let listing
  try {
    listing = execFileSync(
      'git',
      ['-C', rootDir, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    ).toString()
  } catch {
    return null
  }
  const found = listing
    .split('\0')
    .filter((name) => SPEC_FILE.test(name) && !name.split('/').some((segment) => segment.startsWith('.')))
    .map((name) => path.join(rootDir, name))
    .filter((absolute) => fs.existsSync(absolute))
  return found.sort()
}

export function listSpecFiles(rootDir) {
  const fromGit = listSpecFilesViaGit(rootDir)
  if (fromGit) return fromGit
  const found = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name))
      } else if (SPEC_FILE.test(entry.name)) {
        found.push(path.join(dir, entry.name))
      }
    }
  }
  walk(rootDir)
  return found.sort()
}

export function findOffenders(rootDir) {
  const offenders = []
  for (const absolute of listSpecFiles(rootDir)) {
    const relative = path.relative(rootDir, absolute).replace(/\\/g, '/')
    offenders.push(...analyzeSource(fs.readFileSync(absolute, 'utf8'), relative).offenders)
  }
  const seen = new Set()
  return offenders.filter((offender) => {
    const id = baselineId(offender)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function loadBaseline(baselinePath) {
  if (!fs.existsSync(baselinePath)) return []
  return JSON.parse(fs.readFileSync(baselinePath, 'utf8')).allowlist ?? []
}

/** Splits offenders into new ones (must fail CI) and ones covered by the committed baseline. */
export function compareWithBaseline(offenders, baseline) {
  const allowed = new Set(baseline.map(baselineId))
  const fresh = []
  let covered = 0
  for (const offender of offenders) {
    if (allowed.has(baselineId(offender))) covered += 1
    else fresh.push(offender)
  }
  return { fresh, covered }
}

export function toBaselineJson(offenders) {
  const sortedPath = (entry) => `${entry.file}/${entry.rule}/${entry.key}`
  const allowlist = [...offenders].sort((a, b) => sortedPath(a).localeCompare(sortedPath(b)))
  return `${JSON.stringify({ allowlist }, null, 2)}\n`
}

export function describeOffender(offender) {
  return `${offender.file} > ${offender.key} [${offender.rule}]: ${RULES[offender.rule]}`
}
