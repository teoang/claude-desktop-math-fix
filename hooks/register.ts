import type { Register } from 'claude-code'

import { convertInlineMath } from './convert'

export const register: Register = on => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    // Only the desktop app draws math; other surfaces keep the text as written.
    if (e.surface !== 'desktop') return next(e)

    const text = convertInlineMath(e.props.text)
    if (text === e.props.text) return next(e)

    return next({ ...e, props: { ...e.props, text } })
  })
}
