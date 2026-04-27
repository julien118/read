# READ App — CLAUDE.md (Memory File)

## Stack
- Vite + React
- PDF.js 3.11.174 via CDN (NOT npm — Vite bundling breaks iOS Safari)
- Supabase (Storage bucket "books" + tables books/vocabulary)
- Deployed on Vercel at read-julien.vercel.app

## PDF.js — CRITICAL iOS Safari rules
PDF.js MUST be loaded via CDN script tag in index.html:
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
NEVER import from npm (pdfjs-dist) — Vite bundles it with ES2022+ syntax that Safari iOS rejects.

Worker MUST be disabled:
  pdfjsLib.GlobalWorkerOptions.workerSrc = ''
  pdfjsLib.GlobalWorkerOptions.workerPort = null

getDocument MUST use these options:
  pdfjsLib.getDocument({
    data: arrayBuffer,
    isEvalSupported: false,
    useWorkerFetch: false,
    useSystemFonts: true,
    disableWorker: true
  })

PDF download MUST use fetch + arrayBuffer() — NO streaming, NO ReadableStream:
  const { data } = supabase.storage.from('books').getPublicUrl(path)
  const response = await fetch(data.publicUrl)
  const arrayBuffer = await response.arrayBuffer()

NEVER use:
  - for await...of on ReadableStream (breaks Safari iOS)
  - response.body.getReader() without fallback
  - supabase.storage.download() (uses XHR, unreliable on mobile Safari)
  - pdfjs-dist npm package
  - PDF.js version 4+ (ES2022 module syntax breaks Safari)

## PDF Text Extraction — Character fixes
PDF fonts encode ligatures as private-use Unicode chars.
Apply fixPDFChars() to every item.str from getTextContent():

  function fixPDFChars(str) {
    if (!str) return ''
    let result = ''
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i)
      if (code >= 0xE000 && code <= 0xF8FF) { result += ' '; continue } // ← SPACE not empty
      if (code === 0xFB00) { result += 'ff'; continue }
      if (code === 0xFB01) { result += 'fi'; continue }
      if (code === 0xFB02) { result += 'fl'; continue }
      if (code === 0xFB03) { result += 'ffi'; continue }
      if (code === 0xFB04) { result += 'ffl'; continue }
      if (code === 0xFB05 || code === 0xFB06) { result += 'st'; continue }
      if (code === 0xFFFD || code === 0x0000) continue
      if (code === 0x25A1 || code === 0x25A0) continue
      result += str[i]
    }
    return result.replace(/  +/g, ' ').trim()
  }

IMPORTANT: Replace private-use chars with SPACE (not empty string)
or words merge together ("Iam", "Itried", "Ican").

## Reader Layout — CRITICAL CSS fix
The reader MUST use normal document flow (NOT fixed/overflow:hidden):
  .kindle-reader: position: relative; min-height: 100dvh
  header/font-bar/progress-bar: position: fixed
  html/body/#root overflow: unlocked on mount

If reader uses position:fixed + overflow:hidden container:
  window.scrollY is always 0
  scroll position saving silently fails

## Supabase Setup
Tables:
  books: id, title, filename, total_pages, current_page, storage_path,
         cover_image, scroll_percent (float), last_read (timestamp),
         created_at, updated_at
  vocabulary: id, word, definition_fr, example_en, level, book_id, created_at

RLS is DISABLED on both tables (personal app, no auth).
Storage bucket "books" is PUBLIC.

## Claude API — CORS fix for iOS Safari
Safari blocks direct calls to api.anthropic.com.
ALL Claude API calls MUST go through /api/claude.js (Vercel serverless proxy):

  // /api/claude.js
  export default async function handler(req, res) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    })
    const data = await response.json()
    res.status(response.status).json(data)
  }

Frontend calls use '/api/claude' not 'https://api.anthropic.com/v1/messages'.
ANTHROPIC_API_KEY is set in Vercel environment variables (NOT VITE_ prefix).

## Reading Position Save — 5 triggers
1. Scroll (debounced 1500ms)
2. visibilitychange (app goes background)
3. pagehide + beforeunload
4. Back button tap
5. setInterval every 30s
6. useEffect cleanup (unmount)
Backup: localStorage key read_position_{book.id}

## Reading Modes
3 modes: ☀️ DAY / 🌙 SEPIA (default) / 🔴 NIGHT
NIGHT mode: CSS filter sepia(40%) + amber overlay rgba(255,140,0,0.12)
Persisted in localStorage key 'readingMode'

## Bottom Toolbar
‹ | A− | fontSize | A+
Back button is INSIDE the toolbar pill, not floating separately.
Font sizes: 14, 16, 18, 20, 22, 24px — saved in localStorage.

## Env Variables
Vercel:
  ANTHROPIC_API_KEY (server-side, for /api/claude.js)
  VITE_SUPABASE_URL
  VITE_SUPABASE_ANON_KEY
