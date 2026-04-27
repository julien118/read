import { useState, useRef } from 'react'
import { deleteBook, updateBookTitle } from '../db'
import useLongPress from '../hooks/useLongPress'

export default function BookCard({ book, onOpen, onDeleted, onUpdated }) {
  const [deleteMode, setDeleteMode] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef()

  const longPress = useLongPress(() => setDeleteMode(true), 500)

  async function handleDelete(e) {
    e.stopPropagation()
    await deleteBook(book.id)
    onDeleted()
  }

  function handleCardClick() {
    if (deleteMode) { setDeleteMode(false); return }
    if (editing) return
    onOpen()
  }

  function startEdit(e) {
    e.stopPropagation()
    setDeleteMode(false)
    setDraft(book.title)
    setEditing(true)
    // autoFocus via ref after state settles
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 0)
  }

  async function commitEdit() {
    const trimmed = draft.trim()
    setEditing(false)
    if (trimmed && trimmed !== book.title) {
      await updateBookTitle(book.id, trimmed)
      onUpdated()
    }
  }

  function handleInputKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit() }
    if (e.key === 'Escape') setEditing(false)
  }

  const initial = book.title?.charAt(0)?.toUpperCase() ?? '?'

  return (
    <div
      className={`book-card${deleteMode ? ' delete-mode' : ''}`}
      onClick={handleCardClick}
      {...longPress}
    >
      <div className="book-cover">
        {book.cover
          ? <img src={book.cover} alt="" draggable={false} />
          : <div className="book-cover-placeholder"><span>{initial}</span></div>
        }
        {deleteMode && (
          <div className="delete-overlay">
            <button className="delete-btn" onClick={handleDelete}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                <path d="M10 11v6M14 11v6M9 6V4h6v2" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <div className="book-meta">
        <div className="book-title-row">
          {editing ? (
            <input
              ref={inputRef}
              className="book-title-input"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={handleInputKey}
              onClick={e => e.stopPropagation()}
              onTouchStart={e => e.stopPropagation()}
            />
          ) : (
            <>
              <p className="book-title">{book.title}</p>
              <button
                className="edit-title-btn"
                onClick={startEdit}
                onTouchStart={e => e.stopPropagation()}
                onMouseDown={e => e.stopPropagation()}
                aria-label="Edit title"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            </>
          )}
        </div>
        {book.pageCount > 0 && <p className="book-pages">{book.pageCount}p</p>}
      </div>
    </div>
  )
}
