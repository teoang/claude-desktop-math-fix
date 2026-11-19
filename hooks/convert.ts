// Makes the desktop app typeset inline `$...$` math it would otherwise show
// as raw text. A formula the app already accepts is left exactly as written.
// For one it refuses, the mod tries rewrites that draw the same, checks each
// against the app's own rules (./guard.ts), and keeps the first that passes:
//   1. straight quotes next to it become curly ones; `\|` becomes `\Vert`;
//      runs of 4+ plain letters are wrapped in braces;
//   2. the same, with `\textstyle ` in front (for `$3$`, `$abc$`, `${...}$`);
//   3. the same as 1, written as `\(...\)` (for formulas over 60 characters).
// If none passes, the formula is left alone. `$$...$$`, code, escaped `\$`
// and prices such as "$5 and $10" are never touched.

import { backslashAccepted, dollarAccepted } from './guard'

const FENCE = /^(\s*)(`{3,}|~{3,})/

// Opening `$`: not escaped, not part of `$$`, followed by a non-space.
// Body: no `$`, no newline. Closing `$`: preceded by a non-space,
// not followed by a digit or another `$` (so "$5 and $10" is not math).
const SPAN = /(?<![\\$])\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<![\s\\])\$(?![\d$])/g

const CURLY: Record<string, [string, string]> = { '"': ['“', '”'], "'": ['’', '’'] }

// `\|` (refused by the app) to `\Vert`, and every run of 4+ letters outside
// braces and command names wrapped in braces.
export function fixBody(body: string): string {
  const b = body.replace(/\\\|(?=[A-Za-z])/g, '\\Vert ').replace(/\\\|/g, '\\Vert')
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

function convertProse(s: string): string {
  let out = ''
  let at = 0
  for (const m of s.matchAll(SPAN)) {
    const open = m.index
    const body = m[1] ?? ''
    const close = open + 1 + body.length
    out += s.slice(at, open)
    at = close + 1
    if (dollarAccepted(s, open, close)) {
      out += m[0]
      continue
    }

    const prev = s[open - 1] ?? ''
    const next = s[close + 1] ?? ''
    const curlyPrev = CURLY[prev]?.[0]
    const curlyNext = CURLY[next]?.[1]
    const head = open > 0 ? s.slice(Math.max(0, open - 80), open - 1) : ''
    const tail = s.slice(close + 2, close + 12)
    const fixed = fixBody(body)

    let done = false
    for (const math of [fixed, `\\textstyle ${fixed}`]) {
      const before = head + (open > 0 ? (curlyPrev ?? prev) : '')
      const probe = `${before}$${math}$${curlyNext ?? next}${tail}`
      if (dollarAccepted(probe, before.length, before.length + 1 + math.length)) {
        if (curlyPrev !== undefined) out = out.slice(0, -1) + curlyPrev
        out += `$${math}$`
        if (curlyNext !== undefined) {
          out += curlyNext
          at++
        }
        done = true
        break
      }
    }
    if (done) continue

    const before = head + prev
    const probe = `${before}\\(${fixed}\\)${next}${tail}`
    if (backslashAccepted(probe, before.length, before.length + 2 + fixed.length)) {
      out += `\\(${fixed}\\)`
      continue
    }
    out += m[0]
  }
  return out + s.slice(at)
}

// Splits a line on inline code spans and converts only the prose parts.
function convertLine(line: string): string {
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

export function convertInlineMath(text: string): string {
  if (!text.includes('$')) return text
  const lines = text.split('\n')
  let fence: string | null = null
  let inDisplay = false
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n] ?? ''
    const f = FENCE.exec(line)
    const mark = f?.[2]
    if (fence !== null) {
      if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = null
      continue
    }
    if (mark) {
      fence = mark
      continue
    }
    // A `$$` block spread over several lines: leave its inside alone.
    const dd = (line.match(/(?<!\\)\$\$/g) || []).length
    if (inDisplay) {
      if (dd % 2 === 1) inDisplay = false
      continue
    }
    if (dd % 2 === 1) {
      inDisplay = true
      continue
    }
    lines[n] = convertLine(line)
  }
  return lines.join('\n')
}
