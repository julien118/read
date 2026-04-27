import { useState, useEffect, useRef } from 'react'
import { getPDF, updateBookPageCount } from '../db'
import { supabase } from '../lib/supabase'
import WordPopup from './WordPopup'
import TranslatePopup from './TranslatePopup'
const pdfjsLib = window['pdfjs-dist/build/pdf']
pdfjsLib.GlobalWorkerOptions.workerSrc = ''

const FONT_SIZES = [14, 16, 18, 20, 22, 24]
const THEME_ICONS = { white: '☀️', dark: '🌙', night: '🔴' }

function fixPDFChars(str) {
  if (!str) return ''
  let result = ''
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    // Private Use Area → space to preserve word boundaries
    if (code >= 0xE000 && code <= 0xF8FF) { result += ' '; continue }
    if (code === 0xFB00) { result += 'ff'; continue }
    if (code === 0xFB01) { result += 'fi'; continue }
    if (code === 0xFB02) { result += 'fl'; continue }
    if (code === 0xFB03) { result += 'ffi'; continue }
    if (code === 0xFB04) { result += 'ffl'; continue }
    if (code === 0xFB05 || code === 0xFB06) { result += 'st'; continue }
    if (code === 0xFFFD || code === 0x0000) continue  // replacement char / null
    if (code === 0x25A0 || code === 0x25A1) { result += ' '; continue }  // □ ■ → space
    result += str[i]
  }
  return result
}

function reconstructWords(text) {
  return text
    // "a□er" → "after", "□er" → "fter"
    .replace(/a□er/g, 'after')
    .replace(/□er/g, 'fter')
    // "le□" → "left", etc.
    .replace(/le□/g, 'left')
    .replace(/so□/g, 'soft')
    .replace(/gi□/g, 'gift')
    .replace(/shi□/g, 'shift')
    .replace(/li□/g, 'lift')
    .replace(/dri□/g, 'drift')
    .replace(/sel□/g, 'self')
    .replace(/ful□/g, 'fulfil')
    .replace(/hal□/g, 'half')
    .replace(/hel□/g, 'help')
    // Uppercase "Th-" patterns
    .replace(/□is/g, 'This')
    .replace(/□ey/g, 'They')
    .replace(/□e /g, 'The ')
    .replace(/□e\./g, 'The.')
    .replace(/□e,/g, 'The,')
    .replace(/□us/g, 'Thus')
    .replace(/□at/g, 'That')
    .replace(/□en/g, 'Then')
    .replace(/□ere/g, 'There')
    .replace(/□rough/g, 'Through')
    .replace(/□ink/g, 'Think')
    .replace(/□ings/g, 'Things')
    .replace(/□ing/g, 'Thing')
    .replace(/□ose/g, 'Those')
    .replace(/□ough/g, 'Though')
    .replace(/□ought/g, 'Thought')
    // Lowercase versions
    .replace(/□is /g, 'this ')
    .replace(/□ey /g, 'they ')
    .replace(/□e /g, 'the ')
    .replace(/□us /g, 'thus ')
    .replace(/□at /g, 'that ')
    .replace(/□en /g, 'then ')
    .replace(/□ere /g, 'there ')
    .replace(/□rough/g, 'through')
    .replace(/□ink/g, 'think')
    .replace(/□ings/g, 'things')
    .replace(/□ing/g, 'thing')
    .replace(/□ose/g, 'those')
    .replace(/□ough/g, 'though')
    .replace(/□ought/g, 'thought')
    // Strip any remaining □
    .replace(/□/g, '')
}

function textItemsToParagraphs(items) {
  const textItems = items.filter(item => typeof item.str === 'string')
  if (!textItems.length) return []

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

  lineGroups.sort((a, b) => b.y - a.y)
  for (const g of lineGroups) g.items.sort((a, b) => a.transform[4] - b.transform[4])

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
    const raw = lineGroups[i].items.map(it => fixPDFChars(it.str)).join('').replace(/\s+/g, ' ').trim()
    if (!raw) continue
    pending.push(raw)
    const isLast = i === lineGroups.length - 1
    const nextGap = isLast ? Infinity : lineGroups[i].y - lineGroups[i + 1].y
    if (isLast || nextGap > PARA_GAP) {
      let para = pending.join(' ').replace(/\s+/g, ' ').trim()
      para = reconstructWords(para)
      para = para.replace(/\b([A-Z])\s+([a-z])/g, '$1$2')
      para = para.replace(/  +/g, ' ').trim()
      if (para) paragraphs.push(para)
      pending = []
    }
  }
  return paragraphs
}

export default function Reader({ bookId, onClose, theme, onToggleTheme }) {
  const [status, setStatus]           = useState('loading')
  const [errorMsg, setErrorMsg]       = useState('')
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [extractProgress, setExtractProgress]   = useState(0)
  const [content, setContent]         = useState([])
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

  const contentRef       = useRef()
  const numPagesRef      = useRef(0)
  const headerTimerRef   = useRef(null)
  const savedScrollRef   = useRef(0)
  const popupOpenRef     = useRef(false)
  const selInfoRef       = useRef(null)
  const longPressRef     = useRef(null)
  const touchStartRef    = useRef(null)
  const movedRef         = useRef(false)

  useEffect(() => { popupOpenRef.current = !!(popup || translatePopup) }, [popup, translatePopup])
  useEffect(() => { selInfoRef.current = selectionInfo }, [selectionInfo])

  // ── Unlock window scroll while reader is open ───────────────────────
  useEffect(() => {
    document.documentElement.style.overflow = 'auto'
    document.body.style.overflow = 'auto'
    const root = document.getElementById('root')
    if (root) root.style.overflow = 'auto'
    window.scrollTo({ top: 0, behavior: 'instant' })
    return () => {
      document.documentElement.style.overflow = ''
      document.body.style.overflow = ''
      if (root) root.style.overflow = ''
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
  }, [])

  // ── Load PDF then extract all text ──────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data: book, error: bookError } = await supabase
          .from('books')
          .select('id, title, storage_path, cover_image, scroll_percent, total_pages')
          .eq('id', bookId)
          .single()

        // Step 1 debug — verify column exists and value
        console.log('[Reader] saved position from DB:', book?.scroll_percent, 'error:', bookError)

        if (cancelled) return
        if (book?.title)       setBookTitle(book.title)
        if (book?.cover_image) setBookCover(book.cover_image)
        savedScrollRef.current = book?.scroll_percent ?? 0

        const buffer = await getPDF(book, pct => {
          if (!cancelled) setDownloadProgress(pct)
        })
        if (cancelled) return

        const pdf = await pdfjsLib.getDocument({
          data: new Uint8Array(buffer),
          isEvalSupported: false,
          useWorkerFetch: false,
          useSystemFonts: true,
          disableWorker: true,
        }).promise
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
            const scale    = Math.min(640 / vp.width, 1.5)
            const scaledVp = page.getViewport({ scale })
            const canvas   = document.createElement('canvas')
            canvas.width   = Math.round(scaledVp.width)
            canvas.height  = Math.round(scaledVp.height)
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

  // ── Restore scroll after content renders ────────────────────────────
  useEffect(() => {
    if (!content.length || savedScrollRef.current <= 0) return
    setTimeout(() => {
      const total = document.documentElement.scrollHeight - window.innerHeight
      const target = (savedScrollRef.current / 100) * total
      console.log('[Reader] restoring to', savedScrollRef.current + '%', '→ px', target, 'total', total)
      window.scrollTo({ top: target, behavior: 'instant' })
    }, 500)
  }, [content])

  // ── Auto-hide header after ready ─────────────────────────────────────
  useEffect(() => {
    if (status !== 'ready') return
    headerTimerRef.current = setTimeout(() => setShowHeader(false), 3000)
    return () => clearTimeout(headerTimerRef.current)
  }, [status])

  // ── Scroll listener — save on every scroll event ────────────────────
  useEffect(() => {
    if (status !== 'ready') return
    const handleScroll = () => {
      const total = document.documentElement.scrollHeight - window.innerHeight
      if (total <= 0) return
      const percent = Math.round((window.scrollY / total) * 100)
      setScrollPct(percent)

      supabase
        .from('books')
        .update({ scroll_percent: percent })
        .eq('id', bookId)
        .then(({ error }) => {
          if (error) console.error('[Reader] SAVE ERROR:', error)
          else console.log('[Reader] saved position:', percent + '%')
        })

      clearTimeout(headerTimerRef.current)
      headerTimerRef.current = setTimeout(() => setShowHeader(false), 3000)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [bookId, status])

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

  // ── Word detection ───────────────────────────────────────────────────
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
    console.log('[Reader] word tap:', word, '| sentence:', sentence.slice(0, 80))
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
      const el   = document.elementFromPoint(lx, ly)
      const para = el?.closest?.('p')
      const text = para?.textContent?.trim()
      if (text && text.split(/\s+/).length >= 3) {
        console.log('[Reader] long press translate:', text.slice(0, 80))
        setTranslatePopup({ text })
      }
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

  async function handleBack() {
    const total = document.documentElement.scrollHeight - window.innerHeight
    const pct = total > 0 ? Math.round((window.scrollY / total) * 100) : 0
    await supabase
      .from('books')
      .update({ scroll_percent: pct, last_read: new Date().toISOString() })
      .eq('id', bookId)
    onClose()
  }

  return (
    <div className="kindle-reader">
      <div className={`kindle-header${showHeader ? ' visible' : ''}`}>
        <span className="kindle-book-title">
          {bookTitle}{scrollPct > 0 ? ` • ${scrollPct}%` : ''}
        </span>
        <button className="kindle-nav-btn" onClick={onToggleTheme} aria-label="Mode lecture">
          {THEME_ICONS[theme] ?? '☀️'}
        </button>
      </div>

      <div
        className="kindle-scroll"
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

      <div className="kindle-font-bar">
        <button className="kindle-font-btn" onClick={handleBack} aria-label="Retour">‹</button>
        <span className="kindle-font-sep" />
        <button className="kindle-font-btn" onClick={() => changeFontSize(-1)} disabled={fontSize <= FONT_SIZES[0]} aria-label="Diminuer">A−</button>
        <span className="kindle-font-cur">{fontSize}</span>
        <button className="kindle-font-btn" onClick={() => changeFontSize(+1)} disabled={fontSize >= FONT_SIZES[FONT_SIZES.length - 1]} aria-label="Augmenter">A+</button>
      </div>

      <div className="kindle-progress">
        <div className="kindle-progress-fill" style={{ width: `${scrollPct}%` }} />
      </div>

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
