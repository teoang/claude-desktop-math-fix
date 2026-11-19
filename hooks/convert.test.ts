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
