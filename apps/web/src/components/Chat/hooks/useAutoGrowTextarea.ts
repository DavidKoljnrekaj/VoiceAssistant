import { type RefObject, useEffect } from 'react'

/** Refits a textarea to its content on every change, up to `maxPx`; `auto` first so it can shrink. */
export function useAutoGrowTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxPx: number,
): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`
  }, [ref, value, maxPx])
}
