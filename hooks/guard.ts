// A port of the checks the Claude desktop app runs before it typesets an
// inline formula (its `inlineGuard` for `$...$` and for `\(...\)`), read
// from the app's own bundle in November 2026. The mod only rewrites a
// formula when these say the app would refuse it, and only keeps a rewrite
// these say the app accepts.

const LIMIT = 1024
const DOLLAR_MAX = 60
const BACKSLASH_MAX = 200

const TEXISH = /[\\^{}=<>|!+]/
const SUBSCRIPT = /(?<![A-Za-z0-9_])(?:[a-z]_[A-Za-z0-9]|[A-Z]_[a-z0-9])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])[A-Za-z]_\{/
const LETTER_DIGIT = /(?<![A-Za-z0-9_])[A-Za-z]_\d(?![A-Za-z0-9_])/
const ESCAPED_PUNCT = /\\[!-/:-@[-`{-~]/g
const MARKUP = new Set(['*', '_', '~', '', '﷮'])
const OPEN_OK = new Set([' ', '\t', '\n', '(', '['])
const CLOSE_OK = new Set(' \t\r\n.,;:!?)]*_~|-`[<')
const ENDS_IN_OPERATOR = /(?:(?<![_^])[-+*]|[=<>/^_({[,:;\\])$/
const NOT_MATH = /[=!]~|&&|[@#"]|\\\\|(?:^|[\s(=,])'|[\s'"(/[=,;]\^(?!\{)|(?:^|[\s({|&])!$/
const MARKDOWN = /\*\*|__|~~|\]\(|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>|<[!?]/
const TERM = String.raw`-?(?:\d+(?:[.,]\d+)*[a-z]{0,2}|[a-z])[!']*`
const OP = String.raw`(?: ?[-+*/:] ?|, )`
const ATOM = `(?:${TERM}|\\(${TERM}(?:${OP}${TERM})*\\))`
const SIMPLE = new RegExp(`^${ATOM}(?:(?:${OP}|(?=\\())${ATOM})*$`, 'i')
const WORDY = /(?<![\\\p{L}])\p{L}{4}|[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Hangul}]{2}|(?<!\\)%/u
const BAD_ESCAPE = /\\[|.+*?0-9]/
const FLAG = /(^|\s)-{1,2}[A-Za-z]/
const TEX_COMMAND = /\\[a-zA-Z]|\^/

function nonAscii(c: string): boolean {
  return c > '\x7f' && c !== '' && c !== '﷮' && c !== '￿'
}

function charBefore(s: string, at: number): string | undefined {
  let n = at - 1
  const stop = at - 1 - 64
  while (n >= 0 && MARKUP.has(s[n] ?? '')) {
    if (n <= stop) return s[n]
    n--
  }
  return n >= 0 ? s[n] : undefined
}

function closesWell(s: string, at: number): boolean {
  let n = at
  while (s[n] === '' || s[n] === '﷮') if (++n - at > 8) return false
  const c = s[n]
  if (c === '\\') {
    const d = s[n + 1]
    return d === undefined || d === '\n' || d === '\r'
  }
  return c === undefined || CLOSE_OK.has(c) || nonAscii(c)
}

function body(s: string, from: number, to: number, max: number): string | null {
  let count = 0
  for (let i = from; i < to; i++) {
    const c = s.charCodeAt(i)
    if (c !== 0xe000 && c !== 0xfdee && ++count > max) return null
  }
  return s.slice(from, to).replaceAll('', '').replaceAll('﷮', '')
}

// Keeps command names, blanks what sits inside braces.
function outsideBraces(e: string): string {
  let depth = 0
  let out = ''
  for (let i = 0; i < e.length; i++) {
    const c = e[i] ?? ''
    if (c === '\\') {
      out += depth === 0 ? e.slice(i, i + 2) : '  '
      i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}' && depth > 0) depth--
    else if (depth === 0) {
      out += c
      continue
    }
    out += ' '
  }
  return out
}

function unbalanced(e: string): boolean {
  let paren = 0
  let brace = 0
  let bars = 0
  for (let i = 0; i < e.length; i++) {
    const c = e[i]
    if (c === '\\') i++
    else if (c === '(' || c === '[') paren++
    else if ((c === ')' || c === ']') && --paren < 0) return true
    else if (c === '{') brace++
    else if (c === '}' && --brace < 0) return true
    else if (c === '|') bars++
  }
  return paren !== 0 || brace !== 0 || (bars % 2 === 1 && e.endsWith('|'))
}

function refused(e: string): boolean {
  return e.includes('$') || e.includes('`') || e.includes('\\(') || BAD_ESCAPE.test(e)
}

// `$...$` in `s`: the opening `$` at `open`, the closing one at `close`.
export function dollarAccepted(s: string, open: number, close: number): boolean {
  const from = open + 1
  if (close - from > LIMIT) return false
  const before = charBefore(s, open)
  if ((before !== undefined && !OPEN_OK.has(before) && !nonAscii(before)) || !closesWell(s, close + 1)) return false
  const o = body(s, from, close, DOLLAR_MAX)
  if (o === null || o === '' || /^\s|\s$/.test(o) || refused(o) || ENDS_IN_OPERATOR.test(o) || NOT_MATH.test(o) || MARKDOWN.test(o) || unbalanced(o)) return false
  const simple = o.length === 1 ? /[A-Za-z]/.test(o) : !/^\d/.test(o) && SIMPLE.test(o)
  if (o[0] === '{' || (o[0] === '(' && !simple && !TEX_COMMAND.test(o))) return false
  return simple || ((TEXISH.test(o) || SUBSCRIPT.test(o)) && /[A-Za-z0-9\\]/.test(o) && !WORDY.test(outsideBraces(o)))
}

// `\(...\)` in `s`: the opening backslash at `open`, the closing one at `close`.
export function backslashAccepted(s: string, open: number, close: number): boolean {
  const from = open + 2
  if (close - from > LIMIT) return false
  const before = charBefore(s, open)
  if (before !== undefined && !OPEN_OK.has(before)) return false
  const o = body(s, from, close, BACKSLASH_MAX)
  if (o === null || refused(o) || (FLAG.test(o) && !TEX_COMMAND.test(o))) return false
  const plain = o.includes('\\') ? o.replace(ESCAPED_PUNCT, ' ') : o
  return TEXISH.test(plain) || LETTER_DIGIT.test(plain)
}
