// @vitest-environment jsdom
// The confirm card (Part 12): the summary verbatim, two labelled buttons while pending, the
// outcome instead once answered or expired.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import i18n from '../../i18n'
import ConfirmCard from './ConfirmCard'

afterEach(() => cleanup())

const SUMMARY = 'Zabilježit ću uz artikl "Radni stol": "Naručiti dva."'

describe('ConfirmCard', () => {
  it('K10: pending: the summary and two buttons that answer', () => {
    const onAnswer = vi.fn()
    render(
      <ConfirmCard
        summary={SUMMARY}
        status="pending"
        expiresAt="2099-01-01T00:00:00Z"
        disabled={false}
        onAnswer={onAnswer}
      />,
    )
    expect(screen.getByText(SUMMARY)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.confirm') }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.cancel') }))
    expect(onAnswer.mock.calls).toEqual([['confirm'], ['decline']])
  })

  it('K11: disabled while a stream is open; no buttons once answered or expired', () => {
    const onAnswer = vi.fn()
    const { unmount } = render(
      <ConfirmCard
        summary={SUMMARY}
        status="pending"
        expiresAt="2099-01-01T00:00:00Z"
        disabled={true}
        onAnswer={onAnswer}
      />,
    )
    expect(
      (screen.getByRole('button', { name: i18n.t('common.confirm') }) as HTMLButtonElement).disabled,
    ).toBe(true)
    unmount()
    render(
      <ConfirmCard
        summary={SUMMARY}
        status="confirmed"
        expiresAt="2099-01-01T00:00:00Z"
        disabled={false}
        onAnswer={onAnswer}
      />,
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(i18n.t('chat.confirmed'))).toBeTruthy()
    cleanup()
    render(
      <ConfirmCard
        summary={SUMMARY}
        status="pending"
        expiresAt="2000-01-01T00:00:00Z"
        disabled={false}
        onAnswer={onAnswer}
      />,
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(i18n.t('chat.confirm_expired'))).toBeTruthy()
    expect(screen.getByRole('group').getAttribute('data-status')).toBe('expired')
  })
})
