import { useState, useEffect, useRef } from 'react'
import { lookupWord, translateText } from '../api/claude'
import { saveWord } from '../db'

const LEVEL_COLOR = { easy: '#22c55e', medium: '#f59e0b', hard: '#ef4444' }
const LEVEL_LABEL = { easy: 'facile', medium: 'moyen', hard: 'difficile' }

export default function WordPopup({ word, sentence, bookId, onClose }) {
  const [phase, setPhase] = useState('loading') // loading | result | error | translating | translated
  const [data, setData] = useState(null)
  const [translation, setTranslation] = useState(null)
  const [saved, setSaved] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const dragY = useRef(0)
  const overlayRef = useRef()

  useEffect(() => { fetchDefinition() }, [word])

  async function fetchDefinition() {
    setPhase('loading')
    setSaved(false)
    setTranslation(null)
    try {
      const result = await lookupWord(word)
      setData(result)
      setPhase('result')
    } catch (e) {
      setErrorMsg(e.message)
      setPhase('error')
    }
  }

  async function handleTranslate() {
    if (!sentence) return
    setPhase('translating')
    try {
      const result = await translateText(sentence)
      setTranslation(result)
      setPhase('translated')
    } catch (e) {
      setPhase('result')
    }
  }

  async function handleSaveWord() {
    if (!data) return
    await saveWord({ word, definition_fr: data.definition_fr, example_en: data.example_en, level: data.level, bookId })
    setSaved(true)
  }

  function onTouchStart(e) { dragY.current = e.touches[0].clientY }
  function onTouchEnd(e) {
    if (e.changedTouches[0].clientY - dragY.current > 80) onClose()
  }

  return (
    <div className="popup-overlay" ref={overlayRef} onClick={e => { if (e.target === overlayRef.current) onClose() }}>
      <div className="popup-sheet" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="popup-handle" />

        {phase === 'loading' && (
          <div className="popup-loading"><span className="spinner large" /></div>
        )}

        {phase === 'error' && (
          <div className="popup-error">
            <p>Erreur : {errorMsg}</p>
            <button className="popup-retry" onClick={fetchDefinition}>Réessayer</button>
          </div>
        )}

        {(phase === 'result' || phase === 'translating' || phase === 'translated') && data && (
          <>
            <div className="popup-word-row">
              <span className="popup-word">{word}</span>
              <span className="popup-level" style={{ background: LEVEL_COLOR[data.level] + '22', color: LEVEL_COLOR[data.level] }}>
                {LEVEL_LABEL[data.level] ?? data.level}
              </span>
            </div>

            <p className="popup-definition">{data.definition_fr}</p>

            <p className="popup-example">« {data.example_en} »</p>

            {phase === 'translated' && translation && (
              <div className="popup-translation">
                <p className="popup-translation-text">{translation.translation_fr}</p>
                <p className="popup-translation-explain">{translation.explanation_fr}</p>
              </div>
            )}

            <div className="popup-actions">
              {sentence && phase === 'result' && (
                <button className="popup-action secondary" onClick={handleTranslate}>
                  Traduire la phrase
                </button>
              )}
              {phase === 'translating' && (
                <button className="popup-action secondary" disabled>
                  <span className="spinner" /> Traduction…
                </button>
              )}
              <button
                className={`popup-action primary${saved ? ' saved' : ''}`}
                onClick={handleSaveWord}
                disabled={saved}
              >
                {saved ? '✓ Sauvegardé' : '★ Sauvegarder'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
