import { useState, useEffect, useRef } from 'react'
import { getPDF, saveProgress, getProgress, updateBookPageCount } from '../db'
import WordPopup from './WordPopup'
import TranslatePopup from './TranslatePopup'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href

const THEME_ICONS = { white: '☀️', dark: '🌙', night: '🔴' }

export default function Reader({ bookId, onClose, theme, onToggleTheme }) {
  const [page, setPage]             = useState(1)
  const [total, setTotal]           = useState(0)
  const [loading, setLoading]       = useState(true)
  const [showUI, setShowUI]         = useState(true)
  const [popup, setPopup]           = useState(null) // { word, sentence } | null
  const [translatePopup, setTranslatePopup] = useState(null) // { text } | null
  const [selectionInfo, setSelectionInfo]   = useState(null) // { text, x, y } | null

  const readerRef    = useRef()
  const canvasRef    = useRef()
  const wrapperRef   = useRef()
  const textLayerRef = useRef(null)
  const pdfRef       = useRef(null)
  const renderTaskRef       = useRef(null)
  const textLayerTaskRef    = useRef(null)
  const progressTimerRef    = useRef(null)
  const zoomRef      = useRef(1)
  const transformRef = useRef({ panX: 0, panY: 0, cssScale: 1 })
  const currentPageRef = useRef(1)

  // Refs so non-passive / timeout callbacks always see current values
  const popupOpenRef    = useRef(false)
  const selInfoRef      = useRef(null)

  const pinchRef     = useRef({ active: false, startDist: 0 })
  const swipeRef     = useRef({ active: false, startX: 0, startY: 0 })
  const panRef       = useRef({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0 })
  const tapRef       = useRef({ lastTap: 0, timer: null, moved: false })
  const longPressRef = useRef(null)

  useEffect(() => { popupOpenRef.current = !!(popup || translatePopup) }, [popup, translatePopup])
  useEffect(() => { selInfoRef.current = selectionInfo }, [selectionInfo])

  // ── Load PDF ─────────────────────────────────────────────
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

  // ── Render on page/loading change ─────────────────────────
  useEffect(() => {
    currentPageRef.current = page
    if (!loading) renderPage(page)
  }, [page, loading])

  // ── Re-render on resize ───────────────────────────────────
  useEffect(() => {
    if (loading) return
    const onResize = () => { if (pdfRef.current) renderPage(currentPageRef.current) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [loading])

  // ── Block browser gestures (non-passive), allow when popup open ─
  useEffect(() => {
    const el = readerRef.current
    const prevent = e => { if (!popupOpenRef.current) e.preventDefault() }
    el.addEventListener('touchmove', prevent, { passive: false })
    return () => el.removeEventListener('touchmove', prevent)
  }, [])

  // ── Text selection → floating Traduire button ─────────────
  useEffect(() => {
    let t = null
    function onSelectionChange() {
      clearTimeout(t)
      t = setTimeout(() => {
        if (popupOpenRef.current) return
        const sel = window.getSelection()
        const text = sel?.toString().trim()
        if (!text || text.split(/\s+/).filter(Boolean).length < 2) {
          setSelectionInfo(null)
          return
        }
        if (!textLayerRef.current?.contains(sel.anchorNode)) {
          setSelectionInfo(null)
          return
        }
        try {
          const rect = sel.getRangeAt(0).getBoundingClientRect()
          setSelectionInfo({ text, x: rect.left + rect.width / 2, y: rect.top })
        } catch { setSelectionInfo(null) }
      }, 120)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => { document.removeEventListener('selectionchange', onSelectionChange); clearTimeout(t) }
  }, [])

  // ── Keyboard navigation ───────────────────────────────────
  useEffect(() => {
    const onKey = e => {
      if (popup || translatePopup) {
        if (e.key === 'Escape') { setPopup(null); setTranslatePopup(null) }
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goNext()
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goPrev()
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, page, total, popup, translatePopup])

  // ── Canvas + text layer render ────────────────────────────
  async function renderPage(pageNum) {
    if (!pdfRef.current || !canvasRef.current || !readerRef.current) return

    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel() } catch {}
      renderTaskRef.current = null
    }
    if (textLayerTaskRef.current) {
      try { textLayerTaskRef.current.cancel() } catch {}
      textLayerTaskRef.current = null
    }

    const pg = await pdfRef.current.getPage(pageNum)
    const dpr = window.devicePixelRatio || 1
    const containerW = readerRef.current.clientWidth || window.innerWidth
    const baseVp = pg.getViewport({ scale: 1 })
    const fitScale = containerW / baseVp.width
    const cssScale = fitScale * zoomRef.current
    const viewport = pg.getViewport({ scale: cssScale * dpr })

    const canvas = canvasRef.current
    canvas.width  = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    canvas.style.width  = `${containerW * zoomRef.current}px`
    canvas.style.height = `${Math.round(viewport.height) / dpr}px`

    const task = pg.render({ canvasContext: canvas.getContext('2d'), viewport })
    renderTaskRef.current = task
    try {
      await task.promise
      // Debounce progress saves — Supabase network call, 2 s delay
      clearTimeout(progressTimerRef.current)
      progressTimerRef.current = setTimeout(() => saveProgress(bookId, pageNum), 2000)
    } catch (e) {
      if (e?.name !== 'RenderingCancelledException') console.error(e)
    }
    renderTaskRef.current = null

    // Render text layer on top of canvas
    if (textLayerRef.current) {
      textLayerRef.current.replaceChildren()
      const cssW = `${containerW * zoomRef.current}px`
      const cssH = `${Math.round(viewport.height) / dpr}px`
      textLayerRef.current.style.width  = cssW
      textLayerRef.current.style.height = cssH
      const cssViewport = pg.getViewport({ scale: cssScale })
      try {
        const tl = new pdfjsLib.TextLayer({
          textContentSource: pg.streamTextContent(),
          container: textLayerRef.current,
          viewport: cssViewport,
        })
        textLayerTaskRef.current = tl
        await tl.render()
      } catch (e) {
        if (!String(e).toLowerCase().includes('cancel')) console.error('TextLayer:', e)
      }
      textLayerTaskRef.current = null
    }
  }

  // ── Word lookup via text layer DOM ────────────────────────
  async function getWordAtPoint(clientX, clientY) {
    if (!textLayerRef.current) return null
    const el = document.elementFromPoint(clientX, clientY)
    if (!textLayerRef.current.contains(el)) return null

    const span = el.tagName === 'SPAN' ? el : el.closest?.('span')
    const str = span?.textContent
    if (!str?.trim()) return null

    let charIdx = 0
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(clientX, clientY)
      if (span.contains(pos?.offsetNode)) charIdx = pos.offset
    } else if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(clientX, clientY)
      if (span.contains(range?.startContainer)) charIdx = range.startOffset
    }

    const word = extractWordAt(str, charIdx)
    if (!word) return null

    // Gather surrounding line text for sentence context
    const spanRect = span.getBoundingClientRect()
    const lineSpans = Array.from(textLayerRef.current.querySelectorAll('span'))
      .filter(s => {
        const r = s.getBoundingClientRect()
        return r.height > 0 && Math.abs(r.top - spanRect.top) < spanRect.height * 0.6
      })
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
    const sentence = lineSpans.map(s => s.textContent).join(' ').trim()

    return { word, sentence }
  }

  function extractWordAt(str, index) {
    let s = index, e = index
    while (s > 0 && /[a-zA-ZÀ-ÿ''-]/.test(str[s - 1])) s--
    while (e < str.length && /[a-zA-ZÀ-ÿ''-]/.test(str[e])) e++
    const w = str.slice(s, e).replace(/[^a-zA-ZÀ-ÿ''-]/g, '').toLowerCase()
    return w.length > 1 ? w : null
  }

  // ── Transform helpers ─────────────────────────────────────
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

  // ── Touch handlers ────────────────────────────────────────
  function handleTouchStart(e) {
    if (popup || translatePopup) return
    clearTimeout(tapRef.current.timer)
    clearTimeout(longPressRef.current)
    tapRef.current.moved = false

    if (e.touches.length === 2) {
      pinchRef.current = { active: true, startDist: dist2(e.touches) }
      swipeRef.current.active = false
    } else if (e.touches.length === 1) {
      const t = e.touches[0]
      swipeRef.current = { active: true, startX: t.clientX, startY: t.clientY }
      panRef.current = { active: zoomRef.current > 1, startX: t.clientX, startY: t.clientY, baseX: transformRef.current.panX, baseY: transformRef.current.panY }

      // Long press (500 ms) on text layer → translate whole line
      const lx = t.clientX, ly = t.clientY
      longPressRef.current = setTimeout(() => {
        if (tapRef.current.moved || selInfoRef.current) return
        const el = document.elementFromPoint(lx, ly)
        if (!textLayerRef.current?.contains(el)) return
        const span = el.tagName === 'SPAN' ? el : el.closest?.('span')
        if (!span?.textContent?.trim()) return
        const spanRect = span.getBoundingClientRect()
        const lineSpans = Array.from(textLayerRef.current.querySelectorAll('span'))
          .filter(s => {
            const r = s.getBoundingClientRect()
            return r.height > 0 && Math.abs(r.top - spanRect.top) < spanRect.height * 0.6
          })
          .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
        const sentence = lineSpans.map(s => s.textContent).join(' ').trim()
        if (sentence.split(/\s+/).filter(Boolean).length >= 2) {
          clearTimeout(tapRef.current.timer)
          tapRef.current.lastTap = 0
          setTranslatePopup({ text: sentence })
        }
      }, 500)
    }
  }

  function handleTouchMove(e) {
    if (popup || translatePopup) return
    if (e.touches.length === 2 && pinchRef.current.active) {
      const ratio = dist2(e.touches) / pinchRef.current.startDist
      transformRef.current.cssScale = Math.max(0.5, Math.min(5, zoomRef.current * ratio))
      applyTransform()
      tapRef.current.moved = true
    } else if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - swipeRef.current.startX
      const dy = e.touches[0].clientY - swipeRef.current.startY
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        tapRef.current.moved = true
        clearTimeout(longPressRef.current)
      }
      if (panRef.current.active) {
        transformRef.current.panX = panRef.current.baseX + dx
        transformRef.current.panY = panRef.current.baseY + dy
        applyTransform()
      }
    }
  }

  function handleTouchEnd(e) {
    clearTimeout(longPressRef.current)
    if (popup || translatePopup) return

    if (pinchRef.current.active) {
      pinchRef.current.active = false
      zoomRef.current = Math.max(0.5, Math.min(5, transformRef.current.cssScale))
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

    if (selectionInfo) {
      setSelectionInfo(null)
      window.getSelection()?.removeAllRanges()
    }

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

      const result = await getWordAtPoint(touchX, touchY)
      if (result?.word) { setPopup(result); return }

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

  function handleTranslateSelection() {
    const text = selectionInfo.text
    setSelectionInfo(null)
    window.getSelection()?.removeAllRanges()
    setTranslatePopup({ text })
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
          : (
            <div ref={wrapperRef} className="canvas-transform">
              <div className="page-wrapper">
                <canvas ref={canvasRef} />
                <div ref={textLayerRef} className="text-layer" />
              </div>
            </div>
          )
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

      {/* Floating translate button — shown when desktop text is selected */}
      {selectionInfo && !popup && !translatePopup && (
        <button
          className="translate-fab"
          style={{ left: `${selectionInfo.x}px`, top: `${Math.max(64, selectionInfo.y - 48)}px` }}
          onMouseDown={e => e.preventDefault()}
          onClick={handleTranslateSelection}
        >
          Traduire
        </button>
      )}

      {popup && (
        <WordPopup
          word={popup.word}
          sentence={popup.sentence}
          bookId={bookId}
          onClose={() => setPopup(null)}
        />
      )}

      {translatePopup && (
        <TranslatePopup
          text={translatePopup.text}
          onClose={() => setTranslatePopup(null)}
        />
      )}

      {theme === 'night' && <div className="night-overlay" />}
    </div>
  )
}
