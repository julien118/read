import { useState, useEffect, useRef } from 'react'
import { getAllWords, deleteWord } from '../db'

const LEVEL_COLOR = { easy: '#22c55e', medium: '#f59e0b', hard: '#ef4444' }
const LEVEL_LABEL = { easy: 'Facile', medium: 'Moyen', hard: 'Difficile' }

function VocabCard({ entry, onDeleted }) {
  const dragX = useRef(0)
  const [swiped, setSwiped] = useState(false)

  function onTouchStart(e) { dragX.current = e.touches[0].clientX }
  function onTouchEnd(e) {
    const dx = e.changedTouches[0].clientX - dragX.current
    if (dx < -60) setSwiped(true)
    else setSwiped(false)
  }

  async function handleDelete() {
    await deleteWord(entry.id)
    onDeleted()
  }

  return (
    <div className={`vocab-card${swiped ? ' swiped' : ''}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="vocab-card-inner">
        <div className="vocab-word-row">
          <span className="vocab-word">{entry.word}</span>
          <span className="vocab-level" style={{ background: LEVEL_COLOR[entry.level] + '22', color: LEVEL_COLOR[entry.level] }}>
            {LEVEL_LABEL[entry.level] ?? entry.level}
          </span>
        </div>
        <p className="vocab-definition">{entry.definition_fr}</p>
        {entry.example_en && <p className="vocab-example">« {entry.example_en} »</p>}
      </div>
      <button className="vocab-delete-btn" onClick={handleDelete} aria-label="Supprimer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4h6v2" />
        </svg>
      </button>
    </div>
  )
}

export default function Vocabulary() {
  const [words, setWords] = useState([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setWords(await getAllWords())
    setLoaded(true)
  }

  return (
    <div className="vocabulary">
      <header className="library-header">
        <h1 className="app-title">VOCAB</h1>
        <span className="vocab-count">{words.length} mot{words.length !== 1 ? 's' : ''}</span>
      </header>

      {loaded && words.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🔤</div>
          <p className="empty-text">Aucun mot sauvegardé</p>
          <p className="empty-hint">Tapez sur un mot en lisant pour le sauvegarder.</p>
        </div>
      ) : (
        <div className="vocab-list">
          {words.map(entry => (
            <VocabCard key={entry.id} entry={entry} onDeleted={load} />
          ))}
        </div>
      )}
    </div>
  )
}
