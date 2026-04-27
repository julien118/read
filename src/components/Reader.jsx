import { useState, useEffect, useRef } from 'react'
import { getPDF, saveProgress, getProgress, updateBookPageCount } from '../db'
import WordPopup from './WordPopup'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href

const THEME_ICONS = { white: '☀️', dark: '🌙', night: '🔴' }

export default function Reader({ bookId, onClose, theme, onToggleTheme }) {
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showUI, setShowUI] = useState(true)
  const [popup, setPopup] = useState(null) // { word, sentence } | null

  const readerRef    = useRef()
  const canvasRef    = useRef()
  const wrapperRef   = useRef()
  const pdfRef       = useRef(null)
  const renderTaskRef = useRef(null)
  const zoomRef      = useRef(1)
  const transformRef = useRef({ panX: 0, panY: 0, cssScale: 1 })
  const currentPageRef = useRef(1)
  const textCacheRef   = useRef(null) // { page, content }
  const popupOpenRef   = useRef(false)

  const pinchRef = useRef({ active: false, startDist: 0 })
  const swipeRef = useRef({ active: false, startX: 0, startY: 0 })
  const panRef   = useRef({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0 })
  const tapRef   = useRef({ lastTap: 0, timer: null, moved: false })

  // Keep popupOpenRef in sync so the non-passive touchmove handler sees it
  useEffect(() => { popupOpenRef.current = !!popup }, [popup])

  // ── Load PDF ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const buffer = await getPDF(bookId)
      if (!buffer || cancelled) return
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise
      if (cancelled) { pdf.destroy(); return }
      pdfRef.current = pdf
      setTotal(pdf.numPages)
      updateBookPageCount(bookId, pdf.numPages)
      const saved = await getProgress(bookId)
      if (!cancelled) { setPage(Math.min(saved, pdf.numPages)); setLoading(false) }
    }
    load()
    return () => {
      cancelled = true
      pdfRef.current?.destroy()
      pdfRef.current = null
    }
  }, [bookId])

  // ── Render on page change ────────────────────────────────
  useEffect(() => {
    currentPageRef.current = page
    if (!loading) renderPage(page)
  }, [page, loading])

  // ── Re-render on resize ─────────────────────────────────
  useEffect(() => {
    if (loading) return
    const onResize = () => { if (pdfRef.current) renderPage(currentPageRef.current) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [loading])

  // ── Prevent browser gestures (non-passive, skip when popup open) ─
  useEffect(() => {
    const el = readerRef.current
    const prevent = e => { if (!popupOpenRef.current) e.preventDefault() }
    el.addEventListener('touchmove', prevent, { passive: false })
    return () => el.removeEventListener('touchmove', prevent)
  }, [])

  // ── Keyboard navigation ──────────────────────────────────
  useEffect(() => {
    const onKey = e => {
      if (popup) { if (e.key === 'Escape') setPopup(null); return }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goNext()
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goPrev()
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, page, total, popup])

  // ── Canvas render ────────────────────────────────────────
  async function renderPage(pageNum) {
    if (!pdfRef.current || !canvasRef.current || !readerRef.current) return
    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel() } catch {}
      renderTaskRef.current = null
    }
    const pg = await pdfRef.current.getPage(pageNum)
    const dpr = window.devicePixelRatio || 1
    const containerW = readerRef.current.clientWidth || window.innerWidth
    const baseVp = pg.getViewport({ scale: 1 })
    const fitScale = containerW / baseVp.width
    const viewport = pg.getViewport({ scale: fitScale * zoomRef.current * dpr })

    const canvas = canvasRef.current
    canvas.width  = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    canvas.style.width  = `${containerW * zoomRef.current}px`
    canvas.style.height = `${Math.round(viewport.height) / dpr}px`

    const task = pg.render({ canvasContext: canvas.getContext('2d'), viewport })
    renderTaskRef.current = task
    try {
      await task.promise
      saveProgress(bookId, pageNum)
    } catch (e) {
      if (e?.name !== 'RenderingCancelledException') console.error(e)
    }
    renderTaskRef.current = null

    // Pre-cache text content for word lookup (non-blocking)
    pg.getTextContent().then(c => { textCacheRef.current = { page: pageNum, content: c } }).catch(() => {})
  }

  // ── Word lookup via PDF coordinate hit-test ──────────────
  async function getWordAtTap(clientX, clientY, pageNum) {
    if (!pdfRef.current || !canvasRef.current || !readerRef.current) return null

    let cached = textCacheRef.current
    if (!cached || cached.page !== pageNum) {
      try {
        const pg = await pdfRef.current.getPage(pageNum)
        const content = await pg.getTextContent()
        textCacheRef.current = { page: pageNum, content }
        cached = textCacheRef.current
      } catch { return null }
    }

    const pg = await pdfRef.current.getPage(pageNum)
    const containerW = readerRef.current.clientWidth || window.innerWidth
    const baseVp = pg.getViewport({ scale: 1 })
    const fitScale = containerW / baseVp.width
    const cssVp = pg.getViewport({ scale: fitScale * zoomRef.current })

    const rect = canvasRef.current.getBoundingClientRect()
    const cssX = clientX - rect.left
    const cssY = clientY - rect.top
    const [pdfX, pdfY] = cssVp.convertToPdfPoint(cssX, cssY)

    let hitWord = null
    let hitBaselineY = null

    for (const item of cached.content.items) {
      if (!item.str?.trim()) continue
      const [a,, , d, ex, ey] = item.transform
      const w = item.width ?? Math.abs(a) * item.str.length * 0.55
      const h = Math.abs(d) * 1.4

      if (pdfX >= ex && pdfX <= ex + w && pdfY >= ey - h * 0.15 && pdfY <= ey + h) {
        const relX = w > 0 ? (pdfX - ex) / w : 0
        const idx = Math.min(Math.floor(relX * item.str.length), item.str.length - 1)
        hitWord = extractWordAt(item.str, idx)
        hitBaselineY = ey
        break
      }
    }

    if (!hitWord) return null

    // Gather the full line as sentence context
    const lineItems = cached.content.items
      .filter(it => it.str && Math.abs(it.transform[5] - hitBaselineY) < 5)
      .sort((a, b) => a.transform[4] - b.transform[4])
    const sentence = lineItems.map(i => i.str).join(' ').trim()

    return { word: hitWord, sentence }
  }

  function extractWordAt(str, index) {
    let s = index, e = index
    while (s > 0 && /[a-zA-ZÀ-ÿ''-]/.test(str[s - 1])) s--
    while (e < str.length && /[a-zA-ZÀ-ÿ''-]/.test(str[e])) e++
    const w = str.slice(s, e).replace(/[^a-zA-ZÀ-ÿ''-]/g, '').toLowerCase()
    return w.length > 1 ? w : null
  }

  // ── Transform helpers ────────────────────────────────────
  function applyTransform() {
    if (!wrapperRef.current) return
    const { panX, panY, cssScale } = transformRef.current
    wrapperRef.current.style.transform = `translate(${panX}px,${panY}px) scale(${cssScale})`
  }
  function resetTransform() {
    transformRef.current = { panX: 0, panY: 0, cssScale: 1 }
    applyTransform()
  }
  function dist2(touches) {
    const dx = touches[0].clientX - touches[1].clientX
    const dy = touches[0].clientY - touches[1].clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  // ── Touch handlers ───────────────────────────────────────
  function handleTouchStart(e) {
    if (popup) return // popup absorbs events
    clearTimeout(tapRef.current.timer)
    tapRef.current.moved = false
    if (e.touches.length === 2) {
      pinchRef.current = { active: true, startDist: dist2(e.touches) }
      swipeRef.current.active = false
    } else if (e.touches.length === 1) {
      const t = e.touches[0]
      swipeRef.current = { active: true, startX: t.clientX, startY: t.clientY }
      panRef.current = { active: zoomRef.current > 1, startX: t.clientX, startY: t.clientY, baseX: transformRef.current.panX, baseY: transformRef.current.panY }
    }
  }

  function handleTouchMove(e) {
    if (popup) return
    if (e.touches.length === 2 && pinchRef.current.active) {
      const ratio = dist2(e.touches) / pinchRef.current.startDist
      transformRef.current.cssScale = Math.max(0.5, Math.min(5, zoomRef.current * ratio))
      applyTransform()
      tapRef.current.moved = true
    } else if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - swipeRef.current.startX
      const dy = e.touches[0].clientY - swipeRef.current.startY
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) tapRef.current.moved = true
      if (panRef.current.active) {
        transformRef.current.panX = panRef.current.baseX + dx
        transformRef.current.panY = panRef.current.baseY + dy
        applyTransform()
      }
    }
  }

  function handleTouchEnd(e) {
    if (popup) return
    if (pinchRef.current.active) {
      pinchRef.current.active = false
      const newZoom = Math.max(0.5, Math.min(5, transformRef.current.cssScale))
      zoomRef.current = newZoom
      resetTransform()
      renderPage(page)
      return
    }
    panRef.current.active = false
    panRef.current.baseX = transformRef.current.panX
    panRef.current.baseY = transformRef.current.panY

    const touch = e.changedTouches[0]
    if (!touch) return

    const dx = touch.clientX - swipeRef.current.startX
    const dy = touch.clientY - swipeRef.current.startY

    if (swipeRef.current.active && zoomRef.current <= 1 &&
        Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swipeRef.current.active = false
      if (dx < 0) goNext(); else goPrev()
      return
    }
    swipeRef.current.active = false
    if (tapRef.current.moved) return

    const now = Date.now()
    const touchX = touch.clientX
    const touchY = touch.clientY
    const tappedPage = currentPageRef.current

    if (tapRef.current.lastTap > 0 && now - tapRef.current.lastTap < 300) {
      tapRef.current.lastTap = 0
      const newZoom = zoomRef.current > 1 ? 1 : 2.5
      zoomRef.current = newZoom
      resetTransform()
      renderPage(page)
      return
    }

    tapRef.current.lastTap = now
    tapRef.current.timer = setTimeout(async () => {
      tapRef.current.lastTap = 0
      if (tappedPage !== currentPageRef.current) return

      // Try word lookup first
      const result = await getWordAtTap(touchX, touchY, tappedPage)
      if (result?.word) { setPopup(result); return }

      // Fall back: edge tap navigation or UI toggle
      const vw = window.innerWidth
      if (zoomRef.current <= 1 && touchX < vw * 0.22) goPrev()
      else if (zoomRef.current <= 1 && touchX > vw * 0.78) goNext()
      else setShowUI(v => !v)
    }, 300)
  }

  function goPrev() {
    if (page <= 1) return
    zoomRef.current = 1; resetTransform(); setPage(p => p - 1)
  }
  function goNext() {
    if (page >= total) return
    zoomRef.current = 1; resetTransform(); setPage(p => p + 1)
  }

  const progress = total > 0 ? (page / total) * 100 : 0

  return (
    <div
      ref={readerRef}
      className="reader"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className={`reader-header${showUI ? ' visible' : ''}`}>
        <button className="reader-btn" onClick={onClose} aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="page-counter">{page} / {total}</span>
        <button className="reader-btn" onClick={onToggleTheme} aria-label="Toggle theme">
          {THEME_ICONS[theme] ?? '☀️'}
        </button>
      </div>

      <div className="canvas-viewport">
        {loading
          ? <div className="reader-spinner"><span className="spinner large" /></div>
          : <div ref={wrapperRef} className="canvas-transform"><canvas ref={canvasRef} /></div>
        }
      </div>

      <div className={`reader-footer${showUI && !loading ? ' visible' : ''}`}>
        <button className="nav-btn" onClick={goPrev} disabled={page <= 1} aria-label="Previous">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <button className="nav-btn" onClick={goNext} disabled={page >= total} aria-label="Next">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>

      {popup && (
        <WordPopup
          word={popup.word}
          sentence={popup.sentence}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  )
}
