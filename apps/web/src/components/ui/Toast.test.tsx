// @vitest-environment jsdom
// The toast container as a keyboard user meets it: every toast has a real dismiss button, and
// Escape dismisses the newest one (WEB-14).
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import i18n from '../../i18n'
import ToastContainer from './Toast'

afterEach(() => cleanup())

const toasts = [
  { id: 't1', message: 'Prva', variant: 'info' as const },
  { id: 't2', message: 'Druga', variant: 'error' as const },
]

describe('ToastContainer', () => {
  it('WEB-14: each toast has a labelled dismiss button that works from the keyboard', () => {
    const onDismiss = vi.fn()
    render(<ToastContainer toasts={toasts} onDismiss={onDismiss} />)
    const buttons = screen.getAllByRole('button', { name: i18n.t('common.dismiss') })
    expect(buttons).toHaveLength(2)
    buttons[1]!.focus()
    fireEvent.click(buttons[1]!)
    expect(onDismiss).toHaveBeenCalledWith('t2')
  })

  it('WEB-14: Escape dismisses the newest toast', () => {
    const onDismiss = vi.fn()
    render(<ToastContainer toasts={toasts} onDismiss={onDismiss} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledWith('t2')
  })
})
