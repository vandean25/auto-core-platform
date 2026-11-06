/**
 * Small static-analysis helpers shared by the ADR-0036 interaction guards (AUT-893).
 *
 * The guards read source text, never run it. `analyzeSource` blanks comments (so a comment can never
 * satisfy or exempt a guard) and records, per character, the bracket nesting depth and whether the
 * character is code rather than string/template text. This proves wiring, not business safety.
 */

export type AnalyzedSource = {
  /** Source with comments replaced by spaces (same length, same line breaks). */
  masked: string
  /** Bracket depth ((), [], {}, `${}`) of each character: openers sit at the outer depth, their content and closer one deeper. */
  depth: Uint16Array
  /** 1 for code characters, 0 for characters inside a string or template literal. */
  code: Uint8Array
}

const OPENERS = '([{'
const CLOSERS = ')]}'
const DECLARATION_START = /^(?:export |function |async function |const |import )/

class SourceScanner {
  private readonly source: string
  private readonly out: string[] = []
  private readonly depth: Uint16Array
  private readonly code: Uint8Array
  private readonly templateBraceLevels: number[] = []
  private level = 0
  private index = 0
  private inTemplate = false

  constructor(source: string) {
    this.source = source
    this.depth = new Uint16Array(source.length + 1)
    this.code = new Uint8Array(source.length + 1)
  }

  run(): AnalyzedSource {
    while (this.index < this.source.length) {
      if (this.inTemplate) this.stepTemplate()
      else this.stepCode()
    }
    this.depth[this.source.length] = this.level
    return { masked: this.out.join(''), depth: this.depth, code: this.code }
  }

  private emit(char: string, isCode: boolean): void {
    this.depth[this.index] = this.level
    this.code[this.index] = isCode ? 1 : 0
    this.out.push(char)
    this.index += 1
  }

  private current(): string {
    return this.source[this.index]!
  }

  private peek(): string | undefined {
    return this.source[this.index + 1]
  }

  private stepTemplate(): void {
    const char = this.current()
    if (char === '\\') this.emitEscape()
    else if (char === '`') this.endTemplate()
    else if (char === '$' && this.peek() === '{') this.startTemplateExpression()
    else this.emit(char, false)
  }

  private emitEscape(): void {
    this.emit(this.current(), false)
    if (this.index < this.source.length) this.emit(this.current(), false)
  }

  private endTemplate(): void {
    this.emit('`', true)
    this.inTemplate = false
  }

  private startTemplateExpression(): void {
    this.emit('$', true)
    this.templateBraceLevels.push(this.level)
    this.emit('{', true)
    this.level += 1
    this.inTemplate = false
  }

  private stepCode(): void {
    const char = this.current()
    const next = this.peek()
    if (char === '/' && next === '/') this.skipLineComment()
    else if (char === '/' && next === '*') this.skipBlockComment()
    else if (char === '`') this.startTemplate()
    else if (char === '"' || char === "'") this.skipQuoted(char)
    else if (OPENERS.includes(char)) this.openBracket(char)
    else if (CLOSERS.includes(char)) this.closeBracket(char)
    else this.emitCode(char)
  }

  private skipLineComment(): void {
    while (this.index < this.source.length && this.current() !== '\n') this.emit(' ', false)
  }

  private skipBlockComment(): void {
    const end = this.source.indexOf('*/', this.index + 2)
    const stop = end === -1 ? this.source.length : end + 2
    while (this.index < stop) this.emit(this.current() === '\n' ? '\n' : ' ', false)
  }

  private startTemplate(): void {
    this.emit('`', true)
    this.inTemplate = true
  }

  /** A quote cannot span lines, so JSX text such as `Don't` only disturbs its own line. */
  private skipQuoted(quote: string): void {
    this.emit(quote, true)
    while (this.index < this.source.length && this.current() !== quote && this.current() !== '\n') {
      if (this.current() === '\\') this.emitEscape()
      else this.emit(this.current(), false)
    }
    if (this.current() === quote) this.emit(quote, true)
  }

  private openBracket(char: string): void {
    this.emit(char, true)
    this.level += 1
  }

  /** A closer carries the depth of the content it closes (opener depth + 1), so `findClosing` can match it. */
  private closeBracket(char: string): void {
    const outer = Math.max(0, this.level - 1)
    const endsTemplateExpression = char === '}' && this.templateBraceLevels.at(-1) === outer
    this.emit(char, true)
    this.level = outer
    if (endsTemplateExpression) {
      this.templateBraceLevels.pop()
      this.inTemplate = true
    }
  }

  private emitCode(char: string): void {
    if (this.shouldResync()) this.level = 0
    this.emit(char, true)
  }

  /** Prettier keeps declarations at column 0; resync so one stray bracket (regex literal) cannot hide the rest. */
  private shouldResync(): boolean {
    const atLineStart = this.index === 0 || this.source[this.index - 1] === '\n'
    return (
      atLineStart &&
      this.level > 0 &&
      this.templateBraceLevels.length === 0 &&
      DECLARATION_START.test(this.source.slice(this.index, this.index + 15))
    )
  }
}

export function analyzeSource(source: string): AnalyzedSource {
  return new SourceScanner(source).run()
}

/** Index of the bracket closing the one at `openIndex`, or -1. */
export function findClosing(analyzed: AnalyzedSource, openIndex: number): number {
  const target = analyzed.depth[openIndex]! + 1
  for (let j = openIndex + 1; j < analyzed.masked.length; j += 1) {
    if (analyzed.code[j] && analyzed.depth[j] === target && CLOSERS.includes(analyzed.masked[j]!)) {
      return j
    }
  }
  return -1
}

/** Splits the text between `open` and its closing bracket at top-level commas; returns [start, end) ranges. */
export function splitTopLevel(analyzed: AnalyzedSource, openIndex: number): Array<[number, number]> {
  const close = findClosing(analyzed, openIndex)
  if (close === -1) return []
  const target = analyzed.depth[openIndex]! + 1
  const ranges: Array<[number, number]> = []
  let start = openIndex + 1
  for (let j = openIndex + 1; j < close; j += 1) {
    if (analyzed.code[j] && analyzed.depth[j] === target && analyzed.masked[j] === ',') {
      ranges.push([start, j])
      start = j + 1
    }
  }
  if (analyzed.masked.slice(start, close).trim() !== '') ranges.push([start, close])
  return ranges
}

/** Index just after a `<...>` type-argument list starting at `index`, or `index` when there is none. */
export function skipTypeArguments(masked: string, index: number): number {
  let i = index
  while (/\s/.test(masked[i] ?? '')) i += 1
  if (masked[i] !== '<') return index
  let level = 0
  for (; i < masked.length; i += 1) {
    const c = masked[i]
    if (c === '<') level += 1
    else if (c === '>' && masked[i - 1] !== '=') {
      level -= 1
      if (level === 0) return i + 1
    }
  }
  return index
}

export type TopLevelDeclaration = {
  name: string
  /** Index of the declaration keyword. */
  start: number
  /** Parameter list text of the declaration (empty when none). */
  params: string
}

const DECLARATION_PATTERN =
  /(?:^|\n)(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\s*\*?\s+([A-Za-z_$][\w$]*)\s*(?:<[^>(]*>)?\s*\(|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(?:(?:<[^>(]*>)?\s*\(|([A-Za-z_$][\w$]*)\s*=>|function\b))/g

function declarationStart(match: RegExpMatchArray): number {
  return (match.index ?? 0) + (match[0].startsWith('\n') ? 1 : 0)
}

function readParams(analyzed: AnalyzedSource, match: RegExpMatchArray, start: number): string {
  if (match[3]) return match[3]
  const nameIndex = start + match[0].indexOf(match[1] ?? match[2]!)
  const open = analyzed.masked.indexOf('(', nameIndex)
  const close = open === -1 ? -1 : findClosing(analyzed, open)
  return close === -1 ? '' : analyzed.masked.slice(open + 1, close)
}

function toDeclaration(analyzed: AnalyzedSource, match: RegExpMatchArray): TopLevelDeclaration[] {
  const start = declarationStart(match)
  const name = match[1] ?? match[2]
  if (!name || analyzed.depth[start] !== 0) return []
  return [{ name, start, params: readParams(analyzed, match, start) }]
}

/** Declarations (functions and arrow-function consts) that start at bracket depth 0. */
export function topLevelDeclarations(analyzed: AnalyzedSource): TopLevelDeclaration[] {
  return [...analyzed.masked.matchAll(DECLARATION_PATTERN)].flatMap((match) =>
    toDeclaration(analyzed, match),
  )
}

/** The top-level declaration whose span contains `index`, or undefined at module level. */
export function owningDeclaration(
  declarations: readonly TopLevelDeclaration[],
  index: number,
): TopLevelDeclaration | undefined {
  let owner: TopLevelDeclaration | undefined
  for (const declaration of declarations) {
    if (declaration.start <= index) owner = declaration
  }
  return owner
}
