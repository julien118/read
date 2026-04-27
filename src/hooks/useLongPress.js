import { useRef, useCallback } from 'react'

export default function useLongPress(onLongPress, delay = 500) {
  const timer = useRef(null)
  const fired = useRef(false)

  const start = useCallback((e) => {
    fired.current = false
    timer.current = setTimeout(() => {
      fired.current = true
      onLongPress(e)
    }, delay)
  }, [onLongPress, delay])

  const cancel = useCallback(() => {
    clearTimeout(timer.current)
  }, [])

  return {
    onTouchStart: start,
    onTouchEnd: cancel,
    onTouchMove: cancel,
    onMouseDown: start,
    onMouseUp: cancel,
    onMouseLeave: cancel,
  }
}
