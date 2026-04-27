import { useState, useEffect, useRef } from 'react'
import { getAllBooks, addBook, updateBookCover } from '../db'
import { generateCover } from '../utils/pdfUtils'
import BookCard from './BookCard'
import TitleModal from './TitleModal'

const THEME_ICONS = { white: '📖', sepia: '☀️', dark: '🌙' }

function cleanFilename(name) {
  return name
    .replace(/\.pdf$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase())
}

export default function Library({ onOpenBook, theme, onToggleTheme }) {
  const [books, setBooks] = useState([])
  const [uploading, setUploading] = useState(false)
  const [pending, setPending] = useState(null) // { buffer, fileName, title }
  const [uploadError, setUploadError] = useState(null)
  const fileInputRef = useRef()

  useEffect(() => { loadBooks() }, [])

  async function loadBooks() {
    setBooks(await getAllBooks())
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    fileInputRef.current.value = ''

    const buffer = await file.arrayBuffer()
    setPending({ buffer, fileName: file.name, title: cleanFilename(file.name) })
  }

  async function confirmUpload(title) {
    const { buffer, fileName } = pending
    setPending(null)
    setUploading(true)
    setUploadError(null)
    try {
      const id = crypto.randomUUID()
      await addBook(id, { id, title, fileName, addedAt: Date.now(), pageCount: 0, cover: null }, buffer)
      setBooks(await getAllBooks())
      const cover = await generateCover(buffer)
      if (cover) {
        await updateBookCover(id, cover)
        setBooks(await getAllBooks())
      }
    } catch (e) {
      console.error('Upload failed:', e)
      const msg = e?.message ?? String(e)
      const code = e?.error ?? e?.statusCode ?? ''
      setUploadError(code ? `${msg} (${code})` : msg)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="library">
      <header className="library-header">
        <h1 className="app-title">READ</h1>
        <div className="header-actions">
          <button className="icon-btn" onClick={onToggleTheme} title="Toggle theme">
            {THEME_ICONS[theme]}
          </button>
          <button className="icon-btn upload-btn" onClick={() => fileInputRef.current.click()} disabled={uploading}>
            {uploading ? <span className="spinner" /> : '+'}
          </button>
        </div>
      </header>

      <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={handleFile} />

      {uploadError && (
        <div className="upload-error" onClick={() => setUploadError(null)}>
          ⚠️ Erreur upload : {uploadError}
        </div>
      )}

      {pending && (
        <TitleModal
          initialTitle={pending.title}
          fileName={pending.fileName}
          onConfirm={confirmUpload}
          onCancel={() => setPending(null)}
        />
      )}

      {books.length === 0 && !uploading ? (
        <div className="empty-state">
          <div className="empty-icon">📚</div>
          <p className="empty-text">Your library is empty</p>
          <button className="cta-btn" onClick={() => fileInputRef.current.click()}>
            Add a PDF
          </button>
        </div>
      ) : (
        <div className="book-grid">
          {books.map(book => (
            <BookCard
              key={book.id}
              book={book}
              onOpen={() => onOpenBook(book.id)}
              onDeleted={loadBooks}
              onUpdated={loadBooks}
            />
          ))}
          {uploading && <div className="book-card-skeleton" />}
        </div>
      )}
    </div>
  )
}
