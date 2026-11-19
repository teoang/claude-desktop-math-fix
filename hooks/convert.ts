// Makes the desktop app typeset inline math it would otherwise show as raw
// text. A formula the app already accepts is left exactly as written. For one
// it refuses, the mod tries rewrites that draw the same, checks each against
// the app's own rules (./guard.ts), and keeps the first that passes:
//   - the body: `\|` becomes `\Vert`, `\#` becomes `\char35`, runs of 4+
//     plain letters are wrapped in braces;
//   - `\textstyle ` in front (for `$3$`, `$abc$`, `${...}$`);
//   - `\(...\)` in place of `$...$` (for formulas over 60 characters), and
//     `\({...}\)` for a simple `\(x\)` the app shows as "(x)";
//   - next to the formula: straight quotes become curly ones, and an invisible
//     word joiner (U+2060) separates a letter or digit glued to a `$`.
// If none passes, the formula is left alone. Besides, `$$x$$` inside a
// sentence becomes `$x$`, and a `\[...\]` block becomes a `$$` block. Code,
// `$$` blocks, escaped `\$` and prices such as "$5 and $10" are never touched.

import { backslashAccepted, dollarAccepted } from './guard'

const FENCE = /^(\s*)(`{3,}|~{3,})/
const CODE_SPAN = /(`+)[^`].*?\1(?!`)|(`+)\2(?!`)/g

// Opening `$`: not escaped, not part of `$$`, followed by a non-space.
// Body: no `$`, no newline. Closing `$`: preceded by a non-space,
// not followed by a digit or another `$` (so "$5 and $10" is not math).
const DOLLAR = String.raw`(?<![\\$])\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<![\s\\])\$(?![\d$])`
// `\(...\)` on one line, the opening backslash not itself escaped.
const PAREN = String.raw`(?<!\\)\\\(((?:\\[^)\n]|[^\\\n])+?)\\\)`
const SPAN = new RegExp(`${DOLLAR}|${PAREN}`, 'g')

// `$$x$$` written inside a sentence, which the app leaves raw.
const INLINE_DISPLAY = /(?<![\\$])\$\$(?![\s$])([^$\n]+?)(?<![\s\\])\$\$(?!\$)/g
// A line that is only a `$$...$$` formula: a display block, left alone.
const DISPLAY_LINE = /^\s*\$\$[^$]+\$\$\s*$/

const CURLY: Record<string, [string, string]> = { '"': ['“', '”'], "'": ['’', '’'] }
const WORD_JOINER = '⁠'

// `\|` and `\#` (refused by the app) to `\Vert` and `\char35`, and every run
// of 4+ letters outside braces and command names wrapped in braces.
export function fixBody(body: string): string {
  const b = body
    .replace(/\\\|(?=[A-Za-z])/g, '\\Vert ')
    .replace(/\\\|/g, '\\Vert')
    .replace(/\\#(?=\d)/g, '\\char35 ')
    .replace(/\\#/g, '\\char35')
  let out = ''
  let depth = 0
  let i = 0
  while (i < b.length) {
    const c = b[i] ?? ''
    if (c === '\\') {
      let j = i + 1
      if (/[A-Za-z]/.test(b[j] ?? '')) while (/[A-Za-z]/.test(b[j] ?? '')) j++
      else j++
      out += b.slice(i, j)
      i = j
      continue
    }
    if (c === '{') depth++
    else if (c === '}' && depth > 0) depth--
    else if (depth === 0 && /[A-Za-z]/.test(c)) {
      let j = i
      while (/[A-Za-z]/.test(b[j] ?? '')) j++
      const run = b.slice(i, j)
      out += run.length >= 4 ? `{${run}}` : run
      i = j
      continue
    }
    out += c
    i++
  }
  return out
}

type Rewrite = {
  // What replaces the character before the formula, if it changes.
  prev?: string
  // The formula, plus what replaces the character after it, if that changes.
  text: string
  skipNext: boolean
}

// The first rewrite of a refused formula that the app accepts, or null.
// `width` is the delimiter's length: 1 for `$`, 2 for `\(` and `\)`.
function rewrite(s: string, open: number, close: number, body: string, width: number): Rewrite | null {
  const prev = s[open - 1] ?? ''
  const next = s[close + width] ?? ''
  const head = s.slice(Math.max(0, open - 80), Math.max(0, open - 1))
  const tail = s.slice(close + width + 1, close + width + 12)
  const fixed = fixBody(body)

  const curlyPrev = CURLY[prev]?.[0]
  const curlyNext = CURLY[next]?.[1]
  const befores = open === 0 ? [''] : curlyPrev ? [curlyPrev] : [prev, prev + WORD_JOINER]
  const afters = next === '' ? [''] : curlyNext ? [curlyNext] : [next, WORD_JOINER + next]
  const dollar: [string, string][] = [['$', fixed], ['$', `\\textstyle ${fixed}`]]
  const paren: [string, string][] = [['\\(', fixed], ['\\(', `{${fixed}}`]]
  // Keep the delimiter the formula was written with when that works.
  const tries = width === 1 ? [...dollar, ...paren] : [...paren, ...dollar]

  for (const [o, math] of tries) {
    const c = o === '$' ? '$' : '\\)'
    for (const b of befores) {
      for (const a of afters) {
        const before = head + b
        const probe = before + o + math + c + a + tail
        const ok =
          o === '$'
            ? dollarAccepted(probe, before.length, before.length + 1 + math.length)
            : backslashAccepted(probe, before.length, before.length + 2 + math.length)
        if (ok) {
          return {
            prev: open > 0 && b !== prev ? b : undefined,
            text: o + math + c + (a !== next ? a : ''),
            skipNext: a !== next,
          }
        }
      }
    }
  }
  return null
}

function convertProse(input: string): string {
  const s = input.replace(INLINE_DISPLAY, (_m, body: string) => `$${body}$`)
  let out = ''
  let at = 0
  for (const m of s.matchAll(SPAN)) {
    const open = m.index
    const width = m[1] !== undefined ? 1 : 2
    const body = m[1] ?? m[2] ?? ''
    const close = open + width + body.length
    out += s.slice(at, open)
    at = close + width
    const accepted = width === 1 ? dollarAccepted(s, open, close) : backslashAccepted(s, open, close)
    const r = accepted ? null : rewrite(s, open, close, body, width)
    if (r === null) {
      out += m[0]
      continue
    }
    if (r.prev !== undefined) out = out.slice(0, -1) + r.prev
    out += r.text
    if (r.skipNext) at++
  }
  return out + s.slice(at)
}

// Splits a line on inline code spans and converts only the prose parts.
function convertLine(line: string): string {
  if (DISPLAY_LINE.test(line)) return line
  let out = ''
  let i = 0
  while (i < line.length) {
    const tick = line.indexOf('`', i)
    if (tick === -1) {
      out += convertProse(line.slice(i))
      break
    }
    out += convertProse(line.slice(i, tick))
    let run = 1
    while (line[tick + run] === '`') run++
    const fence = '`'.repeat(run)
    const end = line.indexOf(fence, tick + run)
    if (end === -1) {
      out += line.slice(tick)
      break
    }
    out += line.slice(tick, end + run)
    i = end + run
  }
  return out
}

// A `\[...\]` block starting at line `n`, written as a `$$` block, with the
// index of its last line; null when it does not close before a fence or the end.
function bracketBlock(lines: string[], n: number): [string, number] | null {
  const first = lines[n] ?? ''
  const indent = /^\s*/.exec(first)?.[0] ?? ''
  const parts: string[] = []
  let rest = first.trim().slice(2)
  for (let m = n; m < lines.length; m++) {
    if (m > n) {
      rest = lines[m] ?? ''
      if (FENCE.test(rest)) return null
    }
    const t = rest.trimEnd()
    if (t.endsWith('\\]') && !t.endsWith('\\\\]')) {
      const last = t.slice(0, -2)
      if (last.trim() !== '') parts.push(m > n ? last : indent + last.trim())
      const inner = parts.filter(p => p.trim() !== '')
      if (inner.length === 0) return null
      return [[`${indent}$$`, ...inner, `${indent}$$`].join('\n'), m]
    }
    if (rest.trim() !== '') parts.push(m > n ? rest : indent + rest.trim())
  }
  return null
}

export function convertInlineMath(text: string): string {
  if (!text.includes('$') && !text.includes('\\(') && !text.includes('\\[')) return text
  const lines = text.split('\n')
  const out: string[] = []
  let fence: string | null = null
  let inDisplay = false
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n] ?? ''
    const f = FENCE.exec(line)
    const mark = f?.[2]
    if (fence !== null) {
      if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = null
      out.push(line)
      continue
    }
    if (mark) {
      fence = mark
      out.push(line)
      continue
    }
    // A `$$` block spread over several lines: leave its inside alone. A `$$`
    // inside inline code (`` `$$` ``) opens nothing.
    const dd = (line.replace(CODE_SPAN, '').match(/(?<!\\)\$\$/g) || []).length
    if (inDisplay) {
      if (dd % 2 === 1) inDisplay = false
      out.push(line)
      continue
    }
    if (dd % 2 === 1) {
      inDisplay = true
      out.push(line)
      continue
    }
    if (line.trimStart().startsWith('\\[')) {
      const block = bracketBlock(lines, n)
      if (block !== null) {
        out.push(block[0])
        n = block[1]
        continue
      }
    }
    out.push(convertLine(line))
  }
  return out.join('\n')
}
