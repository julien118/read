import { useState, useEffect, useRef } from 'react'

export default function TitleModal({ initialTitle, fileName, onConfirm, onCancel }) {
  const [title, setTitle] = useState(initialTitle)
  const inputRef = useRef()

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  function handleSubmit(e) {
    e.preventDefault()
    const t = title.trim()
    if (t) onConfirm(t)
  }

  function handleOverlayKey(e) {
    if (e.key === 'Escape') onCancel()
  }

  return (
    <div className="modal-overlay" onClick={onCancel} onKeyDown={handleOverlayKey}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <p className="modal-filename">{fileName}</p>
        <h2 className="modal-heading">Name your book</h2>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className="modal-input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Book title"
            onKeyDown={e => e.key === 'Escape' && onCancel()}
          />
          <div className="modal-actions">
            <button type="button" className="modal-btn cancel" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="modal-btn confirm" disabled={!title.trim()}>
              Add to Library
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
