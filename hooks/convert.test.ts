import { expect, test } from 'claude-code/testing'

import { convertInlineMath as c } from './convert'
import { backslashAccepted, dollarAccepted } from './guard'

// `$body$` between `before` and `after`, as the app's guard sees it.
function app(body: string, before = 'x ', after = ' y'): boolean {
  const s = `${before}$${body}$${after}`
  return dollarAccepted(s, before.length, before.length + 1 + body.length)
}

test('the guard port matches what the app drew in testing', async () => {
  // Typeset in the app.
  for (const ok of ['q_0', '3 + 1', '\\vec v', '\\mathbb{Z}', 'x = {abcde}', '\\text{accept}', 'e^{-t}\\,dt', '\\sum_{i=1}^{n} x_i', '\\textstyle abc', '\\textstyle 3', 'x_1 + x_2 + x_3 + x_4 + x_5 + x_6 + x_7 + x_8 + x_9 + x_{10}', '\\sigma_1 \\geq \\sigma_2 \\geq \\dots \\geq \\sigma_r > 0']) {
    expect([ok, app(ok)]).toEqual([ok, true])
  }
  // Left raw by the app.
  for (const raw of ['3', '0', '1.6449', 'abc', 'abcd', 'abcde', '{3}', '{abc}', '\\textstyle abcde', '\\mathbb{Z} = abcdefghijabcdefghij', '\\|A\\|_2 = \\sigma_1', '\\textstyle \\sigma_1 \\geq \\sigma_2 \\geq \\dots \\geq \\sigma_r > 0']) {
    expect([raw, app(raw)]).toEqual([raw, false])
  }
  expect(app('A', 'x "', '" y')).toBe(false)
  expect(app('A', 'x “', '” y')).toBe(true)
  const s = 'x \\(abcde\\) y'
  expect(backslashAccepted(s, 2, 9)).toBe(false)
})

test('formulas the app accepts are left exactly as written', async () => {
  const text = 'start $q_0$, $3 + 1$, $\\vec v$ and $\\sum_{i=1}^{n} x_i$.'
  expect(c(text)).toBe(text)
})

test('refused formulas get the smallest rewrite that passes', async () => {
  expect(c('we have $3$ points')).toBe('we have $\\textstyle 3$ points')
  expect(c('the word $abcde$ here')).toBe('the word $\\textstyle {abcde}$ here')
  expect(c('$3$ at the start')).toBe('$\\textstyle 3$ at the start')
  expect(c('$\\mathbb{Z} = abcdefghij$')).toBe('$\\mathbb{Z} = {abcdefghij}$')
  expect(c('norm $\\|A\\|_2 = \\sigma_1$ here')).toBe('norm $\\Vert A\\Vert_2 = \\sigma_1$ here')
  expect(c('say "$A\\vec v$" now')).toBe('say “$A\\vec v$” now')
})

test('long formulas move to \\(...\\) instead of growing past 60 characters', async () => {
  const long = '\\Sigma = \\operatorname{diag}(\\sigma_1, \\dots, \\sigma_r, 0, \\dots, 0)'
  expect(c(`and $${long}$.`)).toBe(`and \\(${long}\\).`)
})

test('display math, code and currency are left alone', async () => {
  expect(c('$$\\delta: Q \\to Q$$')).toBe('$$\\delta: Q \\to Q$$')
  expect(c('costs $5 and $10 today')).toBe('costs $5 and $10 today')
  expect(c('run `echo $HOME$x$`')).toBe('run `echo $HOME$x$`')
  expect(c('```\na $b$ c\n```')).toBe('```\na $b$ c\n```')
  expect(c('$$\na $b$\n$$')).toBe('$$\na $b$\n$$')
  expect(c('escaped \\$x$ stays')).toBe('escaped \\$x$ stays')
})

// Cases from anthropics/claude-code#102139 the mod did not cover before.
const WJ = '\u2060'

test('a letter, digit or sign glued to a $ gets an invisible word joiner', async () => {
  expect(app('^{1/2}', `loss${WJ}`, ' y')).toBe(true)
  expect(c('the loss$^{1/2}$ here')).toBe(`the loss${WJ}$^{1/2}$ here`)
  expect(c('all $x$s here')).toBe(`all $x$${WJ}s here`)
  expect(c('so $x$/2 and $x$=y')).toBe(`so $x$${WJ}/2 and $x$${WJ}=y`)
})

test('simple \\(...\\) formulas get braces', async () => {
  for (const x of ['x', 'xy', '2k', '1', '0.91', 'M_X', 'f(x)', '(0, 1)', 'x, y', '2\\,k']) {
    expect(c(`so \\(${x}\\) here`)).toBe(`so \\({${x}}\\) here`)
  }
  expect(backslashAccepted('x \\({x}\\) y', 2, 7)).toBe(true)
  const ok = 'so \\(a^2 + b^2 = c^2\\) and \\(\\lVert x \\rVert_Y \\le M_X\\) here'
  expect(c(ok)).toBe(ok)
})

test('$$...$$ inside a sentence becomes inline math', async () => {
  expect(c('the output is $$p_j$$.')).toBe('the output is $p_j$.')
  expect(c('- item $$x^2$$ here')).toBe('- item $x^2$ here')
  expect(c('  $$x^2$$  ')).toBe('  $$x^2$$  ')
  expect(c('Shell: echo $$ and $$PID')).toBe('Shell: echo $$ and $$PID')
})

test('\\[...\\] blocks become $$ blocks', async () => {
  expect(c('a\n\\[\n\\lambda = \\exp(x)\n\\]\nb')).toBe('a\n$$\n\\lambda = \\exp(x)\n$$\nb')
  expect(c('\\[ x^2 \\]')).toBe('$$\nx^2\n$$')
  expect(c('  \\[\n  x^2\n  \\]')).toBe('  $$\n  x^2\n  $$')
  expect(c('\\[\nno end')).toBe('\\[\nno end')
  expect(c('```\n\\[\nx\n\\]\n```')).toBe('```\n\\[\nx\n\\]\n```')
})

test('a $$ inside inline code does not open a display block', async () => {
  const text = '**3. `$$` in a sentence**\n- the output is $$p_j$$.\n- count $3$ and `\\[` too\n\\[\nx^2\n\\]'
  expect(c(text)).toBe('**3. `$$` in a sentence**\n- the output is $p_j$.\n- count $\\textstyle 3$ and `\\[` too\n$$\nx^2\n$$')
})

test('\\\\ inside an environment becomes \\cr', async () => {
  const m = '$A=\\begin{pmatrix}2&0\\\\0&1\\\\0&0\\end{pmatrix}$'
  expect(app(m.slice(1, -1))).toBe(false)
  expect(c(`so ${m} has rank 2`)).toBe('so $A=\\begin{pmatrix}2&0\\cr0&1\\cr0&0\\end{pmatrix}$ has rank 2')
  expect(c('so $\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}$ here')).toBe('so $\\begin{pmatrix}a&b\\cr c&d\\end{pmatrix}$ here')
  expect(c('so $\\begin{cases}1\\\\ 0\\end{cases}$ here')).toBe('so $\\begin{cases}1\\cr 0\\end{cases}$ here')
  // Outside an environment, or with a spacing argument: no `\cr`.
  expect(c('so $a\\\\b$ here')).not.toContain('\\cr')
  expect(c('so $\\begin{pmatrix}1\\\\[2pt]0\\end{pmatrix}$ here')).not.toContain('\\cr')
})

test('\\# becomes \\char35', async () => {
  expect(app('\\#')).toBe(false)
  expect(c('count $\\#$ here')).toBe('count $\\char35$ here')
  expect(c('count $\\#1 + x$ here')).toBe('count $\\char35 1 + x$ here')
})
