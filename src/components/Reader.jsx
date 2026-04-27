import { useState, useEffect, useRef } from 'react'
import { getPDF, saveProgress, updateBookPageCount } from '../db'
import { supabase } from '../lib/supabase'
import WordPopup from './WordPopup'
import TranslatePopup from './TranslatePopup'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href

const FONT_SIZES = [14, 16, 18, 20, 22, 24]
const THEME_ICONS = { white: '☀️', dark: '🌙', night: '🔴' }

// Convert PDF.js text items from one page into paragraphs
function textItemsToParagraphs(items) {
  const textItems = items.filter(item => typeof item.str === 'string')
  if (!textItems.length) return []

  // Group by Y coordinate into lines (tolerance = 2 PDF units)
  const LINE_TOL = 2
  const lineGroups = []
  for (const item of textItems) {
    if (!item.str) continue
    const y = item.transform[5]
    const g = lineGroups.find(g => Math.abs(g.y - y) <= LINE_TOL)
    if (g) {
      g.items.push(item)
      g.height = Math.max(g.height, item.height || 0)
    } else {
      lineGroups.push({ y, items: [item], height: item.height || 10 })
    }
  }

  // Sort top-to-bottom (PDF Y increases upward → sort descending)
  lineGroups.sort((a, b) => b.y - a.y)
  for (const g of lineGroups) g.items.sort((a, b) => a.transform[4] - b.transform[4])

  // Compute median gap between lines for paragraph detection
  const gaps = []
  for (let i = 0; i < lineGroups.length - 1; i++) {
    const gap = lineGroups[i].y - lineGroups[i + 1].y
    if (gap > 0 && gap < 100) gaps.push(gap)
  }
  gaps.sort((a, b) => a - b)
  const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 12
  const PARA_GAP = medianGap * 1.6

  const paragraphs = []
  let pending = []
  for (let i = 0; i < lineGroups.length; i++) {
    const text = lineGroups[i].items.map(it => it.str).join('').replace(/\s+/g, ' ').trim()
    if (!text) continue
    pending.push(text)
    const isLast = i === lineGroups.length - 1
    const nextGap = isLast ? Infinity : lineGroups[i].y - lineGroups[i + 1].y
    if (isLast || nextGap > PARA_GAP) {
      const para = pending.join(' ').replace(/\s+/g, ' ').trim()
      if (para) paragraphs.push(para)
      pending = []
    }
  }
  return paragraphs
}

export default function Reader({ bookId, onClose, theme, onToggleTheme }) {
  const [status, setStatus]           = useState('loading') // loading|extracting|ready|error
  const [errorMsg, setErrorMsg]       = useState('')
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [extractProgress, setExtractProgress]   = useState(0)
  const [content, setContent]         = useState([]) // { type:'text', data:string[] } | { type:'image', data:string }
  const [bookTitle, setBookTitle]     = useState('')
  const [bookCover, setBookCover]     = useState(null)
  const [scrollPct, setScrollPct]     = useState(0)
  const [showHeader, setShowHeader]   = useState(true)
  const [fontSize, setFontSize]       = useState(() => {
    const s = parseInt(localStorage.getItem('reader-font-size'))
    return FONT_SIZES.includes(s) ? s : 18
  })
  const [popup, setPopup]             = useState(null)
  const [translatePopup, setTranslatePopup] = useState(null)
  const [selectionInfo, setSelectionInfo]   = useState(null)

  const scrollRef        = useRef()
  const contentRef       = useRef()
  const numPagesRef      = useRef(0)
  const headerTimerRef   = useRef(null)
  const progressTimerRef = useRef(null)
  const savedScrollRef   = useRef(0) // 0–100 pct
  const popupOpenRef     = useRef(false)
  const selInfoRef       = useRef(null)
  const longPressRef     = useRef(null)
  const touchStartRef    = useRef(null)
  const movedRef         = useRef(false)

  useEffect(() => { popupOpenRef.current = !!(popup || translatePopup) }, [popup, translatePopup])
  useEffect(() => { selInfoRef.current = selectionInfo }, [selectionInfo])

  // ── Load PDF then extract all text ──────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data: book } = await supabase
          .from('books')
          .select('title, current_page, total_pages, cover_image, storage_path')
          .eq('id', bookId)
          .single()
        if (cancelled) return
        if (book?.title)       setBookTitle(book.title)
        if (book?.cover_image) setBookCover(book.cover_image)
        const savedPage  = book?.current_page ?? 1
        const totalPages = book?.total_pages  ?? 1
        savedScrollRef.current = totalPages > 1 ? ((savedPage - 1) / (totalPages - 1)) * 100 : 0

        const buffer = await getPDF(book, pct => {
          if (!cancelled) setDownloadProgress(pct)
        })
        if (cancelled) return

        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise
        if (cancelled) { pdf.destroy(); return }
        numPagesRef.current = pdf.numPages
        updateBookPageCount(bookId, pdf.numPages)

        setStatus('extracting')
        const blocks = []

        for (let p = 1; p <= pdf.numPages; p++) {
          if (cancelled) break
          setExtractProgress(Math.round((p / pdf.numPages) * 100))

          const page = await pdf.getPage(p)
          const vp   = page.getViewport({ scale: 1 })
          const tc   = await page.getTextContent({ includeMarkedContent: false })
          const textItems = tc.items.filter(item => typeof item.str === 'string')
          const totalChars = textItems.reduce((s, i) => s + i.str.length, 0)

          if (totalChars < 20) {
            // Image-dominant page: render to canvas and embed as JPEG
            const scale     = Math.min(640 / vp.width, 1.5)
            const scaledVp  = page.getViewport({ scale })
            const canvas    = document.createElement('canvas')
            canvas.width    = Math.round(scaledVp.width)
            canvas.height   = Math.round(scaledVp.height)
            try {
              await page.render({ canvasContext: canvas.getContext('2d'), viewport: scaledVp }).promise
              blocks.push({ type: 'image', data: canvas.toDataURL('image/jpeg', 0.85) })
            } catch { /* skip */ }
          } else {
            const paras = textItemsToParagraphs(textItems)
            if (paras.length) blocks.push({ type: 'text', data: paras })
          }
          page.cleanup()
        }

        if (!cancelled) {
          setContent(blocks)
          setStatus('ready')
          pdf.destroy()
        }
      } catch (e) {
        console.error('Reader load error:', e)
        if (!cancelled) {
          setErrorMsg(e?.message ?? e?.error_description ?? String(e))
          setStatus('error')
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [bookId])

  // ── Restore scroll position after content mounts ────────────────────
  useEffect(() => {
    if (status !== 'ready' || !scrollRef.current) return
    const pct = savedScrollRef.current
    if (pct > 0) {
      requestAnimationFrame(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = (pct / 100) * (el.scrollHeight - el.clientHeight)
      })
    }
    // Auto-hide header after 3s of inactivity
    headerTimerRef.current = setTimeout(() => setShowHeader(false), 3000)
    return () => clearTimeout(headerTimerRef.current)
  }, [status])

  // ── Scroll handler ──────────────────────────────────────────────────
  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const pct = el.scrollHeight - el.clientHeight > 0
      ? (el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100
      : 0
    setScrollPct(pct)

    clearTimeout(progressTimerRef.current)
    progressTimerRef.current = setTimeout(() => {
      const n = numPagesRef.current
      if (n > 0) saveProgress(bookId, Math.max(1, Math.round((pct / 100) * n)))
    }, 2000)

    clearTimeout(headerTimerRef.current)
    headerTimerRef.current = setTimeout(() => setShowHeader(false), 3000)
  }

  // ── Font size ───────────────────────────────────────────────────────
  function changeFontSize(delta) {
    setFontSize(prev => {
      const next = FONT_SIZES[Math.max(0, Math.min(FONT_SIZES.length - 1, FONT_SIZES.indexOf(prev) + delta))]
      localStorage.setItem('reader-font-size', next)
      return next
    })
  }

  // ── Text selection → floating Traduire ──────────────────────────────
  useEffect(() => {
    let t = null
    function onSel() {
      clearTimeout(t)
      t = setTimeout(() => {
        if (popupOpenRef.current) return
        const sel  = window.getSelection()
        const text = sel?.toString().trim()
        if (!text || text.split(/\s+/).filter(Boolean).length < 2) { setSelectionInfo(null); return }
        if (!contentRef.current?.contains(sel.anchorNode))          { setSelectionInfo(null); return }
        try {
          const rect = sel.getRangeAt(0).getBoundingClientRect()
          setSelectionInfo({ text, x: rect.left + rect.width / 2, y: rect.top })
        } catch { setSelectionInfo(null) }
      }, 120)
    }
    document.addEventListener('selectionchange', onSel)
    return () => { document.removeEventListener('selectionchange', onSel); clearTimeout(t) }
  }, [])

  // ── Keyboard ────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') {
        if (popup || translatePopup) { setPopup(null); setTranslatePopup(null) }
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, popup, translatePopup])

  // ── Word detection in reflowed HTML ─────────────────────────────────
  function getWordAtPoint(cx, cy) {
    if (!contentRef.current) return null
    let node = null, offset = 0
    if (document.caretPositionFromPoint) {
      const cp = document.caretPositionFromPoint(cx, cy)
      if (cp) { node = cp.offsetNode; offset = cp.offset }
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(cx, cy)
      if (r) { node = r.startContainer; offset = r.startOffset }
    }
    if (!node || node.nodeType !== Node.TEXT_NODE) return null
    if (!contentRef.current.contains(node)) return null
    const str = node.textContent
    let s = offset, e = offset
    while (s > 0 && /[a-zA-ZÀ-ÿ''-]/.test(str[s - 1])) s--
    while (e < str.length && /[a-zA-ZÀ-ÿ''-]/.test(str[e])) e++
    const word = str.slice(s, e).replace(/[^a-zA-ZÀ-ÿ''-]/g, '').toLowerCase()
    if (word.length < 2) return null
    const sentence = node.parentElement?.closest('p')?.textContent?.trim() ?? ''
    return { word, sentence }
  }

  // ── Touch handling ───────────────────────────────────────────────────
  function onTouchStart(e) {
    if (popup || translatePopup) return
    clearTimeout(longPressRef.current)
    movedRef.current = false
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    const lx = e.touches[0].clientX, ly = e.touches[0].clientY
    longPressRef.current = setTimeout(() => {
      if (movedRef.current) return
      const el    = document.elementFromPoint(lx, ly)
      const para  = el?.closest?.('p')
      const text  = para?.textContent?.trim()
      if (text && text.split(/\s+/).length >= 3) setTranslatePopup({ text })
    }, 500)
  }
  function onTouchMove(e) {
    if (!touchStartRef.current) return
    const dx = e.touches[0].clientX - touchStartRef.current.x
    const dy = e.touches[0].clientY - touchStartRef.current.y
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { movedRef.current = true; clearTimeout(longPressRef.current) }
  }
  function onTouchEnd(e) {
    clearTimeout(longPressRef.current)
    if (popup || translatePopup) return
    if (movedRef.current) return
    const touch = e.changedTouches[0]
    if (!touch) return
    if (selInfoRef.current) { setSelectionInfo(null); window.getSelection()?.removeAllRanges(); return }
    const result = getWordAtPoint(touch.clientX, touch.clientY)
    if (result?.word) {
      setPopup(result)
    } else {
      setShowHeader(true)
      clearTimeout(headerTimerRef.current)
      headerTimerRef.current = setTimeout(() => setShowHeader(false), 3000)
    }
  }

  function handleTranslateSelection() {
    const text = selectionInfo.text
    setSelectionInfo(null)
    window.getSelection()?.removeAllRanges()
    setTranslatePopup({ text })
  }

  // ── Loading / extracting screens ─────────────────────────────────────
  if (status === 'loading' || status === 'extracting') {
    // Download fills 0→50%, extraction fills 50→100%
    const combinedPct = status === 'loading'
      ? Math.round(downloadProgress / 2)
      : 50 + Math.round(extractProgress / 2)
    const label = status === 'loading' ? 'Chargement en cours…' : 'Extraction du texte…'
    return (
      <div className="kindle-reader">
        <div className="kindle-loading">
          {bookCover
            ? <img className="kindle-loading-cover" src={bookCover} alt="" />
            : <div className="kindle-loading-cover-placeholder" />}
          {bookTitle && <p className="kindle-loading-title">{bookTitle}</p>}
          <div className="kindle-loading-bar-wrap">
            <div className="kindle-loading-bar-fill" style={{ width: `${combinedPct || 3}%` }} />
          </div>
          <p className="kindle-loading-label">{label}</p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="kindle-reader">
        <div className="kindle-loading">
          <p style={{ color: 'var(--text-sub)', padding: '0 24px', textAlign: 'center', maxWidth: 340, fontSize: 14, lineHeight: 1.5 }}>
            Impossible de charger ce livre.
            {errorMsg ? <><br /><span style={{ fontSize: 12, opacity: 0.7 }}>{errorMsg}</span></> : null}
          </p>
          <button className="popup-retry" style={{ marginTop: 16 }} onClick={onClose}>Retour</button>
        </div>
      </div>
    )
  }

  // ── Reader ────────────────────────────────────────────────────────────
  return (
    <div className="kindle-reader">
      {/* Auto-hiding header */}
      <div className={`kindle-header${showHeader ? ' visible' : ''}`}>
        <button className="kindle-nav-btn" onClick={onClose} aria-label="Retour">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="kindle-book-title">{bookTitle}</span>
        <button className="kindle-nav-btn" onClick={onToggleTheme} aria-label="Mode lecture">
          {THEME_ICONS[theme] ?? '☀️'}
        </button>
      </div>

      {/* Scrollable reading area */}
      <div
        ref={scrollRef}
        className="kindle-scroll"
        onScroll={handleScroll}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div ref={contentRef} className="kindle-content" style={{ fontSize: `${fontSize}px` }}>
          {content.map((block, i) =>
            block.type === 'image'
              ? <img key={i} className="kindle-img" src={block.data} alt="" />
              : block.data.map((para, j) => <p key={`${i}-${j}`}>{para}</p>)
          )}
        </div>
      </div>

      {/* Font size pill */}
      <div className="kindle-font-bar">
        <button
          className="kindle-font-btn"
          onClick={() => changeFontSize(-1)}
          disabled={fontSize <= FONT_SIZES[0]}
          aria-label="Diminuer la taille"
        >A−</button>
        <span className="kindle-font-cur">{fontSize}</span>
        <button
          className="kindle-font-btn"
          onClick={() => changeFontSize(+1)}
          disabled={fontSize >= FONT_SIZES[FONT_SIZES.length - 1]}
          aria-label="Augmenter la taille"
        >A+</button>
      </div>

      {/* Thin progress bar */}
      <div className="kindle-progress">
        <div className="kindle-progress-fill" style={{ width: `${scrollPct}%` }} />
      </div>

      {/* Floating Traduire button (desktop selection) */}
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
        <WordPopup word={popup.word} sentence={popup.sentence} bookId={bookId} onClose={() => setPopup(null)} />
      )}
      {translatePopup && (
        <TranslatePopup text={translatePopup.text} onClose={() => setTranslatePopup(null)} />
      )}
    </div>
  )
}
